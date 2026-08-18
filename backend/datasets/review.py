# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: review.py
# Copyright (c) 2024

"""
Phase 2 review queue: classifies images by the kind of sanity-gate
problem they need a human to resolve, plus the action handlers that
record audit-logged decisions.

Each image lands in exactly one flag category (the most important
issue takes precedence) so the UI can present them in priority order
without duplication.
"""

from __future__ import annotations

import logging
from typing import Dict, List, Optional

from django.conf import settings
from django.utils import timezone

from .models import Image, ImageReviewEvent, Dataset, Label

logger = logging.getLogger(__name__)


# Priority order: each image hits the first category it qualifies for.
# 'pending_review' is the catch-all that holds every unreviewed image that
# did not trigger any specific problem flag, so the queue stays usable as a
# manual approval list even when nothing is broken.
REVIEW_FLAGS = (
    'species_mismatch',
    'low_resolution',
    'no_scale_bar',
    'tooth_is_scale_bar',
    'impossible_size',
    'out_of_range_completeness',
    'low_ocr_confidence',
    'no_museum_label',
    'pending_review',
)

# Flags derived from reading the catalog label rather than from measuring the
# tooth.
#
# This study does not use the label at all: the species is settled by which
# directory a photograph came from, and what is needed from each image is the
# measurement. Raising these anyway buried the queue in work nobody wants
# done. On the fragments they accounted for 1,021 of 1,093 entries, so the 72
# images actually missing a measurement were lost among them, and 'species
# mismatch' compares the folder against an OCR read that recovers a usable
# catalog number on about one image in ten.
#
# Set PHASE2_REVIEW_METADATA_FLAGS = True to bring them back when the label
# becomes part of the work.
METADATA_FLAGS = frozenset({
    'species_mismatch',
    'low_ocr_confidence',
    'no_museum_label',
})

REVIEW_FLAG_LABELS = {
    'species_mismatch': 'OCR / folder species mismatch',
    'low_resolution': 'Too low resolution to measure',
    'no_scale_bar': 'No scale bar detected',
    'tooth_is_scale_bar': 'The scale card was measured as the tooth',
    'impossible_size': 'Measures larger than a whole tooth',
    'out_of_range_completeness': 'Completeness out of range',
    'low_ocr_confidence': 'Low OCR confidence',
    'no_museum_label': 'No museum label found on a source image',
    'pending_review': 'Pending review',
}

# Long edge below which an image is treated as unmeasurable in principle.
#
# This is deliberately NOT the 2500 px ingest spec. That number describes how
# much resolution a *wide* frame needs for its card to survive downscaling; it
# says nothing about a tight crop, where the card can be large in the frame at
# a much smaller pixel count. Using 2500 here mislabelled 65 UF studio crops
# (median 1703 px) as "too low resolution" when their cards are perfectly
# legible: UF233474 is 1500 px and calibrates to 22.0 mm on a card whose bands
# are ~49 px wide, eight times the detector's minimum.
#
# 1200 px is where the evidence actually sits: across the full 2,638-image
# census not one image below it calibrated, while the 1200-2500 px band did.
# Anything above this that fails is a detector miss and belongs in the
# no-scale-bar queue where someone will look at it.
LOW_RESOLUTION_PX = 1200

REVIEW_FLAG_DESCRIPTIONS = {
    'species_mismatch': (
        'The species parsed from the catalog label disagrees with the '
        'label assigned to the image. Decide which one is correct.'
    ),
    'low_resolution': (
        'The photograph is too small (under %d px on its long edge) for the '
        'scale card to be resolved. These are almost always images sourced '
        'from the web rather than shot in the studio, so no re-processing '
        'will recover a physical measurement. They remain usable for '
        'classification, where only the tooth image matters.' % LOW_RESOLUTION_PX
    ),
    'tooth_is_scale_bar': (
        'The outline reported as the tooth is the same object as the scale '
        'card, so what has been measured is the card, not the specimen. The '
        'scale itself is usually still correct, which is why the size can look '
        'unremarkable: on UF 237905 the card measures 561 mm2 against a '
        'Galeocerdo cuvier maximum of 553, so it reports 100% complete and '
        'nothing else gives it away. Set the scale by hand, or exclude the '
        'image.'
    ),
    'impossible_size': (
        'This specimen measures larger than the BIGGEST complete tooth of its '
        'species in the reference collection, which a fragment cannot be. '
        'Something other than the tooth has been measured: the scale card '
        'taken for the tooth, or a scale bar misread so every millimetre is '
        'inflated. Open it and check what the green outline is around, and '
        'whether the reported size is credible for the specimen.'
    ),
    'no_scale_bar': (
        'The image is in an "original"-resolution dataset where a scale '
        'bar is expected, but the detector did not find one. mm-anchored '
        'metrics cannot be computed for this image until the scale bar '
        'is identified. Unlike the low-resolution bucket, these are full '
        'resolution photographs that should have worked, so they are worth '
        'inspecting.'
    ),
    'out_of_range_completeness': (
        'mm-anchored completeness landed outside the plausible 0% - 105% '
        'window. Usually means the species reference is wrong or the '
        'scale-bar calibration is off.'
    ),
    'low_ocr_confidence': (
        'OCR parsed at least one field but enough fields are missing '
        'that the result should be verified by a human.'
    ),
    'no_museum_label': (
        'A source-resolution image with a successful scale-bar '
        'calibration but no museum specimen id extracted. The catalog '
        'label was either clipped, unreadable, or merged with another '
        'feature.'
    ),
    'pending_review': (
        'Unreviewed images with no automatic issues. Inspect each one '
        'and mark it reviewed (or excluded) to move it out of the queue.'
    ),
}


def _long_edge_px(img: Image) -> int:
    """Long edge of the stored file, or 0 when it cannot be read.

    PIL only parses the header for .size, so this is cheap. Returning 0 on
    failure deliberately routes unreadable files into the low-resolution
    bucket rather than the detector-miss bucket, since a file we cannot open
    is not something a reviewer can fix by looking at the scale bar.
    """
    try:
        from PIL import Image as PILImage
        with PILImage.open(img.image.path) as im:
            return max(im.size)
    except Exception:
        return 0


# A dataset is treated as label-bearing when at least this share of its images
# yielded catalog text. Well below what a genuinely labelled set produces, and
# well above the incidental hits (stray marks, a handful of odd frames) seen on
# a set that carries no labels.
LABEL_BEARING_MIN_SHARE = 0.25

# The line past which a measurement cannot be a fragment.
#
# Compared against the LARGEST complete tooth of that species, not the median.
# Complete teeth vary far more than a median suggests: Otodus megalodon spans
# 17x from median to maximum, Hemipristis serra 7x, Carcharodon carcharias 5x.
# An earlier version used 1.5x the median and flagged 176 specimens, but a
# 63.3 mm great white fragment reading 3.3x the median turned out to be a
# perfectly good measurement - 51 of 522 complete teeth of that species exceed
# 50 mm. Comparing against the middle of a distribution to detect an outlier
# rejects ordinary large specimens.
#
# Above the species maximum there is no such excuse, which leaves 7 specimens.
# A small margin allows for the reference set not containing the true largest
# individual.
IMPOSSIBLE_SIZE_MARGIN = 1.05


def _dataset_carries_labels(ds: Dataset) -> bool:
    """True when this dataset's photographs generally include a catalog label.

    Judged from OCR output rather than assumed, so it stays correct as new
    batches arrive. Returns False before OCR has run, which errs toward a quiet
    queue instead of thousands of unactionable flags.
    """
    total = Image.objects.filter(dataset=ds).exclude(
        source_kind__in=('masked', 'processed')).count()
    if not total:
        return False
    with_text = Image.objects.filter(dataset=ds).exclude(
        source_kind__in=('masked', 'processed')).filter(
        ocr_label_text__isnull=False).count()
    return (with_text / total) >= LABEL_BEARING_MIN_SHARE


def get_review_flags(dataset_id: int) -> Dict[str, List[Image]]:
    """
    Walk every image in the dataset and bin into flag categories.
    Already-resolved (reviewed / excluded) images are skipped.

    The returned dict's keys are exactly REVIEW_FLAGS (in the same order)
    so the UI can iterate predictably; missing categories appear as
    empty lists.
    """
    ds = Dataset.objects.get(pk=dataset_id)
    resolution = str(ds.resolution).lower()
    is_source_dataset = (resolution == 'original')

    # Does this dataset's photography include catalog labels at all?
    #
    # Alexa's Phase 2 shots frame the tooth, the scale card AND the catalog
    # label. The historical baseline shots frame only the tooth and the scale
    # card. Flagging "no museum label" per image on a set that never had
    # labels buries the real problems: on the baseline it fired on all 1,977
    # calibrated images, which is not a queue anyone can work through. So the
    # flag is suppressed for datasets whose photography plainly does not carry
    # labels, and kept for datasets where labels are the norm and a specific
    # image is missing one.
    label_bearing = is_source_dataset and _dataset_carries_labels(ds)

    flags: Dict[str, List[Image]] = {key: [] for key in REVIEW_FLAGS}

    # Median complete-tooth area per species, for the impossible-size check.
    #
    # Only meaningful for a set measured against a DIFFERENT population. On the
    # reference dataset itself the comparison is circular: complete teeth are
    # scored against their own median, so roughly half exceed it and the larger
    # individuals of a species trip the rule for being ordinary. It flagged 517
    # perfectly good whole teeth before this was scoped.
    from .models import SpeciesReferenceArea
    from django.db.models import Max as _Max
    reference_area_mm2 = {}
    ref_dataset_ids = set(SpeciesReferenceArea.objects
                          .filter(avg_area_mm2__isnull=False)
                          .exclude(dataset_id=ds.id)
                          .values_list('dataset_id', flat=True))
    if ref_dataset_ids:
        for row in (Image.objects
                    .filter(dataset_id__in=ref_dataset_ids, tooth_area_mm2__isnull=False)
                    .values('label_id')
                    .annotate(biggest=_Max('tooth_area_mm2'))):
            reference_area_mm2[row['label_id']] = float(row['biggest'])

    # Label-derived flags are off unless the study actually uses the label.
    metadata_flags_on = bool(getattr(settings, 'PHASE2_REVIEW_METADATA_FLAGS', False))

    images = (
        Image.objects.filter(dataset=ds)
        .select_related('label')
        .order_by('id')
    )

    for img in images:
        if img.review_status in ('reviewed', 'excluded'):
            continue

        # 1. Species mismatch. Case-insensitive comparison; trim spaces.
        #
        # Checked before the scale-bar test, so while it was on it could hide a
        # missing measurement behind a disagreement about a label this study
        # does not use.
        if metadata_flags_on and img.museum_species and img.label and img.label.name:
            if img.museum_species.strip().lower() != img.label.name.strip().lower():
                flags['species_mismatch'].append(img)
                continue

        # 2. No scale bar (only meaningful on source datasets). Split by
        # resolution: a 600 px web-sourced image can never be measured, while
        # a full-resolution studio photograph that failed is a detector miss
        # worth a human look. Mixing them makes the queue unactionable.
        # Resolution is read lazily and only for images that already lack a
        # scale bar, so this costs a header read on a minority of the dataset
        # rather than on every image.
        if is_source_dataset and not img.scale_bar_detected:
            if _long_edge_px(img) < LOW_RESOLUTION_PX:
                flags['low_resolution'].append(img)
            else:
                flags['no_scale_bar'].append(img)
            continue

        # 3. Out of range completeness.
        if img.completeness_mm2 is not None:
            if img.completeness_mm2 > 1.05 or img.completeness_mm2 < -0.05:
                flags['out_of_range_completeness'].append(img)
                continue

        # 4. Low OCR confidence.
        md = img.museum_metadata or {}
        if metadata_flags_on and isinstance(md, dict):
            conf = md.get('confidence')
            if conf is not None and conf < 0.5:
                flags['low_ocr_confidence'].append(img)
                continue

        # 5. Calibration succeeded but no museum_specimen_id was parsed.
        # MASKED images by construction cannot carry a catalog label (the
        # background that held it was removed), and PROCESSED images have
        # the label cropped out, so neither should flag here.
        if (
            metadata_flags_on
            and label_bearing
            and img.mm_per_pixel
            and not img.museum_specimen_id
            and img.source_kind not in ('masked', 'processed')
        ):
            flags['no_museum_label'].append(img)
            continue

        # 5a. The card measured as the tooth.
        #
        # One object cannot be both the specimen and the ruler used to measure
        # it. When the two outlines coincide, the blob picked as the tooth is
        # the scale card: on the fragments this is 211 images, 18% of the set,
        # and it is the single largest defect found.
        #
        # It hides well. The scale is usually still correct - only 13% of these
        # have an mm/px far from their species median - so the measurement
        # looks plausible and simply describes the wrong object. Their areas sit
        # at 1.03x the species median against 0.65x for the rest, and 53% report
        # exactly 100% complete against 24%. Size alone would not separate them,
        # which is why UF 17895C passed every other check.
        if (img.tooth_bbox and img.scale_bar_bbox
                and list(img.tooth_bbox) == list(img.scale_bar_bbox)):
            flags['tooth_is_scale_bar'].append(img)
            continue

        # 5b. A measurement that cannot be true.
        #
        # A fragment cannot be larger than a whole tooth of its own species, so
        # anything well above the complete-tooth reference is not a small
        # result, it is the wrong object measured. Two real causes, both found
        # this way: the scale card classified as the tooth (UF 17895C, where
        # the card is 40x the fragment's area and won on size), and a misread
        # scale inflating every millimetre (UF 17879JM at 13x, mm/px eight
        # times its species median).
        #
        # The check needs no per-species tuning and no threshold anyone typed
        # in: the reference is measured from the complete teeth already in the
        # collection, so it keeps working as new material arrives and on images
        # nobody has looked at. It found 176 of 1,192 fragments, including
        # species that were not suspected.
        if (reference_area_mm2
                and img.tooth_area_mm2
                and img.label_id in reference_area_mm2):
            ref = reference_area_mm2[img.label_id]
            if ref > 0 and float(img.tooth_area_mm2) > ref * IMPOSSIBLE_SIZE_MARGIN:
                flags['impossible_size'].append(img)
                continue

        # 6. Catch-all: every other unreviewed image goes here so the queue
        # stays the single place a reviewer goes to approve work.
        flags['pending_review'].append(img)

    return flags


def apply_review_action(
    image: Image,
    action: str,
    user=None,
    notes: Optional[str] = None,
):
    """
    Apply a review action to one image. Records an ImageReviewEvent in
    every case. Returns (success: bool, error_message: Optional[str]).
    """
    previous_status = image.review_status
    metadata: dict = {}

    if action == 'mark_reviewed':
        image.review_status = 'reviewed'
    elif action == 'mark_unreviewed':
        image.review_status = 'unreviewed'
    elif action == 'mark_excluded':
        image.review_status = 'excluded'
    elif action == 'trust_ocr':
        if not image.museum_species:
            return False, 'image has no OCR species to trust'
        try:
            new_label = Label.objects.get(name__iexact=image.museum_species.strip())
        except Label.DoesNotExist:
            return False, f'no Label named {image.museum_species!r} exists'
        if new_label.id != image.label_id:
            metadata['previous_label_id'] = image.label_id
            metadata['previous_label_name'] = image.label.name if image.label else None
            metadata['new_label_id'] = new_label.id
            metadata['new_label_name'] = new_label.name
            image.label = new_label
        image.review_status = 'reviewed'
    elif action == 'trust_folder':
        # Keep current label; just mark reviewed.
        image.review_status = 'reviewed'
    else:
        return False, f'unknown action: {action!r}'

    image.review_notes = notes or None
    image.reviewed_at = timezone.now()
    image.reviewed_by = user if (user is not None and getattr(user, 'is_authenticated', False)) else None
    image.save()

    ImageReviewEvent.objects.create(
        image=image,
        user=image.reviewed_by,
        action=action,
        previous_status=previous_status,
        new_status=image.review_status,
        notes=notes or None,
        metadata=metadata or None,
    )
    return True, None

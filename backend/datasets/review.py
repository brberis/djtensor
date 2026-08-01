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
    'out_of_range_completeness',
    'low_ocr_confidence',
    'no_museum_label',
    'pending_review',
)

REVIEW_FLAG_LABELS = {
    'species_mismatch': 'OCR / folder species mismatch',
    'low_resolution': 'Too low resolution to measure',
    'no_scale_bar': 'No scale bar detected',
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

    images = (
        Image.objects.filter(dataset=ds)
        .select_related('label')
        .order_by('id')
    )

    for img in images:
        if img.review_status in ('reviewed', 'excluded'):
            continue

        # 1. Species mismatch. Case-insensitive comparison; trim spaces.
        if img.museum_species and img.label and img.label.name:
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
        if isinstance(md, dict):
            conf = md.get('confidence')
            if conf is not None and conf < 0.5:
                flags['low_ocr_confidence'].append(img)
                continue

        # 5. Calibration succeeded but no museum_specimen_id was parsed.
        # MASKED images by construction cannot carry a catalog label (the
        # background that held it was removed), and PROCESSED images have
        # the label cropped out, so neither should flag here.
        if (
            label_bearing
            and img.mm_per_pixel
            and not img.museum_specimen_id
            and img.source_kind not in ('masked', 'processed')
        ):
            flags['no_museum_label'].append(img)
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

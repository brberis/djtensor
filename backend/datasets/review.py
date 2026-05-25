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
    'no_scale_bar',
    'out_of_range_completeness',
    'low_ocr_confidence',
    'no_museum_label',
    'pending_review',
)

REVIEW_FLAG_LABELS = {
    'species_mismatch': 'OCR / folder species mismatch',
    'no_scale_bar': 'No scale bar detected',
    'out_of_range_completeness': 'Completeness out of range',
    'low_ocr_confidence': 'Low OCR confidence',
    'no_museum_label': 'No museum label found on a source image',
    'pending_review': 'Pending review',
}

REVIEW_FLAG_DESCRIPTIONS = {
    'species_mismatch': (
        'The species parsed from the catalog label disagrees with the '
        'label assigned to the image. Decide which one is correct.'
    ),
    'no_scale_bar': (
        'The image is in an "original"-resolution dataset where a scale '
        'bar is expected, but the detector did not find one. mm-anchored '
        'metrics cannot be computed for this image until the scale bar '
        'is identified.'
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

        # 2. No scale bar (only meaningful on source datasets).
        if is_source_dataset and not img.scale_bar_detected:
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
            is_source_dataset
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

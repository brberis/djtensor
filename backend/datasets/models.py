# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: models.py
# Copyright (c) 2024

from django.db import models
from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver
from .tasks import create_dataset_archive
import os

RESOLUTIONS = [
    ('224', '224'),
    ('384', '384'),
    ('512', '512'),
    ('original', 'Original (Phase 2 source)'),
]

class Dataset(models.Model):
    study = models.ForeignKey('feature_extractor.Study', related_name='datasets', blank=True, null=True, on_delete=models.CASCADE)
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True, null=True)
    labels = models.ManyToManyField('Label', related_name='datasets')
    resolution = models.CharField(max_length=10, choices=RESOLUTIONS, default='224')
    base = models.BooleanField(default=False)
    for_testing = models.BooleanField(default=True)
    shared = models.ManyToManyField('feature_extractor.Study', related_name='shared_datasets')
    # Transformed dataset provenance
    synthetic = models.BooleanField(default=False)
    source_dataset = models.ForeignKey('self', null=True, blank=True, on_delete=models.SET_NULL, related_name='derived_datasets')
    transformation_type = models.CharField(
        max_length=50, blank=True, null=True,
        help_text="Type of transformation applied (e.g. fracture, augmentation)"
    )
    generation_config = models.JSONField(
        null=True, blank=True,
        help_text="Parameters used to generate this dataset"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['study', 'name'],
                name='unique_dataset_name_per_study',
            ),
        ]

    def __str__(self):
        return self.name

class Label(models.Model):
    name = models.CharField(max_length=100)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name

def get_image_upload_path(instance, filename):
    dataset_name = instance.dataset.name.lower().replace(' ', '_')
    return os.path.join('datasets', f"{dataset_name}-{instance.dataset.id}", filename)

class Image(models.Model):
    dataset = models.ForeignKey(Dataset, related_name='images', on_delete=models.SET_NULL, null=True, blank=True)
    image = models.ImageField(upload_to=get_image_upload_path)
    label = models.ForeignKey(Label, related_name='images', on_delete=models.CASCADE)
    # SHA-256 hash for deduplication. Nullable so existing rows are not broken.
    file_hash = models.CharField(max_length=64, blank=True, null=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    used_for_training = models.BooleanField(default=False)
    used_for_testing = models.BooleanField(default=False)
    # Tooth completeness detection fields
    tooth_area = models.IntegerField(blank=True, null=True)
    completeness = models.FloatField(blank=True, null=True)
    # Synthetic image provenance
    source_image = models.ForeignKey('self', null=True, blank=True, on_delete=models.SET_NULL, related_name='synthetic_derivatives')
    target_completeness = models.FloatField(null=True, blank=True)

    # Phase 2: scale-aware (mm/px) calibration and metrics. All nullable so
    # existing rows are unaffected. Populated by the scale_calibration pipeline
    # when an image carries a detectable ruler.
    mm_per_pixel = models.FloatField(null=True, blank=True)
    scale_bar_detected = models.BooleanField(default=False)
    scale_bar_source = models.CharField(max_length=20, null=True, blank=True)
    scale_bar_bbox = models.JSONField(null=True, blank=True)
    # Detected ruler tick positions along the bar's long axis. Stored as
    # {"long_axis": "x"|"y", "positions": [int, ...]}. Lets the review
    # inspector render the centimeter blocks the detector actually used
    # to compute mm/px.
    scale_bar_ticks = models.JSONField(null=True, blank=True)
    # Bounding box of the segmented tooth in source pixel coords
    # ([x0, y0, x1, y1]). Used by the review inspector to overlay the
    # detection on top of the original image.
    tooth_bbox = models.JSONField(null=True, blank=True)
    # Relative path to a green-tinted PNG of the exact segmented tooth
    # shape (cropped to tooth_bbox + small margin). The review inspector
    # overlays this image on hover so the researcher sees the precise
    # area that was measured, not a rectangular approximation.
    tooth_mask_url = models.CharField(max_length=255, null=True, blank=True)
    tooth_area_mm2 = models.FloatField(null=True, blank=True)
    # Axis-aligned bbox dimensions in mm. Useful for cropping but orientation-
    # dependent: a tilted tooth will give an apparently-square bbox.
    tooth_width_mm = models.FloatField(null=True, blank=True)
    tooth_height_mm = models.FloatField(null=True, blank=True)
    # Intrinsic shape dimensions via the equivalent-ellipse fit (second
    # central moments). Orientation-independent: the "length" of the tooth
    # along its principal axis regardless of how it sits in the photo.
    tooth_major_axis_mm = models.FloatField(null=True, blank=True)
    tooth_minor_axis_mm = models.FloatField(null=True, blank=True)
    completeness_mm2 = models.FloatField(null=True, blank=True)

    # Phase 2: mean-shape brokenness metric (Katie's method, see
    # datasets/brokenness/). Parallel to completeness_mm2 -- both stored
    # so the paper can compare them. percent_broken is a 0..100 float:
    # fraction of the per-species mean-mask footprint that's missing
    # from the aligned query tooth. brokenness_meta carries the
    # alignment info (best angle/shift/flipped/IoU + chosen quantile).
    percent_broken = models.FloatField(null=True, blank=True)
    brokenness_overlay_url = models.CharField(max_length=255, null=True, blank=True)
    brokenness_meta = models.JSONField(null=True, blank=True)

    # Phase 2: provenance kind. Distinguishes images straight from Alexa's
    # camera (carry catalog label + scale bar + background) from her
    # pre-processed versions (background removed, catalog label dropped)
    # from downstream model-ready 384x384 outputs. Drives which pipeline
    # steps are expected to apply, e.g. OCR is only meaningful on RAW.
    SOURCE_KIND_CHOICES = [
        ('raw',       'RAW (camera original, label visible)'),
        ('masked',    'MASKED (background removed, label dropped)'),
        ('processed', 'PROCESSED (downstream 384x384, model-ready)'),
    ]
    source_kind = models.CharField(
        max_length=16,
        choices=SOURCE_KIND_CHOICES,
        null=True, blank=True,
        db_index=True,
    )

    # Phase 2: museum metadata parsed from FLMNH catalog labels via OCR.
    # Populated by datasets.label_ocr; only meaningful on RAW images that
    # still carry the printed label.
    museum_specimen_id = models.CharField(max_length=64, null=True, blank=True, db_index=True)
    museum_species = models.CharField(max_length=128, null=True, blank=True)
    museum_completeness_category = models.CharField(max_length=128, null=True, blank=True)
    museum_metadata = models.JSONField(null=True, blank=True)
    ocr_label_text = models.TextField(null=True, blank=True)

    # Phase 2: curation review status. Drives the review queue UI and the
    # eventual curated-snapshot inclusion. Default 'unreviewed' means the
    # image is fresh / not yet triaged by a researcher.
    REVIEW_STATUS_CHOICES = [
        ('unreviewed', 'Unreviewed'),
        ('reviewed', 'Reviewed'),
        ('excluded', 'Excluded from curated set'),
    ]
    review_status = models.CharField(
        max_length=16,
        choices=REVIEW_STATUS_CHOICES,
        default='unreviewed',
        db_index=True,
    )
    review_notes = models.TextField(null=True, blank=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    reviewed_by = models.ForeignKey(
        'auth.User',
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='reviewed_images',
    )

    def __str__(self):
        return self.image.url


class ImageReviewEvent(models.Model):
    """
    Audit log row for every review-status change on an Image. Lets the team
    answer 'who decided this' / 'why is this excluded' / 'when did the OCR
    species replace the folder label' even months later.
    """
    image = models.ForeignKey(
        Image,
        related_name='review_events',
        on_delete=models.CASCADE,
    )
    user = models.ForeignKey(
        'auth.User',
        null=True, blank=True,
        on_delete=models.SET_NULL,
    )
    action = models.CharField(max_length=32)
    previous_status = models.CharField(max_length=16, null=True, blank=True)
    new_status = models.CharField(max_length=16, null=True, blank=True)
    notes = models.TextField(null=True, blank=True)
    metadata = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ('-created_at',)

    def __str__(self):
        return f'{self.image_id} {self.action} {self.created_at:%Y-%m-%d %H:%M}'


class SpeciesReferenceArea(models.Model):
    label = models.ForeignKey(Label, related_name='reference_areas', on_delete=models.CASCADE)
    dataset = models.ForeignKey(Dataset, related_name='reference_areas', on_delete=models.CASCADE)
    avg_area = models.FloatField()
    sample_count = models.IntegerField()
    # Phase 2: parallel mm^2 reference, computed only from images that carry a
    # detectable scale bar. avg_area (px^2) remains the historical reference.
    avg_area_mm2 = models.FloatField(null=True, blank=True)
    sample_count_mm2 = models.IntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('label', 'dataset')

    def __str__(self):
        return f"{self.label.name} in {self.dataset.name}: avg_area={self.avg_area}"


@receiver(post_delete, sender=Image)
def create_dataset_archive_on_delete(sender, instance, **kwargs):
    create_dataset_archive.delay(instance.dataset.id)

@receiver(post_delete, sender=Dataset)
def handle_dataset_deletion(sender, instance, **kwargs):
    # Synthetic dataset images should be deleted, not moved to base
    if instance.synthetic:
        Image.objects.filter(dataset=instance).delete()
        return
    base_dataset = Dataset.objects.filter(base=True, study=instance.study).first()
    if base_dataset:
        related_images = Image.objects.filter(dataset=instance)
        related_images.update(
            dataset=base_dataset,
            used_for_training=False,
            used_for_testing=False
        )

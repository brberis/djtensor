# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: tasks.py
# Copyright (c) 2024


from celery_app import app
from celery import shared_task
import os
import tarfile
from django.conf import settings
import logging

logger = logging.getLogger(__name__)

@shared_task
def create_dataset_archive(dataset_id):
    from .models import Dataset, Image

    dataset = Dataset.objects.get(pk=dataset_id)
    file_name = dataset.name.replace(' ', '_').lower()

    # Use a single base_dir directly under 'archive'
    base_dir = settings.MEDIA_ROOT / 'archive' / file_name
    os.makedirs(base_dir, exist_ok=True)
    logger.info(f"PATH: {base_dir}")

    for label in dataset.labels.all():
        label_dir = base_dir / label.name.replace(' ', '_').lower()
        logger.info(f"LABEL PATH: {label_dir}")
        os.makedirs(label_dir, exist_ok=True)

        # Fetch images that are both associated with the current label and the dataset
        images = Image.objects.filter(label=label, dataset=dataset)  

        for image in images:
            original_path = settings.MEDIA_ROOT / image.image.name
            target_path = label_dir / os.path.basename(image.image.name)
            if not os.path.exists(target_path):
                os.link(original_path, target_path)
                logger.info(f"Linked image {original_path} to {target_path}")
            else:
                logger.info(f"Image already exists at {target_path}")

    # Creating tar.gz file directly in 'archive'
    tar_path = settings.MEDIA_ROOT / 'archive' / f'{file_name}.tar.gz'
    with tarfile.open(tar_path, 'w:gz') as tar:
        tar.add(base_dir, arcname=file_name)  

    # Clean up the directory after archiving
    for root, dirs, files in os.walk(base_dir, topdown=False):
        for name in files:
            os.remove(os.path.join(root, name))
        for name in dirs:
            os.rmdir(os.path.join(root, name))
    logger.info(f"Archive created successfully at {tar_path}")


@shared_task
def compute_completeness_for_dataset(dataset_id, reference_dataset_id=None):
    """
    Compute tooth completeness for all images in a dataset.

    If reference_dataset_id is provided, uses that dataset's images to build
    species reference areas. Otherwise, uses the same dataset (assumes complete teeth).
    """
    from .models import Dataset, Image, SpeciesReferenceArea
    from .segmentation import segment_tooth, compute_tooth_area, compute_completeness

    dataset = Dataset.objects.get(pk=dataset_id)
    ref_dataset_id = reference_dataset_id or dataset_id

    # Step 1: Build reference areas from reference dataset
    ref_images = Image.objects.filter(dataset_id=ref_dataset_id).select_related('label')
    label_areas = {}  # {label_id: [areas]}

    for img in ref_images:
        try:
            mask = segment_tooth(img.image.path)
            area = compute_tooth_area(mask)
            if area > 0:
                label_areas.setdefault(img.label_id, []).append(area)
        except Exception as e:
            logger.warning(f"Segmentation failed for image {img.id}: {e}")

    # Step 2: Store/update SpeciesReferenceArea records
    ref_dataset = Dataset.objects.get(pk=ref_dataset_id)
    reference_map = {}  # {label_id: avg_area}

    for label_id, areas in label_areas.items():
        import numpy as np
        avg = float(np.mean(areas))
        SpeciesReferenceArea.objects.update_or_create(
            label_id=label_id,
            dataset=ref_dataset,
            defaults={'avg_area': avg, 'sample_count': len(areas)},
        )
        reference_map[label_id] = avg

    # Step 3: Compute completeness for each image in the target dataset
    images = Image.objects.filter(dataset=dataset).select_related('label')
    to_update = []

    for img in images:
        # Skip synthetic images that already have completeness from generation
        # (re-segmenting synthetic images gives wrong results because the dentine
        # fill gets detected as tooth area)
        if img.source_image_id is not None and img.completeness is not None:
            continue
        try:
            mask = segment_tooth(img.image.path)
            area = compute_tooth_area(mask)
            ref_area = reference_map.get(img.label_id, 0)
            compl = compute_completeness(area, ref_area) if ref_area > 0 else None
            img.tooth_area = area
            img.completeness = compl
            to_update.append(img)
        except Exception as e:
            logger.warning(f"Completeness computation failed for image {img.id}: {e}")

    if to_update:
        Image.objects.bulk_update(to_update, ['tooth_area', 'completeness'], batch_size=100)

    logger.info(f"Completeness computed for {len(to_update)} images in dataset {dataset.name}")


@shared_task
def generate_synthetic_dataset(source_dataset_id, name, completeness_bins, images_per_bin,
                               profile_overrides=None, augmentations=None):
    """
    Generate a synthetic dataset of fragmentary tooth images from a source dataset.

    Pipeline: fragment generation -> augmentation transforms (if selected).
    Augmentations are applied after fragmentation so the cascade produces
    e.g. fragmented + grayscale images in a single pass.

    Args:
        source_dataset_id: ID of the source dataset (complete teeth).
        name: Name for the new synthetic dataset.
        completeness_bins: List of target completeness values, e.g. [0.8, 0.6, 0.4].
        images_per_bin: Number of images to generate per species per bin.
        profile_overrides: Optional dict of {species_name: profile_dict} to override defaults.
        augmentations: Optional dict of augmentation flags (e.g. {'grayscale': True, 'horizontal_flip': True}).
    """
    from .models import Dataset, Image, Label
    from .synthetic_fracture import generate_synthetic_fragment
    from django.core.files.base import ContentFile
    from PIL import Image as PILImage
    import io
    import random
    import numpy as np

    source = Dataset.objects.get(pk=source_dataset_id)

    # Determine transformation type from selected options
    has_augmentations = augmentations and any(augmentations.values())
    if has_augmentations:
        transform_type = 'fracture+augmentation'
    else:
        transform_type = 'fracture'

    # Create the synthetic dataset
    syn_dataset = Dataset.objects.create(
        study=source.study,
        name=name,
        description=f"Synthetic fragments from {source.name}. Bins: {completeness_bins}",
        resolution=source.resolution,
        base=False,
        for_testing=False,
        synthetic=True,
        source_dataset=source,
        transformation_type=transform_type,
        generation_config={
            'completeness_bins': completeness_bins,
            'images_per_bin': images_per_bin,
            'profile_overrides': profile_overrides,
            'augmentations': augmentations,
        },
    )
    syn_dataset.labels.set(source.labels.all())

    # Build augmentation pipeline once if augmentations are selected
    augmentation_pipeline = None
    if has_augmentations:
        from .augmentation_preview import build_augmentation_pipeline
        resolution = int(source.resolution)
        augmentation_pipeline = build_augmentation_pipeline(
            augmentations, image_size=(resolution, resolution)
        )

    # Ensure source images have tooth_area computed for exact completeness
    from .segmentation import segment_tooth, compute_tooth_area
    source_areas = {}  # cache {image_id: tooth_area}

    total_generated = 0
    # Absolute minimum: the lowest bin the user selected
    absolute_min = min(completeness_bins) - 0.10

    for label in source.labels.all():
        source_images = list(Image.objects.filter(dataset=source, label=label))
        if not source_images:
            continue

        # Get species-specific profile override if provided
        species_override = None
        if profile_overrides and label.name in profile_overrides:
            species_override = profile_overrides[label.name]

        for target_compl in completeness_bins:
            generated = 0
            max_attempts = images_per_bin * 5  # retry budget
            attempts = 0
            min_acceptable = max(target_compl - 0.20, absolute_min, 0.10)
            max_acceptable = min(target_compl + 0.20, 1.0)

            while generated < images_per_bin and attempts < max_attempts:
                attempts += 1
                src_img = random.choice(source_images)
                try:
                    result_img, actual_compl = generate_synthetic_fragment(
                        src_img.image.path,
                        target_completeness=target_compl,
                        species=label.name,
                        profile_override=species_override,
                    )

                    # Filter: skip if completeness is too far from target
                    if actual_compl < min_acceptable or actual_compl > max_acceptable:
                        logger.info(f"Skipped {label.name} target={target_compl:.0%} actual={actual_compl:.0%} (out of range)")
                        continue

                    # Apply augmentation pipeline if selected
                    if augmentation_pipeline is not None:
                        import tensorflow as tf
                        img_array = np.array(result_img, dtype=np.float32)
                        batch = tf.expand_dims(img_array, 0)
                        augmented = augmentation_pipeline(batch, training=True)
                        aug_np = np.clip(augmented.numpy()[0], 0, 255).astype(np.uint8)
                        result_img = PILImage.fromarray(aug_np)

                    buf = io.BytesIO()
                    result_img.save(buf, format='PNG')
                    buf.seek(0)

                    filename = f"syn_{label.name}_{int(target_compl * 100)}pct_{generated}_{src_img.id}.png"
                    content = ContentFile(buf.getvalue(), name=filename)

                    # Compute exact tooth_area from source original
                    if src_img.id not in source_areas:
                        src_area = src_img.tooth_area
                        if src_area is None:
                            try:
                                mask = segment_tooth(src_img.image.path)
                                src_area = compute_tooth_area(mask)
                                src_img.tooth_area = src_area
                                src_img.save(update_fields=['tooth_area'])
                            except Exception:
                                src_area = 0
                        source_areas[src_img.id] = src_area

                    orig_area = source_areas[src_img.id]
                    result_tooth_area = int(actual_compl * orig_area) if orig_area else None

                    Image.objects.create(
                        dataset=syn_dataset,
                        image=content,
                        label=label,
                        source_image=src_img,
                        target_completeness=target_compl,
                        tooth_area=result_tooth_area,
                        completeness=actual_compl,
                    )
                    generated += 1
                    total_generated += 1

                except Exception as e:
                    logger.warning(f"Failed to generate fragment for image {src_img.id} at {target_compl}: {e}")

            if generated < images_per_bin:
                logger.warning(f"{label.name} {target_compl:.0%}: only generated {generated}/{images_per_bin} after {attempts} attempts")

    logger.info(f"Synthetic dataset '{name}' created with {total_generated} images")

    # Trigger archive creation
    create_dataset_archive.delay(syn_dataset.id)
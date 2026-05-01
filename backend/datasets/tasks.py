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


def _synth_attempt_worker(args):
    """Single fragment-generation attempt for a process pool worker.

    Pure CPU; touches no DB and no Django/TensorFlow state. Returns enough
    metadata for the parent process to decide whether to keep the result
    and to write the corresponding Image row.

    Worker-side encoding to PNG bytes avoids pickling huge PIL.Image objects
    back across the process boundary.
    """
    src_id, src_path, target_compl, species, profile_override = args
    from .synthetic_fracture import generate_synthetic_fragment
    import io
    try:
        result_img, actual_compl = generate_synthetic_fragment(
            src_path,
            target_completeness=target_compl,
            species=species,
            profile_override=profile_override,
        )
        buf = io.BytesIO()
        result_img.save(buf, format='PNG')
        return ('ok', src_id, target_compl, float(actual_compl), buf.getvalue(), None)
    except Exception as exc:
        return ('err', src_id, target_compl, None, None, str(exc))


def _synth_source_worker(args):
    """Per-source retry loop for a process pool worker (use_all_sources mode).

    Tries up to max_retries to land actual_completeness inside the tolerance
    band. If none of the attempts land in band, returns the closest-to-target
    result as a fallback.
    """
    (src_id, src_path, target_compl, species, profile_override,
     min_acceptable, max_acceptable, max_retries) = args
    from .synthetic_fracture import generate_synthetic_fragment
    import io
    best = None  # (abs_error, actual_compl, png_bytes)
    last_error = None
    for _ in range(max_retries):
        try:
            result_img, actual_compl = generate_synthetic_fragment(
                src_path,
                target_completeness=target_compl,
                species=species,
                profile_override=profile_override,
            )
        except Exception as exc:
            last_error = str(exc)
            break
        buf = io.BytesIO()
        result_img.save(buf, format='PNG')
        png_bytes = buf.getvalue()
        if min_acceptable <= actual_compl <= max_acceptable:
            return ('ok', src_id, target_compl, float(actual_compl), png_bytes, False)
        err = abs(actual_compl - target_compl)
        if best is None or err < best[0]:
            best = (err, actual_compl, png_bytes)
    if best is not None:
        return ('ok', src_id, target_compl, float(best[1]), best[2], True)
    return ('err', src_id, target_compl, None, None, last_error or 'no result')


def _synth_pool_workers():
    """Number of parallel processes for synthetic-fragment generation.

    Honours the SYNTHETIC_FRAGMENT_WORKERS env var; otherwise uses up to
    4 processes or os.cpu_count(), whichever is smaller. Capped to keep
    peak memory bounded since each worker holds ~few-hundred MB of
    numpy/PIL state during generation.
    """
    import os as _os
    override = _os.environ.get('SYNTHETIC_FRAGMENT_WORKERS')
    if override:
        try:
            n = int(override)
            if n >= 1:
                return n
        except ValueError:
            pass
    cpu = _os.cpu_count() or 1
    return max(1, min(cpu, 4))


@shared_task
def generate_synthetic_dataset(syn_dataset_id, completeness_bins, images_per_bin,
                               profile_overrides=None, augmentations=None,
                               use_all_sources=False):
    """
    Populate a synthetic dataset with fragmentary tooth images.

    The dataset record is created by the API view before this task runs,
    so the frontend can navigate to the dataset page immediately.

    Pipeline: fragment generation -> augmentation transforms (if selected).
    Augmentations are applied after fragmentation so the cascade produces
    e.g. fragmented + grayscale images in a single pass.

    Args:
        syn_dataset_id: ID of the pre-created synthetic dataset.
        completeness_bins: List of target completeness values, e.g. [0.8, 0.6, 0.4].
        images_per_bin: Number of images to generate per species per bin. Ignored
            when use_all_sources is True.
        profile_overrides: Optional dict of {species_name: profile_dict} to override defaults.
        augmentations: Optional dict of augmentation flags (e.g. {'grayscale': True, 'horizontal_flip': True}).
        use_all_sources: If True, emit one fragment per source image per bin (max
            per class, no oversampling). If a generated fragment falls out of
            tolerance it is retried once with a fresh random cut before being skipped.
    """
    from .models import Dataset, Image, Label
    from django.core.files.base import ContentFile
    from PIL import Image as PILImage
    import io
    import random
    import numpy as np
    import multiprocessing
    from concurrent.futures import ProcessPoolExecutor, as_completed

    syn_dataset = Dataset.objects.get(pk=syn_dataset_id)
    source = syn_dataset.source_dataset

    has_augmentations = augmentations and any(augmentations.values())

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
    # Derive tolerance from bin spacing
    sorted_bins = sorted(completeness_bins)
    if len(sorted_bins) > 1:
        bin_gaps = [sorted_bins[i+1] - sorted_bins[i] for i in range(len(sorted_bins)-1)]
        tolerance = max(min(bin_gaps) / 2, 0.05)
    else:
        tolerance = 0.08  # single bin: tight ±8% range
    absolute_min = max(sorted_bins[0] - tolerance, 0.05)

    # Use spawn so worker processes get a clean interpreter and don't inherit
    # Django/TF state from the celery task process — fork-after-TF can break
    # CUDA in surprising ways if anything touches the GPU.
    mp_ctx = multiprocessing.get_context('spawn')
    pool_workers = _synth_pool_workers()
    logger.info(f"Synthetic generation using {pool_workers} parallel worker(s)")
    src_image_by_id = {}  # populated as we encounter sources

    def emit_fragment(src_img, target_compl, actual_compl, png_bytes, label, generated):
        """Apply augmentation (parent-side, TF-only) and persist the Image row."""
        if augmentation_pipeline is not None:
            import tensorflow as tf
            with PILImage.open(io.BytesIO(png_bytes)) as pil_img:
                img_array = np.array(pil_img.convert('RGB'), dtype=np.float32)
            batch = tf.expand_dims(img_array, 0)
            augmented = augmentation_pipeline(batch, training=True)
            aug_np = np.clip(augmented.numpy()[0], 0, 255).astype(np.uint8)
            buf = io.BytesIO()
            PILImage.fromarray(aug_np).save(buf, format='PNG')
            png_bytes = buf.getvalue()

        filename = f"syn_{label.name}_{int(target_compl * 100)}pct_{generated}_{src_img.id}.png"
        content = ContentFile(png_bytes, name=filename)

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

    with ProcessPoolExecutor(max_workers=pool_workers, mp_context=mp_ctx) as executor:
        for label in source.labels.all():
            source_images = list(Image.objects.filter(dataset=source, label=label))
            if not source_images:
                continue

            for src_img in source_images:
                src_image_by_id[src_img.id] = src_img

            # Get species-specific profile override if provided
            species_override = None
            if profile_overrides and label.name in profile_overrides:
                species_override = profile_overrides[label.name]

            for target_compl in completeness_bins:
                min_acceptable = max(target_compl - tolerance, absolute_min, 0.05)
                max_acceptable = min(target_compl + tolerance, 0.98)  # never 100% for fragments

                if use_all_sources:
                    # Each source contributes exactly one fragment per bin. The
                    # per-source retry loop runs inside the worker so the parent
                    # only collects (best-or-fallback, png_bytes) per source.
                    per_source_retries = 30
                    bin_target = len(source_images)
                    shuffled = list(source_images)
                    random.shuffle(shuffled)
                    args_iter = (
                        (src.id, src.image.path, target_compl, label.name, species_override,
                         min_acceptable, max_acceptable, per_source_retries)
                        for src in shuffled
                    )
                    generated = 0
                    fallback_used = 0
                    for status, src_id, _, actual_compl, png_bytes, extra in executor.map(
                            _synth_source_worker, args_iter):
                        src_img = src_image_by_id.get(src_id)
                        if status != 'ok' or src_img is None:
                            logger.warning(f"Failed to generate fragment for image {src_id} at {target_compl}: {extra}")
                            continue
                        emit_fragment(src_img, target_compl, actual_compl, png_bytes, label, generated)
                        generated += 1
                        total_generated += 1
                        if extra:  # fallback flag from worker
                            fallback_used += 1
                    if fallback_used:
                        logger.info(f"{label.name} {target_compl:.0%}: emitted {fallback_used} closest-to-target fallback fragments")
                else:
                    # Random-sampling mode: dispatch up to images_per_bin*5 attempts
                    # to the pool, collect the first images_per_bin successes (in
                    # tolerance band), and cancel the remainder once we have enough.
                    bin_target = images_per_bin
                    max_attempts = images_per_bin * 5
                    attempts_args = []
                    for _ in range(max_attempts):
                        src = random.choice(source_images)
                        attempts_args.append(
                            (src.id, src.image.path, target_compl, label.name, species_override)
                        )

                    futures = [executor.submit(_synth_attempt_worker, a) for a in attempts_args]
                    generated = 0
                    try:
                        for fut in as_completed(futures):
                            if generated >= bin_target:
                                break
                            status, src_id, _, actual_compl, png_bytes, error = fut.result()
                            if status != 'ok':
                                logger.warning(f"Failed to generate fragment for image {src_id} at {target_compl}: {error}")
                                continue
                            if actual_compl < min_acceptable or actual_compl > max_acceptable:
                                logger.info(f"Skipped {label.name} target={target_compl:.0%} actual={actual_compl:.0%} (out of range)")
                                continue
                            src_img = src_image_by_id.get(src_id)
                            if src_img is None:
                                continue
                            emit_fragment(src_img, target_compl, actual_compl, png_bytes, label, generated)
                            generated += 1
                            total_generated += 1
                    finally:
                        # Cancel any not-yet-running attempts once we have enough
                        for fut in futures:
                            fut.cancel()

                if generated < bin_target:
                    logger.warning(f"{label.name} {target_compl:.0%}: only generated {generated}/{bin_target}")

    logger.info(f"Synthetic dataset '{syn_dataset.name}' created with {total_generated} images")

    # Trigger archive creation
    create_dataset_archive.delay(syn_dataset.id)
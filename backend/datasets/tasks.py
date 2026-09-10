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
def compute_completeness_mm2_for_dataset(
    dataset_id,
    reference_dataset_id=None,
    assumed_tick_spacing_mm=10.0,
    require_existing_calibration=False,
):
    """
    Phase 2 mm-anchored completeness pass.

    Parallel to compute_completeness_for_dataset. Computes:
      - Image.mm_per_pixel, scale_bar_*, tooth_area_mm2 for each image that
        carries a detectable scale bar.
      - SpeciesReferenceArea.avg_area_mm2 / sample_count_mm2 for the
        reference dataset, built only from images that calibrated cleanly.
      - Image.completeness_mm2 = tooth_area_mm2 / reference_mm2.

    Does not touch the px-based fields, so the historical px metric remains
    available for comparison.

    Set require_existing_calibration=True to skip re-running the detector
    when an image already has mm_per_pixel set (useful for incremental
    runs).
    """
    from .models import Dataset, Image, SpeciesReferenceArea
    from .scale_calibration import detect_scale_bar

    dataset = Dataset.objects.get(pk=dataset_id)
    ref_dataset_id = reference_dataset_id or dataset_id

    def _save_tooth_mask_png(image_path, tooth_bbox, output_path):
        """Generate a green-tinted PNG of the exact segmented tooth shape,
        cropped to the bbox. Returns True on success, False on any failure.
        Cheap: a few hundred ms per image."""
        try:
            from .scale_calibration import _foreground_mask
            from PIL import Image as PILImage
            import numpy as np
            from scipy import ndimage as _ndimage
            import os as _os
            pil = PILImage.open(image_path)
            fg, _src = _foreground_mask(pil)
            if fg is None:
                return False
            opened = _ndimage.binary_opening(fg, iterations=3)
            if opened.sum() < 0.5 * fg.sum():
                opened = fg
            labeled, n = _ndimage.label(opened)
            if n == 0:
                return False
            x0, y0, x1, y1 = tooth_bbox
            cy = max(0, min(labeled.shape[0] - 1, (y0 + y1) // 2))
            cx = max(0, min(labeled.shape[1] - 1, (x0 + x1) // 2))
            tooth_label = int(labeled[cy, cx])
            if tooth_label == 0:
                return False
            tooth_pixels = (labeled == tooth_label)
            cropped = tooth_pixels[y0:y1 + 1, x0:x1 + 1]
            ch, cw = cropped.shape
            if ch < 4 or cw < 4:
                return False
            rgba = np.zeros((ch, cw, 4), dtype=np.uint8)
            # Tailwind green-500 with ~70% alpha where the mask is set.
            rgba[cropped] = [34, 197, 94, 180]
            _os.makedirs(_os.path.dirname(output_path), exist_ok=True)
            PILImage.fromarray(rgba, 'RGBA').save(output_path, 'PNG', optimize=True)
            return True
        except Exception as exc:
            logger.warning(f"_save_tooth_mask_png failed for {image_path}: {exc}")
            return False

    def _calibrate_one(img):
        """Run the detector for one Image row, returning (mm_per_pixel, tooth_area_mm2)
        or (None, None) on failure. Persists the calibration to the row."""
        if require_existing_calibration and img.mm_per_pixel is not None and img.tooth_area_mm2 is not None:
            return img.mm_per_pixel, img.tooth_area_mm2

        # Never re-derive a scale a person set by hand.
        #
        # This function persists whatever the detector returns, including
        # mm_per_pixel and scale_bar_source. A hand-set scale exists precisely
        # BECAUSE the detector could not read the frame, so re-running it here
        # would overwrite a reviewer's measurement with a worse one or with
        # nothing at all. There are 235 such rows, 232 of them Alexa's.
        #
        # The tooth area is still needed for completeness, so it is recomputed
        # from the segmentation using the reviewer's own mm/px.
        if img.scale_bar_source == 'manual' and img.mm_per_pixel is not None:
            if img.tooth_area_mm2 is not None:
                return img.mm_per_pixel, img.tooth_area_mm2
            try:
                from .scale_calibration import detect_tooth_only
                tooth = detect_tooth_only(img.image.path)
            except Exception as exc:
                logger.warning(f"tooth segmentation failed for manual image {img.id}: {exc}")
                return img.mm_per_pixel, None
            if tooth is None:
                return img.mm_per_pixel, None
            mm = float(img.mm_per_pixel)
            area = float(tooth.area_px) * mm ** 2
            img.tooth_area_mm2 = area
            img.save(update_fields=['tooth_area_mm2'])
            return img.mm_per_pixel, area

        try:
            result = detect_scale_bar(
                img.image.path,
                assumed_tick_spacing_mm=assumed_tick_spacing_mm,
            )
        except Exception as exc:
            logger.warning(f"scale_calibration failed for image {img.id}: {exc}")
            return None, None
        if result.mm_per_pixel is None:
            return None, None
        tooth = next((b for b in result.blobs if b.classification == 'tooth'), None)
        if tooth is None:
            return None, None
        tooth_area_mm2 = float(tooth.area_px) * (result.mm_per_pixel ** 2)
        # Axis-aligned bbox dimensions (orientation-dependent).
        tx0, ty0, tx1, ty1 = tooth.bbox
        tooth_width_mm = (tx1 - tx0 + 1) * result.mm_per_pixel
        tooth_height_mm = (ty1 - ty0 + 1) * result.mm_per_pixel
        # Anatomical length and width. The ellipse fit sorts its axes by SIZE,
        # so the longer one is not the length on a tooth broader than it is
        # tall; see _anatomical_length_width_px.
        tooth_major_mm = float(tooth.length_px or 0.0) * result.mm_per_pixel
        tooth_minor_mm = float(tooth.width_px or 0.0) * result.mm_per_pixel
        img.mm_per_pixel = result.mm_per_pixel
        img.scale_bar_detected = result.bar_bbox is not None
        img.scale_bar_source = 'heuristic_whitelist'
        img.scale_bar_bbox = list(result.bar_bbox) if result.bar_bbox else None
        img.scale_bar_ticks = {
            'long_axis': result.bar_long_axis,
            'positions': list(result.tick_positions_px or []),
        } if result.tick_positions_px else None
        img.tooth_bbox = list(tooth.bbox)
        img.tooth_area_mm2 = tooth_area_mm2
        img.tooth_width_mm = tooth_width_mm
        img.tooth_height_mm = tooth_height_mm
        img.tooth_major_axis_mm = tooth_major_mm if tooth_major_mm > 0 else None
        img.tooth_minor_axis_mm = tooth_minor_mm if tooth_minor_mm > 0 else None

        # Generate the tooth-shape mask PNG for the review inspector overlay.
        # Stored next to the source image in a _phase2_masks/ sub-folder.
        try:
            import os as _os
            from django.conf import settings as _settings
            source_dir = _os.path.dirname(img.image.path)
            mask_filename = f'{img.id}_tooth_mask.png'
            mask_dir = _os.path.join(source_dir, '_phase2_masks')
            mask_full_path = _os.path.join(mask_dir, mask_filename)
            ok = _save_tooth_mask_png(img.image.path, tooth.bbox, mask_full_path)
            if ok:
                # Build a media-served URL from MEDIA_ROOT
                rel = _os.path.relpath(mask_full_path, _settings.MEDIA_ROOT)
                img.tooth_mask_url = _settings.MEDIA_URL.rstrip('/') + '/' + rel.replace(_os.sep, '/')
            else:
                img.tooth_mask_url = None
        except Exception as exc:
            logger.warning(f"failed to generate tooth mask for image {img.id}: {exc}")
            img.tooth_mask_url = None

        img.save(update_fields=[
            'mm_per_pixel', 'scale_bar_detected', 'scale_bar_source',
            'scale_bar_bbox', 'scale_bar_ticks',
            'tooth_bbox', 'tooth_area_mm2',
            'tooth_width_mm', 'tooth_height_mm',
            'tooth_major_axis_mm', 'tooth_minor_axis_mm',
            'tooth_mask_url',
        ])
        return result.mm_per_pixel, tooth_area_mm2

    # Step 1: build mm^2 species references from the reference dataset.
    ref_images = Image.objects.filter(dataset_id=ref_dataset_id).select_related('label')
    label_areas = {}  # label_id -> [tooth_area_mm2]
    for img in ref_images:
        # Synthetic images derived from a complete tooth should not bias the
        # reference (their pixel area reflects the fracture mask, not a
        # complete tooth). Mirror the px-task's filter.
        if img.source_image_id is not None:
            continue
        _, tooth_mm2 = _calibrate_one(img)
        if tooth_mm2 is not None and tooth_mm2 > 0:
            label_areas.setdefault(img.label_id, []).append(tooth_mm2)

    ref_dataset = Dataset.objects.get(pk=ref_dataset_id)
    reference_mm2 = {}  # label_id -> avg_area_mm2
    import numpy as _np
    for label_id, areas in label_areas.items():
        # MEDIAN, not mean.
        #
        # Complete-tooth areas are heavily right-skewed within a species. For
        # Otodus megalodon they span 93x (100 to 9,317 mm2) and the mean sits
        # 58% above the median, so a handful of very large teeth drag the
        # reference upward and every fragment scored against it reads too
        # incomplete: a piece that is genuinely half of a typical tooth would
        # report about 30%. The median is the same idea, unmoved by the tail,
        # and indistinguishable from the mean on the well-behaved species
        # (C. leucas spans 5.3x with mean and median within 1%).
        #
        # This does not make completeness a per-specimen truth. A fragment came
        # from ONE tooth, not the average one, and with that much spread its
        # true completeness is not recoverable from area alone. The number is a
        # population estimate and should be read as one.
        avg_mm2 = float(_np.median(areas))
        # Only set the mm fields, but if this is a fresh row, we have to
        # also satisfy the NOT NULL constraints on the legacy px fields.
        # Use get_or_create so an existing px reference is never overwritten.
        sra, created = SpeciesReferenceArea.objects.get_or_create(
            label_id=label_id,
            dataset=ref_dataset,
            defaults={
                'avg_area': 0.0,
                'sample_count': 0,
                'avg_area_mm2': avg_mm2,
                'sample_count_mm2': len(areas),
            },
        )
        if not created:
            sra.avg_area_mm2 = avg_mm2
            sra.sample_count_mm2 = len(areas)
            sra.save(update_fields=['avg_area_mm2', 'sample_count_mm2'])
        reference_mm2[label_id] = avg_mm2

    # Step 2: compute completeness_mm2 for each target-dataset image.
    target_images = Image.objects.filter(dataset=dataset).select_related('label')
    written = 0
    for img in target_images:
        # Skip synthetic derivatives just like the px pass does.
        if img.source_image_id is not None and img.completeness_mm2 is not None:
            continue
        if dataset.id == ref_dataset_id:
            tooth_mm2 = img.tooth_area_mm2
        else:
            _, tooth_mm2 = _calibrate_one(img)
        ref_mm2 = reference_mm2.get(img.label_id)
        if tooth_mm2 is None or not ref_mm2 or ref_mm2 <= 0:
            continue
        compl = max(0.0, min(1.0, tooth_mm2 / ref_mm2))
        img.completeness_mm2 = compl
        img.save(update_fields=['completeness_mm2'])
        written += 1

    logger.info(
        "Phase 2 mm^2 completeness computed for %d images in dataset %s "
        "(reference dataset %s, species refs built: %d)",
        written, dataset.name, ref_dataset_id, len(reference_mm2),
    )


@shared_task
def build_brokenness_reference_for_dataset(reference_dataset_id, n_quantiles=4, threshold=0.2):
    """
    Build per-species, per-aspect-quantile mean-mask artifacts for a
    reference dataset using Katie's algorithm (datasets/brokenness/).

    Artifacts go to
        MEDIA_ROOT/brokenness_reference/<reference_dataset_id>/
    as <species>_mean_mask_q{1..n}.png + outlines + quantile_edges.json.
    These are the inputs the per-image compute_brokenness pass reads.

    The reference dataset should be a PROCESSED (background-transparent
    384x384) dataset: the algorithm reads each image's alpha channel as
    the tooth mask.
    """
    from .models import Dataset, Image
    from .brokenness import build_species_mean_masks

    dataset = Dataset.objects.get(pk=reference_dataset_id)
    images = Image.objects.filter(dataset=dataset).select_related('label')

    species_to_paths = {}
    for img in images:
        if img.label is None or not img.image:
            continue
        # Skip synthetic derivatives so the reference reflects natural tooth shapes.
        if img.source_image_id is not None:
            continue
        species_to_paths.setdefault(img.label.name, []).append(img.image.path)

    out_dir = os.path.join(settings.MEDIA_ROOT, 'brokenness_reference', str(reference_dataset_id))
    edges = build_species_mean_masks(
        species_to_paths,
        outdir=out_dir,
        n_quantiles=n_quantiles,
        threshold=threshold,
    )
    logger.info(
        "Brokenness reference built for dataset %s: %d species, %d images, written to %s",
        dataset.name, len(edges), sum(len(v) for v in species_to_paths.values()), out_dir,
    )
    return {'reference_dataset_id': reference_dataset_id, 'species_count': len(edges), 'outdir': out_dir}


def brokenness_input_path(img):
    """The file Kathie's shape score should read for this image.

    Shared by compute_brokenness_for_dataset and the inspector's shape trace,
    so the animation always replays the same input the stored score used.

    For RAW images, segment_tooth on the full frame returns a huge mask
    (tooth + scale bar + label merged into one foreground blob). We have a
    tight tooth-only mask saved during the mm2 calibration pass at
    Image.tooth_mask_url -- use that for RAW inputs.

    For PROCESSED Mode A images, the file is RGB-only (no alpha), so
    load_mask falls back to segment_tooth on the PROCESSED PNG. That works
    OK for Mode A outputs derived from MASKED sources (clean tooth-vs-black
    boundary), but produces an over-segmented mask on Mode A outputs derived
    from RAW sources (tooth edges blend into surrounding context). If the
    file is RAW_<x>.png, look for the sibling MASKED_<x>.png in the same
    dataset and use that one instead -- same physical tooth, cleaner boundary.

    For MASKED source images, the source PNG itself is correct (alpha is
    meaningful).
    """
    from .models import Image
    input_path = img.image.path
    if img.source_kind == 'raw' and img.tooth_mask_url:
        rel = img.tooth_mask_url.replace(settings.MEDIA_URL.rstrip('/') + '/', '', 1)
        candidate = os.path.join(settings.MEDIA_ROOT, rel)
        if os.path.exists(candidate):
            input_path = candidate
    elif img.source_kind == 'processed':
        fname = os.path.basename(img.image.name)
        if fname.startswith('RAW_'):
            sibling_name = 'MASKED_' + fname[len('RAW_'):]
            sibling = Image.objects.filter(
                dataset_id=img.dataset_id,
                image__endswith='/' + sibling_name,
            ).first()
            if sibling and os.path.exists(sibling.image.path):
                input_path = sibling.image.path
    return input_path


@shared_task
def compute_brokenness_for_dataset(dataset_id, reference_dataset_id=None):
    """
    Per-image mean-shape brokenness pass. Runs Katie's algorithm
    (datasets/brokenness/) to get a shape-based score, then alongside it
    computes a size-based score from our scale-bar calibration's mm² area
    vs the species mean in mm². The two are combined as max(shape, size)
    and stored on Image.percent_broken. Both component scores plus the
    alignment metadata land in Image.brokenness_meta so the paper can
    analyze them separately.

    Pipeline:
      1. For each image, read the binary tooth mask (alpha for MASKED
         inputs, our segment_tooth fallback for RGB-only Mode A inputs).
      2. Look up the species mean-mask for the right aspect quantile.
      3. Call brokenness.estimate_brokenness_from_arrays() -- Katie's
         pure notebook algorithm. Returns shape % broken + overlay.
      4. Look up species mean tooth area in mm² (preferring
         SpeciesReferenceArea, falling back to any dataset's
         tooth_area_mm² average if needed) and compute size % broken.
      5. Combined = max(shape, size).
      6. Draw the mean-shape contour line on top of Katie's overlay so
         the team can see the archetype boundary even when the fragment
         covers it. Visualization-only -- doesn't affect any metric.

    If reference_dataset_id is None, defaults to the target dataset.
    """
    import json as _json
    import numpy as _np
    from PIL import Image as PILImage
    from .models import Dataset, Image, SpeciesReferenceArea
    from .brokenness import (
        load_mask, get_aspect_ratio, get_quantile_index,
        estimate_brokenness_from_arrays,
        normalize,
    )
    import cv2 as _cv2

    dataset = Dataset.objects.get(pk=dataset_id)
    ref_id = reference_dataset_id or dataset_id
    ref_dir = os.path.join(settings.MEDIA_ROOT, 'brokenness_reference', str(ref_id))
    edges_path = os.path.join(ref_dir, 'quantile_edges.json')

    if not os.path.exists(edges_path):
        logger.info(
            "Brokenness reference missing for dataset %s; building it now.", ref_id,
        )
        build_brokenness_reference_for_dataset(ref_id)

    with open(edges_path) as f:
        all_quantile_edges = _json.load(f)

    overlays_dir = os.path.join(settings.MEDIA_ROOT, 'brokenness_overlays', str(dataset_id))
    os.makedirs(overlays_dir, exist_ok=True)

    # Build a species_mean_mm2 lookup keyed by label NAME so it crosses
    # datasets (each dataset has its own Label rows, but mm² is mm² —
    # an honest species-average in mm² from any dataset is usable here).
    #
    # Precedence:
    #   1. SpeciesReferenceArea.avg_area_mm2 for the shape-reference dataset.
    #   2. SpeciesReferenceArea.avg_area_mm2 for ANY other dataset (most-recent wins).
    #   3. On-the-fly Avg(Image.tooth_area_mm2) over the shape-reference dataset.
    #   4. On-the-fly Avg(Image.tooth_area_mm2) over the WHOLE Image table,
    #      grouped by species name.
    #
    # This decouples the size-reference question from the shape-reference
    # question: the size component lights up the moment any dataset
    # anywhere has mm² populated for a given species. Once Dataset 72 gets
    # mm² calibration (plan §8 item 8), it takes over via step 1.
    from django.db.models import Avg as _Avg
    species_mean_mm2_by_name = {}
    sra_filters = [
        ('shape_ref_dataset', SpeciesReferenceArea.objects.filter(dataset_id=ref_id)),
        ('any_dataset', SpeciesReferenceArea.objects.all()),
    ]
    for _label, qs in sra_filters:
        for sra in qs.select_related('label'):
            if sra.avg_area_mm2 and sra.label.name not in species_mean_mm2_by_name:
                species_mean_mm2_by_name[sra.label.name] = float(sra.avg_area_mm2)
    img_filters = [
        ('shape_ref_dataset', Image.objects.filter(dataset_id=ref_id, tooth_area_mm2__isnull=False)),
        ('any_dataset', Image.objects.filter(tooth_area_mm2__isnull=False)),
    ]
    for _label, qs in img_filters:
        for row in qs.values('label__name').annotate(avg=_Avg('tooth_area_mm2')):
            name = row['label__name']
            if name and name not in species_mean_mm2_by_name:
                species_mean_mm2_by_name[name] = float(row['avg'])

    target_images = Image.objects.filter(dataset=dataset).select_related('label')
    written = 0
    skipped = 0
    for img in target_images:
        if img.label is None or not img.image:
            skipped += 1
            continue
        species_name = img.label.name
        if species_name not in all_quantile_edges:
            skipped += 1
            continue

        try:
            input_path = brokenness_input_path(img)
            tooth_mask = load_mask(input_path)
            tooth_rgba = _np.array(PILImage.open(input_path).convert('RGBA'))
            # Force the RGBA alpha to match the segmented mask. Source PNGs
            # from Mode A emit are RGB-only -> PIL synthesises a fully
            # opaque alpha, which would make the overlay blend the texture
            # across the entire canvas. Keeping mask and alpha in lock-step
            # also removes the interpolation halo around the tooth edge.
            tooth_rgba[:, :, 3] = (tooth_mask > 0).astype('uint8') * 255
            aspect = get_aspect_ratio(tooth_mask)
            quantile_edges = _np.array(all_quantile_edges[species_name])
            q_idx = get_quantile_index(aspect, quantile_edges)
            mean_mask_path = os.path.join(ref_dir, f'{species_name}_mean_mask_q{q_idx}.png')
            mean_raw = _cv2.imread(mean_mask_path, _cv2.IMREAD_GRAYSCALE)
            if mean_raw is None:
                skipped += 1
                continue
            mean_binary = (mean_raw > 127).astype('uint8')

            # Step 3: Katie's pure algorithm computes the shape score.
            shape_pct, overlay_rgb, info = estimate_brokenness_from_arrays(
                tooth_mask, tooth_rgba, mean_binary,
            )

            # Step 4: size score from mm² calibration (our chained sidecar).
            # Independent of Katie's algorithm; lives only in this task layer.
            species_mean_mm2 = species_mean_mm2_by_name.get(species_name)
            size_pct = None
            area_ratio = None
            if img.tooth_area_mm2 is not None and species_mean_mm2 and species_mean_mm2 > 0:
                area_ratio = float(img.tooth_area_mm2) / float(species_mean_mm2)
                size_pct = max(0.0, min(100.0, (1.0 - area_ratio) * 100.0))

            # Step 5: combined = worse of the two (broken if either signal says so).
            combined_pct = shape_pct if size_pct is None else max(shape_pct, size_pct)

            # Step 6: viz-only -- draw the mean-shape contour on top of Katie's
            # overlay + tighten the green edge by 1 px so the linear-interp
            # halo from warpAffine doesn't bleed into the visualization. Both
            # are visualization-only; the math above is untouched.
            mean_256 = normalize(mean_binary.astype('uint8'), target_size=256, interpolation=_cv2.INTER_NEAREST)
            mean_contours, _ = _cv2.findContours(mean_256, _cv2.RETR_EXTERNAL, _cv2.CHAIN_APPROX_NONE)
            _cv2.drawContours(overlay_rgb, mean_contours, -1, (180, 30, 30), thickness=1)
        except Exception as exc:
            logger.warning(f"brokenness failed for image {img.id}: {exc}")
            skipped += 1
            continue

        overlay_filename = f'{img.id}_brokenness.png'
        overlay_path = os.path.join(overlays_dir, overlay_filename)
        try:
            PILImage.fromarray(overlay_rgb, 'RGB').save(overlay_path, 'PNG', optimize=True)
            rel = os.path.relpath(overlay_path, settings.MEDIA_ROOT)
            overlay_url = settings.MEDIA_URL.rstrip('/') + '/' + rel.replace(os.sep, '/')
        except Exception as exc:
            logger.warning(f"failed to save brokenness overlay for image {img.id}: {exc}")
            overlay_url = None

        img.percent_broken = float(combined_pct)
        img.brokenness_overlay_url = overlay_url
        img.brokenness_meta = {
            'species': species_name,
            'quantile': int(q_idx),
            'aspect_ratio': round(float(aspect), 4),
            'reference_dataset_id': int(ref_id),
            'shape_pct_broken': float(shape_pct),
            'size_pct_broken': float(size_pct) if size_pct is not None else None,
            'combined_pct_broken': float(combined_pct),
            'area_ratio': float(area_ratio) if area_ratio is not None else None,
            'tooth_area_mm2': float(img.tooth_area_mm2) if img.tooth_area_mm2 is not None else None,
            'species_mean_mm2': float(species_mean_mm2) if species_mean_mm2 else None,
            **info,
        }
        img.save(update_fields=['percent_broken', 'brokenness_overlay_url', 'brokenness_meta'])
        written += 1

    logger.info(
        "Brokenness computed for %d images (skipped %d) in dataset %s "
        "(reference dataset %s)",
        written, skipped, dataset.name, ref_id,
    )
    return {'written': written, 'skipped': skipped, 'reference_dataset_id': ref_id}


@shared_task
def extract_museum_metadata_for_dataset(dataset_id):
    """
    Phase 2 OCR pass.

    For each Image in the dataset, run the FLMNH catalog-label OCR pipeline
    and persist the parsed fields. Designed for RAW images that still carry
    the printed museum label; MASKED images normally have the label cropped
    out and will produce 'no label blob detected'.

    Persists when at least one field is recovered. Images with all-null
    output are left untouched so a previous successful OCR pass is never
    overwritten by a failed re-run.
    """
    from .models import Dataset, Image
    from .label_ocr import extract_specimen_metadata
    from .scale_calibration import detect_scale_bar

    dataset = Dataset.objects.get(pk=dataset_id)
    images = Image.objects.filter(dataset=dataset)

    written = 0
    skipped_no_label = 0
    skipped_no_text = 0
    errors = 0

    for img in images:
        try:
            # Inform the label detector about the bar + tooth bboxes so it
            # doesn't try to OCR those.
            excluded = []
            fallback = []
            try:
                sb = detect_scale_bar(img.image.path)
                if sb.bar_bbox:
                    excluded.append(sb.bar_bbox)
                    # The bar bbox is also the fallback OCR target: if the
                    # label and bar are touching/overlapping and there is no
                    # separately-detectable label blob, the catalog text is
                    # inside the bar bbox.
                    fallback.append(sb.bar_bbox)
                tooth = next((b for b in sb.blobs if b.classification == 'tooth'), None)
                if tooth is not None:
                    excluded.append(tooth.bbox)
            except Exception:
                # Detector failure is non-fatal here; OCR can still try the
                # label detector on its own.
                pass

            meta = extract_specimen_metadata(
                img.image.path,
                excluded_bboxes=excluded,
                fallback_bboxes=fallback,
            )
        except Exception as e:
            logger.warning("extract_museum_metadata: image %s raised %s", img.id, e)
            errors += 1
            continue

        if meta.label_bbox is None:
            skipped_no_label += 1
            continue
        if not meta.raw_text:
            skipped_no_text += 1
            continue

        img.museum_specimen_id = meta.museum_specimen_id
        img.museum_species = meta.species
        img.museum_completeness_category = meta.museum_completeness_category
        img.museum_metadata = {
            'locality': meta.locality,
            'formation': meta.formation,
            'age': meta.age,
            'collector': meta.collector,
            'date': meta.date,
            'confidence': meta.confidence,
            'notes': meta.notes,
            'label_bbox': list(meta.label_bbox) if meta.label_bbox else None,
        }
        img.ocr_label_text = meta.raw_text
        img.save(update_fields=[
            'museum_specimen_id', 'museum_species', 'museum_completeness_category',
            'museum_metadata', 'ocr_label_text',
        ])
        written += 1

    logger.info(
        "extract_museum_metadata_for_dataset(%s): written=%d no_label=%d no_text=%d errors=%d",
        dataset.id, written, skipped_no_label, skipped_no_text, errors,
    )
    return {
        'dataset_id': dataset.id,
        'dataset_name': dataset.name,
        'written': written,
        'skipped_no_label': skipped_no_label,
        'skipped_no_text': skipped_no_text,
        'errors': errors,
    }


@shared_task
def emit_processed_dataset(
    source_dataset_id,
    mode='A',
    target_size=384,
    mode_b_px_per_mm=6.0,
    name_suffix=None,
):
    """
    Phase 2 image curation pass.

    For each image in the source dataset, runs the heuristic scale-bar
    detector, masks the bar away, tight-crops to the tooth, and resizes to
    a square target_size canvas. Two layouts are supported:

      mode 'A'  uniform pixel density: the tooth fills the canvas
                regardless of physical size. This is Phase I behaviour and
                destroys absolute size information.

      mode 'B'  scale-preserving: 1 mm in the output equals
                mode_b_px_per_mm pixels regardless of source mm/px. Small
                teeth appear small in the canvas.

    Writes a new Dataset that links back to the source via
    Dataset.source_dataset. Each Image row in the derived dataset is a
    PROCESSED 384x384 PNG with no scale bar visible. tooth_area_mm2 is
    carried over from the source image when available. In Mode B the
    derived image's mm_per_pixel = 1 / mode_b_px_per_mm and is persisted
    so downstream consumers know the output's physical scale.

    Images for which calibration fails (no scale bar or no tooth blob in
    the source) are skipped and counted as failures.
    """
    from .models import Dataset, Image
    from .scale_calibration import detect_scale_bar
    from .image_curation import emit_processed
    from django.core.files.base import ContentFile
    import io
    import os

    source = Dataset.objects.get(pk=source_dataset_id)
    suffix = name_suffix or f'PROCESSED Mode {mode}'
    derived = Dataset.objects.create(
        name=f'{source.name} ({suffix})',
        description=(
            f"Derived from dataset {source.id} via emit_processed_dataset "
            f"mode={mode}, target_size={target_size}, "
            f"mode_b_px_per_mm={mode_b_px_per_mm}"
        ),
        study=source.study,
        resolution=str(target_size),
        source_dataset=source,
        transformation_type=f'processed_mode_{mode.lower()}',
        synthetic=False,
        generation_config={
            'mode': mode,
            'target_size': target_size,
            'mode_b_px_per_mm': mode_b_px_per_mm,
            'source_dataset_id': source_dataset_id,
        },
    )
    derived.labels.set(source.labels.all())

    written = 0
    failures = 0
    failure_reasons = {}

    def _bump(key):
        failure_reasons[key] = failure_reasons.get(key, 0) + 1

    for src_img in Image.objects.filter(dataset=source).select_related('label'):
        try:
            result = detect_scale_bar(src_img.image.path)
        except Exception as e:
            logger.warning("emit_processed_dataset: detect failed for image %s: %s", src_img.id, e)
            failures += 1
            _bump('detect_exception')
            continue

        tooth = next((b for b in result.blobs if b.classification == 'tooth'), None)
        if tooth is None:
            failures += 1
            _bump('no_tooth_blob')
            continue
        if mode == 'B' and result.mm_per_pixel is None:
            failures += 1
            _bump('mode_b_no_calibration')
            continue

        try:
            pil_img, info = emit_processed(
                src_img.image.path,
                tooth_bbox=tooth.bbox,
                scale_bar_bbox=result.bar_bbox,
                mode=mode,
                target_size=target_size,
                mode_b_px_per_mm=mode_b_px_per_mm,
                mm_per_pixel_source=result.mm_per_pixel,
            )
        except Exception as e:
            logger.warning("emit_processed_dataset: emit failed for image %s: %s", src_img.id, e)
            failures += 1
            _bump('emit_exception')
            continue

        buffer = io.BytesIO()
        pil_img.save(buffer, 'PNG', optimize=True)
        buffer.seek(0)

        filename = os.path.basename(src_img.image.name)
        # Carry forward the physical-size measurements from the source image
        # so the training pipeline can opt into multi-input training without
        # having to re-derive these values from the cropped/resampled PNG.
        # These fields are intrinsic to the tooth (computed in mm), so they
        # remain valid across both Mode A (uniform canvas) and Mode B
        # (scale-preserving) outputs.
        new_img = Image(
            dataset=derived,
            label=src_img.label,
            tooth_area_mm2=src_img.tooth_area_mm2,
            tooth_major_axis_mm=src_img.tooth_major_axis_mm,
            tooth_minor_axis_mm=src_img.tooth_minor_axis_mm,
            completeness_mm2=src_img.completeness_mm2,
            source_kind='processed',
        )
        if mode == 'B':
            new_img.mm_per_pixel = 1.0 / float(mode_b_px_per_mm)
            new_img.scale_bar_detected = False
            new_img.scale_bar_source = 'inherited'
        new_img.image.save(filename, ContentFile(buffer.getvalue()), save=False)
        new_img.save()
        written += 1

    logger.info(
        "emit_processed_dataset: derived dataset %s (%s) written=%d failures=%d reasons=%s",
        derived.id, derived.name, written, failures, failure_reasons,
    )
    return {
        'derived_dataset_id': derived.id,
        'derived_dataset_name': derived.name,
        'written': written,
        'failures': failures,
        'failure_reasons': failure_reasons,
    }


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
    # billiard is Celery's fork-friendly multiprocessing replacement; required
    # because Celery prefork workers are daemonic and Python's stdlib
    # multiprocessing refuses fork-from-daemon ("daemonic processes are not
    # allowed to have children").
    from billiard.pool import Pool as BilliardPool

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

    pool = BilliardPool(processes=pool_workers)
    try:
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
                    args_iter = [
                        (src.id, src.image.path, target_compl, label.name, species_override,
                         min_acceptable, max_acceptable, per_source_retries)
                        for src in shuffled
                    ]
                    generated = 0
                    fallback_used = 0
                    for status, src_id, _, actual_compl, png_bytes, extra in pool.imap_unordered(
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
                    # to the pool, collect the first images_per_bin in-tolerance
                    # successes, then break out (remaining queued items are simply
                    # consumed and discarded — each attempt is cheap to drop).
                    bin_target = images_per_bin
                    max_attempts = images_per_bin * 5
                    attempts_args = []
                    for _ in range(max_attempts):
                        src = random.choice(source_images)
                        attempts_args.append(
                            (src.id, src.image.path, target_compl, label.name, species_override)
                        )

                    generated = 0
                    result_iter = pool.imap_unordered(_synth_attempt_worker, attempts_args)
                    for status, src_id, _, actual_compl, png_bytes, error in result_iter:
                        if generated >= bin_target:
                            break
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

                if generated < bin_target:
                    logger.warning(f"{label.name} {target_compl:.0%}: only generated {generated}/{bin_target}")
    finally:
        pool.close()
        pool.join()

    logger.info(f"Synthetic dataset '{syn_dataset.name}' created with {total_generated} images")

    # Trigger archive creation
    create_dataset_archive.delay(syn_dataset.id)
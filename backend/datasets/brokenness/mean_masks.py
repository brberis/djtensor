"""
Build per-species, per-aspect-quantile mean masks for a reference dataset.

Source: docs.local/average_shark_tooth_mask.ipynb (Katie). Ported here so
the same artifacts (mean_mask_qN.png, binary_mask_qN.png, outline_qN.png,
stacked_quantile_outlines.png, quantile_edges.json) get written into our
mediafiles tree and become reusable by the per-image scorer.

Input is a list of (label_name, list_of_png_paths) so this module stays
free of Django; the Celery wrapper in tasks.py is what walks the
Image queryset.
"""
import os
import json
import numpy as np
from PIL import Image
import cv2

from .estimate import load_mask


def build_species_mean_masks(
    species_to_paths,
    outdir,
    n_quantiles=4,
    threshold=0.2,
    output_size=(384, 384),
):
    """Generate the mean-mask artifacts for every species in species_to_paths.

    Args:
        species_to_paths: dict[str, list[str]] -- species name to list of PNG paths.
            Each PNG must have an alpha channel (or be otherwise convertible
            to a binary mask via load_mask).
        outdir: directory to write artifacts into. Will be created if missing.
        n_quantiles: number of aspect-ratio quantiles per species (default 4).
        threshold: mean-mask threshold for the binary version (default 0.2).
        output_size: (w, h) used when resizing every mask before averaging.

    Returns:
        dict[str, list[float]] -- quantile edges per species, also persisted to
        outdir/quantile_edges.json.
    """
    os.makedirs(outdir, exist_ok=True)
    all_quantile_edges = {}
    summary = {}

    for species_name, image_paths in species_to_paths.items():
        if not image_paths:
            summary[species_name] = {"skipped": "no images"}
            continue

        masks = []
        metrics = []
        for path in image_paths:
            try:
                img = Image.open(path).convert("RGBA").resize(output_size)
                alpha = np.array(img.split()[-1])
                mask = (alpha > 0).astype(np.float32)
                masks.append(mask)

                coords = np.argwhere(mask > 0)
                if len(coords) == 0:
                    metrics.append(1.0)
                    continue
                y0, x0 = coords.min(axis=0)
                y1, x1 = coords.max(axis=0)
                tooth_h = y1 - y0 + 1
                tooth_w = x1 - x0 + 1
                metrics.append(tooth_h / tooth_w if tooth_w > 0 else 1.0)
            except Exception:
                continue

        if not masks:
            summary[species_name] = {"skipped": "no readable masks"}
            continue

        masks = np.array(masks)
        metrics = np.array(metrics)

        if len(masks) < n_quantiles:
            summary[species_name] = {"skipped": f"only {len(masks)} masks, need {n_quantiles}"}
            continue

        quantile_edges = np.quantile(metrics, np.linspace(0, 1, n_quantiles + 1))
        all_quantile_edges[species_name] = quantile_edges.tolist()

        per_quantile_counts = []
        stacked_outlines = None

        for i in range(n_quantiles):
            low, high = quantile_edges[i], quantile_edges[i + 1]
            if i < n_quantiles - 1:
                idx = np.where((metrics >= low) & (metrics < high))[0]
            else:
                idx = np.where((metrics >= low) & (metrics <= high))[0]

            per_quantile_counts.append(int(len(idx)))
            if len(idx) == 0:
                continue

            group_stack = masks[idx]
            mean_mask = np.mean(group_stack, axis=0)
            binary_mask = (mean_mask >= threshold).astype(np.uint8) * 255

            cv2.imwrite(os.path.join(outdir, f"{species_name}_mean_mask_q{i+1}.png"),
                        (mean_mask * 255).astype(np.uint8))
            cv2.imwrite(os.path.join(outdir, f"{species_name}_binary_mask_q{i+1}.png"),
                        binary_mask)

            contours, _ = cv2.findContours(binary_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            outline = np.zeros_like(binary_mask)
            cv2.drawContours(outline, contours, -1, 255, thickness=2)
            cv2.imwrite(os.path.join(outdir, f"{species_name}_outline_q{i+1}.png"), outline)

            if stacked_outlines is None:
                stacked_outlines = np.zeros_like(binary_mask)
            cv2.drawContours(stacked_outlines, contours, -1, 255, thickness=2)

        overall_mean = np.mean(masks, axis=0)
        overall_binary = (overall_mean >= threshold).astype(np.uint8) * 255
        cv2.imwrite(os.path.join(outdir, f"{species_name}_mean_mask.png"),
                    (overall_mean * 255).astype(np.uint8))
        cv2.imwrite(os.path.join(outdir, f"{species_name}_binary_mask.png"), overall_binary)
        contours, _ = cv2.findContours(overall_binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        outline = np.zeros_like(overall_binary)
        cv2.drawContours(outline, contours, -1, 255, thickness=2)
        cv2.imwrite(os.path.join(outdir, f"{species_name}_outline.png"), outline)

        if stacked_outlines is not None:
            cv2.imwrite(os.path.join(outdir, f"{species_name}_stacked_quantile_outlines.png"),
                        stacked_outlines)

        summary[species_name] = {
            "n_masks": int(len(masks)),
            "quantile_edges": [float(x) for x in quantile_edges],
            "per_quantile_counts": per_quantile_counts,
        }

    edges_path = os.path.join(outdir, "quantile_edges.json")
    with open(edges_path, "w") as f:
        json.dump(all_quantile_edges, f, indent=2)

    summary_path = os.path.join(outdir, "build_summary.json")
    with open(summary_path, "w") as f:
        json.dump({
            "n_quantiles": n_quantiles,
            "threshold": threshold,
            "output_size": list(output_size),
            "species": summary,
        }, f, indent=2)

    return all_quantile_edges

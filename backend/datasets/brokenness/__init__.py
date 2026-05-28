"""
Mean-shape brokenness scoring for shark teeth.

Author: Katie (a.k.a. Kathie). Ported from her two notebooks in docs.local/:
  - docs.local/average_shark_tooth_mask.ipynb  -> mean_masks.py
  - docs.local/shark_tooth_percent_brokenness.ipynb -> align.py + estimate.py

The algorithm is shape-anchored, not area-anchored: it aligns each query
tooth to a per-species, per-aspect-quantile mean mask and reports the
fraction of the mean footprint that is missing from the query. This is a
parallel completeness metric to the pixel-area-ratio one in
segmentation.compute_completeness().

Public surface kept close to the notebooks so Katie can diff a hot-edit
against her local Jupyter run and verify identical numbers.
"""
from .align import (
    sample_contour,
    align_contour_startpoints,
    align_to_mean_procrustes,
    try_rotations_and_shifts,
    normalize,
    keep_largest_island,
    warp_image_channels,
)
from .estimate import (
    estimate_brokenness,
    estimate_brokenness_from_arrays,
    load_mask,
    get_aspect_ratio,
    get_quantile_index,
)
from .mean_masks import build_species_mean_masks

__all__ = [
    "sample_contour",
    "align_contour_startpoints",
    "align_to_mean_procrustes",
    "try_rotations_and_shifts",
    "normalize",
    "keep_largest_island",
    "warp_image_channels",
    "estimate_brokenness",
    "estimate_brokenness_from_arrays",
    "load_mask",
    "get_aspect_ratio",
    "get_quantile_index",
    "build_species_mean_masks",
]

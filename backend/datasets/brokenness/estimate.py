"""
Per-image percent-broken estimation.

Source: cell 0 of docs.local/shark_tooth_percent_brokenness.ipynb (Katie).
Two entry points:
  - estimate_brokenness(tooth_mask_path, mean_mask_path) -- Katie's
    original notebook signature, takes file paths. Use this when you want
    to reproduce the notebook exactly.
  - estimate_brokenness_from_arrays(tooth_mask, tooth_rgba, mean_binary)
    -- in-pipeline variant that takes numpy arrays so we don't have to
    write tooth PNGs to disk just to call the algorithm.

Both return:
  (percent_broken, overlay_rgb, info_dict)
where overlay_rgb is the 256x256 gray-on-green visualization from the
notebook and info_dict carries the alignment metadata (best angle,
shift, flipped, IoU score).

Algorithmic improvements we've explored on top of Katie's method
(principal-axis pre-rotation, pad-before-rotate, sign convention,
etc.) are documented in docs.local/brokenness-improvements-ideas.md
and are NOT in this module. The module reads as Katie's notebook
ported to Python, plus the load_mask RGB fallback below.
"""
import numpy as np
import cv2
from PIL import Image

from .align import (
    align_to_mean_procrustes,
    try_rotations_and_shifts,
    warp_image_channels,
    normalize,
    keep_largest_island,
)


def load_mask(path, size=None):
    """Return a binary tooth mask from `path`.

    Strategy:
      * If the source has a meaningful alpha channel (some transparent and
        some opaque pixels), trust it -- this is what Kathie's notebook
        does and what MASKED inputs deliver.
      * If the source is RGB-only (or has a uniformly opaque alpha, as
        happens with our Mode A PROCESSED emit), the alpha tells us
        nothing -- (alpha > 0) would be True for the entire canvas and
        the brokenness math would treat the whole square as tooth.
        Fall back to datasets.segmentation.segment_tooth(), the same
        trusted segmentation that powers the completeness_mm2 path.

    This is the one necessary deviation from Kathie's notebook: without
    it, her code can't handle inputs that aren't transparent-background
    PNGs (which our Mode A processed format is not).
    """
    img = Image.open(path)
    pil_rgba = img.convert("RGBA")
    if size:
        pil_rgba = pil_rgba.resize(size)
    alpha = np.array(pil_rgba.split()[-1])
    has_transparency = bool((alpha == 0).any())
    has_opacity = bool((alpha > 0).any())
    if has_transparency and has_opacity:
        return (alpha > 0).astype(np.uint8)

    # No usable alpha. Segment the RGB ourselves.
    from datasets.segmentation import segment_tooth
    binary = segment_tooth(path)
    if size:
        binary = cv2.resize(binary.astype(np.uint8), size, interpolation=cv2.INTER_NEAREST)
    return binary.astype(np.uint8)


def get_aspect_ratio(mask):
    coords = np.argwhere(mask)
    if len(coords) == 0:
        return 1.0
    y0, x0 = coords.min(axis=0)
    y1, x1 = coords.max(axis=0)
    tooth_h = y1 - y0 + 1
    tooth_w = x1 - x0 + 1
    return tooth_h / tooth_w if tooth_w > 0 else 1.0


def get_quantile_index(aspect, quantile_edges):
    for i in range(len(quantile_edges) - 1):
        if aspect <= quantile_edges[i + 1]:
            return i + 1
    return len(quantile_edges) - 1


def _run(tooth_mask_raw, tooth_rgba, mean_binary, moment_weight=0.0):
    """Shared core. Inputs:
      tooth_mask_raw : 2D uint8, original resolution (will be largest-island-cleaned + resized to 256)
      tooth_rgba     : H x W x 4 uint8 OR None (used only for the overlay blend)
      mean_binary    : 2D uint8 mean mask at any resolution (will be resized to 256)
    """
    PAD = 128
    canvas_padded = 256 + 2 * PAD

    mean_norm = normalize(mean_binary.astype(np.uint8), target_size=256, interpolation=cv2.INTER_NEAREST)
    mean_padded = np.pad(mean_norm, PAD, mode='constant', constant_values=0)

    tooth_raw = keep_largest_island(tooth_mask_raw)
    tooth_norm = normalize(tooth_raw, target_size=256, interpolation=cv2.INTER_NEAREST)
    tooth_padded = np.pad(tooth_norm, PAD, mode='constant', constant_values=0)

    if tooth_rgba is not None:
        tooth_np = normalize(tooth_rgba, target_size=256, interpolation=cv2.INTER_LINEAR)
        tooth_np_padded = np.pad(tooth_np, ((PAD, PAD), (PAD, PAD), (0, 0)), mode='constant', constant_values=0)
    else:
        tooth_np_padded = None

    tooth_aligned, M_procrustes = align_to_mean_procrustes(
        tooth_padded, mean_padded, n_points=100, canvas=canvas_padded,
    )

    tooth_img_aligned = tooth_np_padded.copy() if tooth_np_padded is not None else None
    if M_procrustes is not None and tooth_img_aligned is not None:
        tooth_img_aligned = warp_image_channels(tooth_img_aligned, M_procrustes, canvas=canvas_padded)

    info = {
        "best_angle": 0, "best_shift": (0, 0), "best_flipped": False,
        "iou_score": 0.0, "aligned": M_procrustes is not None,
    }

    M_rotation = None
    flipped = False
    if M_procrustes is not None:
        tooth_aligned, M_rotation, flipped, best_angle, best_shift, iou = try_rotations_and_shifts(
            tooth_padded, mean_padded, M_procrustes,
            rotate_max=10, angle_step=2, shift_max=15, shift_step=3,
            canvas=canvas_padded,
        )
        info.update({
            "best_angle": int(best_angle),
            "best_shift": (int(best_shift[0]), int(best_shift[1])),
            "best_flipped": bool(flipped),
            "iou_score": float(iou),
        })
        if tooth_img_aligned is not None:
            if flipped:
                tooth_img_aligned = tooth_img_aligned[:, ::-1, :]
            if M_rotation is not None:
                tooth_img_aligned = warp_image_channels(tooth_img_aligned, M_rotation, canvas=canvas_padded)

    tooth_aligned = tooth_aligned[PAD:PAD + 256, PAD:PAD + 256]
    mean_final = mean_padded[PAD:PAD + 256, PAD:PAD + 256]
    tooth_img_final = (
        tooth_img_aligned[PAD:PAD + 256, PAD:PAD + 256]
        if tooth_img_aligned is not None else None
    )

    mean_pixels = int(np.sum(mean_final))
    missing_pixels = int(np.sum((mean_final == 1) & (tooth_aligned == 0)))
    percent_broken = (missing_pixels / mean_pixels) * 100 if mean_pixels > 0 else 0.0

    overlay = np.zeros((256, 256, 3), dtype=np.uint8)
    overlay[mean_final == 1] = [200, 200, 200]
    overlay[tooth_aligned == 1] = [100, 200, 100]

    if tooth_img_final is not None and tooth_img_final.shape[2] == 4:
        blend_alpha = 0.3
        overlay_rgb = overlay.astype(np.float32)
        tooth_rgb = tooth_img_final[:, :, :3].astype(np.float32)
        tooth_alpha_mask = (tooth_img_final[:, :, 3] > 0).astype(np.float32)[:, :, np.newaxis]
        blended = (1 - blend_alpha * tooth_alpha_mask) * overlay_rgb + blend_alpha * tooth_alpha_mask * tooth_rgb
        overlay = np.clip(blended, 0, 255).astype(np.uint8)

    info["mean_pixels"] = mean_pixels
    info["missing_pixels"] = missing_pixels

    return float(percent_broken), overlay, info


def estimate_brokenness(tooth_mask_path, mean_mask_path, moment_weight=0.0):
    """Katie's notebook entry point. Paths in, results out."""
    mean_raw = cv2.imread(mean_mask_path, cv2.IMREAD_GRAYSCALE)
    if mean_raw is None:
        raise FileNotFoundError(f"mean mask not found: {mean_mask_path}")
    mean_binary = (mean_raw > 127).astype(np.uint8)

    tooth_mask = load_mask(tooth_mask_path)
    tooth_img = np.array(Image.open(tooth_mask_path).convert("RGBA"))

    return _run(tooth_mask, tooth_img, mean_binary, moment_weight=moment_weight)


def estimate_brokenness_from_arrays(tooth_mask, tooth_rgba, mean_binary, moment_weight=0.0):
    """In-pipeline entry point. Numpy arrays in, results out."""
    return _run(tooth_mask, tooth_rgba, mean_binary, moment_weight=moment_weight)

# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: image_curation.py
# Copyright (c) 2024

"""
Image curation step for the Phase 2 pipeline.

Given a source photograph plus the scale-bar bbox and the tooth blob bbox
detected upstream by scale_calibration.py, produce a model-ready 384x384
PNG with the scale bar masked away and the tooth centred. Two layout modes
are supported, exposed for direct ablation in the paper:

  Mode A: uniform pixel density. The tooth is rescaled so its longer side
          fills `target_size * fill_fraction` regardless of physical size.
          This is the Phase I behaviour; absolute physical size is destroyed.

  Mode B: scale-preserving. 1 mm becomes `px_per_mm` pixels in the output,
          regardless of the source photo's mm/px. Small teeth occupy a
          proportionally smaller fraction of the canvas; the absolute size
          signal is preserved for the classifier to potentially exploit.

No Django dependency; pure Pillow + numpy + scipy. Importable from a
management command or a Celery task.
"""

from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Optional, Tuple

import numpy as np
from PIL import Image


@dataclass
class ProcessedResult:
    mode: str                                     # 'A' or 'B'
    output_size: Tuple[int, int]
    scale_factor: float                           # pixels per mm in the output (Mode B) or px-to-px (Mode A)
    tooth_bbox_in_output: Tuple[int, int, int, int]   # (x0, y0, x1, y1)
    notes: list

    def to_dict(self) -> dict:
        return asdict(self)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def emit_processed(
    source_image,
    tooth_bbox: Tuple[int, int, int, int],
    scale_bar_bbox: Optional[Tuple[int, int, int, int]],
    mode: str = 'A',
    target_size: int = 384,
    mode_a_fill_fraction: float = 0.92,
    mode_b_px_per_mm: float = 6.0,
    mm_per_pixel_source: Optional[float] = None,
    background_color: Tuple[int, int, int] = (255, 255, 255),
):
    """
    Produce a 384x384 model-ready PNG from a source photograph.

    Args:
        source_image: PIL.Image, path string, or RGBA/RGB numpy-arrayable
            input. RGBA is composited over `background_color`.
        tooth_bbox: (x0, y0, x1, y1) of the tooth in source pixel coords.
            Typically taken from BlobInfo.bbox for the 'tooth' blob.
        scale_bar_bbox: (x0, y0, x1, y1) of the scale bar, or None. When
            provided, the bar region is painted with `background_color`
            before cropping so it cannot leak into the model input.
        mode: 'A' (uniform pixel density) or 'B' (scale-preserving).
        target_size: output image side in pixels (default 384).
        mode_a_fill_fraction: in Mode A, the tooth's longer side is rescaled
            to `target_size * mode_a_fill_fraction`. Default 0.92 gives a
            small visual margin.
        mode_b_px_per_mm: in Mode B, every output millimetre is this many
            pixels. Default 6.0 fits an ~64 mm tooth in 384 px.
        mm_per_pixel_source: required for Mode B. Source photo's
            calibration, from ScaleBarResult.mm_per_pixel.
        background_color: RGB used for padding and bar masking.

    Returns:
        (output_pil_image, ProcessedResult)
    """
    if mode not in ('A', 'B'):
        raise ValueError(f'unknown mode {mode!r}; expected A or B')
    if mode == 'B' and (mm_per_pixel_source is None or mm_per_pixel_source <= 0):
        raise ValueError('Mode B requires a positive mm_per_pixel_source')

    img = _open_as_rgb(source_image, background_color=background_color)
    notes = []

    if scale_bar_bbox is not None:
        img = _mask_region(img, scale_bar_bbox, background_color)

    tx0, ty0, tx1, ty1 = tooth_bbox
    # Clamp to image bounds defensively.
    w, h = img.size
    tx0 = max(0, min(w - 1, int(tx0)))
    ty0 = max(0, min(h - 1, int(ty0)))
    tx1 = max(0, min(w - 1, int(tx1)))
    ty1 = max(0, min(h - 1, int(ty1)))
    if tx1 <= tx0 or ty1 <= ty0:
        raise ValueError(f'invalid tooth_bbox {tooth_bbox}')
    tooth_crop = img.crop((tx0, ty0, tx1 + 1, ty1 + 1))

    bbox_w = tx1 - tx0 + 1
    bbox_h = ty1 - ty0 + 1

    if mode == 'A':
        long_side_target = int(round(target_size * mode_a_fill_fraction))
        scale = long_side_target / float(max(bbox_w, bbox_h))
        notes.append(f'mode A scale={scale:.4f} fill={mode_a_fill_fraction}')
    else:
        # 1 mm in the source = mm_per_pixel_source pixels-of-source in the
        # source image. To make 1 mm equal `mode_b_px_per_mm` output pixels,
        # we need the scale factor that turns 1 source pixel into
        # `mode_b_px_per_mm * mm_per_pixel_source` output pixels.
        scale = float(mode_b_px_per_mm) * float(mm_per_pixel_source)
        # Sanity: if the resulting tooth exceeds the target canvas, clamp
        # by downscaling so it fits, and emit a warning note.
        proj_w = bbox_w * scale
        proj_h = bbox_h * scale
        proj_long = max(proj_w, proj_h)
        if proj_long > target_size:
            clamp = target_size / proj_long
            scale *= clamp
            notes.append(
                f'mode B clamped: tooth at {mode_b_px_per_mm} px/mm '
                f'exceeds {target_size}; downscaled by {clamp:.3f} to fit'
            )
        else:
            notes.append(f'mode B scale={scale:.4f} ({mode_b_px_per_mm} px/mm)')

    new_w = max(1, int(round(bbox_w * scale)))
    new_h = max(1, int(round(bbox_h * scale)))
    tooth_resized = tooth_crop.resize((new_w, new_h), Image.LANCZOS)

    canvas = Image.new('RGB', (target_size, target_size), background_color)
    paste_x = (target_size - new_w) // 2
    paste_y = (target_size - new_h) // 2
    canvas.paste(tooth_resized, (paste_x, paste_y))

    out_bbox = (paste_x, paste_y, paste_x + new_w - 1, paste_y + new_h - 1)
    result = ProcessedResult(
        mode=mode,
        output_size=(target_size, target_size),
        scale_factor=float(scale),
        tooth_bbox_in_output=out_bbox,
        notes=notes,
    )
    return canvas, result


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _open_as_rgb(source, background_color):
    if isinstance(source, Image.Image):
        img = source
    elif isinstance(source, str):
        img = Image.open(source)
    elif isinstance(source, np.ndarray):
        img = Image.fromarray(source)
    else:
        raise TypeError(f'unsupported source type: {type(source)!r}')

    if img.mode in ('RGBA', 'LA'):
        bg = Image.new('RGB', img.size, background_color)
        bg.paste(img, mask=img.split()[-1])
        return bg
    return img.convert('RGB')


def _mask_region(img, bbox, color):
    """Paint a rectangular region of `img` with `color`. Returns a new PIL
    Image; the input is not modified."""
    out = img.copy()
    x0, y0, x1, y1 = (int(v) for v in bbox)
    w, h = out.size
    x0 = max(0, min(w - 1, x0))
    y0 = max(0, min(h - 1, y0))
    x1 = max(0, min(w - 1, x1))
    y1 = max(0, min(h - 1, y1))
    if x1 <= x0 or y1 <= y0:
        return out
    block = Image.new('RGB', (x1 - x0 + 1, y1 - y0 + 1), color)
    out.paste(block, (x0, y0))
    return out


__all__ = [
    'ProcessedResult',
    'emit_processed',
]

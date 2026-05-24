# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: scale_calibration.py
# Copyright (c) 2024

"""
Scale-bar detection and mm/px calibration for fossil-tooth photographs.

Given a photograph that contains a tooth and an FLMNH-style scale bar, this
module locates the scale bar, finds the high-contrast ruler region inside the
bar's bounding box, and computes a millimetres-per-pixel calibration so that
downstream code can express tooth areas in mm^2 rather than px^2.

Designed to run without OpenCV or OCR. Uses Pillow, numpy, and scipy only.
Works on the MASKED images Alexa delivers (RGBA, alpha is the segmentation
mask). The same primitives extend to RAW images by swapping the foreground
detector for a dark-background threshold.

No Django dependency. Importable as a plain Python module from any context.
"""

from dataclasses import dataclass, field, asdict
from typing import List, Optional, Tuple
import os

import numpy as np
from PIL import Image
from scipy import ndimage


# ---------------------------------------------------------------------------
# Result types
# ---------------------------------------------------------------------------

@dataclass
class BlobInfo:
    """One connected foreground component."""
    blob_id: int
    area_px: int
    bbox: Tuple[int, int, int, int]   # (x0, y0, x1, y1) inclusive
    fill_ratio: float                 # area / (bbox_w * bbox_h)
    aspect_ratio: float               # max(w, h) / min(w, h), always >= 1
    classification: str               # 'tooth' | 'scale_bar' | 'unknown'


@dataclass
class ScaleBarResult:
    """Detection result for one image."""
    image_path: str
    image_size: Tuple[int, int]                          # (w, h)
    foreground_source: str                               # 'alpha' | 'threshold' | 'none'
    blobs: List[BlobInfo]
    bar_bbox: Optional[Tuple[int, int, int, int]] = None # (x0, y0, x1, y1)
    bar_long_axis: Optional[str] = None                  # 'x' | 'y'
    bar_bbox_length_px: Optional[int] = None             # length along long axis
    ruler_region_px: Optional[Tuple[int, int]] = None    # (start, end) along long axis, inclusive, in image coords
    ruler_region_length_px: Optional[int] = None
    tick_positions_px: List[int] = field(default_factory=list)   # transition positions in image coords
    tick_count: int = 0
    median_tick_spacing_px: Optional[float] = None
    assumed_tick_spacing_mm: Optional[float] = None
    mm_per_pixel: Optional[float] = None
    confidence: float = 0.0                              # 0..1
    notes: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def detect_scale_bar(
    image_path: str,
    assumed_tick_spacing_mm: float = 10.0,
    min_blob_area_px: int = 5_000,
    bar_fill_threshold: float = 0.85,
    bar_aspect_threshold: float = 3.0,
) -> ScaleBarResult:
    """
    Detect the scale bar in a photograph and estimate mm/px.

    The detector finds the bar's bounding box (by foreground blob shape),
    then locates the printed ruler region inside the bar by looking for a
    long contiguous run of regularly-spaced light/dark transitions. The
    ruler's median tick spacing in pixels, combined with the assumed
    physical tick spacing in mm, yields mm/px.

    `assumed_tick_spacing_mm` defaults to 10.0 (1 cm) which matches the
    alternating black/white block pattern on the small FLMNH metric scale.
    For rulers where the discoverable tick spacing is 1 mm, pass 1.0; for
    1/4 inch, pass 6.35; etc.

    Check `result.mm_per_pixel` and `result.confidence` before using the
    calibration downstream.
    """
    img = Image.open(image_path)
    width, height = img.size

    foreground_mask, foreground_source = _foreground_mask(img)
    if foreground_mask is None:
        return ScaleBarResult(
            image_path=image_path,
            image_size=(width, height),
            foreground_source='none',
            blobs=[],
            notes=['could not determine a foreground mask'],
        )

    blobs = _label_and_describe_blobs(foreground_mask, min_blob_area_px)
    _classify_blobs(blobs, bar_fill_threshold, bar_aspect_threshold)

    result = ScaleBarResult(
        image_path=image_path,
        image_size=(width, height),
        foreground_source=foreground_source,
        blobs=blobs,
    )

    bar = _pick_best_bar(blobs)
    if bar is None:
        result.notes.append('no blob classified as scale_bar')
        return result

    result.bar_bbox = bar.bbox
    x0, y0, x1, y1 = bar.bbox
    bar_w = x1 - x0 + 1
    bar_h = y1 - y0 + 1
    result.bar_long_axis = 'x' if bar_w >= bar_h else 'y'
    result.bar_bbox_length_px = max(bar_w, bar_h)

    # Locate the printed ruler region inside the bar bbox by looking for a
    # long run of regularly-spaced light/dark transitions.
    gray = _open_grayscale_with_bg_white(img)
    ruler = _locate_ruler_by_ticks(gray, bar.bbox, result.bar_long_axis)
    if ruler is None:
        result.notes.append('ruler region not detected inside bar bbox')
        result.confidence = 0.2
        return result

    result.ruler_region_px = (ruler.start, ruler.end)
    result.ruler_region_length_px = ruler.end - ruler.start + 1
    result.tick_positions_px = ruler.tick_positions
    result.tick_count = len(ruler.tick_positions)
    result.median_tick_spacing_px = ruler.median_spacing_px
    result.assumed_tick_spacing_mm = assumed_tick_spacing_mm

    if ruler.median_spacing_px and ruler.median_spacing_px > 0:
        result.mm_per_pixel = assumed_tick_spacing_mm / ruler.median_spacing_px

    result.confidence = _calibration_confidence(
        bar=bar,
        ruler_length_px=result.ruler_region_length_px,
        bar_length_px=result.bar_bbox_length_px,
        tick_count=result.tick_count,
        spacing_uniformity=ruler.spacing_uniformity,
    )
    return result


# ---------------------------------------------------------------------------
# Foreground extraction
# ---------------------------------------------------------------------------

def _foreground_mask(img: Image.Image, alpha_threshold: int = 16, dark_bg_threshold: int = 32):
    """
    Build a binary foreground mask plus a tag for which strategy was used.

    Strategy 1: if the image has an alpha channel and any alpha is below
    threshold, the alpha channel itself is the foreground mask. This handles
    the MASKED images Alexa delivers (background already removed).

    Strategy 2: dark background threshold. Used for RAW images. Pixels whose
    grayscale value is above `dark_bg_threshold` are considered foreground.
    """
    if img.mode in ('RGBA', 'LA'):
        alpha = np.array(img.split()[-1])
        if alpha.min() < 250:
            return (alpha > alpha_threshold), 'alpha'

    gray = np.array(img.convert('L'))
    h, w = gray.shape
    margin = max(50, min(h, w) // 20)
    corners = np.concatenate([
        gray[:margin, :margin].ravel(),
        gray[:margin, -margin:].ravel(),
        gray[-margin:, :margin].ravel(),
        gray[-margin:, -margin:].ravel(),
    ])
    median_bg = float(np.median(corners))
    if median_bg < 64:
        # dark background: foreground is anything brighter than threshold
        return (gray > dark_bg_threshold), 'threshold'

    return None, 'none'


# ---------------------------------------------------------------------------
# Blob detection and classification
# ---------------------------------------------------------------------------

def _label_and_describe_blobs(mask: np.ndarray, min_area_px: int) -> List[BlobInfo]:
    """Connected-component labelling plus per-blob descriptors."""
    labeled, n = ndimage.label(mask)
    if n == 0:
        return []

    sizes = ndimage.sum(mask, labeled, range(1, n + 1))
    blobs: List[BlobInfo] = []
    for i in range(n):
        bid = i + 1
        area = int(sizes[i])
        if area < min_area_px:
            continue
        ys, xs = np.where(labeled == bid)
        x0, x1 = int(xs.min()), int(xs.max())
        y0, y1 = int(ys.min()), int(ys.max())
        bw = x1 - x0 + 1
        bh = y1 - y0 + 1
        fill = area / float(bw * bh)
        ar = max(bw, bh) / float(min(bw, bh))
        blobs.append(BlobInfo(
            blob_id=bid,
            area_px=area,
            bbox=(x0, y0, x1, y1),
            fill_ratio=fill,
            aspect_ratio=ar,
            classification='unknown',
        ))
    blobs.sort(key=lambda b: -b.area_px)
    return blobs


def _classify_blobs(blobs: List[BlobInfo], fill_threshold: float, aspect_threshold: float) -> None:
    """
    Mutate `blobs` in place, setting `classification` on each.

    Rules (empirically derived from the FLMNH-card sample set):

    - A blob with fill_ratio above `fill_threshold` is a scale-bar candidate
      (the FLMNH "big" card is a near-perfect filled rectangle).
    - A blob with aspect_ratio above `aspect_threshold` is a scale-bar
      candidate (the smaller FLMNH metric-only card is a long thin strip).
    - The largest remaining blob (by area) is tagged as the tooth.
    """
    for b in blobs:
        is_rect_like = b.fill_ratio >= fill_threshold
        is_strip_like = b.aspect_ratio >= aspect_threshold
        if is_rect_like or is_strip_like:
            b.classification = 'scale_bar'

    tooth_candidates = [b for b in blobs if b.classification == 'unknown']
    if tooth_candidates:
        tooth_candidates[0].classification = 'tooth'


def _pick_best_bar(blobs: List[BlobInfo]) -> Optional[BlobInfo]:
    """Pick the highest-confidence scale-bar blob if multiple are tagged."""
    bars = [b for b in blobs if b.classification == 'scale_bar']
    if not bars:
        return None
    # Prefer the strip-like one over the rectangle-like one if both exist;
    # the strip is unambiguously a ruler. Tie-break on area.
    def score(b: BlobInfo) -> tuple:
        return (b.aspect_ratio, b.fill_ratio, b.area_px)
    bars.sort(key=score, reverse=True)
    return bars[0]


# ---------------------------------------------------------------------------
# Ruler-region location inside the bar bbox
# ---------------------------------------------------------------------------

def _open_grayscale_with_bg_white(img: Image.Image) -> np.ndarray:
    """
    Open image as grayscale, compositing transparent pixels over white so the
    ruler-region detector is not biased by background colour. Returns a
    uint8 array of shape (H, W).
    """
    if img.mode in ('RGBA', 'LA'):
        bg = Image.new('RGB', img.size, (255, 255, 255))
        bg.paste(img, mask=img.split()[-1])
        return np.array(bg.convert('L'))
    return np.array(img.convert('L'))


@dataclass
class _RulerHit:
    start: int                  # ruler region start in image coords (long axis)
    end: int                    # ruler region end inclusive
    tick_positions: List[int]   # transition positions in image coords
    median_spacing_px: float
    spacing_uniformity: float   # 0..1, higher means more uniform spacing


def _locate_ruler_by_ticks(
    gray: np.ndarray,
    bar_bbox: Tuple[int, int, int, int],
    long_axis: str,
    strip_positions: Tuple[float, ...] = (0.10, 0.25, 0.40, 0.50, 0.60, 0.75, 0.90),
    strip_frac: float = 0.18,
    min_run_ticks: int = 4,
    spacing_tolerance: float = 0.35,
    smoothing: int = 7,
    min_spacing_px: int = 30,
) -> Optional['_RulerHit']:
    """
    Locate the printed ruler inside the bar bbox by scanning multiple
    horizontal (or vertical) strips of the bar, looking for the strip with
    the strongest run of evenly-spaced light/dark transitions.

    Cards with text or a logo through the centre would defeat a single
    central-strip scan, so we sweep several strip positions across the
    short axis. The strip that yields the most ticks under uniform spacing
    wins.

    Reject candidate runs whose median spacing is below `min_spacing_px`
    (those are texture/text edges, not printed ruler ticks) or where
    fewer than `min_run_ticks` were found.

    Returns _RulerHit with image-coordinate start/end, tick positions, and
    the median spacing in pixels. Returns None when no qualifying run is
    found.
    """
    x0, y0, x1, y1 = bar_bbox
    crop = gray[y0:y1 + 1, x0:x1 + 1].astype(np.float32)
    h, w = crop.shape

    if long_axis == 'x':
        short_axis_len = h
        coord_offset = x0
    else:
        short_axis_len = w
        coord_offset = y0

    strip_thickness = max(8, int(short_axis_len * strip_frac))
    best_hit: Optional[_RulerHit] = None

    for frac in strip_positions:
        centre = int(round(short_axis_len * frac))
        lo = max(0, centre - strip_thickness // 2)
        hi = min(short_axis_len, lo + strip_thickness)
        lo = max(0, hi - strip_thickness)
        if hi - lo < 8:
            continue

        if long_axis == 'x':
            strip = crop[lo:hi, :]
            profile = strip.mean(axis=0)
        else:
            strip = crop[:, lo:hi]
            profile = strip.mean(axis=1)

        if profile.size < 32:
            continue

        if smoothing > 1:
            kernel = np.ones(smoothing, dtype=np.float32) / float(smoothing)
            profile = np.convolve(profile, kernel, mode='same')

        pmin, pmax = float(profile.min()), float(profile.max())
        if (pmax - pmin) < 30.0:
            continue
        midpoint = pmin + (pmax - pmin) * 0.5
        binary = (profile < midpoint).astype(np.int8)

        transitions = np.where(np.diff(binary) != 0)[0]
        if transitions.size < min_run_ticks - 1:
            continue
        transitions = transitions.astype(int)

        spacings = np.diff(transitions)
        if spacings.size < min_run_ticks - 2:
            continue

        run = _longest_uniform_run(spacings, spacing_tolerance)
        if run is None:
            continue
        rs, re = run
        if (re - rs + 1) < (min_run_ticks - 1):
            continue

        tick_idx = transitions[rs: re + 2]
        run_spacings = np.diff(tick_idx)
        if run_spacings.size == 0:
            continue
        median_sp = float(np.median(run_spacings))
        if median_sp < float(min_spacing_px):
            # Likely texture or small text, not printed ruler ticks.
            continue

        uniformity = float(1.0 - min(1.0, run_spacings.std() / max(1.0, median_sp)))
        tick_positions_img = [int(t) + coord_offset for t in tick_idx.tolist()]
        hit = _RulerHit(
            start=tick_positions_img[0],
            end=tick_positions_img[-1],
            tick_positions=tick_positions_img,
            median_spacing_px=median_sp,
            spacing_uniformity=uniformity,
        )
        if best_hit is None or _hit_score(hit) > _hit_score(best_hit):
            best_hit = hit

    return best_hit


def _longest_uniform_run(spacings: np.ndarray, tolerance: float) -> Optional[Tuple[int, int]]:
    """Find the longest contiguous index range over `spacings` where every
    spacing is within `tolerance` of the run's median. Returns (start, end)
    inclusive over the spacing array, or None."""
    best: Tuple[int, int] = (-1, -2)
    n = len(spacings)
    i = 0
    while i < n:
        j = i
        while j + 1 < n:
            window = spacings[i:j + 2]
            med = float(np.median(window))
            if med <= 0:
                break
            if not bool(np.all(np.abs(window - med) <= tolerance * med)):
                break
            j += 1
        if (j - i) > (best[1] - best[0]):
            best = (i, j)
        i = j + 1
    if best[0] < 0:
        return None
    return best


def _hit_score(hit: '_RulerHit') -> float:
    """Comparator key for picking the best ruler hit across multiple strips.
    Prefers more ticks, then more uniform spacing."""
    n = len(hit.tick_positions)
    return n * 100.0 + hit.spacing_uniformity


def _calibration_confidence(
    bar: BlobInfo,
    ruler_length_px: int,
    bar_length_px: int,
    tick_count: int,
    spacing_uniformity: float,
) -> float:
    """
    Confidence score in [0, 1].

    Higher when:
      - the bar classification used a strong signal (rectangle fill or long strip),
      - the ruler region occupies a reasonable fraction of the bar bbox,
      - many uniformly-spaced ticks were detected,
      - the bar is large in absolute terms.
    """
    base = 0.5
    if bar.fill_ratio >= 0.95 or bar.aspect_ratio >= 4.0:
        base = 0.75
    elif bar.fill_ratio >= 0.85 or bar.aspect_ratio >= 3.0:
        base = 0.65

    if bar_length_px > 0:
        frac = ruler_length_px / float(bar_length_px)
        if 0.20 <= frac <= 0.95:
            base += 0.05

    if tick_count >= 6:
        base += 0.10
    elif tick_count >= 4:
        base += 0.05

    base += 0.10 * max(0.0, min(1.0, spacing_uniformity))

    if bar.area_px < 50_000:
        base -= 0.20

    return max(0.0, min(1.0, base))


# ---------------------------------------------------------------------------
# Convenience: convert px area to mm^2 with a known calibration
# ---------------------------------------------------------------------------

def px_area_to_mm2(area_px: float, mm_per_pixel: float) -> float:
    return float(area_px) * (mm_per_pixel ** 2)


__all__ = [
    'BlobInfo',
    'ScaleBarResult',
    'detect_scale_bar',
    'px_area_to_mm2',
]

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
# Card specifications
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class CardSpec:
    """Physical geometry of one FLMNH scale card.

    Both known cards print two band rows: an imperial row on top and a metric
    row underneath, separated by the "Florida Museum of Natural History"
    caption. On both cards the printed label states that row's TOTAL span, and
    the row is divided into equal bands. Dividing total by band count gives
    what one band is worth in mm, which is what converts pixels to mm.

    Verified against the known-good fixture RAW_574594A (mm/px = 0.025543):
    its imperial band measures 1006 px = 25.7 mm (the printed "1 inch") and
    its metric band 394 px = 10.1 mm (one third of the printed "3 cm").

    Measuring a band width is far more robust than counting "ticks", because a
    band width is a local, repeated quantity, while a tick count depends on
    where the scan line happened to cross the card.
    """
    name: str
    top_block_mm: float       # one band in the imperial row
    bottom_block_mm: float    # one band in the metric row
    top_blocks: int           # bands in the imperial row
    bottom_blocks: int        # bands in the metric row
    caption: str

    @property
    def block_ratio(self) -> float:
        return self.top_block_mm / self.bottom_block_mm


# "1 inch" as a single solid band; "3 cm" as three 1 cm bands.
FLMNH_LARGE = CardSpec('flmnh_1inch_3cm', 25.4, 10.0, 1, 3, '1 inch / 3 cm')
# "0.5 inches" split into five 0.1 inch (2.54 mm) bands; "10 mm" split into
# ten 1 mm bands.
FLMNH_SMALL = CardSpec('flmnh_halfinch_10mm', 2.54, 1.0, 5, 10, '0.5 inches / 10 mm')
# The compact "FLMNH" card: "0.2in" as two 0.1 inch (2.54 mm) bands over
# "5mm" as five 1 mm bands. Note the imperial row is printed BELOW the metric
# row on this card, which is why row identity is decided by band width rather
# than by vertical position.
FLMNH_COMPACT = CardSpec('flmnh_5mm_02in', 2.54, 1.0, 2, 5, '5 mm / 0.2 in')

KNOWN_CARDS = (FLMNH_LARGE, FLMNH_SMALL, FLMNH_COMPACT)

# Both cards happen to share this invariant, so it is a free correctness check
# on the row detection rather than a way to tell the cards apart.
# The tick-spacing floor the detector used historically. Kept as the
# first-pass value so every calibration that already worked keeps working;
# the relative floor is only tried when this one finds no ruler at all.
_HISTORIC_TICK_FLOOR_PX = 30.0

_EXPECTED_BLOCK_RATIO = 2.54
_BLOCK_RATIO_TOLERANCE = 0.22          # accept 1.98 .. 3.10

# ---------------------------------------------------------------------------
# Graduated rulers
# ---------------------------------------------------------------------------
#
# Not every collection uses a banded card. Calvert Marine Museum photographs
# carry a conventional graduated ruler along the frame edge: short ticks every
# millimetre, longer ticks at a regular multiple, and printed centimetre
# numbers. Roughly 280 baseline photographs are of this kind, and the card
# measurement cannot read them at all.
#
# The same self-validating idea applies. A ruler prints two tick populations,
# distinguishable because the longer ticks reach further into the strip. Each
# population yields an independent mm/px, and they must agree. Anchoring on a
# single population with an assumed spacing is precisely the mistake that
# produced the original 5-10x error.
RULER_MINOR_MM = 1.0

# Accepted major/minor tick ratios and what one major tick is worth. Both
# schemes agree that the minor tick is 1 mm, so identifying the scheme is a
# consistency check rather than a free parameter.
RULER_SCHEMES = (
    (5.0, 5.0),     # long tick every half centimetre
    (10.0, 10.0),   # long tick every centimetre
)
_RULER_SCHEME_TOLERANCE = 0.18     # a 5x scheme must measure 4.1 .. 5.9
_RULER_AGREEMENT_TOLERANCE = 0.10  # minor and major estimates within 10%
_RULER_MIN_MINOR_TICKS = 12        # enough graduations to be a ruler, not text
_RULER_MIN_MAJOR_TICKS = 4


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
    # Orientation-independent shape dimensions from the equivalent-ellipse
    # fit (second central moments). 0.0 when unavailable.
    #
    # major/minor are sorted by SIZE and say nothing about anatomy.
    # length/width are the same two numbers assigned to the crown axis and
    # the mesiodistal axis, which is what any measurement of a tooth means.
    # They differ exactly when a tooth is broader than it is tall.
    major_axis_px: float = 0.0
    minor_axis_px: float = 0.0
    length_px: float = 0.0
    width_px: float = 0.0


@dataclass
class ScaleBarResult:
    """Detection result for one image."""
    image_path: str
    image_size: Tuple[int, int]                          # (w, h)
    foreground_source: str                     # 'alpha' | 'threshold' | 'colour' | 'none'
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
    # --- card-aware calibration (preferred path) ---------------------------
    calibration_method: str = 'none'      # 'card_rows' | 'ruler_ticks' | 'legacy_ticks' | 'none'
    ruler_minor_px: Optional[float] = None   # measured 1 mm tick spacing
    ruler_major_px: Optional[float] = None   # measured long-tick spacing
    ruler_major_mm: Optional[float] = None   # what one long tick is worth
    card_name: Optional[str] = None       # CardSpec.name when identified
    top_block_px: Optional[float] = None  # measured imperial-row band width
    bottom_block_px: Optional[float] = None
    mm_per_pixel_top: Optional[float] = None     # estimate from imperial row
    mm_per_pixel_bottom: Optional[float] = None  # estimate from metric row
    block_ratio: Optional[float] = None   # top_block_px / bottom_block_px
    cross_check_error: Optional[float] = None    # |top/bottom - 1|, 0 is perfect

    def to_dict(self) -> dict:
        return asdict(self)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def detect_scale_bar(
    image_path: str,
    assumed_tick_spacing_mm: float = 10.0,
    min_blob_area_px: int = 5_000,
    bar_fill_threshold: float = 0.78,
    bar_aspect_threshold: float = 3.0,
    allow_unverified_ticks: bool = False,
) -> ScaleBarResult:
    """Detect the scale bar, retrying once with a relaxed tick floor.

    The historic tick floor runs first and its answer is final whenever it
    produces one. Only when it yields no calibration at all is the relaxed
    floor tried, and its result is used only if it actually calibrates.

    Ordering it this way is the whole point. The relaxed floor is what makes a
    small ruler readable - CMM-V-4944's millimetre ticks sit at 27-29 px, just
    under the old constant - but it is not free: admitting shorter spacings
    lets a wrong run outscore the right one and silently changes which blob is
    taken for the bar. Applied unconditionally it broke two Hemipristis plates
    that had calibrated correctly, because at the strict floor NO candidate
    showed a ruler, the picker fell back geometrically, and the graduated-ruler
    path then read them at 37 px per mm. Relaxing removed that fallback.

    Strict-wins-if-it-works keeps both behaviours: nothing that calibrates
    today can be taken away, and frames that calibrate under neither floor get
    a second chance.
    """
    strict = _detect_scale_bar_with_floor(
        image_path, assumed_tick_spacing_mm, min_blob_area_px,
        bar_fill_threshold, bar_aspect_threshold, allow_unverified_ticks,
        tick_floor=_HISTORIC_TICK_FLOOR_PX)
    if strict.mm_per_pixel is not None:
        return _gate_colour_calibration(strict)

    relaxed = _detect_scale_bar_with_floor(
        image_path, assumed_tick_spacing_mm, min_blob_area_px,
        bar_fill_threshold, bar_aspect_threshold, allow_unverified_ticks,
        tick_floor=None)
    return _gate_colour_calibration(
        relaxed if relaxed.mm_per_pixel is not None else strict)


def segment_blobs(
    image_path: str,
    min_blob_area_px: int = 5_000,
    bar_fill_threshold: float = 0.78,
    bar_aspect_threshold: float = 3.0,
) -> List['BlobInfo']:
    """Segment the frame into classified blobs and stop there.

    Everything expensive in the detector happens AFTER this point: card
    identification, OCR, sweeping for ruler ticks, and a second full pass when
    the first finds nothing. Callers that only need to know what shapes are in
    the picture should not pay for any of it.
    """
    img = Image.open(image_path)
    mask, _source = _foreground_mask(img)
    if mask is None:
        return []
    blobs = _label_and_describe_blobs(mask, min_blob_area_px)
    _classify_blobs(blobs, bar_fill_threshold, bar_aspect_threshold)
    return blobs


def detect_tooth_only(
    image_path: str,
    min_blob_area_px: int = 5_000,
    bar_fill_threshold: float = 0.78,
    bar_aspect_threshold: float = 3.0,
) -> Optional['BlobInfo']:
    """Find just the tooth, without hunting for a scale bar.

    A hand-set calibration already knows its mm/px; all it needs from the
    image is the tooth outline to convert that into a size. Calling the full
    detector for this is enormously wasteful: on CMM-V-5096-B it spends 21.9
    seconds identifying cards, running OCR and sweeping for ruler ticks
    (twice, since a failed strict pass retries relaxed) before giving up and
    returning no calibration at all. The blobs it would have used take 0.4s.

    That 21 second wait sat between a reviewer clicking Apply and seeing their
    measurement, on exactly the frames where the automatic detector had
    already failed, which is the only reason anyone reaches for the manual
    tool in the first place.

    Returns the tooth BlobInfo, or None when nothing could be segmented.
    """
    blobs = segment_blobs(image_path, min_blob_area_px,
                          bar_fill_threshold, bar_aspect_threshold)
    tooth = next((b for b in blobs if b.classification == 'tooth'), None)
    if tooth is not None:
        return tooth
    # No blob was tagged as the tooth, so fall back to the largest thing that
    # is not card-shaped rather than returning nothing.
    remainder = [b for b in blobs if b.classification != 'scale_bar']
    return max(remainder, key=lambda b: b.area_px) if remainder else None


# A colour-mask calibration has to clear both of these to be believed.
# Sized so the two known false-positive families cannot pass: the synthetic
# training crops are 384x384, and the UI screenshots scored 0.38 to 0.58.
_COLOUR_MIN_LONG_EDGE_PX = 1200
_COLOUR_MIN_CONFIDENCE = 0.70


def _gate_colour_calibration(result: 'ScaleBarResult') -> 'ScaleBarResult':
    """Let a light-background frame calibrate only when the evidence is strong.

    The colour-distance mask was originally forbidden from calibrating at all,
    because letting it try produced 91 mm/px values that had never existed: 3
    UI screenshots and 88 synthetic 384x384 training crops, where banding in
    the mask merely resembled a ruler. Mode A+ feeds size in as a training
    input, so a fabricated mm/px there is poison rather than noise.

    A blanket ban was too coarse. The OMEG-KEMA specimens are photographed on
    a light backdrop WITH a ruler in frame, and all 18 calibrate to within
    0.8% of each other at confidence 0.94 or better - a fixed rig, measured
    correctly, refused on a technicality.

    The two false-positive families separate cleanly from real specimens on
    size and confidence, so gate on those instead of on the mask source.
    Anything that fails keeps its segmentation, so the reviewer still gets a
    tooth outline to scale by hand.
    """
    if result.foreground_source != 'colour' or result.mm_per_pixel is None:
        return result

    long_edge = max(result.image_size) if result.image_size else 0
    if long_edge >= _COLOUR_MIN_LONG_EDGE_PX and result.confidence >= _COLOUR_MIN_CONFIDENCE:
        return result

    result.mm_per_pixel = None
    result.confidence = 0.0
    result.calibration_method = 'none'
    result.notes.append(
        'light background: %s, so no automatic scale. Segmented for review; '
        'set the scale manually.'
        % ('image too small to trust' if long_edge < _COLOUR_MIN_LONG_EDGE_PX
           else 'ruler evidence too weak'))
    return result


def _detect_scale_bar_with_floor(
    image_path: str,
    assumed_tick_spacing_mm: float = 10.0,
    min_blob_area_px: int = 5_000,
    bar_fill_threshold: float = 0.78,
    bar_aspect_threshold: float = 3.0,
    allow_unverified_ticks: bool = False,
    tick_floor=None,
) -> ScaleBarResult:
    """
    Detect the scale bar in a photograph and compute mm/px.

    The detector finds the bar's bounding box (by foreground blob shape), then
    identifies which FLMNH card it is and measures the band width of each of
    the card's two printed rows. Each row yields an independent mm/px, and the
    two must agree; the returned value is their mean. Disagreement is reported
    in `cross_check_error` and lowers `confidence`, so a misread is visible
    rather than silent.

    When the card cannot be read, **no calibration is returned**
    (`mm_per_pixel is None`). Set `allow_unverified_ticks=True` to fall back
    to the old behaviour of multiplying a tick spacing by
    `assumed_tick_spacing_mm`; that guess produced a biologically impossible
    tooth size in 92% of the baseline photographs where it fired, so it is
    off by default and should only be used for diagnostics.

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

    # Among the candidate scale-bar blobs, pick the one that actually
    # contains a detectable ruler pattern. The catalog label can also look
    # like a high-fill rectangle in shape but has no banded ruler inside;
    # this content-based discriminator separates them robustly.
    gray = _open_grayscale_with_bg_white(img)
    bar, ruler = _pick_bar_with_ruler(blobs, gray, tick_floor)
    if bar is None:
        result.notes.append('no blob classified as scale_bar')
        return result

    # Re-tag blobs based on the actual winner so the API consumer sees the
    # correct labels (the loser of bar candidacy, if a different blob, is
    # most likely the catalog label).
    for b in blobs:
        if b is bar:
            b.classification = 'scale_bar'
        elif b.classification == 'scale_bar':
            b.classification = 'label'

    # The largest remaining 'unknown' (not bar, not label) is the tooth.
    tooth_candidates = [b for b in blobs if b.classification == 'unknown']
    if tooth_candidates:
        tooth_candidates[0].classification = 'tooth'

    result.bar_bbox = bar.bbox
    x0, y0, x1, y1 = bar.bbox
    bar_w = x1 - x0 + 1
    bar_h = y1 - y0 + 1
    result.bar_long_axis = 'x' if bar_w >= bar_h else 'y'
    result.bar_bbox_length_px = max(bar_w, bar_h)
    if ruler is None:
        # No tick-like run inside the chosen blob. That used to end the
        # function, which made sense when the tick spacing WAS the
        # calibration. It no longer is: the card path measures printed band
        # widths and the ruler path scans by depth, and neither needs this
        # probe to have succeeded. Bailing out here skipped both of them
        # whenever the blob chooser picked a catalog label, which is exactly
        # what happens on frames carrying a card and a label together.
        result.notes.append('no tick run inside the chosen blob')
    else:
        # Diagnostics only. Nothing downstream calibrates from these.
        result.ruler_region_px = (ruler.start, ruler.end)
        result.ruler_region_length_px = ruler.end - ruler.start + 1
        result.tick_positions_px = ruler.tick_positions
        result.tick_count = len(ruler.tick_positions)
        result.median_tick_spacing_px = ruler.median_spacing_px

    # ---- Preferred path: measure the card's two band rows -----------------
    #
    # The legacy path below multiplies a *tick spacing* by an assumed physical
    # length. That assumption is unknowable from the image and was wrong for
    # the small FLMNH card, inflating mm/px (and therefore mm^2 by its square).
    # Measuring both printed rows instead gives two independent estimates that
    # must agree, so a bad reading is detected rather than silently returned.
    # Only the chosen bar blob is measured. Falling through to runner-up blobs
    # was tried and rejected: it recovered 3 extra calibrations across the
    # baseline sample but 2 of them were biologically impossible, dropping
    # precision from 100% to 98.9%. Coverage is not worth a wrong mm/px, which
    # propagates squared into mm^2.
    rows = _measure_card_rows(gray, bar.bbox, result.bar_long_axis)
    card = _identify_card(image_path, bar.bbox, rows)
    if rows is not None and card is not None:
        top_px, bottom_px = rows
        mm_top = card.top_block_mm / top_px
        mm_bottom = card.bottom_block_mm / bottom_px
        result.card_name = card.name
        result.top_block_px = top_px
        result.bottom_block_px = bottom_px
        result.block_ratio = top_px / bottom_px
        result.mm_per_pixel_top = mm_top
        result.mm_per_pixel_bottom = mm_bottom
        result.cross_check_error = abs(mm_top / mm_bottom - 1.0)
        # Average the two rows; they are independent measurements of the same
        # quantity, so the mean is strictly better than either alone.
        result.mm_per_pixel = (mm_top + mm_bottom) / 2.0
        result.calibration_method = 'card_rows'
        result.confidence = _card_confidence(result.cross_check_error, result.block_ratio)
        if result.cross_check_error > 0.10:
            result.notes.append(
                'rows disagree by %.0f%% (top=%.5f bottom=%.5f mm/px)'
                % (result.cross_check_error * 100.0, mm_top, mm_bottom))
        return result

    # ---- Not a banded card: try a graduated ruler --------------------------
    #
    # Collections outside FLMNH photograph against a conventional ruler rather
    # than a banded card. The card measurement cannot read those at all, so
    # this second method covers them, using the same rule that two independent
    # estimates must agree before anything is returned.
    # Every candidate is tried, not just the one the bar chooser picked. That
    # chooser ranks by tick count, which on a ruler photograph often favours
    # the handwritten catalog label over the ruler strip itself. Trying all of
    # them is safe here because the ruler read has to clear three independent
    # gates: two tick populations, a recognised 5x or 10x scheme, and the two
    # resulting mm/px estimates agreeing within 10%. The best agreement wins.
    ruler = None
    ruler_bbox = bar.bbox
    for candidate in _bar_candidates(blobs):
        found = _measure_graduated_ruler(gray, candidate.bbox)
        if found and (ruler is None or found['agreement'] < ruler['agreement']):
            ruler, ruler_bbox = found, candidate.bbox
    if ruler is not None:
        if ruler_bbox != bar.bbox:
            rx0, ry0, rx1, ry1 = ruler_bbox
            result.bar_bbox = ruler_bbox
            result.bar_long_axis = 'x' if (rx1 - rx0) >= (ry1 - ry0) else 'y'
            result.bar_bbox_length_px = max(rx1 - rx0 + 1, ry1 - ry0 + 1)
        result.mm_per_pixel = ruler['mm_per_pixel']
        result.mm_per_pixel_top = ruler['mm_per_pixel_major']
        result.mm_per_pixel_bottom = ruler['mm_per_pixel_minor']
        result.cross_check_error = ruler['agreement']
        result.ruler_minor_px = ruler['minor_px']
        result.ruler_major_px = ruler['major_px']
        result.ruler_major_mm = ruler['major_mm']
        result.calibration_method = 'ruler_ticks'
        result.confidence = _card_confidence(ruler['agreement'], None)
        result.notes.append(
            'graduated ruler: %.1f px per mm, long tick every %.0f mm'
            % (ruler['minor_px'], ruler['major_mm']))
        return result

    # ---- Last resort: look for a card in ANY blob --------------------------
    #
    # The blob classifier decides what is a scale bar from shape alone, and on
    # frames that contain both a card and a catalog label it routinely picks
    # the label: the label is a big clean rectangle while the card's fill
    # ratio is dragged down by its own printed bands. The card then ends up
    # tagged 'tooth' and is never examined, which is why fragment photographs
    # (card AND label in frame) calibrated far worse than baseline ones (card
    # only).
    #
    # This runs only after the card and ruler paths have both failed on the
    # proper candidates, so it cannot pull a ruler photograph onto the card
    # path. A blob still has to produce two band rows at the 2.54 ratio and be
    # identified as a known card, which a tooth does not.
    # Each blob is tried whole first, then in sliding sub-windows, because a
    # card touching its catalog label comes back as a single merged blob whose
    # combined region cannot be measured.
    blob_boxes = {blob.bbox for blob in blobs}
    candidate_regions: List[Tuple[int, int, int, int]] = []
    for blob in blobs:
        candidate_regions.append(blob.bbox)
    for blob in blobs:
        candidate_regions.extend(_card_search_windows(blob.bbox))

    # Collect every region that reads as a card, then take the one with the
    # WIDEST imperial band rather than the first match found.
    #
    # The cross-check cannot separate these. Every card has
    # top_block_mm / bottom_block_mm = 2.54, which is also the geometric ratio
    # being gated on, so mm_top / mm_bottom = 2.54 / measured_ratio and
    # "the two agree" is implied by the ratio matching. It is a tighter ratio
    # gate, not a second measurement.
    #
    # What does separate them is scale. On UF VP28753AC a narrow window over
    # label text matched at 69 px / 27 px (ratio 2.56, cross-check 0.6%) and
    # returned 0.03692 mm/px, while the card's real 1 inch bar measures 476 px
    # in the same frame and gives 0.0534. Printed bands are far larger than
    # letter strokes, so the widest valid reading is the card.
    matches = []
    for region in candidate_regions:
        rows = _measure_card_rows(gray, region, None)
        if rows is None:
            continue
        card = _identify_card(image_path, region, rows)
        if card is None:
            continue
        # A sub-window must be CONFIRMED BY OCR, not by geometry.
        #
        # Geometry alone cannot tell a card from text here. The ratio gate and
        # the cross-check are the same constraint (see below), and the
        # geometric card-identification fallback happily labels a 93 px text
        # stroke as a 1 inch bar, which on UF VP28753AC produced 0.27 mm/px
        # against a true 0.053. Reading the card's own printed units inside
        # the window is the one genuinely independent signal available.
        if region not in blob_boxes and not _window_shows_card_text(image_path, region):
            continue
        matches.append((rows[0], region, rows, card))
    matches.sort(key=lambda m: m[0], reverse=True)

    for _width, region, rows, card in matches:
        top_px, bottom_px = rows
        mm_top = card.top_block_mm / top_px
        mm_bottom = card.bottom_block_mm / bottom_px
        cross_check = abs(mm_top / mm_bottom - 1.0)
        # A sub-window has to clear a much tighter bar than a whole blob.
        #
        # Sliding a window over a big blob gives the search many chances to
        # find a 2.54-ish pair by accident, and handwriting is full of
        # near-repeating strokes. On CMM-V-1494 a window inside the
        # handwritten catalog label produced a "card" at 9.29% cross-check,
        # yielding a 112 mm tooth that PASSED the biological check because
        # megalodon's range is wide. The ruler in that frame puts the tooth
        # near 55 mm, so it was about 2x wrong and would have shipped
        # silently. Genuine cards agree to 0.3-0.7%, so demanding a few
        # percent from sub-windows rejects the accidents while keeping every
        # real card found inside a merged blob.
        limit = 0.10 if region in blob_boxes else 0.03
        if cross_check > limit:
            continue
        bx0, by0, bx1, by1 = region
        result.bar_bbox = region
        result.bar_long_axis = 'x' if (bx1 - bx0) >= (by1 - by0) else 'y'
        result.bar_bbox_length_px = max(bx1 - bx0 + 1, by1 - by0 + 1)
        result.card_name = card.name
        result.top_block_px = top_px
        result.bottom_block_px = bottom_px
        result.block_ratio = top_px / bottom_px
        result.mm_per_pixel_top = mm_top
        result.mm_per_pixel_bottom = mm_bottom
        result.cross_check_error = cross_check
        result.mm_per_pixel = (mm_top + mm_bottom) / 2.0
        result.calibration_method = 'card_rows'
        result.confidence = _card_confidence(cross_check, result.block_ratio)
        result.notes.append('card found in a blob the classifier had not marked as a scale bar')

        # Re-tag the blob the card was found in.
        #
        # This path deliberately looks for a card inside a blob the classifier
        # called something else, and that something else is usually 'tooth' -
        # the card body reads as irregular because its printed black bands are
        # holes in the mask. Setting bar_bbox without correcting the
        # classification left the SAME object reported as both the specimen and
        # the ruler used to measure it, so downstream the card was measured as
        # the tooth: 211 fragments, 18% of the set, most of them still carrying
        # a correct mm/px so nothing looked wrong. Galeocerdo cuvier read 1.8x
        # its complete teeth for this reason alone.
        for b in blobs:
            if list(b.bbox) != list(region):
                continue
            if b.classification != 'scale_bar':
                b.classification = 'scale_bar'
                remaining = [o for o in blobs
                             if o.classification not in ('scale_bar', 'label')]
                if remaining:
                    max(remaining, key=lambda o: o.area_px).classification = 'tooth'
            break
        return result

    # ---- Neither method could read a scale: report no calibration ----------
    #
    # The legacy path guessed mm/px by assuming a physical length per tick.
    # Measured against a biological plausibility check over 204 baseline
    # photographs, that guess produced an impossible tooth size in 24 of the
    # 26 cases where it fired (92%), while the card path was wrong in 0 of
    # 178. A silently wrong mm/px is worse than none at all, because it
    # propagates squared into mm^2 and poisons the species reference areas, so
    # the guess is no longer returned unless explicitly requested.
    if rows is None:
        result.notes.append('could not resolve both card rows')
    elif card is None:
        result.notes.append('scale card not recognised')

    if ruler is not None and ruler.median_spacing_px and ruler.median_spacing_px > 0:
        result.assumed_tick_spacing_mm = assumed_tick_spacing_mm
        legacy_estimate = assumed_tick_spacing_mm / ruler.median_spacing_px
        if allow_unverified_ticks:
            result.mm_per_pixel = legacy_estimate
            result.calibration_method = 'legacy_ticks'
            result.notes.append(
                'UNVERIFIED: assumed %.2f mm per tick (opt-in fallback)'
                % assumed_tick_spacing_mm)
            result.confidence = min(0.35, _calibration_confidence(
                bar=bar,
                ruler_length_px=result.ruler_region_length_px,
                bar_length_px=result.bar_bbox_length_px,
                tick_count=result.tick_count,
                spacing_uniformity=ruler.spacing_uniformity,
            ))
            return result
        result.notes.append(
            'no calibration returned; the assumed-tick estimate would have '
            'been %.5f mm/px but is unreliable (pass '
            'allow_unverified_ticks=True to use it)' % legacy_estimate)

    result.calibration_method = 'none'
    result.confidence = 0.0
    return result


# ---------------------------------------------------------------------------
# Card row measurement
# ---------------------------------------------------------------------------

def _scanline_blocks(
    gray: np.ndarray,
    bbox: Tuple[int, int, int, int],
    long_axis: str,
    min_contrast: float = 90.0,
    min_block_px: float = 6.0,
    uniformity_tolerance: float = 0.28,
):
    """Measure the printed band width along every scan line across the card.

    Returns a list of (line_index, median_block_px, n_edges). A scan line only
    qualifies when it crosses high-contrast, near-evenly-spaced bands, which
    rejects the "Florida Museum of Natural History" caption running between
    the two rows (text edges are neither uniform nor wide).
    """
    x0, y0, x1, y1 = bbox
    crop = gray[y0:y1 + 1, x0:x1 + 1].astype(np.float32)
    if long_axis == 'y':
        crop = crop.T

    # The bbox corners contain background (the card is rarely axis-aligned).
    # Left in place, a scan line reads background -> card -> background as a
    # single enormous "block" the width of the card, which then dominates the
    # median. Trim each scan line to the bright card interior first.
    card_threshold = float(crop.max()) * 0.55
    kernel = np.ones(5, dtype=np.float32) / 5.0
    out = []
    for idx in range(crop.shape[0]):
        raw = crop[idx]
        if raw.size < 32:
            continue
        bright = np.where(raw >= card_threshold)[0]
        if bright.size < 32:
            continue
        interior = raw[bright[0]:bright[-1] + 1]
        if interior.size < 32:
            continue
        profile = np.convolve(interior, kernel, mode='same')
        # Convolution smears the trimmed edges; drop the affected margin.
        if profile.size > 2 * len(kernel):
            profile = profile[len(kernel):-len(kernel)]
        pmin, pmax = float(profile.min()), float(profile.max())
        if (pmax - pmin) < min_contrast:
            continue
        binary = (profile < pmin + (pmax - pmin) * 0.5).astype(np.int8)
        edges = np.where(np.diff(binary) != 0)[0]
        if edges.size < 2:
            continue
        spacings = np.diff(edges).astype(float)
        if spacings.size < 1:
            continue
        median_block = float(np.median(spacings))
        if median_block < min_block_px:
            continue
        # Uniform block widths are the signature of a printed ruler.
        if spacings.size >= 2:
            deviation = float(np.median(np.abs(spacings - median_block)))
            if deviation > uniformity_tolerance * median_block:
                continue
        out.append((idx, median_block, int(edges.size)))
    return out


def _measure_card_rows(
    gray: np.ndarray,
    bbox: Tuple[int, int, int, int],
    long_axis: Optional[str],
    min_support: int = 6,
) -> Optional[Tuple[float, float]]:
    """Return (top_block_px, bottom_block_px), trying both scan orientations.

    The bands must be crossed perpendicular to their length, and the card's
    own aspect ratio does not reliably say which way that is: the compact
    FLMNH card is printed portrait, so its bounding box is taller than wide
    even though its bands run horizontally. Scanning along the bbox's long
    axis therefore ran parallel to the bands and found nothing.

    Rather than guess, both orientations are tried and the one that produces a
    valid pair of rows wins. A wrong orientation cannot produce a false
    positive, because it has to clear the same 2.54 band-ratio check.
    """
    for axis in ('x', 'y'):
        rows = _measure_card_rows_on_axis(gray, bbox, axis, min_support)
        if rows is not None:
            return rows
    return None


def _measure_card_rows_on_axis(
    gray: np.ndarray,
    bbox: Tuple[int, int, int, int],
    long_axis: Optional[str],
    min_support: int = 6,
) -> Optional[Tuple[float, float]]:
    """Return (top_block_px, bottom_block_px) for the card's two band rows.

    Scan lines are grouped by *block width* rather than by vertical adjacency.
    Grouping by adjacency is fragile: a single thick printed row can split into
    two clusters, which then look like two rows with an identical block width
    and silently corrupt the ratio. Block width separates the rows cleanly
    because the two rows differ by a factor of ~2.54 by construction.
    """
    if long_axis is None:
        return None
    lines = _scanline_blocks(gray, bbox, long_axis)
    if len(lines) < 2 * min_support:
        return None

    widths = np.sort(np.array([w for _, w, _ in lines], dtype=float))

    # Greedy clustering with a fixed relative width, then rank by support.
    # Splitting at the single largest gap is fragile: a handful of scan lines
    # that clip a serif or the card edge produce outliers far from either row
    # and steal the split, leaving two clusters that are not the two rows.
    # The real rows are the two with the most supporting scan lines.
    clusters: List[List[float]] = []
    for w in widths:
        if clusters and w <= clusters[-1][0] * 1.35:
            clusters[-1].append(w)
        else:
            clusters.append([w])

    # Discard clusters too narrow to be a printed band before ranking.
    #
    # The caption "Florida Museum of Natural History" produces a dense cluster
    # of ~8 px letter strokes that can out-support a real band row: on one
    # Galeocerdo fragment the clusters were 266 px (69 lines), 8 px (56),
    # 678 px (56), so the top two by support gave a ratio of 33 and the card
    # was rejected even though 678/266 = 2.549 was present.
    #
    # The floor is RELATIVE to the card, not absolute, because a band's pixel
    # width depends entirely on how large the card sits in frame. Letter
    # strokes run about a hundredth of the card's length while the narrower
    # band row runs a twentieth or more, so a fortieth separates them with
    # room to spare at every card size seen so far.
    #
    # Selecting the ratio-matching PAIR instead was tried and reverted: it let
    # graduated-ruler photographs match a spurious 2.54 pair and take the card
    # path, producing implausible sizes on images the ruler path had been
    # reading correctly.
    x0, y0, x1, y1 = bbox
    card_len = float(max(x1 - x0 + 1, y1 - y0 + 1))
    min_band_px = card_len / 40.0

    ranked = sorted(
        (c for c in clusters
         if len(c) >= min_support and float(np.median(c)) >= min_band_px),
        key=len, reverse=True,
    )
    if len(ranked) < 2:
        return None

    a = float(np.median(ranked[0]))
    b = float(np.median(ranked[1]))
    top_px, bottom_px = max(a, b), min(a, b)
    if bottom_px <= 0:
        return None

    ratio = top_px / bottom_px
    if abs(ratio - _EXPECTED_BLOCK_RATIO) > _BLOCK_RATIO_TOLERANCE * _EXPECTED_BLOCK_RATIO:
        return None
    return top_px, bottom_px


def _measure_single_band_row(
    gray: np.ndarray,
    bbox: Tuple[int, int, int, int],
) -> Optional[dict]:
    """Read mm/px from ONE band row, identified by how many bands it holds.

    _measure_card_rows needs both rows so it can check their 2.54 ratio, and
    on some photographs the second row is simply unreadable: on UF 17879AA the
    "1 inch" caption is printed level with the imperial band, so every scan
    line across that band also crosses the lettering and fails the uniformity
    test. The metric row reads cleanly at 411 px, and the card is rejected for
    want of a partner.

    A lone row can still be pinned down, because the band COUNT differs
    between every card row except one: 1 band is the large card's inch, 3 is
    its centimetre row, 2 is the compact card's imperial row and 10 is the
    small card's millimetre row. Only a count of 5 is shared, and that is
    refused. The count comes from the scan line's own edges, so it is measured
    rather than assumed.

    Deliberately NOT used by detect_scale_bar. Without the ratio check this is
    a weaker reading than the two-row path, and it is offered only where a
    reviewer has already pointed at the object and can see the size it
    produces.
    """
    x0, y0, x1, y1 = bbox
    card_len = float(max(x1 - x0 + 1, y1 - y0 + 1))
    min_band_px = card_len / 40.0

    by_count: dict = {}
    for card in KNOWN_CARDS:
        for blocks, mm in ((card.top_blocks, card.top_block_mm),
                           (card.bottom_blocks, card.bottom_block_mm)):
            by_count.setdefault(blocks, set()).add(mm)
    unambiguous = {n: mms.pop() for n, mms in by_count.items() if len(mms) == 1}

    # 'x' first: a wrong axis reads band THICKNESS rather than band length and
    # would be wrong by whatever the card's aspect happens to be.
    for axis in ('x', 'y'):
        lines = _scanline_blocks(gray, bbox, axis)
        if len(lines) < 12:
            continue
        widths = np.sort(np.array([w for _, w, _ in lines], dtype=float))
        clusters: List[List[float]] = []
        for w in widths:
            if clusters and w <= clusters[-1][0] * 1.35:
                clusters[-1].append(w)
            else:
                clusters.append([w])
        ranked = sorted((c for c in clusters
                         if len(c) >= 6 and float(np.median(c)) >= min_band_px),
                        key=len, reverse=True)
        if not ranked:
            continue
        lo, hi = min(ranked[0]), max(ranked[0])
        support = [(i, w, e) for i, w, e in lines if lo <= w <= hi]
        if not support:
            continue

        # Spacings alternate print and paper, and on these cards the gaps are
        # bands too: the "3 cm" row is dark, white, dark, all 1 cm. So the
        # segment count, not the count of dark runs, is what the card names.
        counts = [e - 1 for _, _, e in support]
        blocks = int(np.bincount(counts).argmax())
        if sum(1 for c in counts if c == blocks) < 0.5 * len(counts):
            continue
        mm_per_block = unambiguous.get(blocks)
        if mm_per_block is None:
            continue

        block_px = float(np.median([w for _, w, _ in support]))
        # A band row is wider than it is thick. Scanning parallel to the bands
        # measures the rows themselves - two bands and the caption gap between
        # them read as three equal "blocks" on this very card - and that
        # imposter fails here while a real row passes easily.
        thickness = max(i for i, _, _ in support) - min(i for i, _, _ in support) + 1
        if block_px * blocks < thickness:
            continue

        return {
            'mm_per_pixel': mm_per_block / block_px,
            'blocks': blocks,
            'block_px': block_px,
            'mm_per_block': mm_per_block,
        }
    return None


def _tick_runs_at_depth(strip: np.ndarray, depth: int):
    """Tick start positions along a single scan line at one depth into a ruler.

    `strip` is oriented so axis 0 runs along the ruler and axis 1 is depth from
    its graduated edge. Returns the tick starts, or None when this depth does
    not read as a regular graduation pattern.
    """
    if depth < 0 or depth >= strip.shape[1]:
        return None
    line = np.convolve(strip[:, depth], np.ones(5, np.float32) / 5, mode='same')
    lo, hi = float(line.min()), float(line.max())
    if (hi - lo) < 60.0:
        return None
    binary = (line < lo + (hi - lo) * 0.5).astype(np.int8)
    edges = np.where(np.diff(binary) != 0)[0]
    starts = edges[::2]
    if starts.size < 3:
        return None
    gaps = np.diff(starts).astype(float)
    median = float(np.median(gaps))
    if median < 6.0:
        return None
    # Graduations are evenly spaced; printed numbers and stray marks are not.
    if float(np.median(np.abs(gaps - median))) > 0.15 * median:
        return None
    return starts


def _measure_graduated_ruler(
    gray: np.ndarray,
    bbox: Tuple[int, int, int, int],
) -> Optional[dict]:
    """Read a graduated ruler, returning mm/px plus the evidence for it.

    Ticks are sampled at increasing depth from the ruler's edge. Short ticks
    disappear as depth increases while long ones persist, so depth separates
    the two populations without needing to measure individual tick lengths.
    Returns None unless both populations are found, their ratio matches a
    known scheme, and their two mm/px estimates agree.
    """
    x0, y0, x1, y1 = bbox
    crop = gray[y0:y1 + 1, x0:x1 + 1].astype(np.float32)
    if min(crop.shape) < 20:
        return None

    best: Optional[dict] = None
    # A ruler may lie along either axis, and its ticks may be indexed from
    # either edge, so try all four before giving up.
    for along_y in (True, False):
        oriented = crop if along_y else crop.T
        for flip in (False, True):
            strip = oriented[:, ::-1] if flip else oriented
            found = _ruler_from_strip(strip)
            if found and (best is None or found['agreement'] < best['agreement']):
                best = found
    return best


def _ruler_from_strip(strip: np.ndarray) -> Optional[dict]:
    """Core ruler read for one orientation. See _measure_graduated_ruler."""
    depth_max = strip.shape[1]
    readings = []  # (depth, tick_count, median_gap)
    step = max(1, depth_max // 60)
    for depth in range(0, depth_max, step):
        starts = _tick_runs_at_depth(strip, depth)
        if starts is None:
            continue
        gaps = np.diff(starts).astype(float)
        readings.append((depth, starts.size, float(np.median(gaps))))
    if len(readings) < 4:
        return None

    # Group depths by the spacing they report. Two genuine populations show up
    # as two well-separated, well-supported spacings.
    spacings = sorted(r[2] for r in readings)
    groups: List[List[float]] = []
    for s in spacings:
        if groups and s <= groups[-1][0] * 1.25:
            groups[-1].append(s)
        else:
            groups.append([s])
    ranked = sorted(groups, key=len, reverse=True)
    if len(ranked) < 2:
        return None

    # Anchor on the finest graduation, then find its partner by scheme.
    #
    # Taking the two most-supported clusters fails on rulers that carry text
    # or a logo beside the scale: on CMM-V-1494 the 1 mm graduation (34 px,
    # seen at 54 ticks across many depths) and the 5 mm marks (170 px) are
    # both clearly present, but a noise cluster around 46-52 px out-supported
    # the 170 px population, giving a ratio of 1.38 and no match.
    #
    # The finest graduation is by far the most repeated spacing on any ruler,
    # so it is the safe anchor. The partner is then whichever cluster sits
    # closest to a known 5x or 10x scheme, which is a far tighter constraint
    # than "second most popular".
    minor_px = float(np.median(ranked[0]))
    if minor_px <= 0:
        return None

    major_px = None
    best_error = None
    for group in ranked[1:]:
        candidate = float(np.median(group))
        if candidate <= minor_px:
            continue
        ratio = candidate / minor_px
        for expected, _mm in RULER_SCHEMES:
            error = abs(ratio - expected) / expected
            if error <= _RULER_SCHEME_TOLERANCE and (best_error is None or error < best_error):
                best_error, major_px = error, candidate
    if major_px is None:
        return None

    # Tick counts guard against reading text as graduations.
    minor_ticks = max((r[1] for r in readings if abs(r[2] - minor_px) <= 0.25 * minor_px), default=0)
    major_ticks = max((r[1] for r in readings if abs(r[2] - major_px) <= 0.25 * major_px), default=0)
    if minor_ticks < _RULER_MIN_MINOR_TICKS or major_ticks < _RULER_MIN_MAJOR_TICKS:
        return None

    ratio = major_px / minor_px
    scheme = next(
        (m for r_expected, m in RULER_SCHEMES
         if abs(ratio - r_expected) <= _RULER_SCHEME_TOLERANCE * r_expected),
        None,
    )
    if scheme is None:
        return None

    mm_minor = RULER_MINOR_MM / minor_px
    mm_major = scheme / major_px
    agreement = abs(mm_minor / mm_major - 1.0)
    if agreement > _RULER_AGREEMENT_TOLERANCE:
        return None

    return {
        'mm_per_pixel': (mm_minor + mm_major) / 2.0,
        'mm_per_pixel_minor': mm_minor,
        'mm_per_pixel_major': mm_major,
        'minor_px': minor_px,
        'major_px': major_px,
        'ratio': ratio,
        'major_mm': scheme,
        'agreement': agreement,
        'minor_ticks': minor_ticks,
    }


def _card_search_windows(
    bbox: Tuple[int, int, int, int],
    shapes: Tuple[Tuple[float, float], ...] = (
        (0.85, 0.40),   # wide and short: the usual card next to a tall label
        (0.40, 0.85),   # tall and narrow: the compact card, printed portrait
        (0.50, 0.50),
        (0.34, 0.34),
    ),
    overlap: float = 0.5,
    max_windows: int = 80,
) -> List[Tuple[int, int, int, int]]:
    """Sub-regions of a blob to hunt for a card in.

    A card photographed next to its catalog label often touches it, and
    connected-component labelling then returns the two as ONE blob. Measuring
    that combined region fails: the scan lines mostly cross the label's typed
    text and the card's bands are a small corner of it. Sliding a window over
    the blob finds the card inside the merge.

    Windows overlap so a card straddling a boundary is still covered whole by
    some window, and the count is capped so this stays cheap on large blobs.

    Window SHAPE matters as much as size, which square windows get wrong. A
    card is wide and short, so a square window large enough to span its width
    also reaches far enough down to swallow the label underneath, and the
    label's text then outvotes the card's bands exactly as it did in the whole
    blob. On UF VP28753AC the card is 900x460 inside a 1261x1261 blob: it
    reads cleanly at 0.9% cross-check in a tight 900x460 crop, and not at all
    in the 1071x1071 square that contains it.
    """
    x0, y0, x1, y1 = bbox
    width, height = x1 - x0 + 1, y1 - y0 + 1
    windows: List[Tuple[int, int, int, int]] = []
    for w_fraction, h_fraction in shapes:
        win_w = max(60, int(width * w_fraction))
        win_h = max(60, int(height * h_fraction))
        step_x = max(1, int(win_w * overlap))
        step_y = max(1, int(win_h * overlap))
        for top in range(y0, y1 - win_h + 1 + step_y, step_y):
            for left in range(x0, x1 - win_w + 1 + step_x, step_x):
                windows.append((left, top,
                                min(left + win_w - 1, x1),
                                min(top + win_h - 1, y1)))
                if len(windows) >= max_windows:
                    return windows
    return windows


def _identify_card(
    image_path: str,
    bbox: Tuple[int, int, int, int],
    rows: Optional[Tuple[float, float]],
) -> Optional[CardSpec]:
    """Decide which FLMNH card this is.

    The block ratio is identical on both cards, so it cannot disambiguate
    them; only the printed text or the imperial row's band count can. OCR is
    tried first and geometry is the fallback.
    """
    text = _ocr_card_text(image_path, bbox)
    if text:
        lowered = text.lower().replace(' ', '')
        # Each cue below is unique to one card, checked most-specific first.
        if '3cm' in lowered:
            return FLMNH_LARGE
        if '0.2in' in lowered or '02in' in lowered or '5mm' in lowered:
            return FLMNH_COMPACT
        if '0.5' in lowered or 'inches' in lowered or '10mm' in lowered:
            return FLMNH_SMALL

    if rows is None:
        return None
    # Geometric fallback when OCR is unavailable or unreadable.
    #
    # FLMNH_SMALL and FLMNH_COMPACT share the same band sizes (2.54 mm and
    # 1 mm), so mm/px comes out identical either way and picking between them
    # only affects the reported card name. FLMNH_LARGE is the one that must be
    # told apart, and its bands are an order of magnitude wider relative to
    # the card, so compare band width against the card's own length rather
    # than against an absolute pixel size.
    x0, y0, x1, y1 = bbox
    card_len = float(max(x1 - x0 + 1, y1 - y0 + 1))
    top_px, _ = rows
    if card_len <= 0 or top_px <= 0:
        return None
    approx_blocks = card_len / top_px
    return FLMNH_LARGE if approx_blocks < 3.0 else FLMNH_SMALL


def _window_shows_card_text(image_path: str, bbox: Tuple[int, int, int, int]) -> bool:
    """True when a region's OCR contains a scale card's printed unit text.

    Used to confirm sub-window card matches. The catalog labels in these
    photographs carry locality, formation and collector text but never the
    card's unit markings, so this separates a real card from a patch of
    writing that happens to measure like one. Returns False when OCR is
    unavailable, which keeps an unverifiable guess out of the results.
    """
    text = _ocr_card_text(image_path, bbox)
    if not text:
        return False
    lowered = text.lower().replace(' ', '')
    return any(cue in lowered for cue in
               ('3cm', '1inch', '0.5inch', 'inches', '10mm', '5mm', '0.2in',
                'floridamuseum', 'naturalhistory'))


def _ocr_card_text(image_path: str, bbox: Tuple[int, int, int, int]) -> Optional[str]:
    """OCR the scale-card crop. Returns None when OCR is unavailable."""
    try:
        import pytesseract
    except Exception:
        return None
    try:
        img = Image.open(image_path)
        x0, y0, x1, y1 = bbox
        crop = img.crop((x0, y0, x1 + 1, y1 + 1)).convert('RGB')
        # Upscale small crops so the unit text is legible to tesseract.
        if max(crop.size) < 600:
            factor = max(2, int(round(600.0 / max(1, max(crop.size)))))
            crop = crop.resize((crop.width * factor, crop.height * factor), Image.LANCZOS)
        return pytesseract.image_to_string(crop, config='--oem 1 --psm 6')
    except Exception:
        return None


def _card_confidence(cross_check_error: float, block_ratio: Optional[float]) -> float:
    """Confidence for the card-rows path, driven by how well the two
    independent row estimates agree."""
    score = 1.0 - min(1.0, cross_check_error / 0.10) * 0.45
    if block_ratio:
        ratio_error = abs(block_ratio - _EXPECTED_BLOCK_RATIO) / _EXPECTED_BLOCK_RATIO
        score -= min(0.25, ratio_error)
    return float(max(0.0, min(1.0, score)))


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

    # Decide "is there a dark backdrop" from a LOW PERCENTILE of the border
    # ring, rather than from an average of it.
    #
    # Two earlier statistics were each wrong in one direction, measured over
    # the baseline set:
    #   * median of the four corners rejected any frame with a bright scale
    #     strip along one edge (two corners ~247, two ~7, pooled median ~75),
    #     losing 18 Calvert photographs whose backdrop is plainly dark cloth;
    #   * the mode of the ring swung the other way and rejected 60 frames
    #     where the strip covers enough of the border to win the vote.
    #
    # A low percentile asks the question that actually matters: is a
    # substantial part of the border dark? That tolerates a bright strip on
    # one or even two edges while still rejecting a genuinely light background.
    # Scored against all three groups (60 must-accept, 18 must-accept, 12
    # light-background must-reject) this rule is correct on 90 of 90.
    ring = np.concatenate([
        gray[:margin, :].ravel(),
        gray[-margin:, :].ravel(),
        gray[:, :margin].ravel(),
        gray[:, -margin:].ravel(),
    ])
    background = float(np.percentile(ring, 25))

    if background < 64:
        # Scale the foreground cut to the backdrop actually measured, instead
        # of always using the fixed dark_bg_threshold.
        #
        # Studio cloth is not equally dark in every shot. Where the backdrop
        # sits around 29-33 the fixed cut of 32 falls INSIDE the background
        # distribution, so most of the cloth is marked as foreground and the
        # tooth, card and label all merge into one blob spanning the frame. On
        # the fragment set that produced 38 images with no usable scale-bar
        # blob at all, the single largest failure cause there.
        #
        # The spread is measured over the DARK pixels of the ring only. Taking
        # a high percentile of the whole ring fails on any frame with a bright
        # scale strip along an edge: the strip dominates the upper percentiles
        # and pushes the cut above every object, so nothing is foreground at
        # all. That was measured, not theorised - it broke the reference
        # fixture and all six ruler images before this was narrowed.
        dark = ring[ring < 64]
        if dark.size:
            threshold = max(float(dark_bg_threshold), float(np.percentile(dark, 95)) * 1.3)
        else:
            threshold = float(dark_bg_threshold)
        return (gray > threshold), 'threshold'

    # Light or coloured backdrop: separate by COLOUR distance, not brightness.
    #
    # Some specimens are photographed on red sand rather than dark cloth, and
    # these used to return no mask at all, so nothing was detected in them -
    # no tooth, no scale reference, nothing to review. Inverting the luminance
    # test does not work on them: the crown is lighter than the sand while the
    # root is about the same, so brightness alone cannot separate the tooth.
    #
    # Distance from the sampled background colour does, because the sand is
    # strongly red-saturated and the tooth is not. On USNM PAL 244351 this
    # recovers the tooth (478x525) and the coin beside it (93x83) as separate
    # blobs, which is what makes a manual scale on that photograph useful:
    # without a tooth blob a hand-set mm/px yields no area and no completeness.
    rgb = np.asarray(img.convert('RGB'), dtype=np.float32)
    border = np.concatenate([
        rgb[:margin, :].reshape(-1, 3), rgb[-margin:, :].reshape(-1, 3),
        rgb[:, :margin].reshape(-1, 3), rgb[:, -margin:].reshape(-1, 3),
    ])
    background_rgb = np.median(border, axis=0)
    distance = np.sqrt(((rgb - background_rgb) ** 2).sum(axis=2))

    # Scale the cut to how much the backdrop varies against itself, so a
    # noisy or textured surface does not register as foreground. Use the
    # MEDIAN of that variation, not a high percentile: sand is coarse enough
    # that its p90 spread already reaches into specimen territory, and a
    # threshold built on it swallows the subject.
    border_spread = float(np.median(
        np.sqrt(((border - background_rgb) ** 2).sum(axis=1))))
    colour_threshold = max(40.0, border_spread * 1.6)
    mask = distance > colour_threshold

    # Refuse a mask that cannot be a specimen on a backdrop. If nearly the
    # whole frame reads as foreground then the border was not background at
    # all - screenshots and cropped plates do this - and if almost nothing
    # does there is no subject. Declining keeps the review overlays honest:
    # "nothing detected" is the truth, and better than boxing a UI divider.
    coverage = float(mask.mean())
    if coverage > 0.85 or coverage < 0.0005:
        return None, 'none'

    return mask, 'colour'


# ---------------------------------------------------------------------------
# Blob detection and classification
# ---------------------------------------------------------------------------

def _label_and_describe_blobs(
    mask: np.ndarray,
    min_area_px: int,
    opening_iterations: int = 3,
) -> List[BlobInfo]:
    """
    Connected-component labelling plus per-blob descriptors.

    Applies a morphological opening before labelling so blobs joined by only
    a few pixels (e.g. a scale-bar card sitting against a catalog label in
    a RAW photograph) are split into separate components. The opening uses
    `opening_iterations` of erosion + the same number of dilation; thin
    connections up to roughly `2 * opening_iterations` pixels wide are
    broken. Solid blobs (e.g. the tooth body) are unaffected.
    """
    cleaned = mask
    if opening_iterations > 0:
        opened = ndimage.binary_opening(mask, iterations=opening_iterations)
        # Sanity guard: if opening removed essentially everything, fall back
        # to the unprocessed mask (avoids killing fragile thin blobs).
        if opened.sum() >= 0.5 * mask.sum():
            cleaned = opened

    labeled, n = ndimage.label(cleaned)
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
        major_px, minor_px, theta = _ellipse_axis_lengths_px(xs, ys)
        length_px, width_px = _anatomical_length_width_px(major_px, minor_px, theta)
        blobs.append(BlobInfo(
            blob_id=bid,
            area_px=area,
            bbox=(x0, y0, x1, y1),
            fill_ratio=fill,
            aspect_ratio=ar,
            classification='unknown',
            major_axis_px=major_px,
            minor_axis_px=minor_px,
            length_px=length_px,
            width_px=width_px,
        ))
    blobs.sort(key=lambda b: -b.area_px)
    return blobs


def _ellipse_axis_lengths_px(xs: np.ndarray, ys: np.ndarray) -> Tuple[float, float, float]:
    """
    Major and minor axis lengths in pixels of the equivalent ellipse with
    the same second central moments as the supplied region, plus the angle
    of the major axis.

    Orientation-independent: a tooth tilted 45 degrees gives the same axis
    lengths as one aligned with the image axes, unlike the axis-aligned
    bbox dimensions.

    The angle matters because `major` is whichever axis is LONGER, which
    carries no anatomical meaning on its own. Callers that want the crown
    height need to know which of the two axes points along the crown; see
    `_anatomical_length_width_px`.

    This mirrors scikit-image regionprops' `axis_major_length` /
    `axis_minor_length` so we don't pull in another dependency for this
    one calculation.
    """
    n = xs.size
    if n < 2:
        return 0.0, 0.0
    xf = xs.astype(np.float64)
    yf = ys.astype(np.float64)
    cx = xf.mean()
    cy = yf.mean()
    mxx = ((xf - cx) ** 2).sum() / n
    myy = ((yf - cy) ** 2).sum() / n
    mxy = ((xf - cx) * (yf - cy)).sum() / n
    tr = mxx + myy
    det = mxx * myy - mxy * mxy
    disc = max(0.0, (tr * tr) / 4.0 - det)
    s = float(np.sqrt(disc))
    eig1 = tr / 2.0 + s
    eig2 = tr / 2.0 - s
    major = 4.0 * float(np.sqrt(max(0.0, eig1)))
    minor = 4.0 * float(np.sqrt(max(0.0, eig2)))
    # Angle of the major axis from the +x axis, in radians.
    theta = 0.5 * float(np.arctan2(2.0 * mxy, mxx - myy))
    return major, minor, theta


def _anatomical_length_width_px(major: float, minor: float, theta: float) -> Tuple[float, float]:
    """Split the two principal extents into crown LENGTH and WIDTH.

    A tooth's length is its crown height, apex to base; its width is the
    mesiodistal span across it. The ellipse fit hands back its axes sorted by
    SIZE, so `major` is simply whichever is longer. For a tall tooth that is
    the crown height and the two coincide, but for a broad, short-crowned
    tooth the longer axis is the width - and reporting it as length swapped
    the two on 1,631 of 4,303 measured teeth, a third of the corpus, most of
    them Galeocerdo cuvier where broad-and-short is the normal shape.

    These specimens are photographed upright, so the crown axis is the one
    nearer vertical. Choosing by angle rather than by size keeps the tilt
    tolerance the ellipse was chosen for: a tooth leaning 20 degrees still
    has its crown axis identified correctly, which an axis-aligned bounding
    box would not manage.

    Caveat worth knowing: on a near-circular blob the orientation is poorly
    determined and small changes flip the assignment. That is inherent to the
    shape rather than to this rule - for a tooth as wide as it is tall there
    is no stable answer - but it means length and width are close to
    interchangeable there anyway.
    """
    # sin/cos of the major-axis angle say how vertical that axis is. In image
    # coordinates y runs downward, which does not matter here: only the
    # magnitude of the vertical component is being compared.
    import math
    if abs(math.sin(theta)) >= abs(math.cos(theta)):
        return major, minor      # major axis is the more vertical one
    return minor, major          # major axis lies across the tooth


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
    """Geometric-only fallback: pick the highest-confidence scale-bar blob
    when content-based discrimination (ruler detection) cannot decide."""
    bars = [b for b in blobs if b.classification == 'scale_bar']
    if not bars:
        return None
    def score(b: BlobInfo) -> tuple:
        return (b.aspect_ratio, b.fill_ratio, b.area_px)
    bars.sort(key=score, reverse=True)
    return bars[0]


def _encloses(outer: BlobInfo, inner: BlobInfo) -> bool:
    """True when `outer` strictly contains `inner`'s bounding box."""
    if outer is inner:
        return False
    ox0, oy0, ox1, oy1 = outer.bbox
    ix0, iy0, ix1, iy1 = inner.bbox
    return ox0 <= ix0 and oy0 <= iy0 and ox1 >= ix1 and oy1 >= iy1 and outer.area_px > inner.area_px


def _bar_candidates(blobs: List[BlobInfo]) -> List[BlobInfo]:
    """Blobs that could be the scale card.

    Cards are printed as thick black bands on white. Where a band spans the
    card's full width, the white gaps between bands are cut off from the card
    body and become their OWN connected components: small, perfectly
    rectangular, fill ratio 1.0, which is exactly the profile the classifier
    looks for in a scale bar. On the compact FLMNH card these fragments are
    large enough to survive the minimum-area filter and were being picked in
    preference to the card itself, so the ruler detector then ran over a plain
    white rectangle and found nothing.

    Two rules fix that:
      * a candidate enclosed by a larger blob is replaced by that blob, since
        the container is the card and the fragment is a hole inside it;
      * a candidate that merely looks like a bar is kept only if nothing
        contains it.

    Promotion can surface a blob the classifier had labelled something else
    (the card body often reads as 'tooth' because its band holes drag the fill
    ratio down). That is intentional: candidacy is cheap, and the ruler test
    plus the two-row cross-check downstream reject a wrong promotion.
    """
    flagged = [b for b in blobs if b.classification == 'scale_bar']
    picked: List[BlobInfo] = []
    for b in flagged:
        containers = [o for o in blobs if _encloses(o, b)]
        if containers:
            # Smallest container is the card; larger ones are the whole scene.
            picked.append(min(containers, key=lambda o: o.area_px))
        else:
            picked.append(b)

    # De-duplicate while preserving order, and drop any candidate that another
    # candidate already contains.
    unique: List[BlobInfo] = []
    for b in picked:
        if not any(b is u for u in unique):
            unique.append(b)
    return [b for b in unique if not any(_encloses(o, b) for o in unique)]


def _pick_bar_with_ruler(blobs: List[BlobInfo], gray: np.ndarray, tick_floor=None):
    """
    Pick the bar blob by INTERIOR CONTENT. Among candidate scale-bar blobs,
    run the ruler-tick detector on each and pick the one with the most
    uniformly-spaced ticks. The catalog label can also look like a
    high-fill rectangle but has no banded ruler inside, so this signal
    distinguishes the two reliably.

    Returns a tuple `(bar, ruler)` where `bar` is the picked BlobInfo and
    `ruler` is the corresponding _RulerHit (or None when no candidate had a
    ruler; in that case `bar` is the geometric fallback pick).
    """
    candidates = _bar_candidates(blobs)
    if not candidates:
        return None, None

    scored = []
    for c in candidates:
        x0, y0, x1, y1 = c.bbox
        long_axis = 'x' if (x1 - x0) >= (y1 - y0) else 'y'
        try:
            hit = _locate_ruler_by_ticks(gray, c.bbox, long_axis, min_spacing_px=tick_floor)
        except Exception:
            hit = None
        scored.append((c, hit))

    with_ruler = [(c, h) for c, h in scored if h is not None]
    if with_ruler:
        # Prefer the candidate with the most ticks; ties broken by spacing
        # uniformity, then by area.
        with_ruler.sort(
            key=lambda x: (len(x[1].tick_positions), x[1].spacing_uniformity, x[0].area_px),
            reverse=True,
        )
        return with_ruler[0]

    # No candidate had a detectable ruler; fall back to the geometric pick.
    return _pick_best_bar(blobs), None


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
    strip_positions: Tuple[float, ...] = (0.05, 0.10, 0.15, 0.20, 0.25, 0.40, 0.50, 0.60, 0.75, 0.90),
    strip_fracs: Tuple[float, ...] = (0.18, 0.08),
    min_run_ticks: int = 4,
    spacing_tolerance: float = 0.35,
    smoothing: int = 7,
    min_spacing_px: Optional[int] = None,
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
        long_axis_len = w
        coord_offset = x0
    else:
        short_axis_len = w
        long_axis_len = h
        coord_offset = y0

    # The floor that separates printed ticks from text and texture has to
    # scale with the ruler, not sit at a fixed pixel count. A flat 30 px
    # rejected the millimetre ticks on CMM-V-4944, which land at 27-29 px:
    # real ticks, discarded for missing an arbitrary constant by two pixels.
    #
    # Tying it to the bar keeps the discrimination that constant was there
    # for. On that plate it yields 20, admitting the 27-29 px millimetre run
    # while still rejecting the 15 px run from finer marks and lettering -
    # and letting THAT through would halve the scale, which is far worse
    # than failing to calibrate at all.
    #
    # Capped at the historic 30 so it can only ever RELAX, never tighten.
    # Scaling it freely also raised the floor for bars past 3000 px, which
    # cost three card images that had calibrated perfectly well before
    # ("could not resolve both card rows"). Relaxing for small rulers was the
    # goal; tightening for large ones was collateral damage. With the cap the
    # change is purely additive - it can add a calibration, never remove one.
    if min_spacing_px is None:
        min_spacing_px = min(_HISTORIC_TICK_FLOOR_PX, max(20.0, long_axis_len / 100.0))

    best_hit: Optional[_RulerHit] = None

    for current_strip_frac in strip_fracs:
        strip_thickness = max(8, int(short_axis_len * current_strip_frac))
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


# ---------------------------------------------------------------------------
# Optional OCR confirmation of the scale-bar physical length
# ---------------------------------------------------------------------------

def read_scale_bar_units(image_path: str, bar_bbox: Tuple[int, int, int, int]) -> Optional[dict]:
    """
    OCR the scale-bar crop to find a printed physical length.

    Returns a dict like {'value_mm': 30.0, 'raw_match': '3 cm'} when a
    convincing match is found, or None when OCR is unavailable / no match.
    pytesseract is imported lazily so this module remains importable in
    environments without tesseract installed.
    """
    try:
        import pytesseract
    except Exception:
        return None

    try:
        img = Image.open(image_path)
        x0, y0, x1, y1 = bar_bbox
        crop = img.crop((x0, y0, x1 + 1, y1 + 1)).convert('RGB')
        text = pytesseract.image_to_string(crop, config='--oem 1 --psm 6')
    except Exception:
        return None

    if not text:
        return None

    import re as _re
    matches = _re.findall(r'(\d+(?:\.\d+)?)\s*(cm|mm|inch|inches|in)\b', text, _re.IGNORECASE)
    if not matches:
        return None

    # Pick the largest plausible length (mm). FLMNH bars typically print
    # "3 cm" (= 30 mm) and "1 inch" (= 25.4 mm). The larger figure is the
    # total ruler length we care about, not a per-tick subdivision.
    best_mm = 0.0
    best_raw = None
    for value_str, unit in matches:
        try:
            value = float(value_str)
        except ValueError:
            continue
        unit_lower = unit.lower()
        if unit_lower == 'cm':
            mm = value * 10.0
        elif unit_lower == 'mm':
            mm = value
        elif unit_lower in ('inch', 'inches', 'in'):
            mm = value * 25.4
        else:
            continue
        if mm > best_mm:
            best_mm = mm
            best_raw = f'{value_str} {unit_lower}'

    if best_mm <= 0:
        return None
    return {'value_mm': best_mm, 'raw_match': best_raw}


__all__ = [
    'BlobInfo',
    'CardSpec',
    'FLMNH_LARGE',
    'FLMNH_SMALL',
    'KNOWN_CARDS',
    'ScaleBarResult',
    'detect_scale_bar',
    'px_area_to_mm2',
    'read_scale_bar_units',
]

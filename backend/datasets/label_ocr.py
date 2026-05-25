# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: label_ocr.py
# Copyright (c) 2024

"""
FLMNH catalog-label OCR for Phase 2 RAW images.

Given a RAW photograph that contains a catalog label printed on white card
stock (in addition to the tooth and the scale bar), this module:

  1. Locates the label as a foreground blob using the same detector machinery
     as scale_calibration.py, but classified as 'label' rather than 'tooth'
     or 'scale_bar' (rectangular with high fill, text-heavy interior).
  2. Runs Tesseract OCR (via pytesseract) on the label crop.
  3. Parses the resulting text against the FLMNH catalog template to extract
     museum_specimen_id, species, museum_completeness_category, locality,
     formation, age, collector, and date.

Designed to fail loud rather than guess: parse failures produce None in the
relevant field of SpecimenMetadata and a warning in `notes`.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, asdict, field
from typing import List, Optional, Tuple

import numpy as np
from PIL import Image
from scipy import ndimage


# ---------------------------------------------------------------------------
# Result types
# ---------------------------------------------------------------------------

@dataclass
class SpecimenMetadata:
    """Parsed FLMNH catalog-label fields plus the raw OCR text."""
    museum_specimen_id: Optional[str] = None
    species: Optional[str] = None
    museum_completeness_category: Optional[str] = None
    locality: Optional[str] = None
    formation: Optional[str] = None
    age: Optional[str] = None
    collector: Optional[str] = None
    date: Optional[str] = None
    raw_text: Optional[str] = None
    label_bbox: Optional[Tuple[int, int, int, int]] = None
    confidence: float = 0.0
    notes: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def extract_specimen_metadata(
    image_path: str,
    known_label_bbox: Optional[Tuple[int, int, int, int]] = None,
    excluded_bboxes: Optional[List[Tuple[int, int, int, int]]] = None,
    min_blob_area_px: int = 50_000,
    rect_fill_threshold: float = 0.85,
    aspect_max: float = 4.0,
) -> SpecimenMetadata:
    """
    Run the full OCR pipeline on a RAW photograph.

    If `known_label_bbox` is provided (e.g. from a previous run), it's used
    directly. Otherwise the label blob is auto-detected. `excluded_bboxes`
    can be used to skip already-identified blobs such as the tooth and the
    scale-bar card so they aren't mis-classified as the label.

    Returns a SpecimenMetadata with as many fields populated as the OCR text
    allowed. Always returns a result, even on partial failure; check
    `result.notes` for what went wrong.
    """
    excluded_bboxes = list(excluded_bboxes or [])
    img = Image.open(image_path)

    if known_label_bbox is not None:
        label_bbox = known_label_bbox
    else:
        label_bbox = detect_specimen_label(
            img,
            excluded_bboxes=excluded_bboxes,
            min_blob_area_px=min_blob_area_px,
            rect_fill_threshold=rect_fill_threshold,
            aspect_max=aspect_max,
        )

    if label_bbox is None:
        return SpecimenMetadata(notes=['no label blob detected'])

    text = extract_label_text(img, label_bbox)
    if not text or not text.strip():
        return SpecimenMetadata(
            label_bbox=label_bbox,
            notes=['OCR returned no text'],
        )

    parsed = parse_specimen_metadata(text)
    parsed.label_bbox = label_bbox
    parsed.raw_text = text
    parsed.confidence = _confidence(parsed)
    return parsed


def detect_specimen_label(
    img: Image.Image,
    excluded_bboxes: Optional[List[Tuple[int, int, int, int]]] = None,
    min_blob_area_px: int = 50_000,
    rect_fill_threshold: float = 0.85,
    aspect_max: float = 4.0,
) -> Optional[Tuple[int, int, int, int]]:
    """
    Find the catalog-label rectangle in a RAW image.

    The label is the rectangular foreground blob with high fill ratio and a
    moderate aspect ratio, distinguished from the tooth (low fill, irregular)
    and the scale bar (also rectangular but typically narrower / wider strip).
    When `excluded_bboxes` is supplied, blobs overlapping any of those are
    skipped, which makes this stable when the tooth and scale-bar bboxes are
    already known from scale_calibration.
    """
    excluded_bboxes = list(excluded_bboxes or [])
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
        mask = gray > 32
    else:
        mask = gray < 224

    labeled, n = ndimage.label(mask)
    if n == 0:
        return None
    sizes = ndimage.sum(mask, labeled, range(1, n + 1))

    best_bbox = None
    best_score = -1.0
    for i in range(n):
        area = int(sizes[i])
        if area < min_blob_area_px:
            continue
        ys, xs = np.where(labeled == (i + 1))
        x0, x1 = int(xs.min()), int(xs.max())
        y0, y1 = int(ys.min()), int(ys.max())
        bbox = (x0, y0, x1, y1)
        # Reject only blobs whose bbox substantially overlaps an excluded
        # bbox (IoU > 0.5). Two near-adjacent connected components, like the
        # tooth and the catalog label, can have a tiny shared bbox corner
        # without being the same blob; an overlap-on-any-pixel test would
        # incorrectly reject the label in that case.
        if any(_bbox_iou(bbox, ex) > 0.5 for ex in excluded_bboxes):
            continue
        bw = x1 - x0 + 1
        bh = y1 - y0 + 1
        fill = area / float(bw * bh)
        ar = max(bw, bh) / float(min(bw, bh))
        # Want: rectangular (high fill), moderate aspect ratio (label is
        # typically 1.2-2.5; scale-bar strip is usually thinner or wider).
        if fill < rect_fill_threshold:
            continue
        if ar > aspect_max:
            continue
        # Score favours a larger, more rectangular, more square blob.
        score = fill - 0.1 * abs(ar - 1.5) + 0.0000001 * area
        if score > best_score:
            best_score = score
            best_bbox = bbox

    return best_bbox


def extract_label_text(img: Image.Image, bbox: Tuple[int, int, int, int]) -> str:
    """Run Tesseract on the label crop and return the raw text."""
    import pytesseract
    x0, y0, x1, y1 = bbox
    crop = img.crop((x0, y0, x1 + 1, y1 + 1)).convert('RGB')
    # `--oem 1` (LSTM) and `--psm 6` (block of text) give us the best results
    # on FLMNH cards in our test set; they keep multi-line structure intact.
    config = '--oem 1 --psm 6'
    return pytesseract.image_to_string(crop, config=config)


# ---------------------------------------------------------------------------
# Field parsers
# ---------------------------------------------------------------------------

# Line-anchored patterns. The FLMNH catalog label puts each field on its own
# line, so matching per-line avoids accidental cross-line capture caused by
# the fact that \s matches newlines.
_RE_SPECIMEN_ID = re.compile(r'\bVP\s+(\d{4,7})\b', re.IGNORECASE)
_RE_COMPLETENESS = re.compile(
    r'^.*tooth[^.\n]*(?:partial|fragment|enamel|crown|root).*$',
    re.IGNORECASE,
)
_RE_DATE = re.compile(r'\b(\d{1,2}\s+[A-Z]{3,4}\s+\d{4})\b')
_RE_FORMATION_MARK = re.compile(r'\b(?:Fm\.|Formation\b)', re.IGNORECASE)
_RE_AGE_KEYWORDS = re.compile(
    r'\b(Pleistocene|Holocene|Pliocene|Miocene|Oligocene|Eocene|Paleocene|'
    r'Hemphillian|Blancan|Irvingtonian|Rancholabrean|Clarendonian|Barstovian|'
    r'Hemingfordian|Arikareean|Whitneyan|Orellan|Chadronian|Duchesnean|'
    r'Hh\d|Bl\d|Ir\d|H[ms]\d)\b'
)
# Locality: the line containing "Co." (county). The trailing \b would fail
# because "." is followed by "," in real labels; both are non-word chars
# and there's no boundary between them.
_RE_LOCALITY_LINE = re.compile(r'\bCo\.', re.IGNORECASE)


def parse_specimen_metadata(text: str) -> SpecimenMetadata:
    """Line-anchored parse of the FLMNH-style catalog label text."""
    result = SpecimenMetadata()
    if not text:
        return result

    normalized = _normalise_text(text)
    lines = normalized.splitlines()

    # Specimen id. We anchor on "VP <digits>" because Tesseract sometimes
    # misreads the leading "UF" as e.g. "UWF". Once we have the digits, we
    # normalise the whole id to "UF/VP <digits>" since these labels are
    # always FLMNH cards.
    for line in lines:
        m = _RE_SPECIMEN_ID.search(line)
        if m:
            digits = m.group(1)
            result.museum_specimen_id = f'UF/VP {digits}'
            break
    if result.museum_specimen_id is None:
        result.notes.append('specimen_id pattern not matched')

    # Completeness: the first line that mentions "tooth" plus a part keyword.
    for line in lines:
        m = _RE_COMPLETENESS.match(line)
        if m:
            result.museum_completeness_category = m.group(0).strip().rstrip('.;')
            break
    if result.museum_completeness_category is None:
        result.notes.append('completeness_category not matched')

    # Locality: pick the first line containing "Co." (county) which is the
    # consistent FLMNH locality marker.
    for line in lines:
        if _RE_LOCALITY_LINE.search(line):
            result.locality = line.strip().rstrip('.,')
            break
    if result.locality is None:
        result.notes.append('locality not matched')

    # Formation: per-line search for "Fm." or "Formation" anywhere on the line.
    for line in lines:
        if _RE_FORMATION_MARK.search(line):
            result.formation = line.strip().rstrip('.,;')
            break
    if result.formation is None:
        result.notes.append('formation not matched')

    age_match = _RE_AGE_KEYWORDS.findall(normalized)
    if age_match:
        seen = set()
        kept = []
        for token in age_match:
            if token not in seen:
                seen.add(token)
                kept.append(token)
        result.age = ', '.join(kept)
    else:
        result.notes.append('age keyword not matched')

    m = _RE_DATE.search(normalized)
    if m:
        date_str = m.group(1).strip()
        result.date = date_str
        # The collector is usually on the same line as the date or on the
        # line immediately above. Try both.
        for i, line in enumerate(lines):
            if date_str in line:
                preceding = line.split(date_str)[0].rstrip(' ,;\t')
                if preceding:
                    result.collector = preceding
                elif i > 0:
                    candidate = lines[i - 1].strip()
                    # Skip obvious non-person lines.
                    if candidate and 'Fm.' not in candidate and not _RE_AGE_KEYWORDS.search(candidate):
                        result.collector = candidate
                break
    else:
        result.notes.append('date not matched')

    result.species = _guess_species(normalized)
    if result.species is None:
        result.notes.append('species not matched')

    return result


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _normalise_text(text: str) -> str:
    """Tighten whitespace, collapse repeated spaces but preserve line breaks."""
    lines = []
    for raw_line in text.splitlines():
        line = re.sub(r'[ \t]+', ' ', raw_line).strip()
        if line:
            lines.append(line)
    return '\n'.join(lines)


def _clean_specimen_id(s: str) -> str:
    """Normalise specimen ids like 'UF / VP 574594' -> 'UF/VP 574594'."""
    s = re.sub(r'\s*/\s*', '/', s)
    s = re.sub(r'\s+', ' ', s)
    return s.upper().strip()


def _bbox_iou(a: Tuple[int, int, int, int], b: Tuple[int, int, int, int]) -> float:
    """Standard intersection-over-union for two axis-aligned bboxes."""
    ax0, ay0, ax1, ay1 = a
    bx0, by0, bx1, by1 = b
    ix0 = max(ax0, bx0)
    iy0 = max(ay0, by0)
    ix1 = min(ax1, bx1)
    iy1 = min(ay1, by1)
    if ix1 < ix0 or iy1 < iy0:
        return 0.0
    inter = (ix1 - ix0 + 1) * (iy1 - iy0 + 1)
    area_a = (ax1 - ax0 + 1) * (ay1 - ay0 + 1)
    area_b = (bx1 - bx0 + 1) * (by1 - by0 + 1)
    union = area_a + area_b - inter
    return float(inter) / float(union) if union > 0 else 0.0


# Lightweight species list. Used as a backstop when the species line lacks a
# clean italic-style cue. Names match the labels already in the database.
_KNOWN_SPECIES = [
    'Otodus megalodon',
    'Carcharodon carcharias',
    'Carcharhinus leucas',
    'Galeocerdo cuvier',
    'Hemipristis serra',
    'Isurus hastalis',
]


def _guess_species(text: str) -> Optional[str]:
    """Best-effort species match against the known label set, case-insensitive."""
    lowered = text.lower()
    for species in _KNOWN_SPECIES:
        if species.lower() in lowered:
            return species
    return None


def _confidence(meta: SpecimenMetadata) -> float:
    """Rough confidence: fraction of fields populated."""
    fields = [
        meta.museum_specimen_id,
        meta.species,
        meta.museum_completeness_category,
        meta.locality,
        meta.formation,
        meta.age,
        meta.date,
    ]
    populated = sum(1 for f in fields if f)
    return populated / float(len(fields))


__all__ = [
    'SpecimenMetadata',
    'extract_specimen_metadata',
    'detect_specimen_label',
    'extract_label_text',
    'parse_specimen_metadata',
]

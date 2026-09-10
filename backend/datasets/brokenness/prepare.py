"""
Input preparation for Katie's shape score.

This is OUR integration code, not part of her method: nothing in align.py,
estimate.py or mean_masks.py changes.

Her fragment inputs were square pictures with the fragment centred on a
transparent background (April New Fragments, 384 x 384). Her normalize()
resizes whatever it is given to a 256 x 256 square, which is harmless for a
square picture and distorting for anything else. Our pipeline was handing her
code the tooth mask cropped tight to the tooth, so a wide fragment arrived as
a wide rectangle and was stretched tall before being compared: UF-TRO9196B,
815 x 445 px, came out 1.8x taller than it really is and scored 99.7%.

square_canvas() gives her code the format it expects: the same pixels, centred
on a square transparent canvas, proportions untouched. Nothing is cropped and
no border is added, so the fragment's longer side touches the edges the way
her complete-tooth templates do. How much border her own fragments had is an
open question for her, and it matters: on the 30-fragment test a border of
about a quarter moved scores by around 30 points.
"""
import numpy as np


def square_canvas(mask, rgba=None):
    """Centre `mask` (and `rgba`, if given) on a square canvas of empty pixels.

    An input that is already square is returned unchanged, so pictures that
    were in Katie's own format are scored exactly as before.
    """
    h, w = mask.shape[:2]
    if h == w:
        return mask, rgba
    side = max(h, w)
    top, left = (side - h) // 2, (side - w) // 2
    out = np.zeros((side, side), dtype=mask.dtype)
    out[top:top + h, left:left + w] = mask
    if rgba is None:
        return out, None
    out_rgba = np.zeros((side, side) + rgba.shape[2:], dtype=rgba.dtype)
    out_rgba[top:top + h, left:left + w] = rgba
    return out, out_rgba

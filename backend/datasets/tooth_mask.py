"""The green tooth outline the review inspector draws over a photograph.

Kept here rather than inside tasks.py because three callers need it and they
were drifting apart: the original calibration task wrote a mask, while
phase2_recalibrate - the command that actually built Datasets 168 and 169 -
never did, so 4,326 images lost the overlay while four test images kept it.
"""

import logging
import os

from django.conf import settings

logger = logging.getLogger(__name__)

# Tailwind green-500 at ~70% alpha, matching the inspector's tooth colour.
MASK_RGBA = (34, 197, 94, 180)


def _mask_path_for(image) -> str:
    return os.path.join(os.path.dirname(image.image.path),
                        '_phase2_masks', '%d_tooth_mask.png' % image.id)


def _media_url_for(path: str) -> str:
    rel = os.path.relpath(path, settings.MEDIA_ROOT)
    return settings.MEDIA_URL.rstrip('/') + '/' + rel.replace(os.sep, '/')


def render_tooth_mask(image_path, tooth_bbox, output_path) -> bool:
    """Write a green-tinted PNG of the tooth's exact shape, cropped to bbox."""
    try:
        import numpy as np
        from PIL import Image as PILImage
        from scipy import ndimage as ndi

        from .scale_calibration import _foreground_mask

        fg, _src = _foreground_mask(PILImage.open(image_path))
        if fg is None:
            return False
        opened = ndi.binary_opening(fg, iterations=3)
        if opened.sum() < 0.5 * fg.sum():
            opened = fg
        labeled, count = ndi.label(opened)
        if count == 0:
            return False

        x0, y0, x1, y1 = (int(v) for v in tooth_bbox)
        window = labeled[y0:y1 + 1, x0:x1 + 1]
        if window.size == 0:
            return False

        # Take the component with the most pixels inside the box, rather than
        # whatever sits under its centre. A fragment is rarely convex and its
        # centre often lands on background, which returned no mask at all.
        counts = np.bincount(window.ravel())
        counts[0] = 0
        if not counts.any():
            return False
        tooth_pixels = labeled == int(counts.argmax())

        cropped = tooth_pixels[y0:y1 + 1, x0:x1 + 1]
        height, width = cropped.shape
        if height < 4 or width < 4:
            return False

        rgba = np.zeros((height, width, 4), dtype=np.uint8)
        rgba[cropped] = MASK_RGBA
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        PILImage.fromarray(rgba, 'RGBA').save(output_path, 'PNG', optimize=True)
        return True
    except Exception as exc:
        logger.warning('tooth mask failed for %s: %s', image_path, exc)
        return False


def refresh_tooth_mask(image, tooth_bbox=None, save=False):
    """Regenerate the overlay for one image and set tooth_mask_url.

    Call this wherever the tooth outline changes. Returns the URL, or None
    when no mask could be drawn - a stale mask is worse than none, because it
    shows the reviewer an outline that is no longer the measured one.
    """
    bbox = tooth_bbox if tooth_bbox is not None else image.tooth_bbox
    if not bbox:
        image.tooth_mask_url = None
    else:
        path = _mask_path_for(image)
        image.tooth_mask_url = _media_url_for(path) if render_tooth_mask(
            image.image.path, bbox, path) else None
    if save:
        image.save(update_fields=['tooth_mask_url'])
    return image.tooth_mask_url

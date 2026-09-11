"""The green tooth outline the review inspector draws over a photograph.

Kept here rather than inside tasks.py because three callers need it and they
were drifting apart: the original calibration task wrote a mask, while
phase2_recalibrate - the command that actually built Datasets 168 and 169 -
never did, so 4,326 images lost the overlay while four test images kept it.

It also writes the tooth-only thumbnail the dataset grid shows: the same
outline cut out of the photograph onto white, at web size. Generated here so
it can never show a different tooth from the one measured.
"""

import logging
import os

from django.conf import settings

logger = logging.getLogger(__name__)

# Tailwind green-500 at ~70% alpha, matching the inspector's tooth colour.
MASK_RGBA = (34, 197, 94, 180)

# Grid thumbnail: square, white, the tooth centred with a little air around
# it. 384 px covers the 96 px tiles at retina density with room to spare, and
# lands around 15-30 KB against the several megabytes of the raw photograph
# the grid used to download for every tile.
THUMB_SIZE = 384
THUMB_MARGIN = 0.08
THUMB_SUFFIX = '_tooth_thumb.jpg'
MASK_SUFFIX = '_tooth_mask.png'


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


def thumbnail_path_for_mask(mask_path: str) -> str:
    """The thumbnail lives beside its mask, so a row that shares another
    row's mask (a study copy) shares its thumbnail too."""
    return mask_path[:-len(MASK_SUFFIX)] + THUMB_SUFFIX if mask_path.endswith(MASK_SUFFIX) else None


def render_tooth_thumbnail(image_path, tooth_bbox, mask_path, output_path) -> bool:
    """Cut the measured tooth out of the photograph onto white, at web size.

    Uses the saved mask rather than segmenting again, so the thumbnail shows
    exactly the pixels that were measured. Holes inside the outline are
    filled for display only: a tooth has none, and on dark roots the
    segmentation leaves speckles (see docs/known-issues) that would otherwise
    show as white flecks.
    """
    try:
        import numpy as np
        from PIL import Image as PILImage, ImageFilter
        from scipy import ndimage as ndi

        x0, y0, x1, y1 = (int(v) for v in tooth_bbox)
        with PILImage.open(mask_path) as mask_img:
            mask = np.array(mask_img.convert('RGBA'))[:, :, 3] > 0
        if mask.size == 0 or not mask.any():
            return False
        mask = ndi.binary_fill_holes(mask)
        # The outline's last pixel or two are part-cloth; on white they read
        # as a dark rim. Trim them, unless that would swallow a sliver.
        trimmed = ndi.binary_erosion(mask, iterations=2)
        if trimmed.sum() > 0.5 * mask.sum():
            mask = trimmed

        with PILImage.open(image_path) as photo:
            full_w, full_h = photo.size
            longer = max(x1 - x0 + 1, y1 - y0 + 1)
            # Let libjpeg decode at 1/2, 1/4 or 1/8 when the tooth is large:
            # far quicker than a full 16-megapixel decode, and still more
            # pixels than the thumbnail needs.
            want = THUMB_SIZE * 1.5
            if longer > want:
                factor = longer / want
                photo.draft('RGB', (int(full_w / factor), int(full_h / factor)))
            photo = photo.convert('RGB')
            sx, sy = photo.size[0] / float(full_w), photo.size[1] / float(full_h)
            box = (int(round(x0 * sx)), int(round(y0 * sy)),
                   int(round((x1 + 1) * sx)), int(round((y1 + 1) * sy)))
            crop = photo.crop(box)

        alpha = PILImage.fromarray((mask * 255).astype('uint8'), 'L').resize(crop.size, PILImage.BILINEAR)
        alpha = alpha.filter(ImageFilter.GaussianBlur(0.6))
        cut = PILImage.new('RGB', crop.size, (255, 255, 255))
        cut.paste(crop, (0, 0), alpha)

        side = int(round(max(crop.size) * (1 + 2 * THUMB_MARGIN)))
        canvas = PILImage.new('RGB', (side, side), (255, 255, 255))
        canvas.paste(cut, ((side - crop.size[0]) // 2, (side - crop.size[1]) // 2))
        canvas = canvas.resize((THUMB_SIZE, THUMB_SIZE), PILImage.LANCZOS)

        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        canvas.save(output_path, 'JPEG', quality=85, optimize=True, progressive=True)
        return True
    except Exception as exc:
        logger.warning('tooth thumbnail failed for %s: %s', image_path, exc)
        return False


def tooth_thumbnail_url(image):
    """URL of the grid thumbnail with an mtime cache-buster, or None.

    The cache-buster matters: Cloudflare holds media for hours, and a
    thumbnail regenerated after a hand edit must not keep showing the old
    tooth.
    """
    if not image.tooth_mask_url:
        return None
    mask_rel = image.tooth_mask_url.replace(settings.MEDIA_URL.rstrip('/') + '/', '', 1)
    thumb = thumbnail_path_for_mask(os.path.join(settings.MEDIA_ROOT, mask_rel))
    if not thumb or not os.path.exists(thumb):
        return None
    return '%s?v=%d' % (_media_url_for(thumb), int(os.path.getmtime(thumb)))


def refresh_tooth_mask(image, tooth_bbox=None, save=False):
    """Regenerate the overlay for one image and set tooth_mask_url.

    Call this wherever the tooth outline changes. Returns the URL, or None
    when no mask could be drawn - a stale mask is worse than none, because it
    shows the reviewer an outline that is no longer the measured one.
    """
    bbox = tooth_bbox if tooth_bbox is not None else image.tooth_bbox
    path = _mask_path_for(image)
    thumb = thumbnail_path_for_mask(path)
    if bbox and render_tooth_mask(image.image.path, bbox, path):
        image.tooth_mask_url = _media_url_for(path)
        render_tooth_thumbnail(image.image.path, bbox, path, thumb)
    else:
        image.tooth_mask_url = None
        # Same rule as the mask: no thumbnail rather than an out-of-date one.
        if thumb and os.path.exists(thumb):
            os.remove(thumb)
    if save:
        image.save(update_fields=['tooth_mask_url'])
    return image.tooth_mask_url

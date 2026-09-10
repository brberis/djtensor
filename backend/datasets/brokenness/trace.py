"""
Step-by-step replay of Katie's shape-brokenness score, for the review
inspector's animation.

Nothing here decides a number. Every pose and every pixel count comes from
the same operations _run() performs, in the same order, and the result is
checked against estimate_brokenness_from_arrays() before it is returned. If
the replay and Katie's function ever disagree, trace_shape_brokenness raises
rather than hand the inspector an animation that tells a different story from
the score.

What the replay adds is the intermediate state _run() throws away: the
fragment before and after the 256 resize, the centroid shift, and the best
shift found at each of the 20 flip/rotation combinations the search tries.
"""
import base64
import io

import cv2
import numpy as np
from PIL import Image

from .align import keep_largest_island, normalize, sample_contour
from .estimate import estimate_brokenness_from_arrays, get_aspect_ratio, get_quantile_index

TRACE_VERSION = 1

# Geometry of _run(): a 256 working square padded by 128 on every side.
SIZE = 256
PAD = 128
CANVAS = SIZE + 2 * PAD

# The search grid exactly as _run() passes it to try_rotations_and_shifts.
ROTATE_MAX, ANGLE_STEP = 10, 2
SHIFT_MAX, SHIFT_STEP = 15, 3

# Same colours as the static trace figures, so the two read alike.
REGION_RGBA = {
    'covered': (42, 120, 214, 255),
    'missing': (235, 104, 52, 255),
    'overhang': (144, 133, 233, 255),
}


class TraceMismatch(RuntimeError):
    """The replay did not reproduce Katie's result."""


def _outline(mask, epsilon=0.6):
    """Largest external contour as [[x, y], ...], lightly simplified for SVG."""
    contours, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours:
        return []
    contour = max(contours, key=cv2.contourArea)
    contour = cv2.approxPolyDP(contour, epsilon, True).reshape(-1, 2)
    return contour.astype(float).round(2).tolist()


def _warp(mask, matrix):
    return cv2.warpAffine(
        mask.astype(np.uint8), matrix, (CANVAS, CANVAS),
        flags=cv2.INTER_NEAREST, borderMode=cv2.BORDER_CONSTANT, borderValue=0,
    )


def _regions_png(fragment, template):
    """Coverage colouring of the final 256 window, as a PNG data URL."""
    rgba = np.zeros((SIZE, SIZE, 4), dtype=np.uint8)
    rgba[(fragment == 1) & (template == 1)] = REGION_RGBA['covered']
    rgba[(template == 1) & (fragment == 0)] = REGION_RGBA['missing']
    rgba[(fragment == 1) & (template == 0)] = REGION_RGBA['overhang']
    buf = io.BytesIO()
    Image.fromarray(rgba, 'RGBA').save(buf, format='PNG', optimize=True)
    return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode('ascii')


def _search(tooth_padded, mean_padded, m_base):
    """Replay of try_rotations_and_shifts, keeping the best of every block.

    Same iteration order (normal before flipped, angles ascending, then dx and
    dy ascending), same score expression and the same strict '>' update, so
    the global winner is the one Katie's function picks, ties included.
    """
    center = (CANVAS // 2, CANVAS // 2)
    base = _warp(tooth_padded, m_base)
    angles = range(-ROTATE_MAX, ROTATE_MAX, ANGLE_STEP)
    shifts = range(-SHIFT_MAX, SHIFT_MAX, SHIFT_STEP)

    candidates = []
    best_score, best = -1, None
    evaluated = 0
    for flip_label, base_candidate in (('normal', base), ('flipped', cv2.flip(base, 1))):
        for angle in angles:
            rotated = _warp(base_candidate, cv2.getRotationMatrix2D(center, angle, 1.0))
            if np.sum(rotated) == 0:
                continue
            block = None
            for dx in shifts:
                for dy in shifts:
                    shifted = _warp(rotated, np.float32([[1, 0, dx], [0, 1, dy]]))
                    if np.sum(shifted) == 0:
                        continue
                    evaluated += 1
                    overlap = np.sum((mean_padded == 1) & (shifted == 1))
                    tooth_pixels = np.sum(shifted == 1)
                    score = overlap / (np.sum(mean_padded) + tooth_pixels - overlap + 1e-6)
                    if block is None or score > block['iou']:
                        block = {'flipped': flip_label == 'flipped', 'angle': int(angle),
                                 'dx': int(dx), 'dy': int(dy), 'iou': float(score)}
                    if score > best_score:
                        best_score = score
                        best = dict(block, mask=shifted)
            if block is not None:
                candidates.append(block)
    return candidates, best, evaluated


def _pose_matrix(m_base, flipped, angle, dx, dy):
    """The composite 2x3 affine the search applies to the padded fragment."""
    def h(m):
        return np.vstack([np.asarray(m, dtype=np.float64), [0, 0, 1]])
    flip = [[-1, 0, CANVAS - 1], [0, 1, 0]] if flipped else [[1, 0, 0], [0, 1, 0]]
    rot = cv2.getRotationMatrix2D((CANVAS // 2, CANVAS // 2), angle, 1.0)
    shift = [[1, 0, dx], [0, 1, dy]]
    return (h(shift) @ h(rot) @ h(flip) @ h(m_base))[:2]


def trace_shape_brokenness(tooth_mask, templates, quantile_edges, context=None):
    """Replay the shape score for one fragment and return everything to animate it.

    tooth_mask      2D uint8, the fragment exactly as the pipeline feeds it
    templates       {1: binary, 2: ..., 3: ..., 4: ...}, each thresholded >127
                    the way the pipeline thresholds the mean masks
    quantile_edges  that species' aspect cutoffs from quantile_edges.json
    context         optional facts for captions (mm per pixel, true area
                    ratio, Alexa's estimate); they never touch the score
    """
    context = context or {}
    edges = [float(e) for e in quantile_edges]

    # Template choice: one template, from the fragment's own proportions.
    aspect = float(get_aspect_ratio(tooth_mask))
    q = int(get_quantile_index(aspect, edges))
    template_full = templates[q]

    # The resize. Katie's code squares both images to 256, whatever shape
    # they started as, so this is where proportions and size both change.
    native_h, native_w = tooth_mask.shape
    fragment_256 = normalize(keep_largest_island(tooth_mask), target_size=SIZE, interpolation=cv2.INTER_NEAREST)
    template_256 = normalize(template_full.astype(np.uint8), target_size=SIZE, interpolation=cv2.INTER_NEAREST)

    tooth_padded = np.pad(fragment_256, PAD, mode='constant', constant_values=0)
    mean_padded = np.pad(template_256, PAD, mode='constant', constant_values=0)

    # The centroid step, computed as align_to_mean_procrustes computes it.
    # (Its start-point matching reorders the points but cannot move their
    # mean, so it has no effect on the translation and is not animated.)
    tooth_pts = sample_contour(tooth_padded, 100)
    mean_pts = sample_contour(mean_padded, 100)
    if tooth_pts is None or mean_pts is None:
        raise TraceMismatch('no outline could be traced for this fragment or template')
    tooth_c, mean_c = tooth_pts.mean(axis=0), mean_pts.mean(axis=0)
    dx0, dy0 = float(mean_c[0] - tooth_c[0]), float(mean_c[1] - tooth_c[1])
    m_base = np.float32([[1, 0, dx0], [0, 1, dy0]])

    candidates, best, evaluated = _search(tooth_padded, mean_padded, m_base)

    final_fragment = best['mask'][PAD:PAD + SIZE, PAD:PAD + SIZE]
    final_template = mean_padded[PAD:PAD + SIZE, PAD:PAD + SIZE]
    template_px = int(np.sum(final_template))
    missing_px = int(np.sum((final_template == 1) & (final_fragment == 0)))
    covered_px = int(np.sum((final_template == 1) & (final_fragment == 1)))
    overhang_px = int(np.sum((final_template == 0) & (final_fragment == 1)))
    percent_broken = (missing_px / template_px) * 100 if template_px > 0 else 0.0

    # The check that makes this safe to show: Katie's own function, run on
    # the same inputs, must land on the same pose and the same number.
    katie_pct, _overlay, katie_info = estimate_brokenness_from_arrays(tooth_mask, None, template_full)
    same_pose = (
        katie_info.get('best_angle') == best['angle']
        and tuple(katie_info.get('best_shift', ())) == (best['dx'], best['dy'])
        and bool(katie_info.get('best_flipped')) == best['flipped']
    )
    if not same_pose or abs(katie_pct - percent_broken) > 1e-9 or katie_info.get('missing_pixels') != missing_px:
        raise TraceMismatch(
            'replay disagrees with estimate_brokenness_from_arrays: replay %.4f%% at %s, Katie %.4f%% at %s'
            % (percent_broken, (best['flipped'], best['angle'], best['dx'], best['dy']),
               katie_pct, katie_info))

    # Outlines. The fragment outline is taken once, in the 256 frame; every
    # later pose is that outline moved by the matrices above.
    fragment_outline = _outline(fragment_256)
    final_matrix = _pose_matrix(m_base, best['flipped'], best['angle'], best['dx'], best['dy'])

    fit = SIZE / float(max(native_w, native_h))
    scale_x, scale_y = SIZE / float(native_w), SIZE / float(native_h)

    # True size, for comparison only: how large the fragment would be drawn if
    # the template stood for the species' median complete tooth. It is the
    # quantity the resize discards, shown so the discarding can be seen.
    true_scale = None
    ratio = context.get('area_ratio')
    if ratio:
        fit_px = float(np.sum(keep_largest_island(tooth_mask))) * fit * fit
        if fit_px > 0:
            true_scale = float(np.sqrt(ratio * template_px / fit_px))

    mm = context.get('mm_per_pixel')
    return {
        'version': TRACE_VERSION,
        'canvas': {'size': SIZE, 'pad': PAD, 'canvas': CANVAS},
        'selection': {
            'aspect': round(aspect, 4),
            'quartile': q,
            'edges': [round(e, 4) for e in edges],
            'templates': [
                {'quartile': k,
                 'range': [round(edges[k - 1], 3), round(edges[k], 3)],
                 'outline': _outline(normalize(templates[k].astype(np.uint8), target_size=SIZE, interpolation=cv2.INTER_NEAREST))}
                for k in sorted(templates)
            ],
        },
        'fragment': {
            'native_w': int(native_w), 'native_h': int(native_h),
            'native_mm': [round(native_w * mm, 1), round(native_h * mm, 1)] if mm else None,
            'pixels': int(np.sum(keep_largest_island(tooth_mask))),
            'outline_256': fragment_outline,
            'fit_scale': [round(native_w * fit / SIZE, 5), round(native_h * fit / SIZE, 5)],
            'true_scale': round(true_scale, 5) if true_scale else None,
        },
        'resize': {
            'scale_x': round(scale_x, 6), 'scale_y': round(scale_y, 6),
            'fragment_px': int(np.sum(fragment_256)), 'template_px': int(np.sum(template_256)),
        },
        'template': {'outline_256': _outline(template_256)},
        'centroid': {
            'fragment': [round(float(tooth_c[0]), 2), round(float(tooth_c[1]), 2)],
            'template': [round(float(mean_c[0]), 2), round(float(mean_c[1]), 2)],
            'shift': [round(dx0, 4), round(dy0, 4)],
        },
        'search': {
            'angles': list(range(-ROTATE_MAX, ROTATE_MAX, ANGLE_STEP)),
            'shifts': list(range(-SHIFT_MAX, SHIFT_MAX, SHIFT_STEP)),
            'evaluated': int(evaluated),
            'center': [CANVAS // 2, CANVAS // 2],
            'candidates': candidates,
            'best': {k: best[k] for k in ('flipped', 'angle', 'dx', 'dy', 'iou')},
        },
        'final': {
            'matrix': [[round(float(v), 6) for v in row] for row in final_matrix],
            'regions_png': _regions_png(final_fragment, final_template),
            'template_px': template_px,
            'covered_px': covered_px,
            'missing_px': missing_px,
            'overhang_px': overhang_px,
            'percent_broken': round(percent_broken, 4),
            'completeness': round(100.0 - percent_broken, 4),
        },
        'context': {k: v for k, v in context.items() if v is not None},
        'verified': {'against': 'estimate_brokenness_from_arrays', 'percent_broken': round(float(katie_pct), 4)},
    }

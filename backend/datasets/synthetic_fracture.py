# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: synthetic_fracture.py
# Copyright (c) 2024

"""
Realistic synthetic fracture generation for fossil shark teeth.

Generates physically plausible fracture masks using multi-scale noise for
jagged edges, contour-following fracture lines, and 3D cross-section effects
at the break point. Supports species-specific fracture profiles.

Fracture types:
  - root_loss: Break at/near root-crown junction
  - tip_loss: Break losing the crown apex
  - lateral_break: Oblique break removing one side
  - edge_chip: Chip along blade/serration edge
  - diagonal_snap: Oblique fracture across the crown

No Django dependency — can be tested standalone.
"""

import json
import os
import numpy as np
from PIL import Image as PILImage
from scipy import ndimage

from .segmentation import segment_tooth, compute_tooth_area, compute_completeness, sanitize_tooth_image


PROFILES_DIR = os.path.join(os.path.dirname(__file__), 'fracture_profiles')
DEFAULT_PROFILE = os.path.join(PROFILES_DIR, 'default.json')


# ---------------------------------------------------------------------------
# Profile loading
# ---------------------------------------------------------------------------

def load_fracture_profiles(profile_path=None):
    """Load fracture profiles from JSON file."""
    path = profile_path or DEFAULT_PROFILE
    with open(path, 'r') as f:
        profiles = json.load(f)
    return {k: v for k, v in profiles.items() if not k.startswith('_')}


def get_species_profile(species, profiles=None):
    """Get full fracture profile for a species, falling back to 'default'."""
    if profiles is None:
        profiles = load_fracture_profiles()
    profile = profiles.get(species, profiles.get('default', {}))
    default = profiles.get('default', {})
    # Merge with defaults for any missing keys
    result = {
        'fracture_types': profile.get('fracture_types', default.get('fracture_types', {})),
        'edge_params': {**default.get('edge_params', {}), **profile.get('edge_params', {})},
    }
    return result


# ---------------------------------------------------------------------------
# Multi-scale fracture noise generation
# ---------------------------------------------------------------------------

def _midpoint_displacement_1d(n_points, roughness, rng):
    """
    1D midpoint displacement (diamond-square in 1D).

    Produces coastline-like irregular shapes: sharp changes at varying
    scales, non-repeating, no sinusoidal character.  This is the classic
    algorithm for natural-looking irregular edges.

    Works by recursively bisecting a line and displacing midpoints by
    decreasing random amounts. The *roughness* parameter (0–1) controls
    how fast the displacement shrinks at each level — higher values keep
    more fine-scale roughness.
    """
    # Need power-of-2 + 1 points for clean recursion
    levels = max(int(np.ceil(np.log2(max(n_points, 2)))), 3)
    size = (1 << levels) + 1
    arr = np.zeros(size)

    # Random initial displacement at endpoints (not zero — avoids forced-flat look)
    arr[0] = rng.randn() * roughness * 3.0
    arr[-1] = rng.randn() * roughness * 3.0

    scale = roughness * 12.0
    # Roughness exponent: 0.5 = very rough (coastline), 0.8 = smoother
    H = rng.uniform(0.4, 0.7)

    step = size - 1
    for level in range(levels):
        half = step // 2
        if half < 1:
            break
        for i in range(half, size - 1, step):
            avg = (arr[i - half] + arr[i + half]) / 2.0
            arr[i] = avg + rng.randn() * scale
        scale *= (0.5 ** H)  # reduce displacement at each level
        step = half

    # Resample to requested length
    x_src = np.linspace(0, 1, size)
    x_dst = np.linspace(0, 1, n_points)
    return np.interp(x_dst, x_src, arr)


def _generate_fracture_noise(length, roughness=0.6, micro_roughness=0.4, seed=None):
    """
    Generate fracture edge displacement combining midpoint displacement with
    conchoidal scallops, sharp notches, and grain texture.

    Layers:
      1. Midpoint displacement: large-scale irregular wander (coastline shape)
      2. Conchoidal scallops: wide asymmetric curved dips/bumps (enameloid flaking)
      3. Sharp steps: sudden shelf jumps at material layer boundaries
      4. Notches: narrow V-shaped dips where crack jumps between layers
      5. Grain texture: fine surface roughness of broken material

    Each layer uses fully random parameters (position, width, amplitude,
    direction) so no two fractures share a recognizable pattern.
    """
    if seed is not None:
        rng = np.random.RandomState(seed)
    else:
        rng = np.random

    # --- Layer 1: Midpoint displacement (large-scale wander) ---
    displacement = _midpoint_displacement_1d(length, roughness, rng)

    # --- Layer 2: Conchoidal scallops (asymmetric curved sections) ---
    # Vary count widely: sometimes 1-2 big scallops, sometimes 5-8 small ones
    n_scallops = rng.randint(2, max(9, length // 25))
    for _ in range(n_scallops):
        center = rng.randint(0, length)
        # Wide range of widths: from narrow chips to broad curves
        min_w = max(length // 30, 4)
        max_w = max(length // 5, min_w + 5)
        width = rng.randint(min_w, max_w)
        amplitude = rng.uniform(3, 12) * roughness * rng.choice([-1, 1])
        # Asymmetric shape: steep on one side, gradual on the other
        steepness = rng.uniform(0.15, 0.85)
        for j in range(max(0, center - width), min(length, center + width)):
            d = (j - center) / max(width, 1)
            if -1 < d < 0:
                displacement[j] += amplitude * (1 - abs(d / steepness) ** 2) * max(0, 1 + d)
            elif 0 <= d < 1:
                displacement[j] += amplitude * (1 - abs(d / (1 - steepness)) ** 2) * max(0, 1 - d)

    # --- Layer 3: Sharp steps (material layer boundaries) ---
    n_steps = rng.randint(1, max(5, length // 50) + 1)
    for _ in range(n_steps):
        pos = rng.randint(length // 10, length * 9 // 10)
        step_height = rng.uniform(3, 10) * roughness * rng.choice([-1, 1])
        transition = rng.randint(3, max(12, length // 25))
        ramp_start = max(0, pos - transition // 2)
        ramp_end = min(length, pos + transition // 2)
        if ramp_end > ramp_start:
            displacement[ramp_start:ramp_end] += np.linspace(0, step_height, ramp_end - ramp_start)
            displacement[ramp_end:] += step_height

    # --- Layer 4: Sharp notches (crack jumps between layers) ---
    n_notches = rng.randint(1, max(5, length // 40))
    for _ in range(n_notches):
        pos = rng.randint(0, length)
        notch_width = rng.randint(2, max(10, length // 30))
        notch_depth = rng.uniform(2, 8) * roughness * rng.choice([-1, 1])
        start = max(0, pos - notch_width // 2)
        end = min(length, pos + notch_width // 2)
        if end > start:
            window = np.hanning(end - start)
            displacement[start:end] += notch_depth * window

    # --- Layer 5: Grain texture (fine surface roughness) ---
    if micro_roughness > 0:
        fine = _midpoint_displacement_1d(length, micro_roughness * 0.6, rng)
        displacement += fine
        # Extra pixel-level jitter
        micro = rng.randn(length) * micro_roughness * 1.5
        if length > 5:
            micro = np.convolve(micro, np.ones(3) / 3, mode='same')
        displacement += micro

    return displacement


def _get_tooth_contour(mask):
    """Extract the contour points of the tooth mask, ordered."""
    # Use erosion to find boundary
    eroded = ndimage.binary_erosion(mask, iterations=1)
    boundary = mask.astype(bool) & ~eroded
    points = np.argwhere(boundary)  # (row, col) pairs
    if len(points) == 0:
        return points

    # Order points by angle from centroid for a continuous contour
    centroid = points.mean(axis=0)
    angles = np.arctan2(points[:, 0] - centroid[0], points[:, 1] - centroid[1])
    order = np.argsort(angles)
    return points[order]


def _add_direction_changes(baseline, max_drift_frac=0.15):
    """
    Add 1-3 direction changes to a flat/smooth baseline array.

    Real fractures change direction as they cross material layers.
    This adds piecewise-linear drift so the fracture line visibly
    shifts direction 1-3 times, with each segment having a different
    random slope. The total drift stays within ±max_drift_frac of
    the baseline's range.

    Args:
        baseline: 1D array (the baseline row or col values).
        max_drift_frac: Max drift as fraction of the array's span.

    Returns:
        Modified baseline with direction changes, and list of
        change positions as fractions in [0, 1] for dentine mapping.
    """
    length = len(baseline)
    if length < 10:
        return baseline, []

    span = np.ptp(baseline)
    if span < 5:
        span = max(length * 0.3, 20)  # for flat baselines, use length as reference
    max_drift = span * max_drift_frac

    n_changes = np.random.randint(1, 4)  # 1-3 direction changes
    # Place change points at random positions (not too close to edges)
    change_positions = sorted(np.random.uniform(0.15, 0.85, size=n_changes))

    # Generate random slopes for each segment
    segments = []
    prev_pos = 0.0
    for cp in change_positions:
        segments.append((prev_pos, cp))
        prev_pos = cp
    segments.append((prev_pos, 1.0))

    drift = np.zeros(length)
    current_offset = 0.0
    for seg_start, seg_end in segments:
        i_start = int(seg_start * length)
        i_end = int(seg_end * length)
        seg_len = i_end - i_start
        if seg_len <= 0:
            continue
        # Random slope for this segment
        slope = np.random.uniform(-max_drift, max_drift)
        t = np.linspace(0, 1, seg_len)
        drift[i_start:i_end] = current_offset + t * slope
        current_offset = drift[min(i_end - 1, length - 1)]

    # Smooth the transitions slightly (not sharp corners)
    sigma = max(length // 30, 3)
    drift = ndimage.gaussian_filter1d(drift, sigma=sigma)

    return baseline + drift, change_positions


def _get_tooth_bbox(mask):
    """Get bounding box of the tooth region."""
    rows = np.any(mask, axis=1)
    cols = np.any(mask, axis=0)
    if not np.any(rows) or not np.any(cols):
        return 0, 0, 0, 0
    rmin, rmax = np.where(rows)[0][[0, -1]]
    cmin, cmax = np.where(cols)[0][[0, -1]]
    return rmin, rmax, cmin, cmax


def _find_contour_at_row(mask, row):
    """Find left and right contour columns at a given row."""
    row = int(np.clip(row, 0, mask.shape[0] - 1))
    cols = np.where(mask[row])[0]
    if len(cols) == 0:
        return None, None
    return cols[0], cols[-1]


def _find_contour_at_col(mask, col):
    """Find top and bottom contour rows at a given column."""
    col = int(np.clip(col, 0, mask.shape[1] - 1))
    rows = np.where(mask[:, col])[0]
    if len(rows) == 0:
        return None, None
    return rows[0], rows[-1]


def _generate_fracture_path(start, end, n_points, roughness=0.6, micro_roughness=0.4,
                            min_angle_change=20, max_angle_change=110,
                            curvature=0.0, tooth_mask=None):
    """
    Generate a fracture path with gentle curvature and fBm edge noise.

    The path uses 2-3 random control points displaced ±8-15 % perpendicular
    to the start→end line, interpolated with smooth cubic-like blending.
    This gives natural, non-straight paths without the zigzag problem of
    the old waypoint-walk approach.

    The fBm noise function adds all the fine-scale organic irregularity.

    Args:
        start: (row, col) start point.
        end: (row, col) end point.
        n_points: Total number of points to generate.
        roughness: Controls amplitude of local noise on each segment.
        micro_roughness: Fine-scale surface roughness.
        curvature: How much the path follows the tooth contour (0–1).
        tooth_mask: Binary tooth mask for curvature calculation.

    Returns:
        Tuple of (Nx2 array of (row, col) points, empty list for compat).
    """
    start = np.array(start, dtype=float)
    end = np.array(end, dtype=float)
    total_dist = np.linalg.norm(end - start)
    t = np.linspace(0, 1, n_points)

    if total_dist < 5:
        return np.column_stack([
            start[0] + t * (end[0] - start[0]),
            start[1] + t * (end[1] - start[1]),
        ]), []

    # --- 1. Build smooth curved baseline through 2-3 control points ---
    line_vec = end - start
    perp_dir = np.array([-line_vec[1], line_vec[0]])
    perp_len = np.linalg.norm(perp_dir)
    if perp_len > 0:
        perp_dir = perp_dir / perp_len

    # 2-3 control points at random positions along the line
    n_ctrl = np.random.randint(2, 4)
    # Place them at roughly even intervals but with jitter
    ctrl_t = sorted(np.random.uniform(0.15, 0.85, size=n_ctrl))

    # Each control point displaces ±8-15% of line length perpendicular
    ctrl_perp = np.random.uniform(-0.15, 0.15, size=n_ctrl) * total_dist

    # Build perpendicular displacement profile: 0 at endpoints, smooth
    # interpolation through control points using cubic-like blending
    all_t = np.r_[0.0, ctrl_t, 1.0]
    all_d = np.r_[0.0, ctrl_perp, 0.0]
    perp_displacement = np.interp(t, all_t, all_d)
    # Smooth to remove any sharp kinks at control points
    sigma = max(n_points // 15, 5)
    perp_displacement = ndimage.gaussian_filter1d(perp_displacement, sigma=sigma)
    # Re-pin endpoints to zero (smoothing may have shifted them)
    taper = np.minimum(t / 0.1, 1.0) * np.minimum((1 - t) / 0.1, 1.0)
    perp_displacement *= taper

    rows = start[0] + t * (end[0] - start[0]) + perp_displacement * perp_dir[0]
    cols = start[1] + t * (end[1] - start[1]) + perp_displacement * perp_dir[1]

    # --- 2. Optional curvature toward tooth center ---
    if curvature > 0 and tooth_mask is not None:
        h_m, w_m = tooth_mask.shape
        for i in range(len(rows)):
            r_i = int(np.clip(rows[i], 0, h_m - 1))
            c_i = int(np.clip(cols[i], 0, w_m - 1))
            row_pixels = np.where(tooth_mask[r_i, :])[0]
            col_pixels = np.where(tooth_mask[:, c_i])[0]
            if len(row_pixels) > 0:
                center_c = (row_pixels[0] + row_pixels[-1]) / 2
                cols[i] += (center_c - cols[i]) * curvature * 0.3
            if len(col_pixels) > 0:
                center_r = (col_pixels[0] + col_pixels[-1]) / 2
                rows[i] += (center_r - rows[i]) * curvature * 0.3

    # --- 3. Fracture edge noise (perpendicular to path) ---
    noise = _generate_fracture_noise(n_points, roughness=roughness,
                                      micro_roughness=micro_roughness)

    dr = np.gradient(rows)
    dc = np.gradient(cols)
    length_local = np.sqrt(dr ** 2 + dc ** 2) + 1e-8
    perp_r = -dc / length_local
    perp_c = dr / length_local

    rows += noise * perp_r
    cols += noise * perp_c

    return np.column_stack([rows, cols]), []


# ---------------------------------------------------------------------------
# Fracture line rasterization
# ---------------------------------------------------------------------------

def _rasterize_fracture_line(points, mask_shape, keep_side='above'):
    """
    Rasterize a fracture line into a binary mask using polygon fill.

    Builds a closed polygon from the fracture line + the image edge on the
    REMOVE side, then fills it. This handles non-monotonic paths correctly
    (no striping artifacts from doubled-back fracture lines).

    Args:
        points: Nx2 array of (row, col) points defining the fracture line.
        mask_shape: (height, width) of the output mask.
        keep_side: 'above', 'below', 'left', 'right' — which side to keep.

    Returns:
        Binary mask (1 = keep, 0 = remove).
    """
    from PIL import Image as PILImage, ImageDraw

    h, w = mask_shape
    if len(points) < 2:
        return np.ones((h, w), dtype=np.uint8)

    # Clip points to image bounds
    pts = points.copy()
    pts[:, 0] = np.clip(pts[:, 0], 0, h - 1)
    pts[:, 1] = np.clip(pts[:, 1], 0, w - 1)

    # Build polygon: fracture line + edge corners on the REMOVE side
    # Convert to (col, row) = (x, y) for PIL
    line_xy = [(int(round(c)), int(round(r))) for r, c in pts]

    # Add corner points to close the polygon on the remove side
    if keep_side == 'above':
        # Remove below: polygon = line + bottom-right + bottom-left
        corners = [(w - 1, h - 1), (0, h - 1)]
    elif keep_side == 'below':
        # Remove above: polygon = line + top-left + top-right
        corners = [(0, 0), (w - 1, 0)]
    elif keep_side == 'left':
        # Remove right: polygon = line + top-right + bottom-right
        corners = [(w - 1, 0), (w - 1, h - 1)]
    elif keep_side == 'right':
        # Remove left: polygon = line + bottom-left + top-left
        corners = [(0, h - 1), (0, 0)]
    else:
        return np.ones((h, w), dtype=np.uint8)

    polygon = line_xy + corners

    # Draw filled polygon (the REMOVE zone)
    remove_img = PILImage.new('L', (w, h), 0)
    draw = ImageDraw.Draw(remove_img)
    draw.polygon(polygon, fill=255)
    remove_mask = np.array(remove_img) > 127

    # Keep mask = everywhere except the remove zone
    fracture = np.ones((h, w), dtype=np.uint8)
    fracture[remove_mask] = 0

    return fracture


# ---------------------------------------------------------------------------
# Fracture type implementations
# ---------------------------------------------------------------------------

def _fracture_root_loss(mask, fraction, edge_params):
    """Break at/near root-crown junction, losing the root."""
    rmin, rmax, cmin, cmax = _get_tooth_bbox(mask)
    h, w = mask.shape
    height = rmax - rmin
    width = cmax - cmin

    cut_row = int(rmax - height * fraction)
    cut_row = np.clip(cut_row, rmin + 5, rmax - 5)

    n_points = max(width + 20, 50)
    base_cols = np.linspace(cmin - 10, cmax + 10, n_points)

    # Random tilt: ±5-20 degrees so the cut isn't perfectly horizontal
    tilt_deg = np.random.uniform(-20, 20)
    tilt_px = np.tan(np.radians(tilt_deg)) * width
    base_rows = np.linspace(cut_row - tilt_px / 2, cut_row + tilt_px / 2, n_points)

    # Follow tooth contour for natural curvature
    curvature = edge_params.get('curvature', 0.3)
    for i, c in enumerate(base_cols):
        c_int = int(np.clip(c, 0, w - 1))
        top, bot = _find_contour_at_col(mask, c_int)
        if top is not None and bot is not None:
            local_center = (top + bot) / 2
            base_rows[i] += (local_center - base_rows[i]) * curvature * 0.3

    # Add direction changes so the cut isn't a straight line
    base_rows, change_positions = _add_direction_changes(base_rows, max_drift_frac=0.20)

    noise = _generate_fracture_noise(
        n_points,
        roughness=edge_params.get('roughness', 0.6),
        micro_roughness=edge_params.get('micro_roughness', 0.4),
    )
    fracture_rows = base_rows + noise

    points = np.stack([fracture_rows, base_cols], axis=1)
    return _rasterize_fracture_line(points, mask.shape, keep_side='above')


def _fracture_tip_loss(mask, fraction, edge_params):
    """Break losing the crown apex/tip."""
    rmin, rmax, cmin, cmax = _get_tooth_bbox(mask)
    h, w = mask.shape
    height = rmax - rmin
    width = cmax - cmin

    cut_row = int(rmin + height * fraction)
    cut_row = np.clip(cut_row, rmin + 5, rmax - 5)

    n_points = max(width + 20, 50)
    base_cols = np.linspace(cmin - 10, cmax + 10, n_points)

    # Random tilt: ±5-20 degrees
    tilt_deg = np.random.uniform(-20, 20)
    tilt_px = np.tan(np.radians(tilt_deg)) * width
    base_rows = np.linspace(cut_row - tilt_px / 2, cut_row + tilt_px / 2, n_points)

    curvature = edge_params.get('curvature', 0.3)
    for i, c in enumerate(base_cols):
        c_int = int(np.clip(c, 0, w - 1))
        top, bot = _find_contour_at_col(mask, c_int)
        if top is not None and bot is not None:
            local_center = (top + bot) / 2
            base_rows[i] += (local_center - cut_row) * curvature * 0.3

    base_rows, change_positions = _add_direction_changes(base_rows, max_drift_frac=0.20)

    noise = _generate_fracture_noise(
        n_points,
        roughness=edge_params.get('roughness', 0.6),
        micro_roughness=edge_params.get('micro_roughness', 0.4),
    )
    fracture_rows = base_rows + noise

    points = np.stack([fracture_rows, base_cols], axis=1)
    return _rasterize_fracture_line(points, mask.shape, keep_side='below')


def _fracture_lateral_break(mask, fraction, edge_params):
    """Oblique/diagonal break removing one side."""
    rmin, rmax, cmin, cmax = _get_tooth_bbox(mask)
    h, w = mask.shape
    height = rmax - rmin
    width = cmax - cmin

    remove_left = np.random.random() < 0.5
    cut_frac = fraction if remove_left else (1.0 - fraction)
    cut_col = int(cmin + width * cut_frac)

    # Wider angle range: 5-40 degrees tilt (was 5-25)
    angle = np.random.uniform(0.08, 0.45) * np.random.choice([-1, 1])

    n_points = max(height + 20, 50)
    base_rows = np.linspace(rmin - 10, rmax + 10, n_points)
    base_cols = np.full(n_points, float(cut_col))

    for i, r in enumerate(base_rows):
        t = (r - rmin) / max(height, 1)
        base_cols[i] += angle * height * (t - 0.5)

    curvature = edge_params.get('curvature', 0.3)
    for i, r in enumerate(base_rows):
        r_int = int(np.clip(r, 0, h - 1))
        left, right = _find_contour_at_row(mask, r_int)
        if left is not None and right is not None:
            local_center = (left + right) / 2
            base_cols[i] += (local_center - cut_col) * curvature * 0.2

    base_cols, change_positions = _add_direction_changes(base_cols, max_drift_frac=0.15)

    noise = _generate_fracture_noise(
        n_points,
        roughness=edge_params.get('roughness', 0.6),
        micro_roughness=edge_params.get('micro_roughness', 0.4),
    )
    fracture_cols = base_cols + noise

    points = np.stack([base_rows, fracture_cols], axis=1)
    keep_side = 'left' if remove_left else 'right'
    return _rasterize_fracture_line(points, mask.shape, keep_side=keep_side)


def _fracture_diagonal_snap(mask, fraction, edge_params):
    """Oblique fracture across the crown at an angle."""
    rmin, rmax, cmin, cmax = _get_tooth_bbox(mask)
    h, w = mask.shape
    height = rmax - rmin
    width = cmax - cmin

    angle_deg = np.random.uniform(25, 55) * np.random.choice([-1, 1])
    angle_rad = np.radians(angle_deg)

    center_row = rmin + height * (1.0 - fraction * 0.7)
    center_col = cmin + width * np.random.uniform(0.3, 0.7)

    half_diag = max(height, width)
    n_points = max(int(2 * half_diag), 80)
    t = np.linspace(-1, 1, n_points)

    base_rows = center_row + t * half_diag * np.sin(angle_rad)
    base_cols = center_col + t * half_diag * np.cos(angle_rad)

    # Direction changes applied along the diagonal
    base_rows, change_positions = _add_direction_changes(base_rows, max_drift_frac=0.12)

    noise = _generate_fracture_noise(
        n_points,
        roughness=edge_params.get('roughness', 0.6),
        micro_roughness=edge_params.get('micro_roughness', 0.4),
    )
    # Apply noise perpendicular to the diagonal line
    perp_r = -np.cos(angle_rad)
    perp_c = np.sin(angle_rad)
    base_rows += noise * perp_r
    base_cols += noise * perp_c

    points = np.stack([base_rows, base_cols], axis=1)

    test_mask = _rasterize_fracture_line(points, mask.shape, keep_side='above')
    keep_above = np.sum(mask & test_mask)
    keep_below = np.sum(mask & ~test_mask)

    target_area = compute_tooth_area(mask) * (1.0 - fraction)
    if abs(keep_above - target_area) < abs(keep_below - target_area):
        return _rasterize_fracture_line(points, mask.shape, keep_side='above')
    else:
        return _rasterize_fracture_line(points, mask.shape, keep_side='below')


def _fracture_transverse_snap(mask, fraction, edge_params):
    """Vertical/near-vertical fracture across the tooth (transverse break)."""
    rmin, rmax, cmin, cmax = _get_tooth_bbox(mask)
    h, w = mask.shape
    height = rmax - rmin
    width = cmax - cmin

    remove_left = np.random.random() < 0.5
    cut_frac = fraction if remove_left else (1.0 - fraction)
    cut_col = int(cmin + width * cut_frac)

    # Wider angle variation: ±5-25 degrees from vertical (was ±7)
    angle = np.random.uniform(-0.35, 0.35)

    n_points = max(height + 20, 50)
    base_rows = np.linspace(rmin - 10, rmax + 10, n_points)
    base_cols = np.full(n_points, float(cut_col))

    for i, r in enumerate(base_rows):
        t = (r - rmin) / max(height, 1)
        base_cols[i] += angle * height * (t - 0.5)

    curvature = edge_params.get('curvature', 0.3)
    for i, r in enumerate(base_rows):
        r_int = int(np.clip(r, 0, h - 1))
        left, right = _find_contour_at_row(mask, r_int)
        if left is not None and right is not None:
            local_center = (left + right) / 2
            base_cols[i] += (local_center - cut_col) * curvature * 0.2

    base_cols, change_positions = _add_direction_changes(base_cols, max_drift_frac=0.15)

    noise = _generate_fracture_noise(
        n_points,
        roughness=edge_params.get('roughness', 0.6),
        micro_roughness=edge_params.get('micro_roughness', 0.4),
    )
    fracture_cols = base_cols + noise

    points = np.stack([base_rows, fracture_cols], axis=1)
    keep_side = 'left' if remove_left else 'right'
    return _rasterize_fracture_line(points, mask.shape, keep_side=keep_side)


def _fracture_oblique_front(mask, fraction, edge_params):
    """Oblique fracture biased toward the front (labial) face."""
    rmin, rmax, cmin, cmax = _get_tooth_bbox(mask)
    h, w = mask.shape
    height = rmax - rmin
    width = cmax - cmin

    angle_deg = np.random.uniform(55, 80) * np.random.choice([-1, 1])
    angle_rad = np.radians(angle_deg)

    front_side = np.random.choice(['left', 'right'])
    if front_side == 'left':
        center_col = cmin + width * np.random.uniform(0.2, 0.4)
    else:
        center_col = cmin + width * np.random.uniform(0.6, 0.8)

    center_row = rmin + height * np.random.uniform(0.3, 0.7)

    half_diag = max(height, width)
    n_points = max(int(2 * half_diag), 80)
    t = np.linspace(-1, 1, n_points)

    base_rows = center_row + t * half_diag * np.sin(angle_rad)
    base_cols = center_col + t * half_diag * np.cos(angle_rad)

    base_rows, change_positions = _add_direction_changes(base_rows, max_drift_frac=0.12)

    noise = _generate_fracture_noise(
        n_points,
        roughness=edge_params.get('roughness', 0.6) * 1.2,
        micro_roughness=edge_params.get('micro_roughness', 0.4),
    )
    perp_r = -np.cos(angle_rad)
    perp_c = np.sin(angle_rad)
    base_rows += noise * perp_r
    base_cols += noise * perp_c

    points = np.stack([base_rows, base_cols], axis=1)

    test_mask = _rasterize_fracture_line(points, mask.shape, keep_side='above')
    keep_above = np.sum(mask & test_mask)
    keep_below = np.sum(mask & ~test_mask)
    target_area = compute_tooth_area(mask) * (1.0 - fraction)

    if abs(keep_above - target_area) < abs(keep_below - target_area):
        return _rasterize_fracture_line(points, mask.shape, keep_side='above')
    else:
        return _rasterize_fracture_line(points, mask.shape, keep_side='below')


FRACTURE_FUNCTIONS = {
    'root_loss': _fracture_root_loss,
    'tip_loss': _fracture_tip_loss,
    'lateral_break': _fracture_lateral_break,
    'edge_chip': _fracture_tip_loss,
    'diagonal_snap': _fracture_diagonal_snap,
    'transverse_snap': _fracture_transverse_snap,
    'oblique_front': _fracture_oblique_front,
}


def _keep_largest_fragment(keep_mask):
    """
    Post-process: keep only the largest connected component.
    Removes disconnected floating pieces that are physically impossible.
    """
    labeled, num = ndimage.label(keep_mask)
    if num <= 1:
        return keep_mask
    sizes = ndimage.sum(keep_mask, labeled, range(1, num + 1))
    largest = np.argmax(sizes) + 1
    return (labeled == largest).astype(np.uint8)


def _validate_fragment_shape(fragment_mask, min_solidity=0.75, window_size=10):
    """
    Validate that a fragment has a physically plausible shape.

    Two checks:
    1. Solidity: ratio of fragment area to convex hull area. Low solidity
       means deep concavities or thin peninsulas that can't exist on a
       real broken tooth.
    2. Blank hole scan: slide a window across the fragment's bounding box.
       If any window that should be inside the tooth is 100% blank, the
       shape has an impossible internal gap.

    Returns:
        True if shape is valid, False if it should be rejected.
    """
    if np.sum(fragment_mask) < 100:
        return False

    # Check 1: Solidity (area / convex hull area)
    from scipy.spatial import ConvexHull
    points = np.argwhere(fragment_mask > 0)
    if len(points) < 10:
        return False

    try:
        hull = ConvexHull(points)
        # Fill the convex hull to count its area
        from PIL import Image as PILImage, ImageDraw
        h, w = fragment_mask.shape
        hull_img = PILImage.new('L', (w, h), 0)
        draw = ImageDraw.Draw(hull_img)
        hull_vertices = points[hull.vertices]
        hull_polygon = [(int(c), int(r)) for r, c in hull_vertices]
        draw.polygon(hull_polygon, fill=255)
        hull_area = np.sum(np.array(hull_img) > 127)
        fragment_area = np.sum(fragment_mask > 0)

        solidity = fragment_area / max(hull_area, 1)
        if solidity < min_solidity:
            return False
    except Exception:
        pass  # ConvexHull can fail on degenerate shapes — allow through

    # Check 2: Thin neck / protrusion check at multiple scales.
    # Erode progressively — if the fragment splits at any level, it has
    # a thin neck or peninsula that can't exist on a real broken tooth.
    for erosion_px in [4, 8, 12]:
        eroded = ndimage.binary_erosion(fragment_mask, iterations=erosion_px)
        if np.sum(eroded) > 100:
            labeled_eroded, n_eroded = ndimage.label(eroded)
            if n_eroded > 1:
                return False

    # Check 2b: Thin peninsula detection — if a moderate erosion (6px)
    # loses more than 30% of area, the shape has thin pointed extensions
    # that couldn't survive fossilization.
    eroded_6 = ndimage.binary_erosion(fragment_mask, iterations=6)
    eroded_area = np.sum(eroded_6)
    if eroded_area > 50:  # only check if erosion leaves something
        area_loss = 1.0 - (eroded_area / max(fragment_area, 1))
        if area_loss > 0.35:
            return False

    # Check 3: Blank hole scan within the bounding box
    rows = np.any(fragment_mask, axis=1)
    cols = np.any(fragment_mask, axis=0)
    if not np.any(rows) or not np.any(cols):
        return False
    rmin, rmax = np.where(rows)[0][[0, -1]]
    cmin, cmax = np.where(cols)[0][[0, -1]]

    # Small margin — scan close to edges to catch concave notches
    margin = window_size // 2
    scan_rmin = rmin + margin
    scan_rmax = rmax - margin
    scan_cmin = cmin + margin
    scan_cmax = cmax - margin

    if scan_rmax <= scan_rmin or scan_cmax <= scan_cmin:
        return True

    # Scan ~8% of positions
    n_samples = max(20, int(0.08 * (scan_rmax - scan_rmin) * (scan_cmax - scan_cmin) / (window_size ** 2)))
    n_samples = min(n_samples, 300)

    for _ in range(n_samples):
        r = np.random.randint(scan_rmin, scan_rmax)
        c = np.random.randint(scan_cmin, scan_cmax)
        window = fragment_mask[r:r+window_size, c:c+window_size]
        if window.shape[0] == window_size and window.shape[1] == window_size:
            if np.sum(window) == 0:
                return False

    return True


# ---------------------------------------------------------------------------
# 3D cross-section effect
# ---------------------------------------------------------------------------

def _add_3d_edge_effect(img_array, tooth_mask, fracture_mask, edge_width=20):
    """
    Add visible exposed dentine at the fracture edge.

    Based on real fragments: broken teeth show a wide band of light
    beige/cream-colored internal material (exposed dentine/osteodentine).
    This is the most visually distinctive feature of a real fracture.

    Uses fast vectorized numpy operations (no per-pixel loops).

    Args:
        img_array: RGB image as numpy array.
        tooth_mask: Binary tooth segmentation mask.
        fracture_mask: Binary fracture mask (1=keep, 0=remove).
        edge_width: Width of the exposed dentine band in pixels.

    Returns:
        Modified image array.
    """
    if edge_width <= 0:
        return img_array

    result = img_array.astype(np.float32)
    h, w = tooth_mask.shape

    keep = tooth_mask.astype(bool) & fracture_mask.astype(bool)
    removed = tooth_mask.astype(bool) & ~fracture_mask.astype(bool)

    if not np.any(removed) or not np.any(keep):
        return img_array

    # Distance from each pixel to the fracture boundary
    dist_to_fracture = ndimage.distance_transform_edt(~removed)

    # Varying width: smooth random variation so some areas show more dentine
    width_variation = np.random.randn(h, w) * 0.3
    width_variation = ndimage.gaussian_filter(width_variation, sigma=20)
    effective_width = edge_width * (1.0 + width_variation)
    effective_width = np.clip(effective_width, edge_width * 0.4, edge_width * 2.0)

    # Cross-section zone: kept tooth pixels within the effective width
    cross_section = keep & (dist_to_fracture > 0) & (dist_to_fracture <= effective_width)

    if not np.any(cross_section):
        return img_array

    # Blend factor: 1.0 at fracture edge, fading toward interior
    # Use safe division with the effective width
    blend = np.zeros((h, w), dtype=np.float32)
    blend[cross_section] = 1.0 - np.clip(
        dist_to_fracture[cross_section] / np.maximum(effective_width[cross_section], 1.0),
        0, 1
    ) ** 0.5

    # Dentine color: RELATIVE to the tooth surface — always lighter + warmer
    # Sample average color along the fracture edge to compute contrast
    near_edge = keep & (dist_to_fracture > 0) & (dist_to_fracture <= 5)
    if np.any(near_edge):
        avg_surface = np.mean(result[near_edge], axis=0)
    else:
        avg_surface = np.mean(result[keep], axis=0) if np.any(keep) else np.array([150, 140, 130])

    # Make dentine 50-70 units lighter than surface, with warm beige shift
    dentine_base = np.clip(avg_surface + np.array([60, 50, 35]), 0, 255)

    # Add grainy texture for realism
    grain = np.random.randn(h, w).astype(np.float32) * 8
    grain = ndimage.gaussian_filter(grain, sigma=2.0)

    dentine = np.zeros_like(result)
    dentine[:, :, 0] = dentine_base[0] + grain
    dentine[:, :, 1] = dentine_base[1] + grain
    dentine[:, :, 2] = dentine_base[2] + grain
    dentine = np.clip(dentine, 0, 255)

    # Apply blend: tooth pixels near fracture become dentine-colored
    blend_3d = blend[:, :, np.newaxis]
    result = result * (1 - blend_3d) + dentine * blend_3d

    # Dark shadow line at the very edge (1-2px) for depth cue
    shadow = keep & (dist_to_fracture > 0) & (dist_to_fracture <= 2.0)
    if np.any(shadow):
        result[shadow] *= 0.55

    return np.clip(result, 0, 255).astype(np.uint8)


# ---------------------------------------------------------------------------
# Main API
# ---------------------------------------------------------------------------

def generate_fracture_mask(mask, target_completeness, species_weights=None, edge_params=None,
                           force_type=None):
    """
    Generate a fracture mask with realistic jagged edges.

    Uses a feedback loop: generates the fracture, measures actual completeness,
    and adjusts the fraction parameter to converge on the target. This makes
    all fracture types equally reliable at hitting target completeness.

    Args:
        mask: Binary tooth segmentation mask.
        target_completeness: Desired completeness (0.0 to 1.0).
        species_weights: Dict of {fracture_type: probability}.
        edge_params: Dict of edge roughness parameters.
        force_type: If set, use this fracture type instead of random selection.

    Returns:
        Binary fracture mask (1 = keep, 0 = remove).
    """
    if species_weights is None:
        species_weights = {
            'root_loss': 0.05, 'tip_loss': 0.10, 'lateral_break': 0.20,
            'edge_chip': 0.05, 'diagonal_snap': 0.20,
            'transverse_snap': 0.20, 'oblique_front': 0.20,
        }
    if edge_params is None:
        edge_params = {'roughness': 0.6, 'micro_roughness': 0.4, 'curvature': 0.3,
                       'edge_3d_width': 4}

    # Select fracture type
    if force_type and force_type in FRACTURE_FUNCTIONS:
        fracture_type = force_type
    else:
        types = list(species_weights.keys())
        probs = np.array([species_weights.get(t, 0) for t in types], dtype=float)
        if probs.sum() == 0:
            probs = np.ones(len(types))
        probs = probs / probs.sum()
        fracture_type = np.random.choice(types, p=probs)

    # Vary dentine exposure by fracture type
    dentine_width_multiplier = {
        'transverse_snap': 2.5,
        'oblique_front': 2.0,
        'lateral_break': 1.5,
        'diagonal_snap': 1.3,
    }
    effective_edge_params = dict(edge_params)
    if fracture_type in dentine_width_multiplier:
        base_width = effective_edge_params.get('edge_3d_width', 20)
        effective_edge_params['edge_3d_width'] = int(base_width * dentine_width_multiplier[fracture_type])

    # Feedback loop: try up to 3 fraction adjustments to hit target completeness.
    # Different fracture types remove different amounts of tooth area for the
    # same fraction parameter, so we measure and adjust.
    original_area = compute_tooth_area(mask)
    fraction_to_remove = 1.0 - target_completeness
    best_mask = None
    best_error = float('inf')
    func = FRACTURE_FUNCTIONS.get(fracture_type, _fracture_tip_loss)

    for _adj in range(3):
        fracture_mask = func(mask, fraction_to_remove, effective_edge_params)
        kept = mask.astype(bool) & fracture_mask.astype(bool)
        actual_area = np.sum(kept)
        actual_compl = actual_area / max(original_area, 1)
        error = abs(actual_compl - target_completeness)

        if error < best_error:
            best_error = error
            best_mask = fracture_mask

        if error < 0.10:  # close enough
            break

        # Adjust fraction: if we removed too much, reduce fraction; too little, increase
        if actual_compl < target_completeness:
            fraction_to_remove *= 0.7  # remove less
        else:
            fraction_to_remove *= 1.3  # remove more
        fraction_to_remove = np.clip(fraction_to_remove, 0.05, 0.90)

    fracture_mask = best_mask

    # --- Compound fractures: additional non-parallel cuts ---
    # More cuts at lower completeness targets to create natural rock-chunk
    # shapes instead of thin slices. High completeness = mostly single cuts.
    #   target >= 0.75: 30% chance of 2nd cut
    #   target 0.50-0.75: 60% chance of 2nd cut, 20% chance of 3rd
    #   target < 0.50: 80% chance of 2nd cut, 45% chance of 3rd
    ORIENTATION_GROUPS = {
        'horizontal': ['root_loss', 'tip_loss'],
        'vertical': ['lateral_break', 'transverse_snap'],
        'diagonal': ['diagonal_snap', 'oblique_front', 'edge_chip'],
    }

    if target_completeness >= 0.75:
        max_extra_cuts = 1
        cut_chances = [0.30]
    elif target_completeness >= 0.50:
        max_extra_cuts = 2
        cut_chances = [0.60, 0.20]
    else:
        max_extra_cuts = 2
        cut_chances = [0.80, 0.45]

    used_groups = set()
    for group_name, group_types in ORIENTATION_GROUPS.items():
        if fracture_type in group_types:
            used_groups.add(group_name)
            break

    for cut_i in range(max_extra_cuts):
        if np.random.random() >= cut_chances[cut_i]:
            break

        # Pick from an orientation group not yet used
        other_types = []
        for group_name, group_types in ORIENTATION_GROUPS.items():
            if group_name not in used_groups:
                for t in group_types:
                    if t in FRACTURE_FUNCTIONS and species_weights.get(t, 0) > 0:
                        other_types.append((t, group_name))

        if not other_types:
            break

        second_type, second_group = other_types[np.random.randint(len(other_types))]
        used_groups.add(second_group)
        second_func = FRACTURE_FUNCTIONS[second_type]
        second_fraction = np.random.uniform(0.15, 0.45)
        second_mask = second_func(mask, second_fraction, effective_edge_params)
        fracture_mask = (fracture_mask.astype(bool) & second_mask.astype(bool)).astype(np.uint8)

    # Dentine exposure: aligned with fracture direction changes.
    # When the crack changes angle, one segment may face the camera (dentine
    # visible) while the next segment faces away (no dentine).
    p_no_dentine = effective_edge_params.get('dentine_hidden_prob', 0.20)
    p_full_dentine = effective_edge_params.get('dentine_full_prob', 0.15)

    roll = np.random.random()
    if roll < p_no_dentine:
        dentine_range = None
    elif roll < p_no_dentine + p_full_dentine:
        dentine_range = (0.0, 1.0)
    else:
        # Pick a random contiguous segment (25-65% of the fracture length)
        seg_length = np.random.uniform(0.25, 0.65)
        seg_start = np.random.uniform(0.0, 1.0 - seg_length)
        dentine_range = (seg_start, seg_start + seg_length)
    effective_edge_params['dentine_range'] = dentine_range

    return fracture_mask, effective_edge_params


def _compute_dentine_color(img_array, tooth_mask, keep_mask=None, edge_params=None):
    """
    Compute dentine base color using one of two modes (from edge_params):

    1. "manual" — use dentine_color_min/max RGB range from the profile.
       A random color within the range is picked.
    2. "auto" (default) — sample the darker side of the tooth surface
       and lighten by dentine_clarity_pct (0-100%). This matches the
       tooth's own coloring automatically.

    The returned base color is then used with the existing multi-scale
    texture system (grain, patches, color variation) which stays unchanged.
    """
    if edge_params is None:
        edge_params = {}

    dentine_mode = edge_params.get('dentine_color_mode', 'auto')

    if dentine_mode == 'manual':
        # Manual RGB range from profile
        color_min = np.array(edge_params.get('dentine_color_min', [140, 130, 110]), dtype=np.float32)
        color_max = np.array(edge_params.get('dentine_color_max', [200, 190, 170]), dtype=np.float32)
        base = np.array([
            np.random.uniform(color_min[0], color_max[0]),
            np.random.uniform(color_min[1], color_max[1]),
            np.random.uniform(color_min[2], color_max[2]),
        ], dtype=np.float32)
        variation = np.random.uniform(-5, 5, 3)
        return np.clip(base + variation, 0, 255).astype(np.float32)

    # Auto mode: sample the darker areas of the tooth + clarity boost
    clarity_pct = edge_params.get('dentine_clarity_pct', 15)  # % to lighten

    h, w = tooth_mask.shape
    tooth_pixels = img_array[tooth_mask.astype(bool)]
    if len(tooth_pixels) == 0:
        return np.array([180, 170, 155], dtype=np.float32)

    # Compute per-pixel brightness and find the darker 30%
    brightness = np.mean(tooth_pixels, axis=1)
    dark_threshold = np.percentile(brightness, 30)
    dark_mask_idx = brightness <= dark_threshold

    if np.sum(dark_mask_idx) > 10:
        dark_color = np.median(tooth_pixels[dark_mask_idx], axis=0)
    else:
        dark_color = np.median(tooth_pixels, axis=0)

    # Lighten by clarity percentage: move toward white by that %
    clarity_factor = clarity_pct / 100.0
    base = dark_color + (255.0 - dark_color) * clarity_factor

    variation = np.random.uniform(-8, 8, 3)
    return np.clip(base + variation, 0, 255).astype(np.float32)


def apply_fracture(image_path, tooth_mask, fracture_mask, edge_params=None,
                   background_color=(255, 255, 255)):
    """
    Apply fracture mask with visible cross-section fill.

    When a tooth breaks, the fracture reveals the internal material (dentine).
    This function:
    1. Keeps the surviving fragment
    2. Fills the REMOVED side of the fracture with dentine color (the visible
       cross-section of the broken tooth, as seen from the photography angle)
    3. Adds a thin dark shadow line at the actual fracture boundary

    The dentine fill width varies — thicker in the center of the tooth
    (where it's physically thicker), thinner at the edges.

    Args:
        image_path: Path to the original image.
        tooth_mask: Binary tooth segmentation mask.
        fracture_mask: Binary fracture mask (1=keep, 0=remove).
        edge_params: Edge parameters including edge_3d_width.
        background_color: RGB background color tuple.

    Returns:
        PIL Image of the fractured tooth.
    """
    if edge_params is None:
        edge_params = {'edge_3d_width': 20}

    # Step 1: Sanitize onto clean background
    clean_img = sanitize_tooth_image(image_path, background_color=background_color)
    img_array = np.array(clean_img).astype(np.float32)
    h, w = tooth_mask.shape

    # Step 2: Compute keep mask and remove disconnected fragments
    keep_mask = tooth_mask.astype(bool) & fracture_mask.astype(bool)
    keep_mask = _keep_largest_fragment(keep_mask.astype(np.uint8)).astype(bool)

    # Dentine exposure range: None = no dentine, (0,1) = full, (start, end) = partial
    dentine_range = edge_params.get('dentine_range', (0.0, 1.0))

    # Step 3: Compute dentine color (lighter than tooth surface)
    dentine_base = _compute_dentine_color(img_array, tooth_mask, keep_mask, edge_params)

    removed = tooth_mask.astype(bool) & ~keep_mask
    edge_width = edge_params.get('edge_3d_width', 20)
    effective_fill = np.zeros((h, w), dtype=np.float32)  # initialized for scope

    # Build dentine width profile along the fracture boundary.
    # Instead of a rectangular band, the dentine width varies smoothly
    # using a 1D random profile mapped onto the 2D fracture edge.
    # This creates organic shapes — wide in some sections, tapering to
    # zero at the ends — no 90-degree corners.
    show_dentine = dentine_range is not None

    if show_dentine:
        # Step 4: Fill the REMOVED side of the fracture with dentine
        if np.any(removed) and np.any(keep_mask):
            dist_from_kept = ndimage.distance_transform_edt(~keep_mask)

            # Uniform dentine width: use distance from the fracture edge only.
            # No thickness_factor (was creating finger-like vertical protrusions
            # by following the tooth's internal shape).
            # Width varies smoothly along the fracture via 1D profile.
            rmin_t = np.where(tooth_mask)[0].min()
            rmax_t = np.where(tooth_mask)[0].max()
            cmin_t = np.where(tooth_mask)[1].min()
            cmax_t = np.where(tooth_mask)[1].max()
            if (cmax_t - cmin_t) >= (rmax_t - rmin_t):
                progress_1d = (np.arange(w) - cmin_t) / max(cmax_t - cmin_t, 1)
                progress_map = np.broadcast_to(progress_1d[np.newaxis, :], (h, w))
                profile_len = w
            else:
                progress_1d = (np.arange(h) - rmin_t) / max(rmax_t - rmin_t, 1)
                progress_map = np.broadcast_to(progress_1d[:, np.newaxis], (h, w))
                profile_len = h

            # Generate a 1D width profile: 0 = no dentine, 1 = full width.
            dr_start, dr_end = dentine_range
            width_profile_1d = np.zeros(profile_len, dtype=np.float32)
            i_start = int(dr_start * profile_len)
            i_end = int(dr_end * profile_len)
            active_len = max(i_end - i_start, 5)
            active_profile = _midpoint_displacement_1d(active_len, 0.3, np.random)
            ap_min, ap_max = active_profile.min(), active_profile.max()
            if ap_max > ap_min:
                active_profile = (active_profile - ap_min) / (ap_max - ap_min)
            else:
                active_profile = np.ones(active_len)
            # Taper at both ends
            taper_len = max(active_len // 5, 3)
            active_profile[:taper_len] *= np.linspace(0, 1, taper_len) ** 1.5
            active_profile[-taper_len:] *= np.linspace(1, 0, taper_len) ** 1.5
            width_profile_1d[i_start:i_start + active_len] = active_profile[:min(active_len, profile_len - i_start)]

            # Map 1D profile onto 2D
            profile_indices = np.clip((progress_map * (profile_len - 1)).astype(int), 0, profile_len - 1)
            width_mult_2d = width_profile_1d[profile_indices]

            # Effective fill: simple edge_width * profile, no tooth-shape factor
            # Small smooth noise for organic variation, hard-capped to prevent drips
            width_noise = np.random.randn(h, w).astype(np.float32) * 0.15
            width_noise = ndimage.gaussian_filter(width_noise, sigma=12)
            effective_fill = edge_width * (1.0 + width_noise) * np.maximum(width_mult_2d, 0.0)
            effective_fill = np.clip(effective_fill, 0, edge_width * 2.0)

            # Dentine zone: removed pixels within the variable-width fill
            dentine_zone = removed & (dist_from_kept <= effective_fill) & (effective_fill > 1.0)

            if np.any(dentine_zone):
                # Normalized distance: 0 at fracture edge, 1 at outer boundary
                normalized_dist = np.zeros((h, w), dtype=np.float32)
                normalized_dist[dentine_zone] = np.clip(
                    dist_from_kept[dentine_zone] / np.maximum(effective_fill[dentine_zone], 1),
                    0, 1
                )

                # Heavy rock/mineral texture — broken rock surface with shadows
                # Coarse chunks: large irregular brightness patches
                rock_coarse = np.random.randn(h, w).astype(np.float32) * 22
                rock_coarse = ndimage.gaussian_filter(rock_coarse, sigma=2)

                # Thick grain: visible granular surface
                rock_grain = np.random.randn(h, w).astype(np.float32) * 14
                rock_grain = ndimage.gaussian_filter(rock_grain, sigma=0.7)

                # Irregular dark patches (mineralized spots, not directional lines)
                dark_spots = np.random.randn(h, w).astype(np.float32) * 12
                dark_spots = ndimage.gaussian_filter(dark_spots, sigma=3)
                dark_spots = np.clip(dark_spots, -25, 5)  # mostly darkening

                # Non-directional texture variation (random sigma per axis)
                sig_r = np.random.uniform(1.5, 4.0)
                sig_c = np.random.uniform(1.5, 4.0)
                streaks = np.random.randn(h, w).astype(np.float32) * 8
                streaks = ndimage.gaussian_filter(streaks, sigma=[sig_r, sig_c])

                # Per-channel color zones (warm/cool areas)
                color_var = np.zeros((h, w, 3), dtype=np.float32)
                for ci in range(3):
                    cv = np.random.randn(h, w).astype(np.float32) * 8
                    cv = ndimage.gaussian_filter(cv, sigma=5)
                    color_var[:, :, ci] = cv

                # Edge color: darker variant (mineralized surface)
                edge_darken = edge_params.get('dentine_edge_darken_pct', 20) / 100.0
                dentine_edge = dentine_base * (1.0 - edge_darken)

                # Color transition base → edge with irregular boundary
                transition_noise = np.random.randn(h, w).astype(np.float32) * 0.12
                transition_noise = ndimage.gaussian_filter(transition_noise, sigma=4)
                color_t = np.clip(normalized_dist + transition_noise, 0, 1)

                combined_texture = rock_coarse + rock_grain + streaks + dark_spots
                dentine_fill = np.zeros_like(img_array)
                for ci in range(3):
                    base_val = dentine_base[ci] + combined_texture + color_var[:, :, ci]
                    edge_val = dentine_edge[ci] + combined_texture * 0.7 + color_var[:, :, ci] * 0.6
                    dentine_fill[:, :, ci] = base_val * (1 - color_t) + edge_val * color_t
                dentine_fill = np.clip(dentine_fill, 0, 255)

                # Fully opaque — hard edge, no anti-alias fade
                img_array[dentine_zone] = dentine_fill[dentine_zone]

        # Step 5: Also paint dentine on the KEPT side (inner surface near fracture)
        if np.any(removed) and np.any(keep_mask):
            dist_to_removed = ndimage.distance_transform_edt(~removed)
            has_dentine_nearby = effective_fill > 1.0
            inner_band = keep_mask & (dist_to_removed > 0) & (dist_to_removed <= max(edge_width // 3, 4)) & has_dentine_nearby
            if np.any(inner_band):
                inner_blend = 1.0 - np.clip(dist_to_removed[inner_band] / max(edge_width // 3, 4), 0, 1) ** 0.5
                grain_inner = np.random.randn(np.sum(inner_band)).astype(np.float32) * 6
                for c in range(3):
                    ch = img_array[:, :, c]
                    ch[inner_band] = ch[inner_band] * (1 - inner_blend) + (dentine_base[c] + grain_inner) * inner_blend
                    img_array[:, :, c] = ch

    # Step 6: Very subtle edge darkening at the fracture boundary.
    # Real broken teeth have no visible line — just a slight shadow where
    # the edge catches less light. Varies along the fracture.
    if np.any(removed) and np.any(keep_mask):
        dist_to_removed2 = ndimage.distance_transform_edt(~removed)
        shadow = keep_mask & (dist_to_removed2 > 0) & (dist_to_removed2 <= 1.5)
        if np.any(shadow):
            # Vary opacity along the edge (some parts darker, some barely visible)
            shadow_noise = np.random.uniform(0.85, 0.97, size=np.sum(shadow)).astype(np.float32)
            img_array[shadow] *= shadow_noise[:, np.newaxis]

    # Step 7: Composite — include kept fragment (and dentine fill where visible)
    visible_mask = keep_mask.copy()
    if show_dentine and np.any(removed) and np.any(keep_mask):
        # Reuse the same effective_fill from Step 4 for consistency
        dist_from_kept_final = ndimage.distance_transform_edt(~keep_mask)
        dentine_visible = removed & (dist_from_kept_final <= effective_fill) & (effective_fill > 1.0)
        visible_mask = visible_mask | dentine_visible

    # Feather only the outer boundary (tooth edge against background)
    visible_alpha = visible_mask.astype(np.float32)
    visible_alpha = ndimage.gaussian_filter(visible_alpha, sigma=1.0)
    visible_alpha = np.clip(visible_alpha * 2, 0.0, 1.0)

    # Output RGBA with transparency so synthetic images match the original
    # PNG format. This prevents the model from learning background differences.
    alpha_channel = (visible_alpha * 255).astype(np.uint8)
    rgb = np.clip(img_array, 0, 255).astype(np.uint8)
    rgba = np.dstack([rgb, alpha_channel])

    return PILImage.fromarray(rgba, mode='RGBA')


def _has_white_spot_anomaly(result_img, fragment_mask, white_threshold=240,
                            min_spot_pixels=50):
    """
    Detect white/bright spots inside the fragment that indicate background
    bleeding through or rendering artifacts.

    Scans the fragment area for clusters of near-white pixels. A real tooth
    fragment should not have large bright white patches inside it.

    Args:
        result_img: PIL RGBA image.
        fragment_mask: Binary mask of the fragment area.
        white_threshold: Brightness above which a pixel is considered "white".
        min_spot_pixels: Minimum cluster size to flag as anomaly.

    Returns:
        True if anomaly detected, False if clean.
    """
    img_array = np.array(result_img)
    if img_array.shape[2] == 4:
        rgb = img_array[:, :, :3]
    else:
        rgb = img_array

    # Check brightness within the fragment
    brightness = np.mean(rgb, axis=2)
    white_inside = fragment_mask.astype(bool) & (brightness > white_threshold)

    if np.sum(white_inside) < min_spot_pixels:
        return False

    # Check if the white pixels form a cluster (not scattered noise)
    labeled, num = ndimage.label(white_inside)
    if num == 0:
        return False

    sizes = ndimage.sum(white_inside, labeled, range(1, num + 1))
    max_cluster = np.max(sizes)
    return max_cluster >= min_spot_pixels


def generate_synthetic_fragment(image_path, target_completeness, reference_area=None,
                                species=None, profile_override=None):
    """
    Generate a synthetic fragment from a complete tooth image.

    Args:
        image_path: Path to the complete tooth image.
        target_completeness: Desired completeness (0.0 to 1.0).
        reference_area: Optional reference area for completeness verification.
        species: Species name for loading fracture profile.
        profile_override: Optional dict to override profile settings.

    Returns:
        Tuple of (PIL Image, actual_completeness float).
    """
    tooth_mask = segment_tooth(image_path)
    original_area = compute_tooth_area(tooth_mask)

    if original_area == 0:
        raise ValueError(f"No tooth detected in {image_path}")

    # Load species profile
    profile = get_species_profile(species) if species else get_species_profile('default')
    if profile_override:
        if 'fracture_types' in profile_override:
            profile['fracture_types'] = profile_override['fracture_types']
        if 'edge_params' in profile_override:
            profile['edge_params'] = {**profile['edge_params'], **profile_override['edge_params']}

    # Generate fracture with shape validation — retry if impossible shape.
    # Cycle through different fracture types to ensure variety.
    max_shape_attempts = 15
    result_img = None
    actual_completeness = 0.0

    # Build a shuffled list of fracture types to try, weighted by profile
    available_types = [t for t, w in profile['fracture_types'].items()
                       if w > 0 and t in FRACTURE_FUNCTIONS]
    if not available_types:
        available_types = list(FRACTURE_FUNCTIONS.keys())
    np.random.shuffle(available_types)

    for _attempt in range(max_shape_attempts):
        # Cycle through types so we don't keep trying the same one
        force_type = available_types[_attempt % len(available_types)]

        fracture_mask, effective_edge_params = generate_fracture_mask(
            tooth_mask, target_completeness,
            species_weights=profile['fracture_types'],
            edge_params=profile['edge_params'],
            force_type=force_type,
        )

        # Clean the fragment: remove thin protrusions, fill internal holes,
        # keep only the largest solid piece.
        raw_fragment = (tooth_mask & fracture_mask).astype(np.uint8)
        raw_fragment = _keep_largest_fragment(raw_fragment)

        # Light morphological opening: erode 2px then dilate 2px.
        # This clips thin pointed extensions that couldn't survive
        # fossilization, without destroying the overall shape.
        cleaned = ndimage.binary_opening(raw_fragment, iterations=2)
        cleaned = ndimage.binary_fill_holes(cleaned)
        cleaned = _keep_largest_fragment(cleaned.astype(np.uint8))
        cleaned = ndimage.binary_fill_holes(cleaned).astype(np.uint8)

        # Update fracture_mask so apply_fracture uses the cleaned shape
        fracture_mask = np.where(tooth_mask, cleaned, 0).astype(np.uint8)
        result_mask = cleaned

        if not _validate_fragment_shape(result_mask):
            continue

        # Generate the image and check for anomalies (white spots, etc.)
        result_img = apply_fracture(
            image_path, tooth_mask, fracture_mask,
            edge_params=effective_edge_params,
        )

        # Anomaly check: detect white/bright spots inside the fragment
        # that indicate background bleeding through
        if _has_white_spot_anomaly(result_img, result_mask):
            result_img = None
            continue

        result_area = compute_tooth_area(result_mask)
        ref = reference_area or original_area
        actual_completeness = compute_completeness(result_area, ref)
        break

    # If all attempts fail, use the last generated image
    if result_img is None:
        fracture_mask = np.where(tooth_mask, cleaned, 0).astype(np.uint8)
        result_img = apply_fracture(
            image_path, tooth_mask, fracture_mask,
            edge_params=effective_edge_params,
        )
        result_area = compute_tooth_area(result_mask)
        ref = reference_area or original_area
        actual_completeness = compute_completeness(result_area, ref)

    return result_img, actual_completeness

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

def _generate_fracture_noise(length, roughness=0.6, micro_roughness=0.4, seed=None):
    """
    Generate realistic tooth fracture displacement based on how real teeth break.

    Real tooth fractures show:
    - Conchoidal steps: sudden shelves where enamel flakes at different depths
    - Asymmetric scallops: uneven curved sections following crystal boundaries
    - Direction changes: the crack shifts direction 2-4 times as it crosses
      material layers (enameloid -> dentine -> osteodentine)
    - Sharp notches: where the crack path jumps between layers

    The result should look organic and irregular — not smooth, not zigzag.

    Args:
        length: Number of points along the fracture line.
        roughness: Overall amplitude (0=flat, 1=very irregular).
        micro_roughness: Fine detail intensity.
        seed: Optional random seed.

    Returns:
        1D array of displacement values (perpendicular to fracture line).
    """
    if seed is not None:
        rng = np.random.RandomState(seed)
    else:
        rng = np.random

    displacement = np.zeros(length)

    # Layer 1: Direction changes — crack shifts direction frequently.
    # No segment should be straight for more than ~25% of the total length.
    # Longer fractures get more direction changes (3-6 for typical lengths).
    min_segments = max(3, length // 40)
    max_segments = max(min_segments + 1, length // 20)
    n_segments = rng.randint(min_segments, max_segments + 1)
    margin = max(length // 15, 3)
    breakpoints = sorted(rng.randint(margin, max(length - margin, margin + 1),
                                      size=max(n_segments - 1, 1)))
    breakpoints = [0] + list(breakpoints) + [length]
    # Ensure no segment exceeds 25% of total length — split any that do
    refined = [0]
    for i in range(len(breakpoints) - 1):
        seg_start = breakpoints[i]
        seg_end = breakpoints[i + 1]
        max_seg = max(length // 4, 10)
        while seg_end - seg_start > max_seg:
            split = seg_start + rng.randint(max_seg // 3, max_seg)
            refined.append(min(split, seg_end - 5))
            seg_start = refined[-1]
        refined.append(seg_end)
    breakpoints = refined
    n_segments = len(breakpoints) - 1
    # Alternate slope directions for more visible changes, with random amplitude
    segment_slopes = np.zeros(n_segments)
    for i in range(n_segments):
        base_dir = 1.0 if i % 2 == 0 else -1.0
        segment_slopes[i] = base_dir * rng.uniform(0.5, 2.0) * roughness * 15.0
        # Randomly flip some to avoid predictable alternation
        if rng.random() < 0.3:
            segment_slopes[i] *= -1

    piecewise = np.zeros(length)
    offset = 0.0
    for seg_i in range(min(n_segments, len(breakpoints) - 1)):
        start = breakpoints[seg_i]
        end = breakpoints[seg_i + 1]
        seg_len = end - start
        if seg_len <= 0:
            continue
        t = np.linspace(0, 1, seg_len)
        piecewise[start:end] = offset + t * segment_slopes[seg_i]
        offset = piecewise[end - 1]

    # Smooth transitions (not sharp corners, but not overly smooth)
    transition_sigma = max(length // 25, 3)
    piecewise = ndimage.gaussian_filter1d(piecewise, sigma=transition_sigma)
    displacement += piecewise

    # Layer 2: Conchoidal scallops — asymmetric curved sections
    # These are wider than bumps, with steep rise and gradual fall (or vice versa)
    n_scallops = rng.randint(3, max(7, length // 30))
    for _ in range(n_scallops):
        center = rng.randint(0, length)
        width = rng.randint(max(length // 20, 5), max(length // 6, 10))
        amplitude = rng.uniform(0.5, 1.5) * roughness * 8.0 * rng.choice([-1, 1])
        # Asymmetric: steep on one side, gradual on other
        steepness = rng.uniform(0.2, 0.8)
        for j in range(length):
            d = (j - center) / max(width, 1)
            if -1 < d < 0:
                displacement[j] += amplitude * (1 - abs(d / steepness) ** 2) * max(0, 1 + d)
            elif 0 <= d < 1:
                displacement[j] += amplitude * (1 - abs(d / (1 - steepness)) ** 2) * max(0, 1 - d)

    # Layer 3: Sharp notches — sudden local dips where crack jumps layers
    n_notches = rng.randint(1, max(4, length // 50))
    for _ in range(n_notches):
        pos = rng.randint(0, length)
        notch_width = rng.randint(3, max(8, length // 40))
        notch_depth = rng.uniform(3, 8) * roughness * rng.choice([-1, 1])
        start = max(0, pos - notch_width // 2)
        end = min(length, pos + notch_width // 2)
        window = np.hanning(end - start)
        displacement[start:end] += notch_depth * window

    # Layer 4: Medium-frequency irregularity (material grain)
    n_bumps = max(8, length // 8)
    bumps = rng.randn(n_bumps)
    bumps_interp = np.interp(
        np.linspace(0, 1, length),
        np.linspace(0, 1, n_bumps),
        bumps
    )
    if length > 10:
        k2 = max(length // 30, 3)
        bumps_interp = np.convolve(bumps_interp, np.ones(k2) / k2, mode='same')
    displacement += bumps_interp * roughness * 6.0

    # Layer 5: Fine micro-texture (surface roughness of broken material)
    micro = rng.randn(length) * micro_roughness * 2.0
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
                            min_angle_change=10, max_angle_change=110):
    """
    Generate a fracture path as a multi-segment walk with real direction changes.

    Instead of a straight line with perpendicular noise, this builds the path
    as a sequence of segments where each segment has its own direction. The
    crack changes angle 2-4 times along its length, simulating how real
    fractures change direction when crossing material boundaries.

    Args:
        start: (row, col) start point.
        end: (row, col) end point.
        n_points: Total number of points to generate.
        roughness: Controls amplitude of local noise on each segment.
        micro_roughness: Fine-scale surface roughness.
        min_angle_change: Minimum direction change in degrees at each turn.
        max_angle_change: Maximum direction change in degrees at each turn.

    Returns:
        Nx2 array of (row, col) points.
    """
    start = np.array(start, dtype=float)
    end = np.array(end, dtype=float)
    total_dist = np.linalg.norm(end - start)
    if total_dist < 5:
        t = np.linspace(0, 1, n_points)
        return np.column_stack([
            start[0] + t * (end[0] - start[0]),
            start[1] + t * (end[1] - start[1]),
        ])

    # Number of direction changes: 2-4 for most fractures
    n_turns = np.random.randint(2, 5)

    # Generate waypoints: the crack goes through these turning points
    # Each segment covers 15-45% of the remaining distance
    waypoints = [start]
    current = start.copy()
    remaining_dist = total_dist

    for i in range(n_turns):
        if remaining_dist < 10:
            break
        # This segment covers a random fraction of remaining distance
        seg_frac = np.random.uniform(0.15, 0.45)
        seg_dist = remaining_dist * seg_frac

        # Direction: starts pointing toward end, but changes angle
        to_end = end - current
        base_angle = np.arctan2(to_end[0], to_end[1])

        # Random angle deviation
        angle_change = np.random.uniform(min_angle_change, max_angle_change)
        angle_change = np.radians(angle_change) * np.random.choice([-1, 1])
        new_angle = base_angle + angle_change

        # New waypoint
        waypoint = current + seg_dist * np.array([np.sin(new_angle), np.cos(new_angle)])
        waypoints.append(waypoint)
        current = waypoint
        remaining_dist = np.linalg.norm(end - current)

    waypoints.append(end)

    # Interpolate smooth path through waypoints using cubic-like interpolation
    # First, compute cumulative distances for parameterization
    waypoints = np.array(waypoints)
    dists = np.cumsum(np.r_[0, np.linalg.norm(np.diff(waypoints, axis=0), axis=1)])
    dists /= dists[-1]  # normalize to [0, 1]

    t = np.linspace(0, 1, n_points)
    rows = np.interp(t, dists, waypoints[:, 0])
    cols = np.interp(t, dists, waypoints[:, 1])

    # Smooth the transitions so turns are not sharp corners
    sigma = max(n_points // 20, 3)
    rows = ndimage.gaussian_filter1d(rows, sigma=sigma)
    cols = ndimage.gaussian_filter1d(cols, sigma=sigma)

    # Add local fracture noise perpendicular to each segment
    noise = _generate_fracture_noise(n_points, roughness=roughness,
                                      micro_roughness=micro_roughness)

    # Compute local perpendicular direction at each point
    dr = np.gradient(rows)
    dc = np.gradient(cols)
    length_local = np.sqrt(dr ** 2 + dc ** 2) + 1e-8
    perp_r = -dc / length_local
    perp_c = dr / length_local

    rows += noise * perp_r
    cols += noise * perp_c

    return np.column_stack([rows, cols]), dists[1:-1].tolist()


# ---------------------------------------------------------------------------
# Fracture line rasterization
# ---------------------------------------------------------------------------

def _rasterize_fracture_line(points, mask_shape, keep_side='above'):
    """
    Rasterize a fracture line into a binary mask.

    Args:
        points: Nx2 array of (row, col) points defining the fracture line.
        mask_shape: (height, width) of the output mask.
        keep_side: 'above', 'below', 'left', 'right' — which side to keep.

    Returns:
        Binary mask (1 = keep, 0 = remove).
    """
    h, w = mask_shape
    fracture = np.ones((h, w), dtype=np.uint8)

    if len(points) < 2:
        return fracture

    if keep_side in ('above', 'below'):
        # For each column in the fracture line, find the row threshold
        # Interpolate the fracture line to cover all columns
        cols = points[:, 1]
        rows = points[:, 0]

        # Sort by column for interpolation
        sort_idx = np.argsort(cols)
        cols_sorted = cols[sort_idx]
        rows_sorted = rows[sort_idx]

        # Remove duplicate columns
        _, unique_idx = np.unique(cols_sorted, return_index=True)
        cols_unique = cols_sorted[unique_idx]
        rows_unique = rows_sorted[unique_idx]

        if len(cols_unique) < 2:
            return fracture

        # Interpolate to all integer columns
        col_range = np.arange(max(0, int(cols_unique[0])), min(w, int(cols_unique[-1]) + 1))
        row_interp = np.interp(col_range, cols_unique, rows_unique)

        for c, r in zip(col_range, row_interp):
            r_int = int(np.clip(r, 0, h - 1))
            c_int = int(np.clip(c, 0, w - 1))
            if keep_side == 'above':
                fracture[r_int:, c_int] = 0
            else:
                fracture[:r_int, c_int] = 0

    elif keep_side in ('left', 'right'):
        # For each row in the fracture line, find the column threshold
        rows = points[:, 0]
        cols = points[:, 1]

        sort_idx = np.argsort(rows)
        rows_sorted = rows[sort_idx]
        cols_sorted = cols[sort_idx]

        _, unique_idx = np.unique(rows_sorted, return_index=True)
        rows_unique = rows_sorted[unique_idx]
        cols_unique = cols_sorted[unique_idx]

        if len(rows_unique) < 2:
            return fracture

        row_range = np.arange(max(0, int(rows_unique[0])), min(h, int(rows_unique[-1]) + 1))
        col_interp = np.interp(row_range, rows_unique, cols_unique)

        for r, c in zip(row_range, col_interp):
            r_int = int(np.clip(r, 0, h - 1))
            c_int = int(np.clip(c, 0, w - 1))
            if keep_side == 'left':
                fracture[r_int, c_int:] = 0
            else:
                fracture[r_int, :c_int] = 0

    return fracture


# ---------------------------------------------------------------------------
# Fracture type implementations
# ---------------------------------------------------------------------------

def _fracture_root_loss(mask, fraction, edge_params):
    """Break at/near root-crown junction, losing the root."""
    rmin, rmax, cmin, cmax = _get_tooth_bbox(mask)
    h, w = mask.shape
    height = rmax - rmin

    cut_row = int(rmax - height * fraction)
    cut_row = np.clip(cut_row, rmin + 5, rmax - 5)

    n_points = max((cmax - cmin) + 20, 50)
    start = (cut_row, cmin - 10)
    end = (cut_row, cmax + 10)

    points, _ = _generate_fracture_path(
        start, end, n_points,
        roughness=edge_params.get('roughness', 0.6) * 0.7,
        micro_roughness=edge_params.get('micro_roughness', 0.4) * 0.6,
    )
    return _rasterize_fracture_line(points, mask.shape, keep_side='above')


def _fracture_tip_loss(mask, fraction, edge_params):
    """Break losing the crown apex/tip. More irregular than root breaks."""
    rmin, rmax, cmin, cmax = _get_tooth_bbox(mask)
    h, w = mask.shape
    height = rmax - rmin

    cut_row = int(rmin + height * fraction)
    cut_row = np.clip(cut_row, rmin + 5, rmax - 5)

    n_points = max((cmax - cmin) + 20, 50)
    start = (cut_row, cmin - 10)
    end = (cut_row, cmax + 10)

    points, _ = _generate_fracture_path(
        start, end, n_points,
        roughness=edge_params.get('roughness', 0.6) * 1.3,
        micro_roughness=edge_params.get('micro_roughness', 0.4) * 1.2,
    )
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

    angle = np.random.uniform(0.05, 0.25) * np.random.choice([-1, 1])
    start_col = cut_col + int(angle * height * -0.5)
    end_col = cut_col + int(angle * height * 0.5)

    n_points = max(height + 20, 50)
    start = (rmin - 10, start_col)
    end = (rmax + 10, end_col)

    points, _ = _generate_fracture_path(
        start, end, n_points,
        roughness=edge_params.get('roughness', 0.6) * 1.4,
        micro_roughness=edge_params.get('micro_roughness', 0.4) * 1.3,
    )
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
    start = (center_row - half_diag * np.sin(angle_rad),
             center_col - half_diag * np.cos(angle_rad))
    end = (center_row + half_diag * np.sin(angle_rad),
           center_col + half_diag * np.cos(angle_rad))

    n_points = max(int(2 * half_diag), 80)
    points, _ = _generate_fracture_path(
        start, end, n_points,
        roughness=edge_params.get('roughness', 0.6),
        micro_roughness=edge_params.get('micro_roughness', 0.4),
    )

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

    angle = np.random.uniform(-0.12, 0.12)
    start_col = cut_col + int(angle * height * -0.5)
    end_col = cut_col + int(angle * height * 0.5)

    n_points = max(height + 20, 50)
    start = (rmin - 10, start_col)
    end = (rmax + 10, end_col)

    points, _ = _generate_fracture_path(
        start, end, n_points,
        roughness=edge_params.get('roughness', 0.6),
        micro_roughness=edge_params.get('micro_roughness', 0.4),
    )
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
    start = (center_row - half_diag * np.sin(angle_rad),
             center_col - half_diag * np.cos(angle_rad))
    end = (center_row + half_diag * np.sin(angle_rad),
           center_col + half_diag * np.cos(angle_rad))

    n_points = max(int(2 * half_diag), 80)
    points, _ = _generate_fracture_path(
        start, end, n_points,
        roughness=edge_params.get('roughness', 0.6) * 1.2,
        micro_roughness=edge_params.get('micro_roughness', 0.4),
    )

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

def generate_fracture_mask(mask, target_completeness, species_weights=None, edge_params=None):
    """
    Generate a fracture mask with realistic jagged edges.

    Args:
        mask: Binary tooth segmentation mask.
        target_completeness: Desired completeness (0.0 to 1.0).
        species_weights: Dict of {fracture_type: probability}.
        edge_params: Dict of edge roughness parameters.

    Returns:
        Binary fracture mask (1 = keep, 0 = remove).
    """
    if species_weights is None:
        species_weights = {
            'root_loss': 0.15, 'tip_loss': 0.10, 'lateral_break': 0.15,
            'edge_chip': 0.05, 'diagonal_snap': 0.15,
            'transverse_snap': 0.20, 'oblique_front': 0.20,
        }
    if edge_params is None:
        edge_params = {'roughness': 0.6, 'micro_roughness': 0.4, 'curvature': 0.3,
                       'edge_3d_width': 4}

    # Select fracture type based on weights
    types = list(species_weights.keys())
    probs = np.array([species_weights.get(t, 0) for t in types], dtype=float)
    if probs.sum() == 0:
        probs = np.ones(len(types))
    probs = probs / probs.sum()
    fracture_type = np.random.choice(types, p=probs)

    # Vary dentine exposure by fracture type: transverse/oblique cuts through
    # the thickest part of the tooth expose more internal structure
    dentine_width_multiplier = {
        'transverse_snap': 2.5,
        'oblique_front': 2.0,
        'lateral_break': 1.5,
        'diagonal_snap': 1.3,
    }
    effective_edge_params = dict(edge_params)  # copy to avoid mutating original
    if fracture_type in dentine_width_multiplier:
        base_width = effective_edge_params.get('edge_3d_width', 20)
        effective_edge_params['edge_3d_width'] = int(base_width * dentine_width_multiplier[fracture_type])

    fraction_to_remove = 1.0 - target_completeness

    func = FRACTURE_FUNCTIONS.get(fracture_type, _fracture_tip_loss)
    fracture_mask = func(mask, fraction_to_remove, effective_edge_params)

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


def _compute_dentine_color(img_array, tooth_mask, keep_mask=None):
    """
    Compute dentine color by sampling the ROOT area of the tooth.

    Fossil teeth have mineralized dentine that matches the root color,
    not fresh beige. The root is typically at the top of the image
    (opposite the tip/apex). We sample from the upper portion of the
    tooth to get the natural root/dentine color.
    """
    h, w = tooth_mask.shape
    tooth_rows = np.where(np.any(tooth_mask, axis=1))[0]
    if len(tooth_rows) == 0:
        return np.array([180, 170, 155], dtype=np.float32)

    rmin, rmax = tooth_rows[0], tooth_rows[-1]
    tooth_height = rmax - rmin

    # Sample from the top 25% of the tooth (root area)
    root_top = rmin
    root_bottom = rmin + int(tooth_height * 0.25)

    root_zone = np.zeros_like(tooth_mask, dtype=bool)
    root_zone[root_top:root_bottom, :] = True
    root_pixels_mask = tooth_mask.astype(bool) & root_zone

    if np.sum(root_pixels_mask) > 20:
        root_color = np.median(img_array[root_pixels_mask], axis=0)
    else:
        # Fallback: use overall tooth color with slight lightening
        tooth_pixels = img_array[tooth_mask.astype(bool)]
        root_color = np.median(tooth_pixels, axis=0) if len(tooth_pixels) > 0 else np.array([180, 170, 155])

    # Small random variation so each fragment is slightly different
    variation = np.random.uniform(-8, 8, 3)
    return np.clip(root_color + variation, 0, 255).astype(np.float32)


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
    dentine_base = _compute_dentine_color(img_array, tooth_mask, keep_mask)

    removed = tooth_mask.astype(bool) & ~keep_mask
    edge_width = edge_params.get('edge_3d_width', 20)

    # Build spatial mask for where dentine is visible along the fracture
    if dentine_range is not None:
        # Compute normalized position along the fracture boundary.
        # Use column position (for horizontal fractures) or row position
        # (for vertical) normalized to [0, 1] across the tooth bbox.
        rmin_t, rmax_t, cmin_t, cmax_t = np.where(tooth_mask)[0].min(), np.where(tooth_mask)[0].max(), \
                                          np.where(tooth_mask)[1].min(), np.where(tooth_mask)[1].max()
        # Use the longer axis for progress direction
        if (cmax_t - cmin_t) >= (rmax_t - rmin_t):
            col_progress = (np.arange(w) - cmin_t) / max(cmax_t - cmin_t, 1)
            progress_map = np.broadcast_to(col_progress[np.newaxis, :], (h, w))
        else:
            row_progress = (np.arange(h) - rmin_t) / max(rmax_t - rmin_t, 1)
            progress_map = np.broadcast_to(row_progress[:, np.newaxis], (h, w))
        dr_start, dr_end = dentine_range
        dentine_spatial = (progress_map >= dr_start) & (progress_map <= dr_end)

        # In the exposed region, allow wider dentine (up to 3x) for dramatic exposure
        exposed_width_mult = np.random.uniform(1.5, 3.0)
    else:
        dentine_spatial = np.zeros((h, w), dtype=bool)
        exposed_width_mult = 1.0

    show_dentine = dentine_range is not None

    if show_dentine:
        # Step 4: Fill the REMOVED side of the fracture with dentine
        # This simulates the visible cross-section of the broken tooth
        if np.any(removed) and np.any(keep_mask):
            dist_from_kept = ndimage.distance_transform_edt(~keep_mask)

            dist_from_bg = ndimage.distance_transform_edt(tooth_mask)
            max_thickness = np.max(dist_from_bg) if np.max(dist_from_bg) > 0 else 1
            thickness_factor = np.clip(dist_from_bg / max_thickness, 0, 1)

            width_noise = np.random.randn(h, w).astype(np.float32) * 0.2
            width_noise = ndimage.gaussian_filter(width_noise, sigma=15)
            # In exposed regions, widen the dentine dramatically
            width_mult = np.where(dentine_spatial, exposed_width_mult, 1.0)
            effective_fill = edge_width * thickness_factor * (1.0 + width_noise) * width_mult
            effective_fill = np.clip(effective_fill, 3, edge_width * 4.0)

            # Only show dentine where the spatial mask allows
            dentine_zone = removed & (dist_from_kept <= effective_fill) & dentine_spatial

            if np.any(dentine_zone):
                grain_fine = np.random.randn(h, w).astype(np.float32) * 6
                grain_fine = ndimage.gaussian_filter(grain_fine, sigma=1.5)

                patches = np.random.randn(h, w).astype(np.float32) * 12
                patches = ndimage.gaussian_filter(patches, sigma=6)

                color_var_r = np.random.randn(h, w).astype(np.float32) * 8
                color_var_r = ndimage.gaussian_filter(color_var_r, sigma=10)
                color_var_g = np.random.randn(h, w).astype(np.float32) * 6
                color_var_g = ndimage.gaussian_filter(color_var_g, sigma=10)

                blend = np.zeros((h, w), dtype=np.float32)
                blend[dentine_zone] = 1.0 - np.clip(
                    dist_from_kept[dentine_zone] / np.maximum(effective_fill[dentine_zone], 1),
                    0, 1
                ) ** 0.6

                dentine_fill = np.zeros_like(img_array)
                dentine_fill[:, :, 0] = dentine_base[0] + grain_fine + patches + color_var_r
                dentine_fill[:, :, 1] = dentine_base[1] + grain_fine + patches + color_var_g
                dentine_fill[:, :, 2] = dentine_base[2] + grain_fine + patches * 0.7
                dentine_fill = np.clip(dentine_fill, 0, 255)

                bg_color = np.full_like(img_array, background_color, dtype=np.float32)
                img_array[dentine_zone] = (
                    dentine_fill[dentine_zone] * blend[dentine_zone, np.newaxis] +
                    bg_color[dentine_zone] * (1 - blend[dentine_zone, np.newaxis])
                )

        # Step 5: Also paint dentine on the KEPT side (inner surface near fracture)
        if np.any(removed) and np.any(keep_mask):
            dist_to_removed = ndimage.distance_transform_edt(~removed)
            inner_band = keep_mask & (dist_to_removed > 0) & (dist_to_removed <= max(edge_width // 3, 4)) & dentine_spatial
            if np.any(inner_band):
                inner_blend = 1.0 - np.clip(dist_to_removed[inner_band] / max(edge_width // 3, 4), 0, 1) ** 0.5
                grain_inner = np.random.randn(np.sum(inner_band)).astype(np.float32) * 6
                for c in range(3):
                    ch = img_array[:, :, c]
                    ch[inner_band] = ch[inner_band] * (1 - inner_blend) + (dentine_base[c] + grain_inner) * inner_blend
                    img_array[:, :, c] = ch

    # Step 6: Dark shadow line at the fracture boundary (always visible)
    if np.any(removed) and np.any(keep_mask):
        dist_to_removed2 = ndimage.distance_transform_edt(~removed)
        shadow = keep_mask & (dist_to_removed2 > 0) & (dist_to_removed2 <= 2.0)
        if np.any(shadow):
            img_array[shadow] *= 0.5

    # Step 7: Composite — include kept fragment (and dentine fill where visible)
    visible_mask = keep_mask.copy()
    if show_dentine and np.any(removed) and np.any(keep_mask):
        dist_from_kept_final = ndimage.distance_transform_edt(~keep_mask)
        dist_from_bg_final = ndimage.distance_transform_edt(tooth_mask)
        max_t = np.max(dist_from_bg_final) if np.max(dist_from_bg_final) > 0 else 1
        t_factor = np.clip(dist_from_bg_final / max_t, 0, 1)
        width_mult_final = np.where(dentine_spatial, exposed_width_mult, 1.0)
        eff_fill_final = edge_width * t_factor * width_mult_final
        eff_fill_final = np.clip(eff_fill_final, 3, edge_width * 4.0)
        dentine_visible = removed & (dist_from_kept_final <= eff_fill_final) & dentine_spatial
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

    fracture_mask, effective_edge_params = generate_fracture_mask(
        tooth_mask, target_completeness,
        species_weights=profile['fracture_types'],
        edge_params=profile['edge_params'],
    )

    result_img = apply_fracture(
        image_path, tooth_mask, fracture_mask,
        edge_params=effective_edge_params,
    )

    # Compute actual completeness (using cleaned mask — largest fragment only)
    result_mask = _keep_largest_fragment(
        (tooth_mask & fracture_mask).astype(np.uint8)
    )
    result_area = compute_tooth_area(result_mask)
    ref = reference_area or original_area
    actual_completeness = compute_completeness(result_area, ref)

    return result_img, actual_completeness

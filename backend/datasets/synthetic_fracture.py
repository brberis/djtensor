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
    Generate realistic fracture displacement — smooth flowing curves with
    gentle undulations, matching real fossil tooth fracture patterns.

    Real fractures are NOT zigzag. They follow smooth curves with:
      - Broad gentle waviness (the main fracture path)
      - Subtle bumps (surface irregularities of the material)
      - Very slight micro-texture (barely visible)

    Based on study of real fragments in the Fragment Teeth Test dataset.

    Args:
        length: Number of points along the fracture line.
        roughness: Overall curve amplitude (0=flat, 1=more wavy).
        micro_roughness: Subtle bump intensity.
        seed: Optional random seed.

    Returns:
        1D array of displacement values (perpendicular to fracture line).
    """
    if seed is not None:
        rng = np.random.RandomState(seed)
    else:
        rng = np.random

    displacement = np.zeros(length)

    # Scale 1: Broad gentle curvature (the main fracture path)
    # Very low frequency, moderate amplitude — smooth flowing curve
    n_control = max(3, rng.randint(3, 6))
    control_points = rng.randn(n_control)
    large = np.interp(
        np.linspace(0, 1, length),
        np.linspace(0, 1, n_control),
        control_points
    )
    # Smooth heavily
    if length > 10:
        kernel_size = max(length // 8, 5)
        kernel = np.ones(kernel_size) / kernel_size
        large = np.convolve(large, kernel, mode='same')
    displacement += large * roughness * 10.0

    # Scale 2: Gentle bumps (material irregularities)
    # Medium-low frequency, low amplitude
    n_bumps = max(5, length // 15)
    bumps = rng.randn(n_bumps)
    bumps_interp = np.interp(
        np.linspace(0, 1, length),
        np.linspace(0, 1, n_bumps),
        bumps
    )
    # Smooth to keep bumps gentle
    if length > 10:
        k2 = max(length // 20, 3)
        bumps_interp = np.convolve(bumps_interp, np.ones(k2) / k2, mode='same')
    displacement += bumps_interp * roughness * 4.0

    # Scale 3: Very subtle micro-texture (barely visible surface roughness)
    micro = rng.randn(length) * micro_roughness * 1.0
    if length > 5:
        kernel = np.ones(5) / 5
        micro = np.convolve(micro, kernel, mode='same')
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
    width = cmax - cmin

    # Cut position: from bottom, removing fraction of the tooth
    cut_row = int(rmax - height * fraction)
    cut_row = np.clip(cut_row, rmin + 5, rmax - 5)

    # Generate fracture line following the tooth contour with noise
    n_points = max(width + 20, 50)
    base_cols = np.linspace(cmin - 10, cmax + 10, n_points)

    # Base fracture line with curvature following the tooth shape
    curvature = edge_params.get('curvature', 0.3)
    base_rows = np.full(n_points, float(cut_row))

    # Add curvature: fracture follows the tooth width profile
    for i, c in enumerate(base_cols):
        c_int = int(np.clip(c, 0, w - 1))
        top, bot = _find_contour_at_col(mask, c_int)
        if top is not None and bot is not None:
            local_center = (top + bot) / 2
            base_rows[i] += (local_center - cut_row) * curvature * 0.3

    # Apply multi-scale fracture noise
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

    curvature = edge_params.get('curvature', 0.3)
    base_rows = np.full(n_points, float(cut_row))

    for i, c in enumerate(base_cols):
        c_int = int(np.clip(c, 0, w - 1))
        top, bot = _find_contour_at_col(mask, c_int)
        if top is not None and bot is not None:
            local_center = (top + bot) / 2
            base_rows[i] += (local_center - cut_row) * curvature * 0.3

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

    # Diagonal angle: slight tilt
    angle = np.random.uniform(0.05, 0.25) * np.random.choice([-1, 1])

    n_points = max(height + 20, 50)
    base_rows = np.linspace(rmin - 10, rmax + 10, n_points)

    # Base column with diagonal tilt
    base_cols = np.full(n_points, float(cut_col))
    for i, r in enumerate(base_rows):
        t = (r - rmin) / max(height, 1)
        base_cols[i] += angle * height * (t - 0.5)

    # Add curvature following the tooth contour
    curvature = edge_params.get('curvature', 0.3)
    for i, r in enumerate(base_rows):
        r_int = int(np.clip(r, 0, h - 1))
        left, right = _find_contour_at_row(mask, r_int)
        if left is not None and right is not None:
            local_center = (left + right) / 2
            base_cols[i] += (local_center - cut_col) * curvature * 0.2

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

    # Choose an angle for the diagonal (30-60 degrees from horizontal)
    angle_deg = np.random.uniform(25, 55) * np.random.choice([-1, 1])
    angle_rad = np.radians(angle_deg)

    # Fracture passes through a point at the target fraction height
    center_row = rmin + height * (1.0 - fraction * 0.7)
    center_col = cmin + width * np.random.uniform(0.3, 0.7)

    # Generate line endpoints extending beyond tooth
    half_diag = max(height, width)
    start = (center_row - half_diag * np.sin(angle_rad),
             center_col - half_diag * np.cos(angle_rad))
    end = (center_row + half_diag * np.sin(angle_rad),
           center_col + half_diag * np.cos(angle_rad))

    n_points = max(int(2 * half_diag), 80)
    t = np.linspace(0, 1, n_points)
    base_rows = start[0] + t * (end[0] - start[0])
    base_cols = start[1] + t * (end[1] - start[1])

    noise = _generate_fracture_noise(
        n_points,
        roughness=edge_params.get('roughness', 0.6),
        micro_roughness=edge_params.get('micro_roughness', 0.4),
    )

    # Apply noise perpendicular to the fracture direction
    perp_row = -np.cos(angle_rad)
    perp_col = np.sin(angle_rad)
    fracture_rows = base_rows + noise * perp_row
    fracture_cols = base_cols + noise * perp_col

    points = np.stack([fracture_rows, fracture_cols], axis=1)

    # Determine which side to keep based on which has more tooth
    test_mask = _rasterize_fracture_line(points, mask.shape, keep_side='above')
    keep_above = np.sum(mask & test_mask)
    keep_below = np.sum(mask & ~test_mask)

    # Keep the larger piece (closer to target completeness)
    target_area = compute_tooth_area(mask) * (1.0 - fraction)
    if abs(keep_above - target_area) < abs(keep_below - target_area):
        return _rasterize_fracture_line(points, mask.shape, keep_side='above')
    else:
        return _rasterize_fracture_line(points, mask.shape, keep_side='below')


def _fracture_edge_chip(mask, fraction, edge_params):
    """Chip along the blade edge or serration margin."""
    rmin, rmax, cmin, cmax = _get_tooth_bbox(mask)
    h, w = mask.shape
    height = rmax - rmin
    width = cmax - cmin

    # Find the contour and pick a section to chip
    contour = _get_tooth_contour(mask)
    if len(contour) < 10:
        return np.ones_like(mask)

    # Pick a random contour section (not at the very top or bottom extremes)
    n = len(contour)
    start_idx = np.random.randint(n // 6, 5 * n // 6)
    chip_length = max(int(n * fraction * 0.4), 10)
    end_idx = min(start_idx + chip_length, n - 1)

    chip_contour = contour[start_idx:end_idx]
    if len(chip_contour) < 3:
        return np.ones_like(mask)

    # Create chip by cutting inward from the contour
    centroid = np.mean(np.argwhere(mask), axis=0)
    chip_depth = max(height, width) * fraction * 0.3

    noise = _generate_fracture_noise(
        len(chip_contour),
        roughness=edge_params.get('roughness', 0.6),
        micro_roughness=edge_params.get('micro_roughness', 0.4),
    )

    fracture = np.ones_like(mask)
    for i, (r, c) in enumerate(chip_contour):
        # Direction from contour point toward centroid
        dr = centroid[0] - r
        dc = centroid[1] - c
        dist = max(np.sqrt(dr ** 2 + dc ** 2), 1)
        dr, dc = dr / dist, dc / dist

        # Chip depth with noise
        depth = chip_depth * (1.0 + noise[i] / 20.0)
        depth = max(depth, 2)

        # Remove pixels from contour inward
        for d in range(int(depth)):
            pr = int(r + dr * d * 0.3)
            pc = int(c + dc * d * 0.3)
            if 0 <= pr < h and 0 <= pc < w:
                fracture[pr, pc] = 0

    # Dilate the chip slightly for more natural appearance
    chip_region = fracture == 0
    chip_region = ndimage.binary_dilation(chip_region, iterations=2)
    fracture[chip_region] = 0

    return fracture


FRACTURE_FUNCTIONS = {
    'root_loss': _fracture_root_loss,
    'tip_loss': _fracture_tip_loss,
    'lateral_break': _fracture_lateral_break,
    'edge_chip': _fracture_edge_chip,
    'diagonal_snap': _fracture_diagonal_snap,
}


# ---------------------------------------------------------------------------
# 3D cross-section effect
# ---------------------------------------------------------------------------

def _add_3d_edge_effect(img_array, tooth_mask, fracture_mask, edge_width=4):
    """
    Add a realistic 3D cross-section effect at the fracture edge.

    Based on study of real fragments: the exposed cross-section shows
    a wide band of light beige/cream-colored internal material (dentine),
    with a thin darker edge line at the very break point.

    The cross-section width varies randomly along the fracture (some areas
    show more internal material, some less), and has a grainy texture.

    Args:
        img_array: RGB image as numpy array.
        tooth_mask: Binary tooth segmentation mask.
        fracture_mask: Binary fracture mask (1=keep, 0=remove).
        edge_width: Base width of the cross-section effect in pixels.
                    Actual width varies randomly (0.5x to 2x this value).

    Returns:
        Modified image array.
    """
    if edge_width <= 0:
        return img_array

    result = img_array.copy()
    h, w = tooth_mask.shape

    keep = tooth_mask.astype(bool) & fracture_mask.astype(bool)
    removed = tooth_mask.astype(bool) & ~fracture_mask.astype(bool)

    if not np.any(removed) or not np.any(keep):
        return result

    # Distance from each kept tooth pixel to the nearest fracture boundary
    dist_to_fracture = ndimage.distance_transform_edt(~removed)

    # Create a varying width map (the cross-section isn't uniform width)
    # Use smooth random noise to vary the effective edge width
    width_noise = np.random.randn(h, w) * 0.3
    width_noise = ndimage.gaussian_filter(width_noise, sigma=15)  # smooth it
    effective_width = edge_width * (1.0 + width_noise)
    effective_width = np.clip(effective_width, edge_width * 0.3, edge_width * 2.5)

    # The cross-section zone: kept tooth pixels within the effective width
    cross_section = keep & (dist_to_fracture > 0) & (dist_to_fracture <= effective_width)

    if not np.any(cross_section):
        return result

    # Exposed dentine color: light beige/cream
    # Based on real fragments: the internal material is consistently
    # light beige (R:210-230, G:195-215, B:170-190)
    dentine_base = np.array([220, 205, 180], dtype=np.float32)

    # Add grainy texture to the cross-section
    grain = np.random.randn(h, w) * 12
    grain = ndimage.gaussian_filter(grain, sigma=1.5)  # slight smooth for grain texture

    # Blend: pixels closer to the fracture edge get more dentine color,
    # pixels further inside blend back to the original tooth color
    cross_rows, cross_cols = np.where(cross_section)
    for idx in range(len(cross_rows)):
        r, c = cross_rows[idx], cross_cols[idx]
        dist = dist_to_fracture[r, c]
        ew = effective_width[r, c]

        # Blend factor: 1.0 at the fracture edge, fading to 0.0 at the inner boundary
        blend = 1.0 - (dist / max(ew, 1)) ** 0.7

        # Dentine color with grain texture
        dentine_color = dentine_base + grain[r, c]
        dentine_color = np.clip(dentine_color, 0, 255)

        # Blend with original pixel
        original = result[r, c].astype(np.float32)
        result[r, c] = np.clip(
            original * (1 - blend) + dentine_color * blend,
            0, 255
        ).astype(np.uint8)

    # Dark edge line at the very fracture boundary (depth shadow)
    edge_line = keep & (dist_to_fracture > 0) & (dist_to_fracture <= 2.0)
    if np.any(edge_line):
        for c in range(3):
            channel = result[:, :, c].astype(np.float32)
            channel[edge_line] = np.clip(channel[edge_line] * 0.6, 0, 255)
            result[:, :, c] = channel.astype(np.uint8)

    return result


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
        species_weights = {'root_loss': 0.3, 'tip_loss': 0.25, 'lateral_break': 0.2,
                           'edge_chip': 0.1, 'diagonal_snap': 0.15}
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

    fraction_to_remove = 1.0 - target_completeness

    func = FRACTURE_FUNCTIONS.get(fracture_type, _fracture_tip_loss)
    fracture_mask = func(mask, fraction_to_remove, edge_params)
    return fracture_mask


def apply_fracture(image_path, tooth_mask, fracture_mask, edge_params=None,
                   background_color=(255, 255, 255)):
    """
    Apply fracture mask with 3D cross-section effect.

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
        edge_params = {'edge_3d_width': 4}

    # Step 1: Sanitize onto clean background
    clean_img = sanitize_tooth_image(image_path, background_color=background_color)
    img_array = np.array(clean_img)

    # Step 2: Apply 3D edge effect before masking
    edge_width = edge_params.get('edge_3d_width', 4)
    img_array = _add_3d_edge_effect(img_array, tooth_mask, fracture_mask, edge_width)

    # Step 3: Apply fracture mask with sharp edges (no gaussian feathering)
    keep_mask = tooth_mask.astype(bool) & fracture_mask.astype(bool)

    # Only feather the original tooth boundary (against background), NOT the fracture edge
    tooth_boundary_alpha = tooth_mask.astype(np.float32)
    tooth_boundary_alpha = ndimage.gaussian_filter(tooth_boundary_alpha, sigma=1.0)
    tooth_boundary_alpha = np.clip(tooth_boundary_alpha * 2, 0.0, 1.0)

    # Fracture edge stays sharp (no feathering)
    final_alpha = np.where(keep_mask, tooth_boundary_alpha, 0.0)

    bg = np.full_like(img_array, background_color, dtype=np.float32)
    result = img_array.astype(np.float32) * final_alpha[:, :, np.newaxis] + \
             bg * (1.0 - final_alpha[:, :, np.newaxis])

    return PILImage.fromarray(result.astype(np.uint8))


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

    fracture_mask = generate_fracture_mask(
        tooth_mask, target_completeness,
        species_weights=profile['fracture_types'],
        edge_params=profile['edge_params'],
    )

    result_img = apply_fracture(
        image_path, tooth_mask, fracture_mask,
        edge_params=profile['edge_params'],
    )

    # Compute actual completeness
    result_mask = tooth_mask & fracture_mask
    result_area = compute_tooth_area(result_mask)
    ref = reference_area or original_area
    actual_completeness = compute_completeness(result_area, ref)

    return result_img, actual_completeness

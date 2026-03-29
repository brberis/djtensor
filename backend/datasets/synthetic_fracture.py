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


FRACTURE_FUNCTIONS = {
    'root_loss': _fracture_root_loss,
    'tip_loss': _fracture_tip_loss,
    'lateral_break': _fracture_lateral_break,
    'edge_chip': _fracture_tip_loss,  # edge_chip redirects to tip_loss (chips create impossible holes)
    'diagonal_snap': _fracture_diagonal_snap,
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


def _compute_dentine_color(img_array, tooth_mask, keep_mask):
    """Compute dentine color relative to the tooth surface (lighter + warmer)."""
    near_edge_pixels = img_array[keep_mask]
    if len(near_edge_pixels) > 0:
        avg_surface = np.mean(near_edge_pixels, axis=0)
    else:
        avg_surface = np.array([150, 140, 130], dtype=np.float32)
    # Randomize the dentine offset each time — real teeth vary
    r_offset = np.random.uniform(20, 50)
    g_offset = np.random.uniform(15, 40)
    b_offset = np.random.uniform(5, 25)
    return np.clip(avg_surface + np.array([r_offset, g_offset, b_offset]), 0, 255)


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

    # Step 3: Compute dentine color (lighter than tooth surface)
    dentine_base = _compute_dentine_color(img_array, tooth_mask, keep_mask)

    # Step 4: Fill the REMOVED side of the fracture with dentine
    # This simulates the visible cross-section of the broken tooth
    removed = tooth_mask.astype(bool) & ~keep_mask
    edge_width = edge_params.get('edge_3d_width', 20)

    if np.any(removed) and np.any(keep_mask):
        # Distance from each removed pixel to the nearest KEPT pixel
        dist_from_kept = ndimage.distance_transform_edt(~keep_mask)

        # The cross-section fill width varies:
        # - Wider in the center of the tooth (thicker there)
        # - Narrower at the edges
        # Use distance from tooth boundary as a proxy for thickness
        dist_from_bg = ndimage.distance_transform_edt(tooth_mask)
        max_thickness = np.max(dist_from_bg) if np.max(dist_from_bg) > 0 else 1
        thickness_factor = np.clip(dist_from_bg / max_thickness, 0, 1)

        # Effective fill width: base * thickness_factor + random variation
        width_noise = np.random.randn(h, w).astype(np.float32) * 0.2
        width_noise = ndimage.gaussian_filter(width_noise, sigma=15)
        effective_fill = edge_width * thickness_factor * (1.0 + width_noise)
        effective_fill = np.clip(effective_fill, 3, edge_width * 2.5)

        # Dentine fill zone: removed pixels close to the fracture boundary
        dentine_zone = removed & (dist_from_kept <= effective_fill)

        if np.any(dentine_zone):
            # Multi-scale texture: fine grain + medium patches + subtle streaks
            grain_fine = np.random.randn(h, w).astype(np.float32) * 6
            grain_fine = ndimage.gaussian_filter(grain_fine, sigma=1.5)

            # Medium patches (porous texture of osteodentine)
            patches = np.random.randn(h, w).astype(np.float32) * 12
            patches = ndimage.gaussian_filter(patches, sigma=6)

            # Subtle color variation per channel (some areas more yellow, some more gray)
            color_var_r = np.random.randn(h, w).astype(np.float32) * 8
            color_var_r = ndimage.gaussian_filter(color_var_r, sigma=10)
            color_var_g = np.random.randn(h, w).astype(np.float32) * 6
            color_var_g = ndimage.gaussian_filter(color_var_g, sigma=10)

            # Blend: full dentine near fracture, fading to background at outer edge
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

            # Apply dentine fill to the removed zone
            blend_3d = blend[:, :, np.newaxis]
            bg_color = np.full_like(img_array, background_color, dtype=np.float32)
            img_array[dentine_zone] = (
                dentine_fill[dentine_zone] * blend[dentine_zone, np.newaxis] +
                bg_color[dentine_zone] * (1 - blend[dentine_zone, np.newaxis])
            )

    # Step 5: Also paint dentine on the KEPT side (inner surface near fracture)
    if np.any(removed) and np.any(keep_mask):
        dist_to_removed = ndimage.distance_transform_edt(~removed)
        inner_band = keep_mask & (dist_to_removed > 0) & (dist_to_removed <= max(edge_width // 3, 4))
        if np.any(inner_band):
            inner_blend = 1.0 - np.clip(dist_to_removed[inner_band] / max(edge_width // 3, 4), 0, 1) ** 0.5
            grain_inner = np.random.randn(np.sum(inner_band)).astype(np.float32) * 6
            for c in range(3):
                ch = img_array[:, :, c]
                ch[inner_band] = ch[inner_band] * (1 - inner_blend) + (dentine_base[c] + grain_inner) * inner_blend
                img_array[:, :, c] = ch

    # Step 6: Dark shadow line at the fracture boundary
    if np.any(removed) and np.any(keep_mask):
        dist_to_removed2 = ndimage.distance_transform_edt(~removed)
        shadow = keep_mask & (dist_to_removed2 > 0) & (dist_to_removed2 <= 2.0)
        if np.any(shadow):
            img_array[shadow] *= 0.5

    # Step 7: Composite — include both kept fragment AND dentine fill zone
    visible_mask = keep_mask.copy()
    if np.any(removed) and np.any(keep_mask):
        dist_from_kept_final = ndimage.distance_transform_edt(~keep_mask)
        # Recompute fill width for visibility mask
        dist_from_bg_final = ndimage.distance_transform_edt(tooth_mask)
        max_t = np.max(dist_from_bg_final) if np.max(dist_from_bg_final) > 0 else 1
        t_factor = np.clip(dist_from_bg_final / max_t, 0, 1)
        eff_fill_final = edge_width * t_factor
        eff_fill_final = np.clip(eff_fill_final, 3, edge_width * 2.5)
        dentine_visible = removed & (dist_from_kept_final <= eff_fill_final)
        visible_mask = visible_mask | dentine_visible

    # Feather only the outer boundary (tooth edge against background)
    visible_alpha = visible_mask.astype(np.float32)
    visible_alpha = ndimage.gaussian_filter(visible_alpha, sigma=1.0)
    visible_alpha = np.clip(visible_alpha * 2, 0.0, 1.0)

    bg = np.full_like(img_array, background_color, dtype=np.float32)
    result = img_array * visible_alpha[:, :, np.newaxis] + \
             bg * (1.0 - visible_alpha[:, :, np.newaxis])

    return PILImage.fromarray(np.clip(result, 0, 255).astype(np.uint8))


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

    # Compute actual completeness (using cleaned mask — largest fragment only)
    result_mask = _keep_largest_fragment(
        (tooth_mask & fracture_mask).astype(np.uint8)
    )
    result_area = compute_tooth_area(result_mask)
    ref = reference_area or original_area
    actual_completeness = compute_completeness(result_area, ref)

    return result_img, actual_completeness

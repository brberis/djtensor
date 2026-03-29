# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: synthetic_fracture.py
# Copyright (c) 2024

"""
Synthetic fracture generation for fossil shark teeth.

Generates realistic fracture masks to simulate fragmentary teeth from complete
tooth images. Supports species-specific fracture weight maps loaded from JSON.

Fracture types:
  - root_loss: Removes the bottom portion (root) of the tooth
  - tip_loss: Removes the top portion (tip/apex) of the tooth
  - lateral_break: Removes one side via a diagonal/vertical break line
  - edge_chip: Removes a small region from an edge

No Django dependency — can be tested standalone.
"""

import json
import os
import numpy as np
from PIL import Image as PILImage
from scipy import ndimage

from .segmentation import segment_tooth, compute_tooth_area, compute_completeness, sanitize_tooth_image


# Default fracture profiles path
PROFILES_DIR = os.path.join(os.path.dirname(__file__), 'fracture_profiles')
DEFAULT_PROFILE = os.path.join(PROFILES_DIR, 'default.json')


def load_fracture_profiles(profile_path=None):
    """Load fracture weight profiles from JSON file."""
    path = profile_path or DEFAULT_PROFILE
    with open(path, 'r') as f:
        profiles = json.load(f)
    # Remove metadata keys
    return {k: v for k, v in profiles.items() if not k.startswith('_')}


def get_species_weights(species, profiles=None):
    """Get fracture weights for a species, falling back to 'default'."""
    if profiles is None:
        profiles = load_fracture_profiles()
    weights = profiles.get(species, profiles.get('default', {
        'root_loss': 0.3, 'tip_loss': 0.3, 'lateral_break': 0.25, 'edge_chip': 0.15,
    }))
    return weights


def _get_tooth_bbox(mask):
    """Get bounding box of the tooth region (rows, cols)."""
    rows = np.any(mask, axis=1)
    cols = np.any(mask, axis=0)
    rmin, rmax = np.where(rows)[0][[0, -1]]
    cmin, cmax = np.where(cols)[0][[0, -1]]
    return rmin, rmax, cmin, cmax


def _generate_bezier_line(start, end, num_points=50, noise_std=8.0):
    """Generate a noisy Bezier-like curve between two points."""
    t = np.linspace(0, 1, num_points)
    # Midpoint with random offset for control point
    mid = ((start[0] + end[0]) / 2 + np.random.normal(0, noise_std),
           (start[1] + end[1]) / 2 + np.random.normal(0, noise_std))

    # Quadratic Bezier
    points_r = (1 - t) ** 2 * start[0] + 2 * (1 - t) * t * mid[0] + t ** 2 * end[0]
    points_c = (1 - t) ** 2 * start[1] + 2 * (1 - t) * t * mid[1] + t ** 2 * end[1]

    # Add noise along the curve
    points_r += np.random.normal(0, noise_std * 0.3, num_points)
    points_c += np.random.normal(0, noise_std * 0.3, num_points)

    return np.stack([points_r, points_c], axis=1)


def _fracture_root_loss(mask, fraction):
    """Remove the bottom portion of the tooth (root loss)."""
    rmin, rmax, cmin, cmax = _get_tooth_bbox(mask)
    height = rmax - rmin
    cut_row = int(rmax - height * fraction)

    # Generate noisy horizontal cut line
    h, w = mask.shape
    start = (cut_row, cmin - 10)
    end = (cut_row + np.random.randint(-5, 5), cmax + 10)
    curve = _generate_bezier_line(start, end, noise_std=height * 0.05)

    # Create fracture mask: keep everything above the curve
    fracture = np.ones_like(mask)
    for r, c in curve:
        r_int = int(np.clip(r, 0, h - 1))
        fracture[r_int:, :] = 0  # Remove below curve

    # Only apply within the tooth region for the fill
    rr, cc = np.meshgrid(range(h), range(w), indexing='ij')
    for r, c in curve:
        r_int = int(np.clip(r, 0, h - 1))
        c_int = int(np.clip(c, 0, w - 1))
        fracture[r_int:, max(0, c_int - 2):min(w, c_int + 3)] = 0

    return fracture


def _fracture_tip_loss(mask, fraction):
    """Remove the top portion of the tooth (tip loss)."""
    rmin, rmax, cmin, cmax = _get_tooth_bbox(mask)
    height = rmax - rmin
    cut_row = int(rmin + height * fraction)

    h, w = mask.shape
    start = (cut_row, cmin - 10)
    end = (cut_row + np.random.randint(-5, 5), cmax + 10)
    curve = _generate_bezier_line(start, end, noise_std=height * 0.05)

    fracture = np.ones_like(mask)
    for r, c in curve:
        r_int = int(np.clip(r, 0, h - 1))
        fracture[:r_int, :] = 0

    for r, c in curve:
        r_int = int(np.clip(r, 0, h - 1))
        c_int = int(np.clip(c, 0, w - 1))
        fracture[:r_int, max(0, c_int - 2):min(w, c_int + 3)] = 0

    return fracture


def _fracture_lateral_break(mask, fraction):
    """Remove one side of the tooth via a diagonal/vertical break."""
    rmin, rmax, cmin, cmax = _get_tooth_bbox(mask)
    width = cmax - cmin
    height = rmax - rmin

    # Decide left or right side removal
    remove_left = np.random.random() < 0.5
    cut_frac = fraction if remove_left else (1 - fraction)
    cut_col = int(cmin + width * cut_frac)

    h, w = mask.shape
    # Diagonal cut line with noise
    angle = np.random.uniform(-0.15, 0.15)  # slight angle
    start = (rmin - 10, cut_col + int(height * angle))
    end = (rmax + 10, cut_col - int(height * angle))
    curve = _generate_bezier_line(start, end, noise_std=width * 0.05)

    fracture = np.ones_like(mask)
    for r, c in curve:
        r_int = int(np.clip(r, 0, h - 1))
        c_int = int(np.clip(c, 0, w - 1))
        if remove_left:
            fracture[r_int, :c_int] = 0
        else:
            fracture[r_int, c_int:] = 0

    return fracture


def _fracture_edge_chip(mask, fraction):
    """Remove a small chip from a random edge of the tooth."""
    rmin, rmax, cmin, cmax = _get_tooth_bbox(mask)
    h, w = mask.shape
    height = rmax - rmin
    width = cmax - cmin

    # Chip size proportional to fraction
    chip_h = int(height * fraction * 0.6)
    chip_w = int(width * fraction * 0.6)

    # Pick a random edge point on the tooth contour
    edge_side = np.random.choice(['top', 'bottom', 'left', 'right'])
    if edge_side == 'top':
        cr, cc = rmin, np.random.randint(cmin, max(cmin + 1, cmax))
    elif edge_side == 'bottom':
        cr, cc = rmax, np.random.randint(cmin, max(cmin + 1, cmax))
    elif edge_side == 'left':
        cr, cc = np.random.randint(rmin, max(rmin + 1, rmax)), cmin
    else:
        cr, cc = np.random.randint(rmin, max(rmin + 1, rmax)), cmax

    # Create an elliptical chip
    fracture = np.ones_like(mask)
    rr, cc_grid = np.meshgrid(range(h), range(w), indexing='ij')
    dist = ((rr - cr) / max(chip_h, 1)) ** 2 + ((cc_grid - cc) / max(chip_w, 1)) ** 2
    chip_mask = dist < 1.0
    # Add noise to chip boundary
    noise = np.random.normal(0, 0.15, (h, w))
    chip_mask = (dist + noise) < 1.0
    fracture[chip_mask] = 0

    return fracture


# Map fracture type names to functions
FRACTURE_FUNCTIONS = {
    'root_loss': _fracture_root_loss,
    'tip_loss': _fracture_tip_loss,
    'lateral_break': _fracture_lateral_break,
    'edge_chip': _fracture_edge_chip,
}


def generate_fracture_mask(mask, target_completeness, species_weights=None):
    """
    Generate a fracture mask for a tooth given the segmentation mask.

    Uses species-specific fracture weights to determine which type of fracture
    to apply, then adjusts the fraction to approximate the target completeness.

    Args:
        mask: Binary tooth segmentation mask (numpy array).
        target_completeness: Desired completeness (0.0 to 1.0).
        species_weights: Dict of {fracture_type: probability}. Uses default if None.

    Returns:
        Binary fracture mask (1 = keep, 0 = remove).
    """
    if species_weights is None:
        species_weights = get_species_weights('default')

    # Select fracture type based on weights
    types = list(species_weights.keys())
    probs = np.array([species_weights.get(t, 0) for t in types], dtype=float)
    probs = probs / probs.sum()
    fracture_type = np.random.choice(types, p=probs)

    # Fraction to remove = 1 - target_completeness
    fraction_to_remove = 1.0 - target_completeness

    func = FRACTURE_FUNCTIONS.get(fracture_type)
    if func is None:
        # Unknown type, fall back to tip_loss
        func = _fracture_tip_loss

    fracture_mask = func(mask, fraction_to_remove)
    return fracture_mask


def apply_fracture(image_path, tooth_mask, fracture_mask, background_color=(255, 255, 255)):
    """
    Apply a fracture mask to create a synthetic fragment on white background.

    First sanitizes the image (extracts tooth onto clean white background),
    then applies the fracture mask to remove part of the tooth.

    Args:
        image_path: Path to the original image.
        tooth_mask: Binary tooth segmentation mask.
        fracture_mask: Binary fracture mask (1 = keep, 0 = remove).
        background_color: RGB tuple for background (default white).

    Returns:
        PIL Image of the fractured tooth on clean white background.
    """
    # Step 1: Sanitize — extract tooth onto clean white background
    clean_img = sanitize_tooth_image(image_path, background_color=background_color)
    img_array = np.array(clean_img)

    # Step 2: Apply fracture — keep only surviving fragment pixels
    keep_mask = tooth_mask.astype(bool) & fracture_mask.astype(bool)

    # Feather the fracture edge for natural appearance
    keep_float = keep_mask.astype(np.float32)
    keep_float = ndimage.gaussian_filter(keep_float, sigma=1.5)
    keep_float = np.clip(keep_float * 2, 0.0, 1.0)

    # Composite: fragment * alpha + white * (1 - alpha)
    bg = np.full_like(img_array, background_color, dtype=np.float32)
    result = img_array.astype(np.float32) * keep_float[:, :, np.newaxis] + bg * (1.0 - keep_float[:, :, np.newaxis])

    return PILImage.fromarray(result.astype(np.uint8))


def generate_synthetic_fragment(image_path, target_completeness, reference_area=None, species=None):
    """
    Generate a synthetic fragment from a complete tooth image.

    Args:
        image_path: Path to the complete tooth image.
        target_completeness: Desired completeness (0.0 to 1.0).
        reference_area: Optional reference area for completeness verification.
        species: Species name for loading species-specific fracture weights.

    Returns:
        Tuple of (PIL Image, actual_completeness float).
    """
    tooth_mask = segment_tooth(image_path)
    original_area = compute_tooth_area(tooth_mask)

    if original_area == 0:
        raise ValueError(f"No tooth detected in {image_path}")

    weights = get_species_weights(species) if species else None
    fracture_mask = generate_fracture_mask(tooth_mask, target_completeness, weights)

    result_img = apply_fracture(image_path, tooth_mask, fracture_mask)

    # Compute actual completeness of the result
    result_mask = tooth_mask & fracture_mask
    result_area = compute_tooth_area(result_mask)
    ref = reference_area or original_area
    actual_completeness = compute_completeness(result_area, ref)

    return result_img, actual_completeness

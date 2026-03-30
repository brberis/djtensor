# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: segmentation.py
# Copyright (c) 2024

"""
Tooth segmentation and completeness detection module.

Segments fossil shark teeth from standardized white backgrounds and computes
completeness percentage by comparing tooth area to species reference areas.

No Django dependency — can be tested standalone.
"""

import os
import numpy as np
from PIL import Image
from scipy import ndimage


def _open_as_rgb(image_path):
    """
    Open an image and convert to RGB, handling alpha transparency correctly.

    PNG images with alpha channels must be composited onto a white background
    before conversion, otherwise transparent pixels become black.
    """
    img = Image.open(image_path)
    if img.mode == 'RGBA':
        background = Image.new('RGB', img.size, (255, 255, 255))
        background.paste(img, mask=img.split()[3])
        return background
    return img.convert('RGB')


def _detect_background(arr):
    """
    Detect whether the image has a light or dark background by sampling
    the corner pixels (which are almost always background).

    Returns:
        'light' or 'dark'
    """
    h, w = arr.shape
    margin = max(5, min(h, w) // 20)  # ~5% margin
    corners = np.concatenate([
        arr[:margin, :margin].ravel(),       # top-left
        arr[:margin, -margin:].ravel(),      # top-right
        arr[-margin:, :margin].ravel(),      # bottom-left
        arr[-margin:, -margin:].ravel(),     # bottom-right
    ])
    median_bg = np.median(corners)
    return 'light' if median_bg > 127 else 'dark'


def _otsu_threshold(arr):
    """Compute Otsu's optimal threshold for a grayscale image."""
    hist, bin_edges = np.histogram(arr.ravel(), bins=256, range=(0, 256))
    total = arr.size
    sum_total = np.sum(np.arange(256) * hist)

    best_thresh = 0
    best_variance = 0
    sum_bg = 0
    weight_bg = 0

    for t in range(256):
        weight_bg += hist[t]
        if weight_bg == 0:
            continue
        weight_fg = total - weight_bg
        if weight_fg == 0:
            break

        sum_bg += t * hist[t]
        mean_bg = sum_bg / weight_bg
        mean_fg = (sum_total - sum_bg) / weight_fg

        variance = weight_bg * weight_fg * (mean_bg - mean_fg) ** 2
        if variance > best_variance:
            best_variance = variance
            best_thresh = t

    return best_thresh


def segment_tooth(image_path, threshold=None):
    """
    Segment tooth from background using color distance + adaptive thresholding.

    For light backgrounds: uses Euclidean color distance from the sampled
    background color in RGB space. Even very light tooth areas (white root,
    cream-colored fossils) differ from pure white background in at least one
    channel. Falls back to grayscale Otsu for dark backgrounds.

    Args:
        image_path: Path to the image file.
        threshold: Optional manual threshold override. If None, auto-detects.

    Returns:
        Binary numpy array (1 = tooth, 0 = background).
    """
    img = _open_as_rgb(image_path)
    rgb = np.array(img, dtype=np.float32)
    arr = np.array(img.convert('L'))
    h, w = arr.shape

    if threshold is not None:
        mask = arr < threshold
    else:
        bg_type = _detect_background(arr)

        if bg_type == 'light':
            # White background: use max channel deviation from white.
            # Any pixel where ANY channel differs from 255 by more than
            # a small margin is not background. Fossil teeth — even very
            # light cream/white roots — always have some color tint.
            max_dev = np.max(255.0 - rgb, axis=2)
            mask = max_dev > 6
        else:
            # Dark or mixed background: use Otsu's method on grayscale
            otsu = _otsu_threshold(arr)
            mask_dark = arr < otsu
            mask_light = arr >= otsu

            center_r, center_c = h // 2, w // 2
            margin = min(h, w) // 4

            center_region = slice(center_r - margin, center_r + margin), slice(center_c - margin, center_c + margin)
            dark_center = np.sum(mask_dark[center_region])
            light_center = np.sum(mask_light[center_region])

            mask = mask_light if light_center > dark_center else mask_dark

    # Fill internal holes
    mask = ndimage.binary_fill_holes(mask)

    # Keep only the largest connected component (the tooth)
    labeled, num_features = ndimage.label(mask)
    if num_features == 0:
        return mask.astype(np.uint8)

    component_sizes = ndimage.sum(mask, labeled, range(1, num_features + 1))
    largest = np.argmax(component_sizes) + 1
    mask = labeled == largest

    # Morphological cleanup: remove noise
    mask = ndimage.binary_opening(mask, iterations=2)
    mask = ndimage.binary_closing(mask, iterations=3)

    return mask.astype(np.uint8)


def compute_tooth_area(mask):
    """Return pixel count of foreground (tooth) in the mask."""
    return int(np.sum(mask > 0))


def compute_completeness(tooth_area, reference_area):
    """
    Compute completeness as ratio of tooth area to reference area.

    Returns:
        Float between 0.0 and 1.0 (clamped).
    """
    if reference_area <= 0:
        return 0.0
    return min(1.0, max(0.0, tooth_area / reference_area))


def get_mask_as_image(mask):
    """Convert binary mask to PIL Image for visualization."""
    return Image.fromarray((mask * 255).astype(np.uint8), mode='L')


def sanitize_tooth_image(image_path, background_color=(255, 255, 255), feather_radius=2):
    """
    Extract the tooth from any background and place it on a clean uniform background.

    Uses segmentation to isolate the tooth, then applies edge feathering
    for smooth blending (avoids hard aliased edges).

    Args:
        image_path: Path to the source image.
        background_color: RGB tuple for the output background (default white).
        feather_radius: Gaussian blur radius for edge feathering (anti-aliasing).

    Returns:
        PIL Image with the tooth on a clean uniform background.
    """
    img = _open_as_rgb(image_path)
    img_array = np.array(img, dtype=np.float32)

    mask = segment_tooth(image_path)

    # Create a float alpha mask with feathered edges for smooth blending
    alpha = mask.astype(np.float32)
    if feather_radius > 0:
        alpha = ndimage.gaussian_filter(alpha, sigma=feather_radius)
        # Re-threshold to keep interior solid but smooth the edges
        alpha = np.clip(alpha * 2, 0.0, 1.0)

    # Composite: tooth * alpha + background * (1 - alpha)
    bg = np.full_like(img_array, background_color, dtype=np.float32)
    result = img_array * alpha[:, :, np.newaxis] + bg * (1.0 - alpha[:, :, np.newaxis])

    return Image.fromarray(result.astype(np.uint8))


def build_reference_areas(dataset_path):
    """
    Compute average segmented tooth area per species (label) from a dataset directory.

    Expects directory structure:
        dataset_path/
            species_a/
                img1.jpg
                img2.jpg
            species_b/
                img1.jpg

    Args:
        dataset_path: Path to the dataset root directory.

    Returns:
        dict: {species_name: {'avg_area': float, 'sample_count': int}}
    """
    reference = {}

    if not os.path.isdir(dataset_path):
        return reference

    for label_name in sorted(os.listdir(dataset_path)):
        label_dir = os.path.join(dataset_path, label_name)
        if not os.path.isdir(label_dir):
            continue

        areas = []
        for fname in os.listdir(label_dir):
            fpath = os.path.join(label_dir, fname)
            if not os.path.isfile(fpath):
                continue
            ext = os.path.splitext(fname)[1].lower()
            if ext not in ('.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tif', '.tiff'):
                continue
            try:
                mask = segment_tooth(fpath)
                area = compute_tooth_area(mask)
                if area > 0:
                    areas.append(area)
            except Exception:
                continue

        if areas:
            reference[label_name] = {
                'avg_area': float(np.mean(areas)),
                'sample_count': len(areas),
            }

    return reference

"""
Contour sampling, Procrustes-style alignment, and brute-force rotation +
shift + flip search.

Source: cell 0 of docs.local/shark_tooth_percent_brokenness.ipynb (Katie).
Lifted with minimal changes; variable names and function signatures
preserved so this file can be hot-edited in place from the notebook.
"""
import numpy as np
import cv2
from scipy.interpolate import interp1d


def sample_contour(mask, n_points=100):
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if len(contours) == 0:
        return None
    contour = max(contours, key=cv2.contourArea).squeeze().astype(np.float32)
    if contour.ndim == 1:
        return None
    diffs = np.diff(contour, axis=0)
    dists = np.sqrt((diffs ** 2).sum(axis=1))
    arc = np.concatenate([[0], np.cumsum(dists)])
    if arc[-1] == 0:
        return None
    arc_norm = arc / arc[-1]
    target = np.linspace(0, 1, n_points)
    fx = interp1d(arc_norm, contour[:, 0])
    fy = interp1d(arc_norm, contour[:, 1])
    return np.stack([fx(target), fy(target)], axis=1)


def align_contour_startpoints(pts1, pts2):
    n = len(pts1)
    best_offset = 0
    best_dist = np.inf
    for offset in range(0, n, max(1, n // 20)):
        pts2_rolled = np.roll(pts2, offset, axis=0)
        dist = np.sum((pts1 - pts2_rolled) ** 2)
        if dist < best_dist:
            best_dist = dist
            best_offset = offset
    return np.roll(pts2, best_offset, axis=0)


def warp_image_channels(img_np, M, canvas=256):
    aligned_channels = []
    for c in range(img_np.shape[2]):
        warped = cv2.warpAffine(
            img_np[:, :, c], M, (canvas, canvas),
            flags=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_CONSTANT, borderValue=0,
        )
        aligned_channels.append(warped)
    return np.stack(aligned_channels, axis=2)


def align_to_mean_procrustes(tooth_mask, mean_mask, n_points=100, canvas=256, pad_offset=0):
    tooth_pts = sample_contour(tooth_mask, n_points)
    mean_pts = sample_contour(mean_mask, n_points)
    if tooth_pts is None or mean_pts is None:
        return tooth_mask, None

    tooth_pts = align_contour_startpoints(mean_pts, tooth_pts)

    tooth_centroid = tooth_pts.mean(axis=0)
    mean_centroid = mean_pts.mean(axis=0)
    dx = mean_centroid[0] - tooth_centroid[0]
    dy = mean_centroid[1] - tooth_centroid[1]

    M = np.float32([[1, 0, dx], [0, 1, dy]])

    h, w = tooth_mask.shape
    aligned = cv2.warpAffine(
        tooth_mask.astype(np.uint8), M, (w, h),
        flags=cv2.INTER_NEAREST,
        borderMode=cv2.BORDER_CONSTANT, borderValue=0,
    )
    return aligned, M


def try_rotations_and_shifts(
    tooth_norm, mean_norm, M_base,
    rotate_max=10, angle_step=2,
    shift_max=10, shift_step=2,
    canvas=256,
):
    center = (canvas // 2, canvas // 2)
    best_mask = None
    best_score = -1
    best_angle = 0
    best_shift = (0, 0)
    best_flipped = False
    best_R = None

    angles = range(-rotate_max, rotate_max, angle_step)
    shifts = range(-shift_max, shift_max, shift_step)

    base = cv2.warpAffine(
        tooth_norm.astype(np.uint8), M_base, (canvas, canvas),
        flags=cv2.INTER_NEAREST,
        borderMode=cv2.BORDER_CONSTANT, borderValue=0,
    )

    candidates = {"normal": base, "flipped": cv2.flip(base, 1)}

    for flip_label, base_candidate in candidates.items():
        for angle in angles:
            R = cv2.getRotationMatrix2D(center, angle, 1.0)
            rotated = cv2.warpAffine(
                base_candidate, R, (canvas, canvas),
                flags=cv2.INTER_NEAREST,
                borderMode=cv2.BORDER_CONSTANT, borderValue=0,
            )

            if np.sum(rotated) == 0:
                continue

            for dx in shifts:
                for dy in shifts:
                    T = np.float32([[1, 0, dx], [0, 1, dy]])
                    shifted = cv2.warpAffine(
                        rotated, T, (canvas, canvas),
                        flags=cv2.INTER_NEAREST,
                        borderMode=cv2.BORDER_CONSTANT, borderValue=0,
                    )

                    if np.sum(shifted) == 0:
                        continue

                    overlap = np.sum((mean_norm == 1) & (shifted == 1))
                    tooth_pixels = np.sum(shifted == 1)
                    score = overlap / (np.sum(mean_norm) + tooth_pixels - overlap + 1e-6)

                    if score > best_score:
                        best_score = score
                        best_mask = shifted
                        best_angle = angle
                        best_shift = (dx, dy)
                        best_flipped = flip_label == "flipped"
                        best_R = np.float32([[1, 0, dx], [0, 1, dy]]) @ np.vstack([R, [0, 0, 1]])
                        best_R = best_R[:2, :]

    return best_mask, best_R, best_flipped, best_angle, best_shift, float(best_score)


def normalize(img, target_size=256, interpolation=cv2.INTER_NEAREST):
    return cv2.resize(img, (target_size, target_size), interpolation=interpolation)


def keep_largest_island(mask):
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(
        mask.astype(np.uint8), connectivity=8,
    )
    if num_labels <= 1:
        return mask
    areas = stats[1:, cv2.CC_STAT_AREA]
    largest_label = int(np.argmax(areas)) + 1
    return (labels == largest_label).astype(np.uint8)

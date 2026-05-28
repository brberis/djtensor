"""
Animate the brokenness pipeline as it runs in PRODUCTION today on a
synthetic fragment + the real Galeocerdo Cuvier mean from Dataset 72.

Production = Kathie's notebook algorithm, exactly as published in
docs.local/shark_tooth_percent_brokenness.ipynb, plus a load_mask RGB
fallback that's necessary for our Mode A processed inputs (which have
no alpha channel). The size signal we compute alongside (mm² ratio) is
not shown in this animation -- it's a separate metric stored next to
the shape score, not part of the alignment math.

For algorithmic experiments we've considered but parked (principal-axis
pre-rotation, pad-before-rotate, sign convention, etc.), see
docs.local/brokenness-improvements-ideas.md.

Output: /usr/src/app/mediafiles/_tmp/brokenness_animation.gif
Run: docker compose exec backend python /usr/src/app/scripts/animate_brokenness.py
"""
import os
import sys
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.animation import FuncAnimation, PillowWriter
import cv2

sys.path.insert(0, "/usr/src/app")
# Kathie's algorithm, exactly as in her notebook
from datasets.brokenness.align import (  # noqa: E402
    sample_contour,
    align_contour_startpoints,
    try_rotations_and_shifts,
    keep_largest_island,
    normalize,
)

MEAN_PATH = "/usr/src/app/mediafiles/brokenness_reference/72/Galeocerdo Cuvier_mean_mask.png"
OUT_PATH = "/usr/src/app/mediafiles/_tmp/brokenness_animation.gif"
FPS = 10

# ---------------------------------------------------------------------------
# Real species mean + synthetic fragment
# ---------------------------------------------------------------------------
mean_raw = cv2.imread(MEAN_PATH, cv2.IMREAD_GRAYSCALE)
assert mean_raw is not None
species_mask = (mean_raw > 127).astype(np.uint8)
H, W = species_mask.shape


def make_fragment(species, crop_fraction=0.55, rotation_deg=25, tx=40, ty=-30, seed=42):
    h, w = species.shape
    frag = species.copy()
    cut_y = int(h * (1.0 - crop_fraction))
    frag[:cut_y, :] = 0
    rng = np.random.RandomState(seed)
    for x in range(w):
        if frag[cut_y:cut_y + 5, x].any():
            jag = int(rng.normal(0, 8))
            frag[: max(0, cut_y + jag), x] = 0
    M = cv2.getRotationMatrix2D((w // 2, h // 2), rotation_deg, 1.0)
    M[0, 2] += tx
    M[1, 2] += ty
    return cv2.warpAffine(frag, M, (w, h), flags=cv2.INTER_NEAREST)


fragment_initial = make_fragment(species_mask)

# ---------------------------------------------------------------------------
# Run Kathie's algorithm step by step, capturing intermediate state for the animation
# ---------------------------------------------------------------------------
fragment_cleaned = keep_largest_island(fragment_initial.copy())

# Sample contours (Kathie's step 1)
species_pts = sample_contour(species_mask, 100)
fragment_pts_initial = sample_contour(fragment_cleaned, 100)

# Match start points (Kathie's step 2)
fragment_pts_matched = align_contour_startpoints(species_pts, fragment_pts_initial)

# Centroid translation (Kathie's step 3 / Procrustes)
species_cx, species_cy = species_pts.mean(axis=0)
frag_cx, frag_cy = fragment_pts_initial.mean(axis=0)
dx0 = species_cx - frag_cx
dy0 = species_cy - frag_cy
M_procrustes = np.float32([[1, 0, dx0], [0, 1, dy0]])

# Brute-force search at Kathie's parameters (rotate_max=10)
PAD = 128
canvas_padded = 256 + 2 * PAD
mean_norm = normalize(species_mask, target_size=256, interpolation=cv2.INTER_NEAREST)
mean_padded = np.pad(mean_norm, PAD, mode='constant', constant_values=0)
tooth_norm = normalize(fragment_cleaned, target_size=256, interpolation=cv2.INTER_NEAREST)
tooth_padded = np.pad(tooth_norm, PAD, mode='constant', constant_values=0)

final_aligned_padded, _R, flipped_final, best_angle, best_shift, best_iou = try_rotations_and_shifts(
    tooth_padded, mean_padded, M_procrustes,
    rotate_max=10, angle_step=2, shift_max=15, shift_step=3,
    canvas=canvas_padded,
)
fragment_final = final_aligned_padded[PAD:PAD + 256, PAD:PAD + 256]
mean_final = mean_padded[PAD:PAD + 256, PAD:PAD + 256]

mean_pixels = int((mean_final > 0).sum())
missing_pixels = int(((mean_final > 0) & (fragment_final == 0)).sum())
pct_broken = missing_pixels / max(mean_pixels, 1) * 100


def iou(a, b):
    inter = ((a > 0) & (b > 0)).sum()
    uni = ((a > 0) | (b > 0)).sum()
    return inter / max(int(uni), 1)


# Pre-compute brute-force search candidates Kathie's algorithm would try
SEARCH_CANDIDATES = []
center = (canvas_padded // 2, canvas_padded // 2)
base = cv2.warpAffine(
    tooth_padded.astype(np.uint8), M_procrustes, (canvas_padded, canvas_padded),
    flags=cv2.INTER_NEAREST, borderMode=cv2.BORDER_CONSTANT, borderValue=0,
)
# Kathie's wider angle range (±10°)
for flip_label, base_cand in {"normal": base, "flipped": cv2.flip(base, 1)}.items():
    for angle in [-10, -6, -2, 0, 2, 6, 10]:
        R = cv2.getRotationMatrix2D(center, angle, 1.0)
        rotated = cv2.warpAffine(
            base_cand, R, (canvas_padded, canvas_padded),
            flags=cv2.INTER_NEAREST, borderMode=cv2.BORDER_CONSTANT, borderValue=0,
        )
        cand_iou = iou(rotated[PAD:PAD + 256, PAD:PAD + 256], mean_final)
        SEARCH_CANDIDATES.append((flip_label, angle, rotated[PAD:PAD + 256, PAD:PAD + 256], cand_iou))
SEARCH_CANDIDATES.append(("best", best_angle, fragment_final, best_iou))


STAGES = [
    ("intro_mean", 1.5, "Species archetype (gray): Galeocerdo Cuvier mean, averaged from ~500 complete teeth."),
    ("intro_frag", 1.5, "A new fragment (green) arrives at a random pose: rotated + translated."),
    ("sample_points", 2.0, "Step 1: sample 100 reference points along each outline."),
    ("match_points", 2.0, "Step 2: minimize sum of squared distances between paired points."),
    ("centroid_translate", 2.0, "Step 3: align centroids (slide fragment so its center sits on the mean's center)."),
    ("brute_force_search", 5.5, "Step 4: brute-force search ±10° rotation + ±15px shift + horizontal flip, pick max IoU."),
    ("highlight_missing", 2.5, "Step 5: red = mean covered but fragment not covered = missing."),
    ("result", 2.5, "Result: missing pixels / mean pixels = percent broken."),
]

FRAMES_PER_STAGE = [(name, int(dur * FPS), caption) for name, dur, caption in STAGES]
TOTAL = sum(n for _, n, _ in FRAMES_PER_STAGE)


def stage_at(f):
    acc = 0
    for name, n, caption in FRAMES_PER_STAGE:
        if f < acc + n:
            return name, f - acc, n, caption
        acc += n
    name, n, caption = FRAMES_PER_STAGE[-1]
    return name, n - 1, n, caption


def to_display(mask_256):
    return cv2.resize(mask_256.astype(np.uint8), (W, H), interpolation=cv2.INTER_NEAREST)


mean_display_from_padded = to_display(mean_final)
fragment_final_display = to_display(fragment_final)


fig, ax = plt.subplots(figsize=(8, 9))
fig.patch.set_facecolor("white")

GRAY = (0.78, 0.78, 0.78)
GREEN = (0.34, 0.78, 0.42)
RED = (0.86, 0.20, 0.20)


def overlay_mask(mask, rgb, alpha=0.65):
    out = np.zeros((mask.shape[0], mask.shape[1], 4), dtype=np.float32)
    out[mask > 0] = (*rgb, alpha)
    return out


def update(frame):
    ax.clear()
    ax.set_xlim(-30, W + 30)
    ax.set_ylim(H + 80, -40)
    ax.set_aspect("equal")
    ax.axis("off")

    name, sub, total, caption = stage_at(frame)

    def draw_species(alpha=0.55):
        ax.imshow(overlay_mask(species_mask, GRAY, alpha=alpha), extent=[0, W, H, 0])

    def draw_fragment(frag, alpha=0.7):
        ax.imshow(overlay_mask(frag, GREEN, alpha=alpha), extent=[0, frag.shape[1], frag.shape[0], 0])

    if name == "intro_mean":
        draw_species()
        ax.plot(species_pts[:, 0], species_pts[:, 1], color=(0.3, 0.3, 0.3), linewidth=1.5)
    elif name == "intro_frag":
        draw_species()
        draw_fragment(fragment_initial)
    elif name == "sample_points":
        draw_species(alpha=0.35)
        draw_fragment(fragment_initial, alpha=0.5)
        n_dots = int(100 * (sub + 1) / total)
        ax.scatter(species_pts[:n_dots, 0], species_pts[:n_dots, 1], c="black", s=12, zorder=5)
        ax.scatter(fragment_pts_initial[:n_dots, 0], fragment_pts_initial[:n_dots, 1],
                   c="darkgreen", s=12, zorder=5)
        caption = f"Step 1: sample reference points ({n_dots}/100)"
    elif name == "match_points":
        draw_species(alpha=0.35)
        draw_fragment(fragment_initial, alpha=0.5)
        n_offsets = 12
        progress = sub / total
        if progress < 0.8:
            offset_idx = int(progress / 0.8 * n_offsets) % n_offsets
            offset = offset_idx * (100 // n_offsets)
            rolled = np.roll(fragment_pts_initial, offset, axis=0)
        else:
            rolled = fragment_pts_initial
        ax.scatter(species_pts[:, 0], species_pts[:, 1], c="black", s=12, zorder=5)
        ax.scatter(rolled[:, 0], rolled[:, 1], c="darkgreen", s=12, zorder=5)
        for i in range(0, 100, 10):
            ax.plot([species_pts[i, 0], rolled[i, 0]], [species_pts[i, 1], rolled[i, 1]],
                    color=(0.4, 0.6, 0.9), linewidth=0.8, alpha=0.6)
        total_dist = np.sum((species_pts - rolled) ** 2)
        caption = f"Step 2: find minimum distance pairing (current: {total_dist:.0f})"
    elif name == "centroid_translate":
        draw_species(alpha=0.35)
        t = (sub + 1) / total
        cur_dx = dx0 * t
        cur_dy = dy0 * t
        M = np.float32([[1, 0, cur_dx], [0, 1, cur_dy]])
        cur_frag = cv2.warpAffine(fragment_cleaned, M, (W, H), flags=cv2.INTER_NEAREST)
        draw_fragment(cur_frag)
        ax.plot(species_cx, species_cy, marker="+", color="black",
                markersize=18, markeredgewidth=2.5, zorder=10)
        ax.plot(frag_cx + cur_dx, frag_cy + cur_dy, marker="o",
                color="darkgreen", markersize=8, zorder=10)
        if t < 1.0:
            ax.plot([species_cx, frag_cx + cur_dx], [species_cy, frag_cy + cur_dy],
                    color="black", linestyle="--", linewidth=1.0, alpha=0.4)
        caption = f"Step 3: centroid translation ({int(t * 100)}%)"
    elif name == "brute_force_search":
        idx = int((sub / total) * len(SEARCH_CANDIDATES))
        idx = min(idx, len(SEARCH_CANDIDATES) - 1)
        flip_label, angle, cand_mask_256, cand_iou = SEARCH_CANDIDATES[idx]
        cand_display = to_display(cand_mask_256)
        ax.imshow(overlay_mask(mean_display_from_padded, GRAY, alpha=0.35), extent=[0, W, H, 0])
        draw_fragment(cand_display)
        kind = "flipped" if flip_label == "flipped" else ("BEST" if flip_label == "best" else "normal")
        caption = (f"Step 4: candidate {idx + 1}/{len(SEARCH_CANDIDATES)} "
                   f"({kind}, angle={angle:+d}°, IoU={cand_iou:.2f}) — ±10° range")
    elif name == "highlight_missing":
        ax.imshow(overlay_mask(mean_display_from_padded, GRAY, alpha=0.35), extent=[0, W, H, 0])
        draw_fragment(fragment_final_display)
        miss = ((mean_display_from_padded > 0) & (fragment_final_display == 0)).astype(np.uint8)
        ax.imshow(overlay_mask(miss, RED, alpha=0.6), extent=[0, W, H, 0])
        caption = (f"Step 5: {missing_pixels:,} missing of {mean_pixels:,} mean pixels")
    else:
        ax.imshow(overlay_mask(mean_display_from_padded, GRAY, alpha=0.35), extent=[0, W, H, 0])
        draw_fragment(fragment_final_display)
        miss = ((mean_display_from_padded > 0) & (fragment_final_display == 0)).astype(np.uint8)
        ax.imshow(overlay_mask(miss, RED, alpha=0.6), extent=[0, W, H, 0])
        ax.text(W / 2, H + 50,
                f"Percent broken = {missing_pixels:,} / {mean_pixels:,} = {pct_broken:.1f}%  (IoU = {best_iou:.2f})",
                ha="center", fontsize=14, fontweight="bold", color=(0.55, 0.0, 0.0))
        caption = "Final brokenness percentage"

    ax.text(W / 2, -25, caption, ha="center", fontsize=11, color="black", wrap=True)
    ax.set_title("Kathie's brokenness alignment, step by step",
                 fontsize=13, fontweight="bold", pad=10)


ani = FuncAnimation(fig, update, frames=TOTAL, interval=1000 // FPS, blit=False)
os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
print(f"Rendering {TOTAL} frames at {FPS} fps -> {OUT_PATH}")
print(f"Original-method final: IoU={best_iou:.3f}, percent_broken={pct_broken:.1f}%")
ani.save(OUT_PATH, writer=PillowWriter(fps=FPS))
print(f"Saved: {OUT_PATH}  ({os.path.getsize(OUT_PATH) / 1024:.0f} KB)")

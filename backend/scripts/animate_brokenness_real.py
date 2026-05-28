"""
Animate Kathie's brokenness pipeline step by step on a REAL image from
the database (not a synthetic fragment). Uses the same input-path
lookup, same species-mean selection, same algorithm calls that the
production Celery task does.

Run: docker compose exec backend python manage.py shell -c "
    exec(open('/usr/src/app/scripts/animate_brokenness_real.py').read())"

Edit IMAGE_ID below to animate a different image. Default is 101342
(RAW_574595D.png in Dataset 167, the one Cris asked about).
"""
import os
import sys
import json as _json
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.animation import FuncAnimation, PillowWriter
import cv2
from PIL import Image as PILImage
from django.conf import settings

sys.path.insert(0, "/usr/src/app")
from datasets.models import Image as DbImage
from datasets.brokenness.align import (
    sample_contour, align_contour_startpoints, try_rotations_and_shifts,
    keep_largest_island, normalize,
)
from datasets.brokenness.estimate import (
    load_mask, get_aspect_ratio, get_quantile_index,
)

# ---------------------------------------------------------------------------
# Config: which image, which reference dataset
# ---------------------------------------------------------------------------
IMAGE_ID = 101342  # RAW_574595D.png in Dataset 167
REFERENCE_DATASET_ID = 72
FPS = 10

img = DbImage.objects.get(pk=IMAGE_ID)
species_name = img.label.name
print(f"Animating image #{IMAGE_ID}: {os.path.basename(img.image.name)}")
print(f"  Dataset: {img.dataset_id}, label: {species_name}, source_kind: {img.source_kind}")

OUT_PATH = f"/usr/src/app/mediafiles/_tmp/brokenness_animation_real_{IMAGE_ID}.gif"

# ---------------------------------------------------------------------------
# Mirror production's input-path selection (compute_brokenness_for_dataset)
# ---------------------------------------------------------------------------
input_path = img.image.path
if img.source_kind == 'raw' and img.tooth_mask_url:
    rel = img.tooth_mask_url.replace(settings.MEDIA_URL.rstrip('/') + '/', '', 1)
    candidate = os.path.join(settings.MEDIA_ROOT, rel)
    if os.path.exists(candidate):
        input_path = candidate
        print(f"  source_kind=raw -> using tooth_mask_url: {input_path}")
elif img.source_kind == 'processed':
    fname = os.path.basename(img.image.name)
    if fname.startswith('RAW_'):
        sibling_name = 'MASKED_' + fname[len('RAW_'):]
        sibling = DbImage.objects.filter(
            dataset_id=img.dataset_id,
            image__endswith='/' + sibling_name,
        ).first()
        if sibling and os.path.exists(sibling.image.path):
            input_path = sibling.image.path
            print(f"  source_kind=processed, RAW_* -> using sibling MASKED_: {input_path}")

# ---------------------------------------------------------------------------
# Load the fragment and the species mean (same selection as production)
# ---------------------------------------------------------------------------
fragment_initial = load_mask(input_path)
tooth_rgba_full = np.array(PILImage.open(input_path).convert('RGBA'))
tooth_rgba_full[:, :, 3] = (fragment_initial > 0).astype('uint8') * 255

# Mean lookup
ref_dir = os.path.join(settings.MEDIA_ROOT, 'brokenness_reference', str(REFERENCE_DATASET_ID))
edges_path = os.path.join(ref_dir, 'quantile_edges.json')
with open(edges_path) as f:
    all_quantile_edges = _json.load(f)
aspect = get_aspect_ratio(fragment_initial)
quantile_edges = np.array(all_quantile_edges[species_name])
q_idx = get_quantile_index(aspect, quantile_edges)
mean_mask_path = os.path.join(ref_dir, f'{species_name}_mean_mask_q{q_idx}.png')
mean_raw = cv2.imread(mean_mask_path, cv2.IMREAD_GRAYSCALE)
mean_binary_full = (mean_raw > 127).astype('uint8')
print(f"  aspect={aspect:.2f} -> quantile Q{q_idx} -> {os.path.basename(mean_mask_path)}")

# For visualization we'll work at the same 256x256 scale Kathie's algorithm uses.
# This matches what's drawn in the per-image overlay PNG.
H, W = 256, 256
species_mask = normalize(mean_binary_full, target_size=256, interpolation=cv2.INTER_NEAREST)
fragment_initial_256 = normalize(keep_largest_island(fragment_initial), target_size=256,
                                 interpolation=cv2.INTER_NEAREST)

# ---------------------------------------------------------------------------
# Run Kathie's algorithm step by step (capture intermediate states)
# ---------------------------------------------------------------------------
species_pts = sample_contour(species_mask, 100)
fragment_pts = sample_contour(fragment_initial_256, 100)
fragment_pts_matched = align_contour_startpoints(species_pts, fragment_pts)

species_cx, species_cy = species_pts.mean(axis=0)
frag_cx, frag_cy = fragment_pts.mean(axis=0)
dx0 = species_cx - frag_cx
dy0 = species_cy - frag_cy

PAD = 128
canvas_padded = 256 + 2 * PAD
mean_padded = np.pad(species_mask, PAD, mode='constant', constant_values=0)
tooth_padded = np.pad(fragment_initial_256, PAD, mode='constant', constant_values=0)
M_procrustes = np.float32([[1, 0, dx0], [0, 1, dy0]])

final_padded, _R, flipped_final, best_angle, best_shift, best_iou = try_rotations_and_shifts(
    tooth_padded, mean_padded, M_procrustes,
    rotate_max=10, angle_step=2, shift_max=15, shift_step=3,
    canvas=canvas_padded,
)
fragment_final = final_padded[PAD:PAD + 256, PAD:PAD + 256]
mean_final = mean_padded[PAD:PAD + 256, PAD:PAD + 256]
mean_pixels = int((mean_final > 0).sum())
missing_pixels = int(((mean_final > 0) & (fragment_final == 0)).sum())
pct_broken = missing_pixels / max(mean_pixels, 1) * 100
print(f"  final: combined={pct_broken:.1f}%, IoU={best_iou:.2f}")


def iou(a, b):
    inter = ((a > 0) & (b > 0)).sum()
    uni = ((a > 0) | (b > 0)).sum()
    return inter / max(int(uni), 1)


# Precompute brute-force search candidates
SEARCH_CANDIDATES = []
center = (canvas_padded // 2, canvas_padded // 2)
base = cv2.warpAffine(
    tooth_padded.astype(np.uint8), M_procrustes, (canvas_padded, canvas_padded),
    flags=cv2.INTER_NEAREST, borderMode=cv2.BORDER_CONSTANT, borderValue=0,
)
for flip_label, base_cand in {"normal": base, "flipped": cv2.flip(base, 1)}.items():
    for angle in [-10, -6, -2, 0, 2, 6, 10]:
        R = cv2.getRotationMatrix2D(center, angle, 1.0)
        rotated = cv2.warpAffine(base_cand, R, (canvas_padded, canvas_padded),
                                 flags=cv2.INTER_NEAREST, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
        cand_iou = iou(rotated[PAD:PAD + 256, PAD:PAD + 256], mean_final)
        SEARCH_CANDIDATES.append((flip_label, angle, rotated[PAD:PAD + 256, PAD:PAD + 256], cand_iou))
SEARCH_CANDIDATES.append(("best", best_angle, fragment_final, best_iou))


STAGES = [
    ("intro_mean", 1.5, f"Species archetype: {species_name} mean from Dataset {REFERENCE_DATASET_ID} (Q{q_idx})."),
    ("intro_frag", 1.5, f"Real fragment from image #{IMAGE_ID} ({os.path.basename(img.image.name)})."),
    ("sample_points", 2.0, "Step 1: sample 100 reference points along each outline."),
    ("match_points", 2.0, "Step 2: minimize sum of squared distances between paired points."),
    ("centroid_translate", 2.0, "Step 3: align centroids."),
    ("brute_force_search", 5.5, "Step 4: brute-force search rotation + shift + flip, pick max IoU."),
    ("highlight_missing", 2.5, "Step 5: red = mean covered but fragment NOT covered = missing."),
    ("result", 2.5, "Result matches what the review-UI badge shows for this image."),
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


fig, ax = plt.subplots(figsize=(8, 9))
fig.patch.set_facecolor("white")
GRAY = (0.78, 0.78, 0.78); GREEN = (0.34, 0.78, 0.42); RED = (0.86, 0.20, 0.20)


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
        draw_fragment(fragment_initial_256)
    elif name == "sample_points":
        draw_species(alpha=0.35); draw_fragment(fragment_initial_256, alpha=0.5)
        n_dots = int(100 * (sub + 1) / total)
        ax.scatter(species_pts[:n_dots, 0], species_pts[:n_dots, 1], c="black", s=12, zorder=5)
        ax.scatter(fragment_pts[:n_dots, 0], fragment_pts[:n_dots, 1], c="darkgreen", s=12, zorder=5)
        caption = f"Step 1: sample reference points ({n_dots}/100)"
    elif name == "match_points":
        draw_species(alpha=0.35); draw_fragment(fragment_initial_256, alpha=0.5)
        progress = sub / total
        n_offsets = 12
        if progress < 0.8:
            offset = (int(progress / 0.8 * n_offsets) % n_offsets) * (100 // n_offsets)
            rolled = np.roll(fragment_pts, offset, axis=0)
        else:
            rolled = fragment_pts
        ax.scatter(species_pts[:, 0], species_pts[:, 1], c="black", s=12, zorder=5)
        ax.scatter(rolled[:, 0], rolled[:, 1], c="darkgreen", s=12, zorder=5)
        for i in range(0, 100, 10):
            ax.plot([species_pts[i, 0], rolled[i, 0]], [species_pts[i, 1], rolled[i, 1]],
                    color=(0.4, 0.6, 0.9), linewidth=0.8, alpha=0.6)
        total_dist = np.sum((species_pts - rolled) ** 2)
        caption = f"Step 2: min sum of squared distances (current: {total_dist:.0f})"
    elif name == "centroid_translate":
        draw_species(alpha=0.35)
        t = (sub + 1) / total
        cur_dx = dx0 * t; cur_dy = dy0 * t
        M = np.float32([[1, 0, cur_dx], [0, 1, cur_dy]])
        cur_frag = cv2.warpAffine(fragment_initial_256, M, (W, H), flags=cv2.INTER_NEAREST)
        draw_fragment(cur_frag)
        ax.plot(species_cx, species_cy, marker="+", color="black", markersize=18, markeredgewidth=2.5, zorder=10)
        ax.plot(frag_cx + cur_dx, frag_cy + cur_dy, marker="o", color="darkgreen", markersize=8, zorder=10)
        if t < 1.0:
            ax.plot([species_cx, frag_cx + cur_dx], [species_cy, frag_cy + cur_dy],
                    color="black", linestyle="--", linewidth=1.0, alpha=0.4)
        caption = f"Step 3: centroid translation ({int(t * 100)}%)"
    elif name == "brute_force_search":
        idx = int((sub / total) * len(SEARCH_CANDIDATES))
        idx = min(idx, len(SEARCH_CANDIDATES) - 1)
        flip_label, angle, cand_mask_256, cand_iou = SEARCH_CANDIDATES[idx]
        ax.imshow(overlay_mask(species_mask, GRAY, alpha=0.35), extent=[0, W, H, 0])
        draw_fragment(cand_mask_256)
        kind = "flipped" if flip_label == "flipped" else ("BEST" if flip_label == "best" else "normal")
        caption = (f"Step 4: candidate {idx + 1}/{len(SEARCH_CANDIDATES)} "
                   f"({kind}, angle={angle:+d}°, IoU={cand_iou:.2f})")
    elif name == "highlight_missing":
        ax.imshow(overlay_mask(species_mask, GRAY, alpha=0.35), extent=[0, W, H, 0])
        draw_fragment(fragment_final)
        miss = ((species_mask > 0) & (fragment_final == 0)).astype(np.uint8)
        ax.imshow(overlay_mask(miss, RED, alpha=0.6), extent=[0, W, H, 0])
        caption = f"Step 5: {missing_pixels:,} missing of {mean_pixels:,} mean pixels"
    else:
        ax.imshow(overlay_mask(species_mask, GRAY, alpha=0.35), extent=[0, W, H, 0])
        draw_fragment(fragment_final)
        miss = ((species_mask > 0) & (fragment_final == 0)).astype(np.uint8)
        ax.imshow(overlay_mask(miss, RED, alpha=0.6), extent=[0, W, H, 0])
        ax.text(W / 2, H + 50,
                f"Percent broken = {missing_pixels:,} / {mean_pixels:,} = {pct_broken:.1f}%  (IoU = {best_iou:.2f})",
                ha="center", fontsize=14, fontweight="bold", color=(0.55, 0.0, 0.0))
        caption = f"Same number you see on image #{IMAGE_ID} in the UI"

    ax.text(W / 2, -25, caption, ha="center", fontsize=11, color="black", wrap=True)
    ax.set_title(f"Brokenness on real fragment: image #{IMAGE_ID} ({species_name})",
                 fontsize=13, fontweight="bold", pad=10)


ani = FuncAnimation(fig, update, frames=TOTAL, interval=1000 // FPS, blit=False)
os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
print(f"Rendering {TOTAL} frames at {FPS} fps -> {OUT_PATH}")
ani.save(OUT_PATH, writer=PillowWriter(fps=FPS))
print(f"Saved: {OUT_PATH}  ({os.path.getsize(OUT_PATH) / 1024:.0f} KB)")

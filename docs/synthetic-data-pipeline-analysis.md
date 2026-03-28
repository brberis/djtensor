# Synthetic Data Pipeline for Fragmentary Shark Teeth

**Date:** 2026-03-28
**Context:** SharkAI / DjTensor — NSF Grant 2147625, University of Florida
**Related Meeting:** SharkAI Research Meeting #2 (2026-03-25, chaired by Arthur)

---

## The Problem

Teeth below ~50% completeness were never classified by species because paleontologists couldn't identify them visually, so they never entered the dataset. The model has no training data for the hardest cases it needs to handle. This is a **selection bias** inherent to the collection process.

**Goal:** Generate synthetic fragmentary tooth images with known species ground truth to train the model on partial/fragmentary specimens.

---

## Team Roles (from March 25 meeting)

| Person | Responsibility |
|--------|---------------|
| **Cristobal** | Model runs, GPU resources, 2D synthetic fragmentation pipeline |
| **Arthur** | 3D approaches to synthetic data generation (Blender/volumetric) |
| **Alexa** | Photographing specimens, focus on 50-60% grade teeth first |
| **Katie** | Quantitative automation for binning teeth into finer resolution groups |
| **Maria, Stephanie** | Imaging and folder organization based on Katie's process |

---

## Options Explored

### Option A — 2D Fracture Mask Learning (simpler)

- Use the few real fragments as examples of how fracture edges look
- Train a small model to learn fracture edge geometry (contours, textures)
- Apply those masks to segmented complete teeth
- **Pros:** No 3D needed, fast to implement
- **Cons:** May look unrealistic with very few real examples

### Option B — 3D Synthetic Fracture (Arthur's track)

- If 3D scans exist (photogrammetry, micro-CT), apply volumetric fracture (Blender Cell Fracture, Voronoi)
- Render fragments from multiple angles as 2D images
- **Pros:** Physically realistic, full control of % completeness, infinite viewing angles
- **Cons:** Requires 3D scans, more complex pipeline
- **Note:** Arthur owns this track per the meeting

### Option C — GAN/Diffusion-based (most advanced)

- Use generative models (Stable Diffusion inpainting + LoRA fine-tuning) to synthesize realistic fractures
- Given a complete tooth + fracture mask, the model generates realistic broken edges
- **Requirements:**
  - ~50-100 real fragment images for LoRA fine-tuning (no pairs needed)
  - 12GB+ VRAM (A100 is more than sufficient)
  - Stack: `diffusers`, `transformers`, `accelerate`, `peft`, `torch >= 2.0`
- **Critical:** SD inpainting without fine-tuning generates edges that look like human teeth or ceramic, not fossilized specimens. LoRA fine-tune with real fossil fragment images is mandatory.
- **Blocker:** Depends on Alexa delivering photographed specimens (50-60% grade)

### Option D — Geometric Augmentation + Edge Texture Blending (hybrid pragmatic)

- Segment complete tooth into binary mask
- Generate fracture shapes geometrically (Voronoi polygons, Bezier curves with noise)
- Blend real fracture edge textures from existing fragments onto generated edges
- **Pros:** No 3D or GAN needed, controllable, reproducible, can start immediately
- **Cons:** Less variety than generative approaches

---

## Recommended Priority Order

1. **Run threshold experiment first** — Test existing model with progressively fragmentary teeth to find where accuracy degrades. This establishes the baseline and tells us *where* the model breaks and *how much* synthetic data is needed at each completeness level. (Meeting action item assigned to Cristobal)

2. **Start D+A (geometric fracture masks)** — Can begin immediately with existing complete tooth images. No external dependencies. Natural extension of existing augmentation pipeline (could become 12th boolean flag `synthetic_fracture` alongside existing `cutout`, `gaussian_noise`, etc. in `DataAugmentation` model).

3. **Wait for Alexa's photos** — Once she delivers 50-60% grade specimens, use them to:
   - Validate D+A synthetic outputs against real fragments
   - Serve as LoRA training data for Option C

4. **Arthur's 3D work runs in parallel** — If he produces results, they complement rather than replace the 2D approach. These are parallel tracks, not competing alternatives.

---

## Integration with Existing Codebase

### Current Augmentation Pipeline

The `DataAugmentation` model in `backend/feature_extractor/models.py` already has 11 boolean flags applied during training in `tasks.py`:

- grayscale, random_grayscale
- horizontal_flip, vertical_flip
- random_rotation (+-15 degrees)
- zoom (5-15%), brightness_contrast (+-10%)
- random_crop, gaussian_noise, gaussian_blur, cutout

A synthetic fracture augmentation would fit as a new flag in this same pattern, applied as a custom transform during the training data loading step.

### Target Completeness Bins

Should align with Katie's binning scheme (pending her quantitative automation work). Proposed bins: 80%, 70%, 60%, 50%, 40%.

### Data Safety

Any synthetic data pipeline must save outputs **outside** Docker volumes or have reliable backups. Dataset_72 was previously lost to a Docker volume prune incident — this cannot happen again with synthetic training data.

---

## Key Meeting Insights

- **Ideal scenario** is using actual fossil fragments so the model learns real edge nuances — but Alexa's spreadsheet showed this is impractical due to species class limits in the collection.
- **Synthetic advantage:** Guarantees known species ID (the ground truth comes from the complete tooth before fragmentation). Katie supports this approach.
- **Future direction:** Train a new model with partial/fragmentary teeth, then feed unlabeled smaller fragments to it for classification.

---

## Hardware Available

- **Production:** NVIDIA A100 GPU on server 151.242.102.34 (Proxmox VM/CT 121)
- **DGX Spark (spark-3):** 130.44.36.85, GB10 GPU, ARM64 (secondary deployment)
- Both are sufficient for all options including LoRA fine-tuning

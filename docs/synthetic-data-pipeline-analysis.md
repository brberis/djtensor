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

## Class-Specific Fracture Simulation

### The Problem with Generic Fractures

A naive geometric fracture (random Voronoi or Bezier cut) does not account for species-specific tooth morphology. Different species break differently:

- **Carcharocles megalodon** — thick, triangular, heavy enameloid. Tends to break at root-crown junction or lose serration edges
- **Hemipristis serra** — thin, curved blade. Fractures along the blade length
- **Carcharhinus** — small, narrow. Often loses the tip or root lobes

The **diagnostic features** paleontologists use to ID species (serrations, root shape, blade curvature, nutrient groove) are in specific locations. A fracture that removes vs. preserves those features has very different effects on classification.

### Three Paths to Class-Specific Fractures

#### Path 1 — Data-Driven (best, needs data)

Once Alexa photographs enough real fragments per species:
1. Segment each real fragment → binary mask
2. Segment same species' complete teeth → reference mask
3. Compute the "missing region" (difference between full and fragment)
4. Build a **fracture pattern distribution per species** — where do fractures typically occur? What shapes?
5. Sample from that distribution for new fractures

Needs ~20-30 real fragments per species. **Blocked** by Alexa's collection work.

#### Path 2 — Morphology-Guided Heuristics (can start now, needs team input)

Encode paleontological knowledge about how each species' teeth break:
1. Define a **tooth anatomy map** per species: crown, root, serrations, tip, blade regions
2. Define **fracture probability weights** per region per species

Example:
```
megalodon_fracture_weights = {
    "root_loss": 0.4,       # 40% of fractures lose root
    "tip_loss": 0.3,        # 30% lose the tip
    "lateral_break": 0.2,   # 20% break along the blade
    "serration_chip": 0.1   # 10% chip serration edges
}
```

Requires **input from Arthur and the paleontology team** to define rules, but no training data.

#### Path 3 — Generic + Iterative Validation (pragmatic bootstrap)

1. Generate generic geometric fractures
2. Show to team via Augmentation Preview UI
3. Paleontologists flag unrealistic ones
4. Constrain the fracture generator based on feedback
5. Iterate until validated

### Recommended Approach: Combine Paths 2 + 3

1. Start with **generic geometric fractures** with basic species-specific weight maps
2. Use **Augmentation Preview UI** to iterate with the team
3. When Alexa's data arrives, upgrade to **data-driven distributions** (Path 1)

The `synthetic_fracture.py` module accepts per-species fracture weight maps via a JSON config, making it easy to refine without code changes.

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

## Tooth Completeness Percentage Detection

A key requirement is automatically detecting what percentage of a tooth is present — for any image in training datasets, testing datasets, or synthetic outputs.

### Approaches Analyzed

#### Approach 1 — Segmentation + Species Reference Area (recommended first)

- Segment tooth from background using thresholding or simple model (images have standardized white/uniform backgrounds)
- Build a reference area per species from complete tooth dataset (average pixel area of segmented complete teeth)
- `completeness % = fragment_area / species_reference_area`
- **Pros:** Simple, interpretable, works with existing data, no model training needed for the detector itself
- **Cons:** Sensitive to image scale/resolution (mitigated by standardized 384px images)

#### Approach 2 — Convex Hull Ratio (species-agnostic)

- Segment tooth, compute its convex hull
- `completeness_proxy = tooth_area / convex_hull_area`
- **Pros:** No reference data needed, species-independent
- **Cons:** Not a true "percentage of full tooth" — more of a fragmentation score. Naturally concave teeth skew results.

#### Approach 3 — Shape Completion Network (most accurate, more complex)

- Train a U-Net to predict the full tooth mask from a fragment mask
- `completeness % = fragment_area / predicted_full_area`
- **Pros:** Most accurate, learns species-specific morphology
- **Cons:** Needs training data (can bootstrap with synthetic fragments from complete teeth)

### Recommended Detection Strategy

Start with **Approach 1** — it's immediate, interpretable, and aligns with Katie's binning work. The standardized image resolution (384px) and consistent backgrounds make segmentation straightforward. Upgrade to Approach 3 later using synthetic fragments as training data for the shape completion network.

---

## UI Visualization Tool

A new UI page/section is needed to:

1. **Preview augmentation results** — Show original image alongside all enabled augmentation transforms applied to it, so researchers can visually verify augmentation quality before training
2. **Analyze synthetic fragments** — Display generated synthetic fragments with their computed completeness percentage, organized by species and completeness bin
3. **Compare real vs. synthetic** — Side-by-side view of real fragments (from Alexa's photos) and synthetic ones at similar completeness levels for validation

This tool serves both as a development aid (tuning augmentation parameters) and a research tool (validating synthetic data quality with the paleontology team).

---

## Feature Visibility Control

Since this is a production server used by the research team, all synthetic data features are **admin-only by default**. A toggle in the Settings page (Admin Settings section) allows the admin to expose these tools to the team when they're ready.

- **Admin (superuser):** Always sees all synthetic data tools (Augmentation page, completeness badges, synthetic generation buttons, synthetic_fracture training flag)
- **Team members (toggle OFF):** Cannot see or access any synthetic data features
- **Team members (toggle ON):** Full access to all synthetic data features

This is implemented via a `SiteSettings` singleton model with a `show_synthetic_tools` boolean flag, a reusable `IsSyntheticToolsEnabled` permission class for backend API protection, and a frontend context check that guards all new UI elements.

---

## Hardware Available

- **Production:** NVIDIA A100 GPU on server 151.242.102.34 (Proxmox VM/CT 121)
- **DGX Spark (spark-3):** 130.44.36.85, GB10 GPU, ARM64 (secondary deployment)
- Both are sufficient for all options including LoRA fine-tuning

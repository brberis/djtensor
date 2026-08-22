# Dark tooth roots are excluded from the measured area

**Status:** open, diagnosed, fix prototyped and validated, not applied
**Found:** 2026-08-22, by eye, from the green mask overlay in the review inspector
**Affects:** `tooth_area_mm2` on Datasets 168 and 169, and therefore every
completeness figure derived from them

## What happens

Where a tooth's root is nearly as dark as the black cloth it is photographed
on, the foreground threshold cannot separate the two, and the segmentation
drops the root in speckles. Those pixels are then missing from the area.

This is not a display problem. On `O_megalodon_raw_t_n_v__CMM-V-3313-S
lingual.jpg` (image 103505) all three numbers agree exactly:

| | pixels |
|---|---|
| implied by stored `tooth_area_mm2` | 755,742 |
| opaque pixels in the mask PNG | 755,742 |
| `segment_blobs` blob `area_px` | 755,742 |

The overlay is a faithful picture of what was counted, and the root was not
counted. That tooth is under-measured by about 11%.

## How much of the set is affected

Interior holes alone, measured over 600 images: median 0.04%, p90 0.8%,
p99 4.4%, worst 7.2%; 8.5% of images lose more than 1% of their area.

That is a floor, not the total. Where the root's outer edge is cut away
entirely there is no hole to fill, so the loss does not appear in that
figure at all. The real error on dark-rooted teeth is larger.

## Prototyped fix

Hysteresis on the tooth blob: seed from the current threshold, then grow into
connected pixels above a lower one, so a root that is continuous with the
crown is recovered while unconnected cloth is not.

Naive hysteresis is NOT safe. Two of the three largest growers were leaks and
one absorbed the FLMNH scale card into the tooth outline. Two guards fix it:

1. accept grown pixels only within 25 px of the existing tooth mask
2. open the result (3 iterations), then union with the original so nothing is
   ever lost, then fill holes

| case | naive | + adjacency | + opening |
|---|---|---|---|
| 103505 recover dark root | +13.0% | +11.1% | **+11.0%** |
| 102668 reject cloth patch | +35.6% | +3.8% | **+0.5%** |
| 103887 reject scale card | +14.9% | +0.8% | **+0.8%** |

Validated on 240 images: median +0.6%, p90 +2.5%, max +9.9%, nothing above
10%, nothing shrank. Before the guards, 12 of 193 grew more than 10%.

## Where the fix belongs

NOT in `_foreground_mask`. That function also drives scale-bar and label
detection, and widening the mask globally risks re-merging a card with its
catalog label, which took real work to fix. Apply it as a refinement to the
blob already classified as the tooth, leaving scale detection untouched.

## What must NOT be assumed

Megalodon was expected to gain most, since dark roots concentrate there. It
did not. Every species lands between 0.3% and 1.5% median gain. This is a
property of individual photographs, not of species, and it is **not** the
explanation for the megalodon disagreement with Alexa's estimates. That gap
is still unexplained.

## Before applying

Re-measuring 4,326 teeth moves the per-species reference areas and therefore
every completeness number, including the comparison table sent to Bruce and
Alexa on 2026-08-19. Sequence should be:

1. apply the refinement to the tooth blob only
2. re-run the known-complete-teeth check as the gate: scoring the 3,111
   complete teeth with our own metric currently calls 35% of them less than
   80% complete, and that figure should improve, not worsen
3. regenerate the comparison against Alexa's sheet
4. send the team a short correction

## Reproducing

The prototype lived in scratch scripts and was not committed. The recipe is
fully specified above; `datasets/tooth_mask.py` has the mask rendering and
`datasets/scale_calibration.py::_foreground_mask` has the current threshold.

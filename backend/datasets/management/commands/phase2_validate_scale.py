# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: phase2_validate_scale.py
# Copyright (c) 2024

"""
Biological sanity check for the scale-bar calibration.

A calibration bug is invisible in the numbers themselves: 0.29 mm/px looks as
reasonable as 0.03 mm/px. It only becomes obvious when the resulting tooth
dimensions are compared against what the species can actually be. This command
runs the detector over a sample of a species folder and reports how many teeth
land inside a plausible length range.

Usage:

    # Validate every species folder under a directory
    python manage.py phase2_validate_scale /data_shark --per-species 40

    # Validate one folder, listing each failure
    python manage.py phase2_validate_scale /data_shark/H_serra_raw_all --verbose
"""

from __future__ import annotations

import glob
import os
import random
import statistics
from typing import Dict, List, Optional, Tuple

from django.core.management.base import BaseCommand, CommandError

from datasets.scale_calibration import detect_scale_bar


# Plausible maximum tooth crown length in mm, by species. Deliberately
# generous: the point is to catch order-of-magnitude errors, not to police
# biology. A tooth outside these bounds means the calibration is wrong.
SPECIES_LENGTH_MM: Dict[str, Tuple[float, float]] = {
    # Baseline folder names.
    'c_carcharias': (8.0, 75.0),
    'c_leucas': (5.0, 40.0),
    'g_cuvier': (6.0, 50.0),
    'h_serra': (5.0, 45.0),
    'i_hastalis': (10.0, 85.0),
    'o_megalodon': (15.0, 180.0),
    # Fragment folder names, which spell the binomial out in full. Without
    # these the fragment set matched no species, and an unmatched folder was
    # recorded as 'ok' WITHOUT any plausibility check, so a whole dataset
    # could report zero implausible results while never being checked.
    'carcharodon_carcharias': (8.0, 75.0),
    'carcharias_leucas': (5.0, 40.0),
    'carcharhinus_leucas': (5.0, 40.0),
    'galeocerdo_cuvier': (6.0, 50.0),
    'hemipristis_serra': (5.0, 45.0),
    'isurus_hastalis': (10.0, 85.0),
    'otodus_megalodon': (15.0, 180.0),
}

# Any tooth beyond this is impossible for every species in the study and
# indicates a gross calibration failure rather than a borderline case.
ABSURD_LENGTH_MM = 200.0


def _species_key(folder_name: str) -> Optional[str]:
    lowered = folder_name.lower()
    for key in SPECIES_LENGTH_MM:
        if lowered.startswith(key):
            return key
    return None


class Command(BaseCommand):
    help = (
        'Validate scale-bar calibration by checking that computed tooth '
        'lengths are biologically plausible for their species.'
    )

    def add_arguments(self, parser):
        parser.add_argument('root', help='species folder, or a directory of species folders')
        parser.add_argument('--per-species', type=int, default=30,
                            help='images to sample per species folder (default 30)')
        parser.add_argument('--seed', type=int, default=17,
                            help='sampling seed, for reproducible runs')
        parser.add_argument('--verbose', action='store_true',
                            help='list every implausible image')
        parser.add_argument('--fail-under', type=float, default=None,
                            help='exit non-zero if the plausible rate falls below this (0-1)')

    def handle(self, *args, **opts):
        root = os.path.abspath(opts['root'])
        if not os.path.isdir(root):
            raise CommandError('not a directory: %s' % root)

        folders = [root]
        subdirs = sorted(
            os.path.join(root, d) for d in os.listdir(root)
            if os.path.isdir(os.path.join(root, d))
        )
        if subdirs and _species_key(os.path.basename(root)) is None:
            folders = subdirs

        rng = random.Random(opts['seed'])
        overall_ok = overall_n = 0
        rows: List[Tuple[str, int, int, int, int, float]] = []

        for folder in folders:
            name = os.path.basename(folder)
            key = _species_key(name)
            if key is None:
                self.stdout.write(self.style.WARNING('skip %s (unknown species)' % name))
                continue
            files = sorted(glob.glob(os.path.join(folder, '**', '*.*'), recursive=True))
            files = [f for f in files if f.lower().endswith(('.jpg', '.jpeg', '.png', '.tif', '.tiff'))]
            if not files:
                continue
            sample = rng.sample(files, min(opts['per_species'], len(files)))

            lo, hi = SPECIES_LENGTH_MM[key]
            ok = absurd = uncal = 0
            lengths: List[float] = []
            for path in sample:
                length_mm = self._tooth_length_mm(path)
                if length_mm is None:
                    uncal += 1
                    continue
                lengths.append(length_mm)
                if lo <= length_mm <= hi:
                    ok += 1
                elif length_mm > ABSURD_LENGTH_MM:
                    absurd += 1
                    if opts['verbose']:
                        self.stdout.write('    %8.1f mm  %s' % (length_mm, os.path.basename(path)))
                elif opts['verbose']:
                    self.stdout.write('    %8.1f mm  %s' % (length_mm, os.path.basename(path)))

            measured = len(lengths)
            rate = (ok / measured) if measured else 0.0
            median_len = statistics.median(lengths) if lengths else 0.0
            rows.append((name, measured, ok, absurd, uncal, median_len))
            overall_ok += ok
            overall_n += measured

            style = self.style.SUCCESS if rate >= 0.8 else self.style.ERROR
            self.stdout.write(style(
                '%-26s %3d/%3d plausible (%4.0f%%)  median %6.1f mm   '
                'absurd %2d  uncalibrated %2d   [expect %.0f-%.0f mm]'
                % (name, ok, measured, rate * 100, median_len, absurd, uncal, lo, hi)))

        if not overall_n:
            raise CommandError('no images could be calibrated')

        overall_rate = overall_ok / overall_n
        self.stdout.write('')
        self.stdout.write('OVERALL: %d/%d plausible (%.1f%%)'
                          % (overall_ok, overall_n, overall_rate * 100))

        limit = opts['fail_under']
        if limit is not None and overall_rate < limit:
            raise CommandError(
                'plausible rate %.3f is below --fail-under %.3f' % (overall_rate, limit))

    def _tooth_length_mm(self, path: str) -> Optional[float]:
        """Longest tooth bbox side in mm, or None when uncalibrated."""
        try:
            result = detect_scale_bar(path)
        except Exception:
            return None
        if not result.mm_per_pixel:
            return None
        tooth = next((b for b in result.blobs if b.classification == 'tooth'), None)
        if tooth is None:
            return None
        x0, y0, x1, y1 = tooth.bbox
        return max(x1 - x0 + 1, y1 - y0 + 1) * result.mm_per_pixel

# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: phase2_scale_report.py
# Copyright (c) 2024

"""
Full-batch scale-calibration census, for reporting to the team.

Runs the calibration over every image in a directory tree and classifies each
one, so we can say exactly how many photographs are usable for physical
(mm-anchored) measurement and why the rest are not.

Outcome per image, in priority order:

  ok             calibrated, tooth found, length biologically plausible
  implausible    calibrated but the tooth size is impossible for its species
  no_scale       no scale card could be read (usually no card in frame)
  no_tooth       card read, but no tooth blob was isolated
  error          the detector raised

Resolution is reported independently of outcome, because a low-resolution
image is not automatically unusable, and the two questions ("is it small?"
and "did it calibrate?") need separate answers.

Usage:
    python manage.py phase2_scale_report /data_shark --csv /tmp/scale_report.csv
"""

from __future__ import annotations

import csv
import glob
import os
import statistics
from collections import Counter, defaultdict
from typing import Dict, List, Optional, Tuple

from PIL import Image as PILImage
from django.core.management.base import BaseCommand, CommandError

from datasets.scale_calibration import detect_scale_bar


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

# Below this long edge the ingest downscale spec no longer holds and a small
# tooth can fall under the 384 px training-crop floor.
LOW_RES_PX = 2500
VERY_LOW_RES_PX = 1200

IMAGE_EXTS = ('.jpg', '.jpeg', '.png', '.tif', '.tiff')


def _species_key(folder_name: str) -> Optional[str]:
    lowered = folder_name.lower()
    for key in SPECIES_LENGTH_MM:
        if lowered.startswith(key):
            return key
    return None


class Command(BaseCommand):
    help = 'Census of scale-bar calibration coverage across the whole batch.'

    def add_arguments(self, parser):
        parser.add_argument('root')
        parser.add_argument('--csv', default=None, help='write per-image rows here')
        parser.add_argument('--limit', type=int, default=None,
                            help='cap images per species (for a quick run)')

    def handle(self, *args, **opts):
        root = os.path.abspath(opts['root'])
        if not os.path.isdir(root):
            raise CommandError('not a directory: %s' % root)

        folders = sorted(
            os.path.join(root, d) for d in os.listdir(root)
            if os.path.isdir(os.path.join(root, d))
        ) or [root]

        rows: List[dict] = []
        for folder in folders:
            name = os.path.basename(folder)
            key = _species_key(name)
            files = [
                f for f in sorted(glob.glob(os.path.join(folder, '**', '*.*'), recursive=True))
                if f.lower().endswith(IMAGE_EXTS)
            ]
            if opts['limit']:
                files = files[:opts['limit']]
            for i, path in enumerate(files, 1):
                rows.append(self._inspect(path, name, key))
                if i % 100 == 0:
                    self.stdout.write('  %s %d/%d' % (name, i, len(files)))

        self._report(rows)
        if opts['csv']:
            self._write_csv(rows, opts['csv'])
            self.stdout.write('\nper-image CSV: %s' % opts['csv'])

    # -- per image ------------------------------------------------------
    def _inspect(self, path: str, folder: str, key: Optional[str]) -> dict:
        row = {
            'file': os.path.basename(path),
            'folder': folder,
            'species': key or 'unknown',
            'long_edge': 0,
            'low_res': False,
            'very_low_res': False,
            'outcome': 'error',
            'card': '',
            'mm_per_pixel': '',
            'tooth_len_mm': '',
            'confidence': '',
            'source': 'UF' if not _is_external(path) else 'external',
        }
        try:
            with PILImage.open(path) as im:
                row['long_edge'] = max(im.size)
        except Exception:
            return row
        row['low_res'] = row['long_edge'] < LOW_RES_PX
        row['very_low_res'] = row['long_edge'] < VERY_LOW_RES_PX

        try:
            result = detect_scale_bar(path)
        except Exception:
            return row

        row['confidence'] = round(result.confidence, 3)
        if not result.mm_per_pixel:
            row['outcome'] = 'no_scale'
            return row
        row['card'] = result.card_name or ''
        row['mm_per_pixel'] = round(result.mm_per_pixel, 6)

        tooth = next((b for b in result.blobs if b.classification == 'tooth'), None)
        if tooth is None:
            row['outcome'] = 'no_tooth'
            return row
        x0, y0, x1, y1 = tooth.bbox
        length_mm = max(x1 - x0 + 1, y1 - y0 + 1) * result.mm_per_pixel
        row['tooth_len_mm'] = round(length_mm, 1)

        if key is None:
            row['outcome'] = 'ok'
            return row
        lo, hi = SPECIES_LENGTH_MM[key]
        row['outcome'] = 'ok' if lo <= length_mm <= hi else 'implausible'
        return row

    # -- reporting ------------------------------------------------------
    def _report(self, rows: List[dict]) -> None:
        w = self.stdout.write
        total = len(rows)
        by_folder: Dict[str, List[dict]] = defaultdict(list)
        for r in rows:
            by_folder[r['folder']].append(r)

        w('\n' + '=' * 100)
        w('SCALE CALIBRATION CENSUS')
        w('=' * 100)

        w('\nPER SPECIES')
        w('%-24s %6s %7s %7s %8s %8s %7s %9s' % (
            'species', 'total', 'with', 'no', 'implaus', 'no', 'low', 'median'))
        w('%-24s %6s %7s %7s %8s %8s %7s %9s' % (
            '', '', 'scale', 'scale', 'ible', 'tooth', 'res', 'len mm'))
        w('-' * 100)
        for folder in sorted(by_folder):
            rs = by_folder[folder]
            c = Counter(r['outcome'] for r in rs)
            lens = [r['tooth_len_mm'] for r in rs if r['outcome'] == 'ok']
            with_scale = c['ok'] + c['implausible'] + c['no_tooth']
            w('%-24s %6d %7d %7d %8d %8d %7d %9s' % (
                folder[:24], len(rs), with_scale, c['no_scale'] + c['error'],
                c['implausible'], c['no_tooth'],
                sum(1 for r in rs if r['low_res']),
                ('%.1f' % statistics.median(lens)) if lens else '-'))
        w('-' * 100)
        c = Counter(r['outcome'] for r in rows)
        with_scale = c['ok'] + c['implausible'] + c['no_tooth']
        w('%-24s %6d %7d %7d %8d %8d %7d' % (
            'TOTAL', total, with_scale, c['no_scale'] + c['error'],
            c['implausible'], c['no_tooth'],
            sum(1 for r in rows if r['low_res'])))

        w('\nHEADLINE')
        w('  total images                     %6d' % total)
        w('  usable (calibrated + plausible)  %6d  (%.1f%%)' % (c['ok'], _pct(c['ok'], total)))
        w('  could not be processed           %6d  (%.1f%%)'
          % (total - c['ok'], _pct(total - c['ok'], total)))

        w('\nWHY IMAGES COULD NOT BE PROCESSED')
        w('  no scale card readable           %6d' % (c['no_scale'] + c['error']))
        w('  card read but no tooth isolated  %6d' % c['no_tooth'])
        w('  calibrated but implausible size  %6d' % c['implausible'])

        # Is failure driven by resolution, or by the photo simply lacking a card?
        w('\nFAILURE vs RESOLUTION  (are the failures just the small images?)')
        w('  %-34s %6s %6s %7s' % ('', 'total', 'ok', 'ok rate'))
        for label, pred in (
            ('>= %d px (full res)' % LOW_RES_PX, lambda r: not r['low_res']),
            ('%d-%d px' % (VERY_LOW_RES_PX, LOW_RES_PX), lambda r: r['low_res'] and not r['very_low_res']),
            ('< %d px (very low)' % VERY_LOW_RES_PX, lambda r: r['very_low_res']),
        ):
            sub = [r for r in rows if pred(r)]
            ok = sum(1 for r in sub if r['outcome'] == 'ok')
            w('  %-34s %6d %6d %6.1f%%' % (label, len(sub), ok, _pct(ok, len(sub))))

        w('\nFAILURE vs SOURCE  (UF studio photos vs external collections)')
        w('  %-34s %6s %6s %7s' % ('', 'total', 'ok', 'ok rate'))
        for label in ('UF', 'external'):
            sub = [r for r in rows if r['source'] == label]
            ok = sum(1 for r in sub if r['outcome'] == 'ok')
            w('  %-34s %6d %6d %6.1f%%' % (label, len(sub), ok, _pct(ok, len(sub))))

        cards = Counter(r['card'] for r in rows if r['card'])
        if cards:
            w('\nSCALE CARD IN USE')
            for card, n in cards.most_common():
                w('  %-34s %6d' % (card, n))

        low = [r for r in rows if r['low_res']]
        if low:
            w('\nLOW-RESOLUTION IMAGES (< %d px long edge): %d' % (LOW_RES_PX, len(low)))
            by_sp = Counter(r['folder'] for r in low)
            for sp, n in by_sp.most_common():
                w('  %-34s %6d' % (sp, n))
            w('\n  smallest 25:')
            for r in sorted(low, key=lambda r: r['long_edge'])[:25]:
                w('    %5d px  %-10s %-34s %s' % (
                    r['long_edge'], r['outcome'], r['file'][:34], r['folder']))

    def _write_csv(self, rows: List[dict], path: str) -> None:
        fields = ['folder', 'species', 'file', 'source', 'long_edge', 'low_res',
                  'very_low_res', 'outcome', 'card', 'mm_per_pixel',
                  'tooth_len_mm', 'confidence']
        with open(path, 'w', newline='') as fh:
            writer = csv.DictWriter(fh, fieldnames=fields)
            writer.writeheader()
            for r in rows:
                writer.writerow({k: r.get(k, '') for k in fields})


def _is_external(path: str) -> bool:
    base = os.path.basename(path).upper()
    return base.startswith(('MYFOSSIL', 'USNM', 'UCMP', 'CMM', 'LC', 'AMNH', 'NCSM', 'BF'))


def _pct(n: int, d: int) -> float:
    return (n / d * 100.0) if d else 0.0

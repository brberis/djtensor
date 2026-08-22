# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: phase2_recalibrate.py
# Copyright (c) 2024

"""
Re-run scale calibration over Image rows that already carry stored values.

Needed after a calibration-logic change: rows written by the previous logic
hold numbers that are no longer reproducible, and simply re-running the
detector is not enough. An image that used to calibrate and no longer does
must have its stored calibration CLEARED, otherwise the stale (and in this
case wrong) mm/px silently survives and keeps poisoning every mm^2 derived
from it.

Dry-run by default. --write is the only path that mutates the database.

Usage:
    python manage.py phase2_recalibrate --dataset 166
    python manage.py phase2_recalibrate --all --write
"""

from __future__ import annotations

from typing import List, Optional

from django.core.management.base import BaseCommand, CommandError

from datasets.models import Image
from datasets.tooth_mask import refresh_tooth_mask
from datasets.scale_calibration import detect_scale_bar


# Everything the calibration pass owns. Cleared together so a row can never
# be left half-calibrated.
CALIBRATION_FIELDS = (
    'mm_per_pixel',
    'scale_bar_detected',
    'scale_bar_source',
    'scale_bar_bbox',
    'scale_bar_ticks',
    'tooth_area_mm2',
    'tooth_width_mm',
    'tooth_height_mm',
    'tooth_major_axis_mm',
    'tooth_minor_axis_mm',
    'completeness_mm2',
)


class Command(BaseCommand):
    help = 'Re-run scale calibration on stored images; clear rows that no longer calibrate.'

    def add_arguments(self, parser):
        parser.add_argument('--dataset', type=int, action='append', dest='datasets',
                            help='dataset id (repeatable)')
        parser.add_argument('--all', action='store_true',
                            help='every image that has a stored mm_per_pixel')
        parser.add_argument('--write', action='store_true',
                            help='persist changes (default is a dry run)')
        parser.add_argument('--include-manual', action='store_true',
                            help='ALSO recalibrate rows a reviewer set by hand, '
                                 'discarding their measurement (default: leave them alone)')

    def handle(self, *args, **opts):
        if not opts['datasets'] and not opts['all']:
            raise CommandError('pass --dataset <id> or --all')

        qs = Image.objects.all()
        if opts['datasets']:
            qs = qs.filter(dataset_id__in=opts['datasets'])
        else:
            qs = qs.filter(mm_per_pixel__isnull=False)

        # Never silently discard a reviewer's own measurement.
        #
        # A hand-set scale exists precisely BECAUSE the detector could not read
        # the frame, so re-running the detector over it will at best reproduce
        # nothing and at worst overwrite a correct human number with a wrong
        # automatic one. This pass owns scale_bar_source, so without the
        # exclusion every manual calibration is destroyed with no warning and
        # no way to tell afterwards which rows were lost.
        skipped_manual = 0
        if not opts['include_manual']:
            skipped_manual = qs.filter(scale_bar_source='manual').count()
            qs = qs.exclude(scale_bar_source='manual')
            if skipped_manual:
                self.stdout.write(self.style.WARNING(
                    'leaving %d manually-calibrated image(s) untouched '
                    '(pass --include-manual to overwrite them)' % skipped_manual))
        images = list(qs.select_related('dataset').order_by('id'))
        if not images:
            self.stdout.write('no matching images')
            return

        mode = 'WRITE' if opts['write'] else 'DRY RUN'
        self.stdout.write('%s: %d image(s)\n' % (mode, len(images)))
        self.stdout.write('%-8s %-26s %-12s %-12s %-9s %s' % (
            'id', 'file', 'old mm/px', 'new mm/px', 'change', 'note'))
        self.stdout.write('-' * 100)

        kept = cleared = unchanged = 0
        for img in images:
            old = img.mm_per_pixel
            new, result = self._recalibrate(img)

            if new is None:
                note = 'CLEARED' if old is not None else 'still uncalibrated'
                change = '-'
                if old is not None:
                    cleared += 1
                else:
                    unchanged += 1
            else:
                note = result.card_name or ''
                if old:
                    delta = (new - old) / old * 100.0
                    change = '%+.1f%%' % delta
                else:
                    change = 'new'
                kept += 1

            self.stdout.write('%-8s %-26s %-12s %-12s %-9s %s' % (
                img.id,
                img.image.name.split('/')[-1][:26],
                ('%.6f' % old) if old else '-',
                ('%.6f' % new) if new else '-',
                change,
                note))

            if opts['write']:
                self._persist(img, new, result)

        self.stdout.write('-' * 100)
        self.stdout.write('calibrated: %d   cleared: %d   still uncalibrated: %d'
                          % (kept, cleared, unchanged))
        if not opts['write']:
            self.stdout.write(self.style.WARNING('\nDry run. Re-run with --write to apply.'))

    def _recalibrate(self, img):
        try:
            result = detect_scale_bar(img.image.path)
        except Exception as exc:
            self.stderr.write('  image %s failed: %s' % (img.id, exc))
            return None, None
        return result.mm_per_pixel, result

    def _persist(self, img, mm_per_pixel, result) -> None:
        if mm_per_pixel is None:
            for field in CALIBRATION_FIELDS:
                setattr(img, field, None)
            img.scale_bar_detected = False
            img.save(update_fields=list(CALIBRATION_FIELDS))
            return

        tooth = next((b for b in result.blobs if b.classification == 'tooth'), None)
        img.mm_per_pixel = mm_per_pixel
        img.scale_bar_detected = result.bar_bbox is not None
        img.scale_bar_source = result.calibration_method
        img.scale_bar_bbox = list(result.bar_bbox) if result.bar_bbox else None
        img.scale_bar_ticks = {
            'long_axis': result.bar_long_axis,
            'positions': list(result.tick_positions_px or []),
        } if result.tick_positions_px else None

        if tooth is not None:
            x0, y0, x1, y1 = tooth.bbox
            img.tooth_bbox = list(tooth.bbox)
            img.tooth_area_mm2 = float(tooth.area_px) * mm_per_pixel ** 2
            img.tooth_width_mm = (x1 - x0 + 1) * mm_per_pixel
            img.tooth_height_mm = (y1 - y0 + 1) * mm_per_pixel
            # Anatomical length/width, not the size-sorted major/minor:
            # on a broad tooth the longer axis is the WIDTH.
            length = float(tooth.length_px or 0.0) * mm_per_pixel
            width = float(tooth.width_px or 0.0) * mm_per_pixel
            img.tooth_major_axis_mm = length if length > 0 else None
            img.tooth_minor_axis_mm = width if width > 0 else None
            refresh_tooth_mask(img, tooth.bbox)
        else:
            img.tooth_mask_url = None

        # completeness_mm2 is derived from the species reference and is now
        # stale; clear it so it is recomputed rather than silently kept.
        img.completeness_mm2 = None
        img.save(update_fields=[
            'mm_per_pixel', 'scale_bar_detected', 'scale_bar_source',
            'scale_bar_bbox', 'scale_bar_ticks', 'tooth_bbox', 'tooth_area_mm2',
            'tooth_width_mm', 'tooth_height_mm', 'tooth_major_axis_mm',
            'tooth_minor_axis_mm', 'completeness_mm2',
            'tooth_mask_url',
        ])

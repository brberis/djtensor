# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: phase2_fix_tooth_axes.py
# Copyright (c) 2024

"""
Recompute stored tooth length and width after the axis-assignment fix.

The ellipse fit returns its axes sorted by SIZE, and the longer one was being
stored as the tooth's length. Length means crown height, apex to base, so on
any tooth broader than it is tall the two were swapped. That is 1,631 of 4,303
measured teeth, mostly Galeocerdo cuvier, where broad-and-short is simply the
normal shape.

Why this exists rather than just re-running phase2_recalibrate:

  * The scale is not in question. mm_per_pixel, the scale-bar detection and the
    tooth area are all unaffected, so a full recalibration would redo an
    expensive job to fix a labelling fault.

  * phase2_recalibrate deliberately SKIPS hand-measured rows, and it should:
    re-running the detector over a scale a person set by hand can only lose
    information. But those 235 rows carry swapped axes too. This pass touches
    only the two axis fields and never mm_per_pixel, so it can safely correct
    a reviewer's image without disturbing their measurement.

Dry-run by default. --write is the only path that mutates the database.

Usage:
    python manage.py phase2_fix_tooth_axes --dataset 168 --dataset 169
    python manage.py phase2_fix_tooth_axes --all --write
"""

from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError

from datasets.models import Image
from datasets.scale_calibration import detect_tooth_only


class Command(BaseCommand):
    help = 'Recompute tooth length/width with the corrected axis assignment. Leaves mm/px alone.'

    def add_arguments(self, parser):
        parser.add_argument('--dataset', type=int, action='append', dest='datasets',
                            help='dataset id (repeatable)')
        parser.add_argument('--all', action='store_true',
                            help='every image with a stored tooth measurement')
        parser.add_argument('--write', action='store_true',
                            help='persist changes (default is a dry run)')

    def handle(self, *args, **opts):
        if not opts['datasets'] and not opts['all']:
            raise CommandError('pass --dataset <id> or --all')

        qs = Image.objects.filter(
            mm_per_pixel__isnull=False,
            tooth_major_axis_mm__isnull=False,
        )
        if opts['datasets']:
            qs = qs.filter(dataset_id__in=opts['datasets'])
        images = list(qs.order_by('id'))
        if not images:
            self.stdout.write('no matching images')
            return

        mode = 'WRITE' if opts['write'] else 'DRY RUN'
        self.stdout.write('%s: %d image(s) with a stored measurement\n' % (mode, len(images)))
        self.stdout.write('%-8s %-34s %-15s %-15s %s' % (
            'id', 'file', 'stored L/W', 'corrected L/W', 'note'))
        self.stdout.write('-' * 96)

        swapped = same = lost = 0
        manual_touched = 0
        for img in images:
            try:
                tooth = detect_tooth_only(img.image.path)
            except Exception as exc:
                self.stderr.write('  image %s failed: %s' % (img.id, exc))
                lost += 1
                continue
            if tooth is None:
                lost += 1
                continue

            mm = float(img.mm_per_pixel)
            length = float(tooth.length_px or 0.0) * mm
            width = float(tooth.width_px or 0.0) * mm
            if length <= 0 or width <= 0:
                lost += 1
                continue

            old_l = float(img.tooth_major_axis_mm or 0.0)
            old_w = float(img.tooth_minor_axis_mm or 0.0)
            changed = abs(length - old_l) > 0.05 or abs(width - old_w) > 0.05
            if not changed:
                same += 1
                continue

            swapped += 1
            if img.scale_bar_source == 'manual':
                manual_touched += 1
            self.stdout.write('%-8s %-34s %-15s %-15s %s' % (
                img.id,
                img.image.name.split('/')[-1][:34],
                '%.1f / %.1f' % (old_l, old_w),
                '%.1f / %.1f' % (length, width),
                'hand-measured' if img.scale_bar_source == 'manual' else ''))

            if opts['write']:
                img.tooth_major_axis_mm = length
                img.tooth_minor_axis_mm = width
                # Only the two axis fields. mm_per_pixel, the scale source and
                # the area are untouched, so a reviewer's measurement survives.
                img.save(update_fields=['tooth_major_axis_mm', 'tooth_minor_axis_mm'])

        self.stdout.write('-' * 96)
        self.stdout.write('corrected: %d   already right: %d   no tooth found: %d'
                          % (swapped, same, lost))
        self.stdout.write('of the corrected, %d were hand-measured (their mm/px was not touched)'
                          % manual_touched)
        if not opts['write']:
            self.stdout.write(self.style.WARNING('\nDry run. Re-run with --write to apply.'))

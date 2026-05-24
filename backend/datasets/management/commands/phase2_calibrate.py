# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: phase2_calibrate.py
# Copyright (c) 2024

"""
End-to-end Phase 2 calibration command.

Usage examples:

    # Calibrate one image, no DB writes, print JSON to stdout
    python manage.py phase2_calibrate /path/to/image.png

    # Same, plus emit a debug overlay PNG for visual inspection
    python manage.py phase2_calibrate /path/to/image.png --overlay-out /tmp/overlay.png

    # Calibrate an image already in the DB by Image.id (still no write
    # unless --write is also passed)
    python manage.py phase2_calibrate --image-id 12345 --overlay-out /tmp/ov.png

    # Run on multiple images at once
    python manage.py phase2_calibrate img1.png img2.png img3.png --out-dir /tmp/calib

    # Persist results to the Image row(s). Requires --image-id or --image-id-from-path.
    python manage.py phase2_calibrate /path/to/image.png --image-id 12345 --write

The command is DRY-RUN by default. The `--write` flag is the only path
that mutates the database.
"""

from __future__ import annotations

import json
import os
import sys
from dataclasses import asdict
from typing import List, Optional

from django.core.management.base import BaseCommand, CommandError

# Local import. scale_calibration.py is in backend/datasets/ next to this
# command's package, but Django's `apps` machinery already gives us the
# import path:
from datasets.scale_calibration import detect_scale_bar, ScaleBarResult


class Command(BaseCommand):
    help = (
        "Run the Phase 2 scale-bar detection + mm/px calibration pipeline on "
        "one or more image paths. Dry-run by default; opt in to DB writes with "
        "--write."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            'image_paths',
            nargs='*',
            help='One or more image file paths to process.',
        )
        parser.add_argument(
            '--image-id',
            type=int,
            default=None,
            help='Optional Image.id to associate with the given image. If '
                 'omitted no DB lookup happens. Required for --write.',
        )
        parser.add_argument(
            '--assumed-tick-spacing-mm',
            type=float,
            default=10.0,
            help='Physical spacing in mm between adjacent ruler ticks the '
                 'detector should expect to find (default 10.0 = 1 cm).',
        )
        parser.add_argument(
            '--overlay-out',
            type=str,
            default=None,
            help='Write a single debug overlay PNG to this path (only meaningful '
                 'when processing one image).',
        )
        parser.add_argument(
            '--out-dir',
            type=str,
            default=None,
            help='Directory for per-image JSON + overlay PNG outputs when '
                 'multiple images are processed.',
        )
        parser.add_argument(
            '--write',
            action='store_true',
            help='Persist the calibration result (mm/px, scale_bar_*, '
                 'tooth_area_mm2) to the Image row. Requires --image-id. '
                 'completeness_mm2 is NOT computed by this command; that '
                 'belongs to the dataset-level reference task.',
        )

    def handle(self, *args, **options):
        image_paths: List[str] = options['image_paths']
        if not image_paths:
            raise CommandError('Pass at least one image path.')

        if options['write'] and not options['image_id']:
            raise CommandError('--write requires --image-id.')
        if options['write'] and len(image_paths) > 1:
            raise CommandError(
                '--write with multiple image paths is ambiguous. '
                'Run one image at a time when writing.'
            )

        if options['out_dir']:
            os.makedirs(options['out_dir'], exist_ok=True)

        all_results = []
        for path in image_paths:
            if not os.path.exists(path):
                self.stderr.write(self.style.ERROR(f'MISSING {path}'))
                all_results.append({'image_path': path, 'error': 'not_found'})
                continue

            try:
                result = detect_scale_bar(
                    path,
                    assumed_tick_spacing_mm=options['assumed_tick_spacing_mm'],
                )
            except Exception as exc:  # pylint: disable=broad-except
                self.stderr.write(self.style.ERROR(f'FAILED {path}: {exc!r}'))
                all_results.append({'image_path': path, 'error': repr(exc)})
                continue

            tooth_area_mm2 = _compute_tooth_area_mm2(result)
            summary = _summarise(result, tooth_area_mm2)
            all_results.append(summary)

            self.stdout.write(self.style.MIGRATE_HEADING(path))
            self.stdout.write(json.dumps(summary, indent=2))

            # Write JSON / overlay if requested
            base = os.path.splitext(os.path.basename(path))[0]
            json_out = None
            overlay_out = options.get('overlay_out')
            if options['out_dir']:
                json_out = os.path.join(options['out_dir'], f'result_{base}.json')
                if overlay_out is None:
                    overlay_out = os.path.join(options['out_dir'], f'overlay_{base}.png')
            if json_out:
                with open(json_out, 'w') as f:
                    json.dump(result.to_dict(), f, indent=2)
                self.stdout.write(f'  json:    {json_out}')
            if overlay_out:
                try:
                    # Lazy import so the overlay path stays optional and the
                    # command still works in headless contexts.
                    from datasets.scale_calibration_test import draw_overlay
                    draw_overlay(path, result, overlay_out)
                    self.stdout.write(f'  overlay: {overlay_out}')
                except Exception as exc:  # pylint: disable=broad-except
                    self.stderr.write(self.style.WARNING(
                        f'  overlay generation failed: {exc!r}'
                    ))

            # DB write (only when explicit)
            if options['write'] and options['image_id']:
                _write_to_image_row(
                    image_id=options['image_id'],
                    result=result,
                    tooth_area_mm2=tooth_area_mm2,
                    out=self.stdout,
                )

        if len(all_results) > 1:
            self.stdout.write(self.style.MIGRATE_HEADING('summary'))
            self.stdout.write(json.dumps(all_results, indent=2))


def _compute_tooth_area_mm2(result: ScaleBarResult) -> Optional[float]:
    """Multiply the tooth blob's pixel area by mm_per_pixel^2."""
    if result.mm_per_pixel is None:
        return None
    tooth = next((b for b in result.blobs if b.classification == 'tooth'), None)
    if tooth is None:
        return None
    return float(tooth.area_px) * (result.mm_per_pixel ** 2)


def _summarise(result: ScaleBarResult, tooth_area_mm2: Optional[float]) -> dict:
    tooth = next((b for b in result.blobs if b.classification == 'tooth'), None)
    return {
        'image_path':           result.image_path,
        'image_size':           result.image_size,
        'foreground_source':    result.foreground_source,
        'tooth_area_px':        tooth.area_px if tooth else None,
        'tooth_area_mm2':       tooth_area_mm2,
        'bar_bbox':             result.bar_bbox,
        'scale_bar_detected':   result.bar_bbox is not None,
        'mm_per_pixel':         result.mm_per_pixel,
        'tick_count':           result.tick_count,
        'median_tick_spacing':  result.median_tick_spacing_px,
        'assumed_tick_mm':      result.assumed_tick_spacing_mm,
        'confidence':           result.confidence,
        'notes':                result.notes,
    }


def _write_to_image_row(image_id: int, result: ScaleBarResult, tooth_area_mm2: Optional[float], out) -> None:
    """Persist calibration fields to the Image row. Only called with --write."""
    from datasets.models import Image

    try:
        img = Image.objects.get(pk=image_id)
    except Image.DoesNotExist:
        out.write(f'  WRITE: Image id={image_id} not found, skipping')
        return

    img.mm_per_pixel = result.mm_per_pixel
    img.scale_bar_detected = result.bar_bbox is not None
    img.scale_bar_source = 'heuristic_whitelist'
    img.scale_bar_bbox = list(result.bar_bbox) if result.bar_bbox else None
    img.tooth_area_mm2 = tooth_area_mm2
    # completeness_mm2 is left alone; it is computed at the dataset level
    # against the species reference, not per-image.

    img.save(update_fields=[
        'mm_per_pixel', 'scale_bar_detected', 'scale_bar_source',
        'scale_bar_bbox', 'tooth_area_mm2',
    ])
    out.write(f'  WRITE: persisted to Image id={image_id}')

# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: phase2_shape_study.py
# Copyright (c) 2024

"""
Build a review study around a chosen set of fragments, scored by Katie's
shape method, so each one can be opened in the inspector and its shape
analysis played back.

Made for the quartile test Katie asked for (five fragments per species), but
takes any list of files from a source dataset.

Each fragment is copied into the new dataset as a new Image row pointing at
the SAME photograph and tooth mask; no file is duplicated, and nothing in the
source dataset changes. Deleting an Image row never deletes its file, so the
copies are safe to remove later.

The shape score is Katie's alone (percent_broken holds the shape percentage,
not the pipeline's max(shape, size)), because the point of the study is to
see her method on its own. Alexa's estimate and our area completeness are
stored beside it for comparison.

Dry-run by default. --write is the only path that mutates the database.

Usage:
    python manage.py phase2_shape_study --source-dataset 169 \\
        --files katie-quartile-test.csv --alexa-csv "Associated Data.csv" \\
        --copy-members-from 60 --write
"""

from __future__ import annotations

import csv
import os
import re

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from datasets.brokenness.trace import TraceMismatch
from datasets.models import Dataset, Image
from datasets.shape_trace import ShapeTraceUnavailable, get_shape_trace
from feature_extractor.models import Study, StudyMembership

# Measurement fields copied from the source row so the copy reads exactly
# like the original in every panel.
COPIED_FIELDS = (
    'label', 'file_hash', 'tooth_area', 'completeness', 'source_kind',
    'mm_per_pixel', 'scale_bar_detected', 'scale_bar_source', 'scale_bar_bbox', 'scale_bar_ticks',
    'tooth_bbox', 'tooth_mask_url', 'tooth_area_mm2', 'tooth_width_mm', 'tooth_height_mm',
    'tooth_major_axis_mm', 'tooth_minor_axis_mm', 'completeness_mm2',
    'museum_specimen_id', 'museum_species', 'museum_completeness_category',
    'museum_metadata', 'ocr_label_text', 'review_status',
)


def _key(name):
    name = re.sub(r'\.jpe?g$', '', os.path.basename(name), flags=re.I)
    name = re.sub(r'^[A-Za-z]+_[A-Za-z]+__', '', name)
    return re.sub(r'[^a-z0-9]', '', name.lower())


class Command(BaseCommand):
    help = "Create a review study of chosen fragments scored by Katie's shape method."

    def add_arguments(self, parser):
        parser.add_argument('--source-dataset', type=int, required=True)
        parser.add_argument('--files', required=True,
                            help="CSV with a 'file' column naming the source images")
        parser.add_argument('--alexa-csv',
                            help="Associated Data export, to store Alexa's estimate beside each score")
        parser.add_argument('--reference', type=int, default=72,
                            help='dataset whose shape templates are used (default 72)')
        parser.add_argument('--study', default='Phase 2 - Shape Completeness')
        parser.add_argument('--dataset', default='Katie quartile test (30 fragments)')
        parser.add_argument('--copy-members-from', type=int,
                            help='study whose memberships the new study inherits')
        parser.add_argument('--write', action='store_true')

    def handle(self, *args, **opts):
        source = Dataset.objects.filter(pk=opts['source_dataset']).first()
        if source is None:
            raise CommandError('source dataset %s does not exist' % opts['source_dataset'])

        with open(opts['files']) as f:
            wanted = [row['file'] for row in csv.DictReader(f) if row.get('file')]
        if not wanted:
            raise CommandError("no rows with a 'file' column in %s" % opts['files'])

        originals = []
        for name in wanted:
            hit = Image.objects.filter(dataset=source, image__endswith='/' + name).select_related('label').first()
            if hit is None:
                raise CommandError('%s is not in dataset %d' % (name, source.id))
            originals.append(hit)

        alexa = {}
        if opts.get('alexa_csv'):
            with open(opts['alexa_csv']) as f:
                for row in csv.DictReader(f):
                    try:
                        alexa[_key(row['Name'])] = float(row['Percent Complete'])
                    except (KeyError, TypeError, ValueError):
                        continue

        self.stdout.write('%d fragments from dataset %d, templates from dataset %d'
                          % (len(originals), source.id, opts['reference']))
        if not opts['write']:
            for img in originals:
                self.stdout.write('  %-26s %s' % (img.label.name, os.path.basename(img.image.name)))
            self.stdout.write(self.style.WARNING('\nDry run. Re-run with --write to create the study.'))
            return

        with transaction.atomic():
            study, made = Study.objects.get_or_create(
                name=opts['study'],
                defaults={'mode': 'review', 'description': (
                    "Katie's shape-completeness method on its own, applied to hand-picked "
                    'fragments so each can be opened and its analysis played back.')},
            )
            if opts.get('copy_members_from'):
                for m in StudyMembership.objects.filter(study_id=opts['copy_members_from']):
                    StudyMembership.objects.get_or_create(study=study, user=m.user, defaults={'role': m.role})

            dataset, _ = Dataset.objects.get_or_create(
                study=study, name=opts['dataset'],
                defaults={
                    'description': 'Fragments from %s scored by the shape method only (templates from dataset %d).'
                                   % (source.name, opts['reference']),
                    'resolution': source.resolution,
                    'for_testing': source.for_testing,
                    'source_dataset': source,
                    'transformation_type': 'subset',
                    'generation_config': {
                        'purpose': "Katie's quartile test: shape score on its own",
                        'source_dataset_id': source.id,
                        'reference_dataset_id': opts['reference'],
                        'source_image_ids': [img.id for img in originals],
                    },
                },
            )
            dataset.labels.add(*{img.label for img in originals})

            copies = []
            for img in originals:
                copy = Image.objects.filter(dataset=dataset, source_image=img).first()
                if copy is None:
                    copy = Image(dataset=dataset, source_image=img)
                for field in COPIED_FIELDS:
                    setattr(copy, field, getattr(img, field))
                # The stored name, not the FieldFile: assigning another row's
                # FieldFile makes Django repoint that shared object at this row.
                copy.image = img.image.name
                copy.save()
                copies.append((img, copy))

        # Scoring runs outside the transaction: each takes seconds, and a
        # failure on one fragment should not undo the study.
        self.stdout.write('%s study %d, dataset %d. Scoring:\n' % ('Created' if made else 'Updated', study.id, dataset.id))
        self.stdout.write('  %-40s %3s %7s %6s %6s %6s' % ('file', 'q', 'aspect', 'Alexa', 'area', 'shape'))
        for img, copy in copies:
            try:
                trace = get_shape_trace(copy, opts['reference'])
            except (ShapeTraceUnavailable, TraceMismatch) as exc:
                self.stderr.write('  %s: %s' % (os.path.basename(img.image.name), exc))
                continue
            fin, sel, best = trace['final'], trace['selection'], trace['search']['best']
            alexa_pct = alexa.get(_key(img.image.name))
            copy.percent_broken = float(fin['percent_broken'])
            copy.brokenness_meta = {
                'method': 'katie_shape_only',
                'species': img.label.name,
                'reference_dataset_id': opts['reference'],
                'quantile': sel['quartile'],
                'aspect_ratio': sel['aspect'],
                'shape_pct_broken': float(fin['percent_broken']),
                'shape_completeness': float(fin['completeness']),
                'mean_pixels': fin['template_px'],
                'missing_pixels': fin['missing_px'],
                'overhang_pixels': fin['overhang_px'],
                'iou_score': best['iou'],
                'best_angle': best['angle'],
                'best_shift': [best['dx'], best['dy']],
                'best_flipped': best['flipped'],
                'area_completeness': round(img.completeness_mm2 * 100, 1) if img.completeness_mm2 is not None else None,
                'alexa_pct': alexa_pct,
                'source_image_id': img.id,
            }
            copy.save(update_fields=['percent_broken', 'brokenness_meta'])
            self.stdout.write('  %-40s %3d %7.3f %5s%% %5.0f%% %5.1f%%' % (
                os.path.basename(img.image.name)[:40], sel['quartile'], sel['aspect'],
                '%.0f' % alexa_pct if alexa_pct is not None else '-',
                (img.completeness_mm2 or 0) * 100, fin['completeness']))
        self.stdout.write(self.style.SUCCESS('\nOpen /datasets/%d to browse them.' % dataset.id))

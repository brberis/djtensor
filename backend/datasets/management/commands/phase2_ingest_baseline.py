# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: phase2_ingest_baseline.py
# Copyright (c) 2024

"""
Ingest the downscaled baseline photographs as a reviewable Dataset.

The baseline arrives as species folders of JPEGs on disk. This registers them
as Image rows under a Study so the whole existing review pipeline (review
queue, visual inspector, bulk actions) applies to them.

The dataset is created with resolution='original', which is the Phase 2 flag
meaning "do not resize these", because scale calibration and label OCR need the
photograph as shot. Images are recorded with source_kind='raw' since each frame
carries the tooth, the scale card and the catalog label.

Idempotent: an image whose file hash is already present in the dataset is
skipped, so a re-run resumes rather than duplicating.

Usage:
    python manage.py phase2_ingest_baseline /data_shark --study "Phase 2 - Baseline Recalibration"
    python manage.py phase2_ingest_baseline /data_shark --dry-run
"""

from __future__ import annotations

import hashlib
import os
import shutil
from typing import Dict, Optional

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from datasets.models import Dataset, Image, Label
from feature_extractor.models import Study


# Species folder prefix -> canonical Label name (labels already exist).
#
# Two naming conventions appear in the Dropbox tree: the baseline uses
# abbreviated folders ("C_leucas_raw_t_n_v") while the fragments use the full
# binomial ("Carcharias leucas"), so both are mapped here. Note the fragments
# folder says "Carcharias leucas" where the species is actually Carcharhinus
# leucas; the label mapping corrects that rather than creating a duplicate.
FOLDER_TO_LABEL: Dict[str, str] = {
    'c_carcharias': 'Carcharodon Carcharias',
    'c_leucas': 'Carcharhinus Leucas',
    'g_cuvier': 'Galeocerdo Cuvier',
    'h_serra': 'Hemipristis Serra',
    'i_hastalis': 'Isurus Hastalis',
    'o_megalodon': 'Otodus Megalodon',
    # fragment folder names
    'carcharodon_carcharias': 'Carcharodon Carcharias',
    'carcharias_leucas': 'Carcharhinus Leucas',
    'carcharhinus_leucas': 'Carcharhinus Leucas',
    'galeocerdo_cuvier': 'Galeocerdo Cuvier',
    'hemipristis_serra': 'Hemipristis Serra',
    'isurus_hastalis': 'Isurus Hastalis',
    'otodus_megalodon': 'Otodus Megalodon',
}

IMAGE_EXTS = ('.jpg', '.jpeg', '.png', '.tif', '.tiff')


def _label_for(folder_name: str) -> Optional[str]:
    lowered = folder_name.lower()
    for prefix, label in FOLDER_TO_LABEL.items():
        if lowered.startswith(prefix):
            return label
    return None


class Command(BaseCommand):
    help = 'Register the baseline photo folders as a reviewable Dataset under a Study.'

    def add_arguments(self, parser):
        parser.add_argument('root', help='directory of species folders')
        parser.add_argument('--study', default='Phase 2 - Baseline Recalibration')
        parser.add_argument('--dataset', default='Baseline Raw (scale-calibrated)')
        parser.add_argument('--dry-run', action='store_true')

    def handle(self, *args, **opts):
        root = os.path.abspath(opts['root'])
        if not os.path.isdir(root):
            raise CommandError('not a directory: %s' % root)

        plan = []
        for folder in sorted(os.listdir(root)):
            folder_path = os.path.join(root, folder)
            if not os.path.isdir(folder_path):
                continue
            label_name = _label_for(folder)
            if label_name is None:
                self.stdout.write(self.style.WARNING('skip %s (no species mapping)' % folder))
                continue
            files = sorted(
                os.path.join(folder_path, f) for f in os.listdir(folder_path)
                if f.lower().endswith(IMAGE_EXTS)
            )
            plan.append((folder, label_name, files))
            self.stdout.write('%-26s -> %-24s %4d files' % (folder, label_name, len(files)))

        total = sum(len(f) for _, _, f in plan)
        self.stdout.write('\ntotal images: %d' % total)
        if opts['dry_run']:
            self.stdout.write(self.style.WARNING('Dry run, nothing written.'))
            return

        study, made = Study.objects.get_or_create(
            name=opts['study'],
            defaults={'mode': 'review',
                      'description': 'Recalibrated baseline photographs for the '
                                     'mm-anchored completeness pipeline.'},
        )
        self.stdout.write('%s study %s (id=%s)' % ('created' if made else 'reusing', study.name, study.id))

        dataset, made = Dataset.objects.get_or_create(
            study=study,
            name=opts['dataset'],
            defaults={
                'resolution': 'original',   # Phase 2 flag: never resize these
                'description': 'Baseline raw photographs at 3000 px long edge. '
                               'Each frame carries the tooth, the FLMNH scale '
                               'card and the catalog label.',
            },
        )
        self.stdout.write('%s dataset %s (id=%s)' % ('created' if made else 'reusing', dataset.name, dataset.id))

        media_dir = os.path.join(
            settings.MEDIA_ROOT, 'datasets',
            '%s-%s' % (dataset.name.lower().replace(' ', '_'), dataset.id),
        )
        os.makedirs(media_dir, exist_ok=True)

        existing = set(
            Image.objects.filter(dataset=dataset)
            .exclude(file_hash__isnull=True)
            .values_list('file_hash', flat=True)
        )
        self.stdout.write('already ingested: %d\n' % len(existing))

        added = skipped = failed = 0
        for folder, label_name, files in plan:
            label = Label.objects.filter(name=label_name).first()
            if label is None:
                self.stderr.write('no Label row named %r, skipping %s' % (label_name, folder))
                continue
            # The per-image FK alone is not enough: the dataset page lists its
            # classes from the Dataset.labels m2m, so without this link the
            # Images tab renders "0 categories" and shows nothing even though
            # every image is present and correctly labelled.
            dataset.labels.add(label)
            for src in files:
                try:
                    digest = _hash(src)
                    if digest in existing:
                        skipped += 1
                        continue
                    # Namespace by species so two species can share a filename.
                    stored_name = '%s__%s' % (folder, os.path.basename(src))
                    shutil.copy2(src, os.path.join(media_dir, stored_name))
                    Image.objects.create(
                        dataset=dataset,
                        label=label,
                        image='datasets/%s-%s/%s' % (
                            dataset.name.lower().replace(' ', '_'), dataset.id, stored_name),
                        file_hash=digest,
                        source_kind='raw',
                    )
                    existing.add(digest)
                    added += 1
                except Exception as exc:
                    failed += 1
                    self.stderr.write('  failed %s: %s' % (os.path.basename(src), exc))
                if (added + skipped) % 250 == 0:
                    self.stdout.write('  %d added / %d skipped' % (added, skipped))

        self.stdout.write(self.style.SUCCESS(
            '\ndone. added %d, skipped %d, failed %d. dataset id=%s'
            % (added, skipped, failed, dataset.id)))
        self.stdout.write('next: python manage.py phase2_recalibrate --dataset %s --write' % dataset.id)


def _hash(path: str) -> str:
    h = hashlib.sha256()
    with open(path, 'rb') as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()

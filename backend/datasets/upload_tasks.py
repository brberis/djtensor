# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: upload_tasks.py
# Copyright (c) 2024
#
# Celery tasks for processing archive uploads (zip, tar, tar.gz).
# Extracts images, deduplicates by SHA-256 hash, resizes to dataset resolution,
# and creates Image records.

import hashlib
import logging
import os
import shutil
import tarfile
import tempfile
import zipfile

from celery import shared_task
from django.conf import settings
from django.core.files.base import ContentFile

from .image_resize import resize_to_dataset, get_target_resolution

logger = logging.getLogger(__name__)

IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff', '.tif'}


def _compute_hash(filepath):
    hasher = hashlib.sha256()
    with open(filepath, 'rb') as file_handle:
        while True:
            chunk = file_handle.read(8192)
            if not chunk:
                break
            hasher.update(chunk)
    return hasher.hexdigest()


def _compute_content_hash(file_obj):
    hasher = hashlib.sha256()
    file_obj.seek(0)
    for chunk in file_obj.chunks(8192):
        hasher.update(chunk)
    file_obj.seek(0)
    return hasher.hexdigest()


def _is_image_file(filename):
    basename = os.path.basename(filename)
    if basename.startswith('.') or basename.startswith('__'):
        return False
    _, ext = os.path.splitext(basename.lower())
    return ext in IMAGE_EXTENSIONS


@shared_task(bind=True)
def process_archive_upload(self, archive_path, dataset_id, label_id):
    from .models import Dataset, Label, Image
    from .tasks import create_dataset_archive

    created = []
    duplicates = []
    errors = []

    extract_dir = tempfile.mkdtemp(prefix='bulk_upload_', dir=os.path.join(settings.MEDIA_ROOT, 'temp_uploads'))

    try:
        dataset = Dataset.objects.get(pk=dataset_id)
        label = Label.objects.get(pk=label_id)
        preserve_original = str(dataset.resolution).lower() == 'original'
        target_resolution = None if preserve_original else get_target_resolution(dataset)

        self.update_state(state='PROGRESS', meta={
            'progress': 0, 'current': 0, 'total': 0,
            'message': 'Extracting archive...',
        })

        if zipfile.is_zipfile(archive_path):
            with zipfile.ZipFile(archive_path, 'r') as zip_file:
                zip_file.extractall(extract_dir)
        elif tarfile.is_tarfile(archive_path):
            with tarfile.open(archive_path, 'r:*') as tar_file:
                members = []
                for member in tar_file.getmembers():
                    if member.name.startswith('/') or '..' in member.name:
                        logger.warning(f'Skipping suspicious archive member: {member.name}')
                        continue
                    members.append(member)
                tar_file.extractall(extract_dir, members=members)
        else:
            raise ValueError(f'Unrecognized archive format: {archive_path}')

        image_paths = []
        for root, _dirs, files in os.walk(extract_dir):
            for filename in files:
                if _is_image_file(filename):
                    image_paths.append(os.path.join(root, filename))

        total = len(image_paths)
        if total == 0:
            return {
                'created': [],
                'duplicates': [],
                'errors': [],
                'summary': {'created_count': 0, 'duplicate_count': 0, 'error_count': 0},
                'message': 'No image files found in archive.',
            }

        self.update_state(state='PROGRESS', meta={
            'progress': 5,
            'current': 0,
            'total': total,
            'message': f'Found {total} images. Processing in real time...',
        })

        for index, image_path in enumerate(image_paths):
            filename = os.path.basename(image_path)

            try:
                with open(image_path, 'rb') as file_handle:
                    uploaded = ContentFile(file_handle.read())
                    uploaded.name = filename

                if preserve_original:
                    resized_file = uploaded
                    resize_meta = {'preserved_original': True, 'width': None, 'height': None}
                else:
                    resized_file, resize_meta = resize_to_dataset(uploaded, target_resolution)
                file_hash = _compute_content_hash(resized_file)
            except Exception as exc:
                errors.append({'file': filename, 'reason': str(exc)})
                continue

            existing = Image.objects.filter(dataset=dataset, label=label, file_hash=file_hash).first()
            if existing:
                duplicates.append({'file': filename, 'hash': file_hash})
            else:
                try:
                    image = Image.objects.create(
                        dataset=dataset,
                        label=label,
                        image=resized_file,
                        file_hash=file_hash,
                    )
                    created.append({
                        'id': image.id,
                        'file': filename,
                        'hash': file_hash,
                        'width': resize_meta.get('width'),
                        'height': resize_meta.get('height'),
                        'preserved_original': resize_meta.get('preserved_original', False),
                    })
                except Exception as exc:
                    logger.error(f'Failed to create image {filename}: {exc}')
                    errors.append({'file': filename, 'reason': str(exc)})

            if (index + 1) % 10 == 0 or (index + 1) == total:
                progress = int(5 + (90 * (index + 1) / total))
                self.update_state(state='PROGRESS', meta={
                    'progress': progress,
                    'current': index + 1,
                    'total': total,
                    'message': f'Processed {index + 1}/{total} images...',
                })

        if created:
            create_dataset_archive.delay(dataset_id)

        result = {
            'created': created,
            'duplicates': duplicates,
            'errors': errors,
            'summary': {
                'created_count': len(created),
                'duplicate_count': len(duplicates),
                'error_count': len(errors),
            },
        }

        self.update_state(state='PROGRESS', meta={
            'progress': 100,
            'current': total,
            'total': total,
            'message': 'Done.',
        })

        return result

    except Exception as exc:
        logger.error(f'Archive processing failed: {exc}', exc_info=True)
        raise

    finally:
        try:
            if os.path.isdir(extract_dir):
                shutil.rmtree(extract_dir)
            if os.path.isfile(archive_path):
                os.remove(archive_path)
        except Exception as cleanup_error:
            logger.warning(f'Cleanup error: {cleanup_error}')

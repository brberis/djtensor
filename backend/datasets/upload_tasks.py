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
# Extracts images, deduplicates by SHA-256 hash, and creates Image records.

import hashlib
import logging
import os
import shutil
import tarfile
import tempfile
import zipfile

from celery import shared_task
from django.conf import settings
from django.core.files import File

logger = logging.getLogger(__name__)

# Same set of image extensions used in bulk_upload.py
IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff', '.tif'}


def _compute_hash(filepath):
    """Compute SHA-256 hash of a file on disk."""
    hasher = hashlib.sha256()
    with open(filepath, 'rb') as f:
        while True:
            chunk = f.read(8192)
            if not chunk:
                break
            hasher.update(chunk)
    return hasher.hexdigest()


def _is_image_file(filename):
    """Check if filename has an image extension. Ignores hidden/system files."""
    basename = os.path.basename(filename)
    if basename.startswith('.') or basename.startswith('__'):
        return False
    _, ext = os.path.splitext(basename.lower())
    return ext in IMAGE_EXTENSIONS


@shared_task(bind=True)
def process_archive_upload(self, archive_path, dataset_id, label_id):
    """
    Extract an uploaded archive and ingest images into the dataset.

    Steps:
    1. Extract archive to a temp directory
    2. Walk the extracted tree for image files
    3. Hash each image and check for duplicates
    4. Create Image records for new images
    5. Clean up temp files and the original archive

    Progress is reported via Celery task state updates.
    """
    from .models import Dataset, Label, Image
    from .tasks import create_dataset_archive

    # Track results
    created = []
    duplicates = []
    errors = []

    # Use a temp directory for extraction to avoid polluting mediafiles
    extract_dir = tempfile.mkdtemp(prefix='bulk_upload_', dir=os.path.join(settings.MEDIA_ROOT, 'temp_uploads'))

    try:
        dataset = Dataset.objects.get(pk=dataset_id)
        label = Label.objects.get(pk=label_id)

        # Report initial state
        self.update_state(state='PROGRESS', meta={
            'progress': 0, 'current': 0, 'total': 0,
            'message': 'Extracting archive...',
        })

        # Extract the archive
        if zipfile.is_zipfile(archive_path):
            with zipfile.ZipFile(archive_path, 'r') as zf:
                zf.extractall(extract_dir)
        elif tarfile.is_tarfile(archive_path):
            with tarfile.open(archive_path, 'r:*') as tf:
                # Safety: filter out absolute paths and directory traversals
                members = []
                for member in tf.getmembers():
                    if member.name.startswith('/') or '..' in member.name:
                        logger.warning(f'Skipping suspicious archive member: {member.name}')
                        continue
                    members.append(member)
                tf.extractall(extract_dir, members=members)
        else:
            raise ValueError(f'Unrecognized archive format: {archive_path}')

        # Collect all image file paths from the extraction
        image_paths = []
        for root, dirs, files in os.walk(extract_dir):
            for fname in files:
                if _is_image_file(fname):
                    image_paths.append(os.path.join(root, fname))

        total = len(image_paths)
        if total == 0:
            return {
                'created': [], 'duplicates': [], 'errors': [],
                'summary': {'created_count': 0, 'duplicate_count': 0, 'error_count': 0},
                'message': 'No image files found in archive.',
            }

        self.update_state(state='PROGRESS', meta={
            'progress': 5, 'current': 0, 'total': total,
            'message': f'Found {total} images. Processing...',
        })

        # Process each image
        for i, img_path in enumerate(image_paths):
            fname = os.path.basename(img_path)

            try:
                file_hash = _compute_hash(img_path)
            except Exception as e:
                errors.append({'file': fname, 'reason': f'Hash error: {str(e)}'})
                continue

            # Check for duplicates
            existing = Image.objects.filter(
                dataset=dataset, label=label, file_hash=file_hash
            ).first()
            if existing:
                duplicates.append({'file': fname, 'hash': file_hash})
            else:
                try:
                    with open(img_path, 'rb') as fh:
                        django_file = File(fh, name=fname)
                        img = Image.objects.create(
                            dataset=dataset,
                            label=label,
                            image=django_file,
                            file_hash=file_hash,
                        )
                        created.append({'id': img.id, 'file': fname, 'hash': file_hash})
                except Exception as e:
                    logger.error(f'Failed to create image {fname}: {e}')
                    errors.append({'file': fname, 'reason': str(e)})

            # Update progress every 10 images or on the last one
            if (i + 1) % 10 == 0 or (i + 1) == total:
                progress = int(5 + (90 * (i + 1) / total))
                self.update_state(state='PROGRESS', meta={
                    'progress': progress,
                    'current': i + 1,
                    'total': total,
                    'message': f'Processed {i + 1}/{total} images...',
                })

        # Trigger dataset archive rebuild if we created any images
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
            'progress': 100, 'current': total, 'total': total,
            'message': 'Done.',
        })

        return result

    except Exception as e:
        logger.error(f'Archive processing failed: {e}', exc_info=True)
        raise

    finally:
        # Always clean up temp files and the archive itself
        try:
            if os.path.isdir(extract_dir):
                shutil.rmtree(extract_dir)
            if os.path.isfile(archive_path):
                os.remove(archive_path)
        except Exception as cleanup_err:
            logger.warning(f'Cleanup error: {cleanup_err}')

# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: bulk_upload.py
# Copyright (c) 2024
#
# Handles bulk image uploads with deduplication and archive support.
# Designed to scale to tens of thousands of images without timeouts.

import hashlib
import logging
import os
import shutil

from django.conf import settings
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import Dataset, Label, Image
from .upload_tasks import process_archive_upload
from .serializers import ImageSerializer

logger = logging.getLogger(__name__)

# Allowed image extensions (lowercase)
IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff', '.tif'}
# Allowed archive extensions (lowercase)
ARCHIVE_EXTENSIONS = {'.zip', '.tar', '.tar.gz', '.tgz'}
# Max individual file size: 20 MB
MAX_FILE_SIZE = 20 * 1024 * 1024
# Max archive size: 500 MB
MAX_ARCHIVE_SIZE = 500 * 1024 * 1024
# Minimum free disk space to accept uploads: 1 GB
MIN_FREE_DISK_BYTES = 1 * 1024 * 1024 * 1024


def compute_file_hash(file_obj):
    """Compute SHA-256 hash of an uploaded file without loading it all into memory."""
    hasher = hashlib.sha256()
    # Reset file position in case it was read before
    file_obj.seek(0)
    for chunk in file_obj.chunks(8192):
        hasher.update(chunk)
    file_obj.seek(0)
    return hasher.hexdigest()


def get_file_extension(filename):
    """Return the lowercased file extension, handling double extensions like .tar.gz."""
    name = filename.lower()
    if name.endswith('.tar.gz'):
        return '.tar.gz'
    _, ext = os.path.splitext(name)
    return ext


def check_disk_space():
    """Return available disk space in bytes for the media root partition."""
    usage = shutil.disk_usage(settings.MEDIA_ROOT)
    return usage.free


@api_view(['POST'])
def bulk_upload(request):
    """
    Accept a batch of image files or a single archive for a given dataset and label.

    Form fields:
      - dataset_id: int
      - label_id: int
      - image: one or more image files (multipart)
      - archive: a single zip/tar/tar.gz file (multipart)

    Returns JSON with created/duplicate/error counts and details.
    """
    dataset_id = request.data.get('dataset_id') or request.data.get('dataset')
    label_id = request.data.get('label_id') or request.data.get('label')

    if not dataset_id or not label_id:
        return Response(
            {'error': 'dataset_id and label_id are required'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        dataset = Dataset.objects.get(pk=dataset_id)
    except Dataset.DoesNotExist:
        return Response(
            {'error': f'Dataset {dataset_id} not found'},
            status=status.HTTP_404_NOT_FOUND,
        )

    try:
        label = Label.objects.get(pk=label_id)
    except Label.DoesNotExist:
        return Response(
            {'error': f'Label {label_id} not found'},
            status=status.HTTP_404_NOT_FOUND,
        )

    # Check disk space before processing
    free_space = check_disk_space()
    if free_space < MIN_FREE_DISK_BYTES:
        return Response(
            {'error': f'Insufficient disk space. Only {free_space // (1024*1024)} MB free.'},
            status=status.HTTP_507_INSUFFICIENT_STORAGE,
        )

    # Determine if this is an archive upload or individual images
    archive_file = request.FILES.get('archive')
    image_files = request.FILES.getlist('image')

    if archive_file:
        return _handle_archive_upload(archive_file, dataset, label, free_space)
    elif image_files:
        return _handle_image_upload(image_files, dataset, label)
    else:
        return Response(
            {'error': 'No files provided. Send images via "image" field or an archive via "archive" field.'},
            status=status.HTTP_400_BAD_REQUEST,
        )


def _handle_image_upload(image_files, dataset, label):
    """Process individual image files with deduplication."""
    created = []
    duplicates = []
    errors = []

    for f in image_files:
        ext = get_file_extension(f.name)
        if ext not in IMAGE_EXTENSIONS:
            errors.append({'file': f.name, 'reason': f'Unsupported format: {ext}'})
            continue

        if f.size > MAX_FILE_SIZE:
            errors.append({'file': f.name, 'reason': f'File too large: {f.size // (1024*1024)} MB (max {MAX_FILE_SIZE // (1024*1024)} MB)'})
            continue

        try:
            file_hash = compute_file_hash(f)
        except Exception as e:
            errors.append({'file': f.name, 'reason': f'Could not hash file: {str(e)}'})
            continue

        # Check for duplicate in same dataset + label
        existing = Image.objects.filter(
            dataset=dataset, label=label, file_hash=file_hash
        ).first()
        if existing:
            duplicates.append({'file': f.name, 'hash': file_hash})
            continue

        try:
            img = Image.objects.create(
                dataset=dataset,
                label=label,
                image=f,
                file_hash=file_hash,
            )
            created.append({'id': img.id, 'file': f.name, 'hash': file_hash})
        except Exception as e:
            logger.error(f'Failed to save image {f.name}: {e}')
            errors.append({'file': f.name, 'reason': str(e)})

    # Trigger archive rebuild if we created any new images
    if created:
        from .tasks import create_dataset_archive
        create_dataset_archive.delay(dataset.id)

    return Response({
        'created': created,
        'duplicates': duplicates,
        'errors': errors,
        'summary': {
            'created_count': len(created),
            'duplicate_count': len(duplicates),
            'error_count': len(errors),
        },
    }, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


def _handle_archive_upload(archive_file, dataset, label, free_space):
    """Save archive to temp dir and queue Celery task for extraction."""
    ext = get_file_extension(archive_file.name)
    if ext not in ARCHIVE_EXTENSIONS:
        return Response(
            {'error': f'Unsupported archive format: {ext}. Use zip, tar, tar.gz, or tgz.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if archive_file.size > MAX_ARCHIVE_SIZE:
        return Response(
            {'error': f'Archive too large: {archive_file.size // (1024*1024)} MB (max {MAX_ARCHIVE_SIZE // (1024*1024)} MB)'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Archives can expand significantly. Make sure we have at least 2x the archive size free.
    required_space = archive_file.size * 2
    if free_space < required_space:
        return Response(
            {'error': f'Not enough disk space for extraction. Need ~{required_space // (1024*1024)} MB, have {free_space // (1024*1024)} MB.'},
            status=status.HTTP_507_INSUFFICIENT_STORAGE,
        )

    # Save archive to a temp directory
    temp_dir = os.path.join(settings.MEDIA_ROOT, 'temp_uploads')
    os.makedirs(temp_dir, exist_ok=True)

    safe_name = archive_file.name.replace('/', '_').replace('\\', '_')
    archive_path = os.path.join(temp_dir, f'{dataset.id}_{label.id}_{safe_name}')

    try:
        with open(archive_path, 'wb') as dest:
            for chunk in archive_file.chunks(8192):
                dest.write(chunk)
    except Exception as e:
        logger.error(f'Failed to save archive {archive_file.name}: {e}')
        return Response(
            {'error': f'Failed to save archive: {str(e)}'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    # Queue Celery task for extraction and processing
    task = process_archive_upload.delay(archive_path, dataset.id, label.id)

    return Response({
        'task_id': task.id,
        'status': 'processing',
        'message': f'Archive "{archive_file.name}" queued for processing.',
    }, status=status.HTTP_202_ACCEPTED)


@api_view(['GET'])
def upload_status(request, task_id):
    """Check the status of an archive upload processing task."""
    from celery.result import AsyncResult

    result = AsyncResult(task_id)

    response_data = {
        'task_id': task_id,
        'status': result.state,
    }

    if result.state == 'PROGRESS':
        meta = result.info or {}
        response_data.update({
            'progress': meta.get('progress', 0),
            'current': meta.get('current', 0),
            'total': meta.get('total', 0),
            'message': meta.get('message', ''),
        })
    elif result.state == 'SUCCESS':
        response_data.update({
            'status': 'completed',
            'result': result.result,
        })
    elif result.state == 'FAILURE':
        response_data.update({
            'status': 'failed',
            'error': str(result.result),
        })

    return Response(response_data)


@api_view(['GET'])
def disk_status(request):
    """Return current disk usage info for the media storage partition."""
    usage = shutil.disk_usage(settings.MEDIA_ROOT)
    return Response({
        'total_gb': round(usage.total / (1024**3), 1),
        'used_gb': round(usage.used / (1024**3), 1),
        'free_gb': round(usage.free / (1024**3), 1),
        'usage_percent': round(usage.used / usage.total * 100, 1),
    })

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
from .image_resize import resize_to_dataset, get_target_resolution

logger = logging.getLogger(__name__)

IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff', '.tif'}
ARCHIVE_EXTENSIONS = {'.zip', '.tar', '.tar.gz', '.tgz'}
MAX_FILE_SIZE = 20 * 1024 * 1024
MAX_ARCHIVE_SIZE = 500 * 1024 * 1024
MIN_FREE_DISK_BYTES = 1 * 1024 * 1024 * 1024


def dataset_is_locked(dataset):
    return (
        dataset.training_sessions.filter(status='Completed').exists()
        or dataset.tests.filter(status='Completed').exists()
    )


def dataset_lock_reason(dataset):
    has_training = dataset.training_sessions.filter(status='Completed').exists()
    has_testing = dataset.tests.filter(status='Completed').exists()

    if has_training and has_testing:
        return 'Dataset is locked because it belongs to completed training and testing sessions.'
    if has_training:
        return 'Dataset is locked because it belongs to a completed training session.'
    if has_testing:
        return 'Dataset is locked because it belongs to a completed testing session.'
    return 'Dataset is locked.'


def compute_file_hash(file_obj):
    hasher = hashlib.sha256()
    file_obj.seek(0)
    for chunk in file_obj.chunks(8192):
        hasher.update(chunk)
    file_obj.seek(0)
    return hasher.hexdigest()


def get_file_extension(filename):
    name = filename.lower()
    if name.endswith('.tar.gz'):
        return '.tar.gz'
    _, ext = os.path.splitext(name)
    return ext


def check_disk_space():
    usage = shutil.disk_usage(settings.MEDIA_ROOT)
    return usage.free


@api_view(['POST'])
def bulk_upload(request):
    dataset_id = request.data.get('dataset_id') or request.data.get('dataset')
    label_id = request.data.get('label_id') or request.data.get('label')

    if not dataset_id or not label_id:
        return Response({'error': 'dataset_id and label_id are required'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        dataset = Dataset.objects.get(pk=dataset_id)
    except Dataset.DoesNotExist:
        return Response({'error': f'Dataset {dataset_id} not found'}, status=status.HTTP_404_NOT_FOUND)

    if dataset_is_locked(dataset):
        return Response({'error': dataset_lock_reason(dataset)}, status=status.HTTP_409_CONFLICT)

    try:
        label = Label.objects.get(pk=label_id)
    except Label.DoesNotExist:
        return Response({'error': f'Label {label_id} not found'}, status=status.HTTP_404_NOT_FOUND)

    free_space = check_disk_space()
    if free_space < MIN_FREE_DISK_BYTES:
        return Response(
            {'error': f'Insufficient disk space. Only {free_space // (1024*1024)} MB free.'},
            status=status.HTTP_507_INSUFFICIENT_STORAGE,
        )

    archive_file = request.FILES.get('archive')
    image_files = request.FILES.getlist('image')

    if archive_file:
        return _handle_archive_upload(archive_file, dataset, label, free_space)
    if image_files:
        return _handle_image_upload(image_files, dataset, label)

    return Response(
        {'error': 'No files provided. Send images via "image" field or an archive via "archive" field.'},
        status=status.HTTP_400_BAD_REQUEST,
    )


def _handle_image_upload(image_files, dataset, label):
    created = []
    duplicates = []
    errors = []
    target_resolution = get_target_resolution(dataset)

    for image_file in image_files:
        ext = get_file_extension(image_file.name)
        if ext not in IMAGE_EXTENSIONS:
            errors.append({'file': image_file.name, 'reason': f'Unsupported format: {ext}'})
            continue

        if image_file.size > MAX_FILE_SIZE:
            errors.append({
                'file': image_file.name,
                'reason': f'File too large: {image_file.size // (1024*1024)} MB (max {MAX_FILE_SIZE // (1024*1024)} MB)',
            })
            continue

        try:
            resized_file, resize_meta = resize_to_dataset(image_file, target_resolution)
            file_hash = compute_file_hash(resized_file)
        except Exception as exc:
            errors.append({'file': image_file.name, 'reason': str(exc)})
            continue

        existing = Image.objects.filter(dataset=dataset, label=label, file_hash=file_hash).first()
        if existing:
            duplicates.append({'file': image_file.name, 'hash': file_hash})
            continue

        try:
            image = Image.objects.create(
                dataset=dataset,
                label=label,
                image=resized_file,
                file_hash=file_hash,
            )
            created.append({
                'id': image.id,
                'file': image_file.name,
                'hash': file_hash,
                'width': resize_meta['width'],
                'height': resize_meta['height'],
            })
        except Exception as exc:
            logger.error(f'Failed to save image {image_file.name}: {exc}')
            errors.append({'file': image_file.name, 'reason': str(exc)})

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

    required_space = archive_file.size * 2
    if free_space < required_space:
        return Response(
            {'error': f'Not enough disk space for extraction. Need ~{required_space // (1024*1024)} MB, have {free_space // (1024*1024)} MB.'},
            status=status.HTTP_507_INSUFFICIENT_STORAGE,
        )

    temp_dir = os.path.join(settings.MEDIA_ROOT, 'temp_uploads')
    os.makedirs(temp_dir, exist_ok=True)

    safe_name = archive_file.name.replace('/', '_').replace('\\', '_')
    archive_path = os.path.join(temp_dir, f'{dataset.id}_{label.id}_{safe_name}')

    try:
        with open(archive_path, 'wb') as destination:
            for chunk in archive_file.chunks(8192):
                destination.write(chunk)
    except Exception as exc:
        logger.error(f'Failed to save archive {archive_file.name}: {exc}')
        return Response({'error': f'Failed to save archive: {str(exc)}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    # Keep Celery task but image processing itself now includes resize for every image.
    task = process_archive_upload.delay(archive_path, dataset.id, label.id)

    return Response({
        'task_id': task.id,
        'status': 'processing',
        'message': f'Archive "{archive_file.name}" queued for processing.',
    }, status=status.HTTP_202_ACCEPTED)


@api_view(['GET'])
def upload_status(request, task_id):
    from celery.result import AsyncResult

    result = AsyncResult(task_id)
    response_data = {'task_id': task_id, 'status': result.state}

    if result.state == 'PROGRESS':
        meta = result.info or {}
        response_data.update({
            'progress': meta.get('progress', 0),
            'current': meta.get('current', 0),
            'total': meta.get('total', 0),
            'message': meta.get('message', ''),
        })
    elif result.state == 'SUCCESS':
        response_data.update({'status': 'completed', 'result': result.result})
    elif result.state == 'FAILURE':
        response_data.update({'status': 'failed', 'error': str(result.result)})

    return Response(response_data)


@api_view(['GET'])
def disk_status(request):
    usage = shutil.disk_usage(settings.MEDIA_ROOT)
    return Response({
        'total_gb': round(usage.total / (1024**3), 1),
        'used_gb': round(usage.used / (1024**3), 1),
        'free_gb': round(usage.free / (1024**3), 1),
        'usage_percent': round(usage.used / usage.total * 100, 1),
    })

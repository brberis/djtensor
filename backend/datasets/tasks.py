from celery_app import app
from celery import shared_task
import os
import tarfile
from django.conf import settings

import logging

logger = logging.getLogger(__name__)

@shared_task
def create_dataset_archive(dataset_id):
    from .models import Dataset

    dataset = Dataset.objects.get(pk=dataset_id)
    base_dir = settings.MEDIA_ROOT / 'archive' / str(dataset_id)
    os.makedirs(base_dir, exist_ok=True)

    for label in dataset.labels.all():
        label_dir = os.path.join(base_dir, label.name.replace(' ', '_').lower())
        os.makedirs(label_dir, exist_ok=True)

        for image in label.images.all():
            original_path = settings.MEDIA_ROOT / image.image.name
            target_path = os.path.join(label_dir, os.path.basename(image.image.name))
            if not os.path.exists(target_path):
                os.link(original_path, target_path)  # Using hard link to avoid copying

    # Creating tar.gz file
    with tarfile.open(f'{base_dir}.tar.gz', 'w:gz') as tar:
        tar.add(base_dir, arcname=os.path.basename(base_dir))

    # Clean up the directory after archiving
    for root, dirs, files in os.walk(base_dir, topdown=False):
        for name in files:
            os.remove(os.path.join(root, name))
        for name in dirs:
            os.rmdir(os.path.join(root, name))
# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: tasks.py
# Copyright (c) 2024


from celery_app import app
from celery import shared_task
import os
import tarfile
from django.conf import settings
import logging

logger = logging.getLogger(__name__)

@shared_task
def create_dataset_archive(dataset_id):
    from .models import Dataset, Image

    dataset = Dataset.objects.get(pk=dataset_id)
    file_name = dataset.name.replace(' ', '_').lower()

    # Use a single base_dir directly under 'archive'
    base_dir = settings.MEDIA_ROOT / 'archive' / file_name
    os.makedirs(base_dir, exist_ok=True)
    logger.info(f"PATH: {base_dir}")

    for label in dataset.labels.all():
        label_dir = base_dir / label.name.replace(' ', '_').lower()
        logger.info(f"LABEL PATH: {label_dir}")
        os.makedirs(label_dir, exist_ok=True)

        # Fetch images that are both associated with the current label and the dataset
        images = Image.objects.filter(label=label, dataset=dataset)  

        for image in images:
            original_path = settings.MEDIA_ROOT / image.image.name
            target_path = label_dir / os.path.basename(image.image.name)
            if not os.path.exists(target_path):
                os.link(original_path, target_path)
                logger.info(f"Linked image {original_path} to {target_path}")
            else:
                logger.info(f"Image already exists at {target_path}")

    # Creating tar.gz file directly in 'archive'
    tar_path = settings.MEDIA_ROOT / 'archive' / f'{file_name}.tar.gz'
    with tarfile.open(tar_path, 'w:gz') as tar:
        tar.add(base_dir, arcname=file_name)  

    # Clean up the directory after archiving
    for root, dirs, files in os.walk(base_dir, topdown=False):
        for name in files:
            os.remove(os.path.join(root, name))
        for name in dirs:
            os.rmdir(os.path.join(root, name))
    logger.info(f"Archive created successfully at {tar_path}")
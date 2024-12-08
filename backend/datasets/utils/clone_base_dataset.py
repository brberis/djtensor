# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: clone_base_dataset.py
# Copyright (c) 2024

import os
from ..models import Dataset, Image, Label

def clone_base_dataset_from_study(old_study_id, new_study_id):
    # Get the first base dataset for the old study
    old_base_dataset = Dataset.objects.filter(study_id=old_study_id, base=True).first()

    # Check if a base dataset was found
    if not old_base_dataset:
        print(f"No base dataset found for study with id {old_study_id}.")
        return

    # Create a new dataset in the new study
    new_dataset = Dataset.objects.create(
        study_id=new_study_id,
        name=f"Base dataset clone",
        resolution=old_base_dataset.resolution, 
        base=True,
        for_testing=False
    )

    # Set labels to the new dataset
    new_dataset.labels.set(old_base_dataset.labels.all())
    new_dataset.save()

    # Clone all images from the old dataset to the new dataset
    for old_image in old_base_dataset.images.all():
        # Create a new image object in the new dataset
        new_image = Image.objects.create(
            dataset=new_dataset,
            image=old_image.image,
            label=old_image.label,
            used_for_training=old_image.used_for_training,
            used_for_testing=old_image.used_for_testing
        )
        new_image.save()

    print(f"New base dataset cloned with id {new_dataset.id} for study {new_study_id}.")

# Example usage:
# clone_base_dataset_from_study(old_study_id=1, new_study_id=2)

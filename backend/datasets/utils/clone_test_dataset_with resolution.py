# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: clone_test_dataset_with resolution.py
# Copyright (c) 2024

import os
from .models import Dataset, Image, Label

def clone_dataset(dataset_id, new_study_id, new_resolution):
    # Get the existing dataset
    try:
        old_dataset = Dataset.objects.get(id=dataset_id, for_testing=True)
    except Dataset.DoesNotExist:
        print(f"No dataset found with id {dataset_id}, study=1, and for_testing=True.")
        return

    # Get the base dataset of the new study
    try:
        new_study_base_dataset = Dataset.objects.get(study=new_study_id, base=True)
    except Dataset.DoesNotExist:
        print(f"No base dataset found for the new study with id {new_study_id}.")
        return

    # Create a new dataset with the new resolution and study
    new_dataset = Dataset.objects.create(
        study_id=new_study_id,
        name=f"{old_dataset.name}_clone",
        description=old_dataset.description,
        resolution=new_resolution,
        base=False,
        for_testing=True
    )
    new_dataset.labels.set(old_dataset.labels.all())
    new_dataset.save()

    # Update the images from the old dataset to the new dataset
    for old_image in old_dataset.images.all():
        # Extract the filename from the old image path
        old_image_filename = os.path.basename(old_image.image.name)
        
        try:
            # Find the corresponding image in the new base dataset by filename
            new_image = new_study_base_dataset.images.get(image__endswith=old_image_filename)
            # Update the dataset pointer and mark it as used for testing
            new_image.dataset = new_dataset
            new_image.used_for_testing = True
            new_image.save()
        except Image.DoesNotExist:
            print(f"No corresponding image found in the new base dataset for image {old_image_filename}.")
            continue

    print(f"New dataset cloned with id {new_dataset.id} and resolution {new_resolution} for study {new_study_id}.")

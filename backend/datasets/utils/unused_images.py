# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: unused_images.py
# Copyright (c) 2024

from datasets.models import Image, Dataset

def update_unused_images():
    try:
        new_dataset = Dataset.objects.get(id=6)
    except Dataset.DoesNotExist:
        print("Dataset with id=6 does not exist.")
        return

    unused_images = Image.objects.filter(used_for_training=False, used_for_testing=False)

    updated_count = unused_images.update(dataset=new_dataset, used_for_training=True)

    print(f"Updated {updated_count} images.")

if __name__ == "__main__":
    update_unused_images()

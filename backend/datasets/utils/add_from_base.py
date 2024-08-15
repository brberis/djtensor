import os
from ..models import Dataset, Image, Label
from django.db.models import Count
from feature_extractor.models import Study
from random import sample

def move_random_images(target_dataset_id, global_base_dataset_id, num_images=50):
    # Get the base dataset
    try:
        base_dataset = Dataset.objects.get(id=global_base_dataset_id)
    except Dataset.DoesNotExist:
        print(f"No base dataset found with id {global_base_dataset_id}.")
        return

    # Get the target dataset
    try:
        target_dataset = Dataset.objects.get(id=target_dataset_id)
    except Dataset.DoesNotExist:
        print(f"No dataset found with id {target_dataset_id}.")
        return

    # Ensure that the base dataset has at least `num_images` images
    if base_dataset.images.count() < num_images:
        print(f"Not enough images in the base dataset with id {global_base_dataset_id}.")
        return

    # Select exactly `num_images` random images from the base dataset
    for label in base_dataset.labels.all():
        label_images = base_dataset.images.filter(label=label)
        if label_images.count() >= num_images:
            random_images = sample(list(label_images), num_images)
            for image in random_images:
                image.dataset = target_dataset
                image.used_for_training = True
                image.save()
        else:
            print(f"Not enough images for label {label.name} in the base dataset.")


    print(f"Random {num_images} images moved from base dataset {global_base_dataset_id} to target dataset with id {target_dataset_id}.")

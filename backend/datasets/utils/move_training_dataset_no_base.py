import os
from ..models import Dataset, Image, Label
from feature_extractor.models import Study

def move_training_dataset(origin_dataset_id, target_dataset_id):
    # Get the existing training dataset (origin)
    try:
        old_dataset = Dataset.objects.get(id=origin_dataset_id, for_testing=False)
    except Dataset.DoesNotExist:
        print(f"No training dataset found with id {origin_dataset_id}.")
        return

    # Get the target dataset
    try:
        new_dataset = Dataset.objects.get(id=target_dataset_id)
    except Dataset.DoesNotExist:
        print(f"No target dataset found with id {target_dataset_id}.")
        return

    # Move all images from the old dataset to the new dataset
    for old_image in old_dataset.images.all():
        # Update the dataset reference to the new dataset
        old_image.dataset = new_dataset
        old_image.save()

    print(f"All images have been moved from dataset {origin_dataset_id} to dataset {target_dataset_id}.")


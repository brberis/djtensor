import os
from ..models import Dataset, Image, Label

def clone_all_images_from_study(old_study_id, new_study_id):
    # Get all datasets for the old study
    old_datasets = Dataset.objects.filter(study_id=old_study_id)

    if not old_datasets.exists():
        print(f"No datasets found for study with id {old_study_id}.")
        return

    # Create a new dataset in the new study
    new_dataset = Dataset.objects.create(
        study_id=new_study_id,
        name=f"consolidated_clone",
        description=f"Consolidated images from study {old_study_id}",
        resolution=old_datasets.first().resolution, 
        base=False,
        for_testing=False
    )
    # Collect all unique labels from the old datasets
    labels = set()
    for old_dataset in old_datasets:
        labels.update(old_dataset.labels.all())

    # Set labels to the new dataset
    new_dataset.labels.set(labels)
    new_dataset.save()

    # Clone all images from the old datasets to the new dataset
    for old_dataset in old_datasets:
        for old_image in old_dataset.images.all():
            # Create a new image object in the new dataset
            new_image = Image.objects.create(
                dataset=new_dataset,
                image=old_image.image,
                label=old_image.label,
                used_for_training=False,
                used_for_testing=False
            )
            new_image.save()

    print(f"New consolidated dataset cloned with id {new_dataset.id} for study {new_study_id}.")

# Example usage:
# clone_all_images_from_study(old_study_id=1, new_study_id=2)

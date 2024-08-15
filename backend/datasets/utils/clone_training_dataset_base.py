import os
from ..models import Dataset, Image, Label
from feature_extractor.models import Study

def clone_training_dataset(dataset_id, new_study_id, global_base_dataset_id):
    # Get the existing training dataset
    try:
        old_dataset = Dataset.objects.get(id=dataset_id, for_testing=False)
    except Dataset.DoesNotExist:
        print(f"No training dataset found with id {dataset_id} and for_testing=False.")
        return

    # Get the base dataset of the new study
    try:
        global_base_dataset = Dataset.objects.get(id=global_base_dataset_id)
    except Dataset.DoesNotExist:
        print(f"No base dataset found for the new study with id {global_base_dataset_id}.")
        return

    # Create a new dataset with the same resolution and new study
    new_dataset = Dataset.objects.create(
        study_id=new_study_id,
        name=f"{old_dataset.name}_clone",
        description=old_dataset.description,
        resolution=old_dataset.resolution,
        base=False,
        for_testing=False  
    )
    new_dataset.labels.set(old_dataset.labels.all())
    new_dataset.shared.set([new_study_id])
    new_dataset.save()

    # Update the images from the old dataset to the new dataset
    for old_image in old_dataset.images.all():
        # Extract the filename from the old image path
        old_image_filename = os.path.basename(old_image.image.name)
        
        try:
            # Find the corresponding image in the new base dataset by filename
            new_image = global_base_dataset.images.get(image__endswith=old_image_filename)
            # Update the dataset pointer and mark it as used for training
            new_image.dataset = new_dataset
            new_image.used_for_training = True
            new_image.save()
        except Image.DoesNotExist:
            print(f"No corresponding image found in the new base dataset for image {old_image_filename}.")
            continue

    print(f"New training dataset cloned with id {new_dataset.id} and resolution {old_dataset.resolution} for study {new_study_id}.")

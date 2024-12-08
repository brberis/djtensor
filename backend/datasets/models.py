# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: models.py
# Copyright (c) 2024

from django.db import models
from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver
from .tasks import create_dataset_archive
import os

RESOLUTIONS = [
    ('224', '224'),
    ('384', '384'),
    ('512', '512'),
]

class Dataset(models.Model):
    study = models.ForeignKey('feature_extractor.Study', related_name='datasets', blank=True, null=True, on_delete=models.CASCADE)
    name = models.CharField(max_length=100, unique=True)
    description = models.TextField(blank=True, null=True)
    labels = models.ManyToManyField('Label', related_name='datasets')
    resolution = models.CharField(max_length=10, choices=RESOLUTIONS, default='224')
    base = models.BooleanField(default=False)
    for_testing = models.BooleanField(default=True)
    shared = models.ManyToManyField('feature_extractor.Study', related_name='shared_datasets')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name

class Label(models.Model):
    name = models.CharField(max_length=100)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name

def get_image_upload_path(instance, filename):
    dataset_name = instance.dataset.name.lower().replace(' ', '_')
    return os.path.join('datasets', f"{dataset_name}-{instance.dataset.id}", filename)

class Image(models.Model):
    dataset = models.ForeignKey(Dataset, related_name='images', on_delete=models.SET_NULL, null=True, blank=True)
    image = models.ImageField(upload_to=get_image_upload_path)
    label = models.ForeignKey(Label, related_name='images', on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    used_for_training = models.BooleanField(default=False)
    used_for_testing = models.BooleanField(default=False)

    def __str__(self):
        return self.image.url


@receiver(post_delete, sender=Image)
def create_dataset_archive_on_delete(sender, instance, **kwargs):
    create_dataset_archive.delay(instance.dataset.id)

@receiver(post_delete, sender=Dataset)
def handle_dataset_deletion(sender, instance, **kwargs):
    base_dataset = Dataset.objects.filter(base=True, study=instance.study).first()
    if base_dataset:
        related_images = Image.objects.filter(dataset=instance)
        related_images.update(
            dataset=base_dataset,
            used_for_training=False,
            used_for_testing=False
        )
from django.db import models
from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver
from .tasks import create_dataset_archive

RESOLUTIONS = [
    ('224x224', '224x224'),
    ('380x380', '380x380')
]

class Dataset(models.Model):
    name = models.CharField(max_length=100, unique=True)
    description = models.TextField(blank=True, null=True)
    labels = models.ManyToManyField('Label', related_name='datasets')
    resolution = models.CharField(max_length=10, choices=RESOLUTIONS, default='224x224')
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
    
class Image(models.Model):
    dataset = models.ForeignKey(Dataset, related_name='images', on_delete=models.CASCADE)
    image = models.ImageField(upload_to='datasets/')
    label = models.ForeignKey(Label, related_name='images', on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.image.url


@receiver(post_save, sender=Image)
def create_dataset_archive_on_save(sender, instance, **kwargs):
    create_dataset_archive.delay(instance.dataset.id)

@receiver(post_delete, sender=Image)
def create_dataset_archive_on_delete(sender, instance, **kwargs):
    create_dataset_archive.delay(instance.dataset.id)
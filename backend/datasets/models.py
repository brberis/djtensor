from django.db import models
from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver
from .tasks import create_dataset_archive

RESOLUTIONS = [
    ('224', '224'),
    # ('240', '240'),
    # ('260', '260'),
    # ('299', '299'),
    # ('300', '300'),
    # ('331', '331'),
    # ('380', '380'),
    ('384', '384'),
    # ('456', '456'),
    # ('480', '480'),
    ('512', '512'),
    # ('528', '528'),
    # ('600', '600')
]

class Dataset(models.Model):
    study = models.ForeignKey('feature_extractor.Study',  related_name='datasets', blank=True, null=True, on_delete=models.CASCADE)
    name = models.CharField(max_length=100, unique=True)
    description = models.TextField(blank=True, null=True)
    labels = models.ManyToManyField('Label', related_name='datasets')
    resolution = models.CharField(max_length=10, choices=RESOLUTIONS, default='224')
    base = models.BooleanField(default=False)
    for_testing = models.BooleanField(default=True)
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


@receiver(post_delete, sender=Image)
def create_dataset_archive_on_delete(sender, instance, **kwargs):
    create_dataset_archive.delay(instance.dataset.id)
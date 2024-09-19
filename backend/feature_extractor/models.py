from django.db import models
from datasets.models import Dataset, Image
from django.db.models.signals import post_save
from django.dispatch import receiver
from .tasks import train_model, test_images

STATUS = [
    ('Pending', 'Pending'),
    ('Training', 'Training'),
    ('Testing', 'Testing'),
    ('Completed', 'Completed'),
    ('Failed', 'Failed')
]

RESOLUTIONS = [
    ('224', '224'),
    ('240', '240'),
    ('260', '260'),
    ('299', '299'),
    ('300', '300'),
    ('331', '331'),
    ('380', '380'),
    ('384', '384'),
    ('456', '456'),
    ('480', '480'),
    ('512', '512'),
    ('528', '528'),
    ('600', '600')
]

PRE_MODEL = [
    ('efficientnetv2-s', 'efficientnetv2-s'),
    ('efficientnetv2-m', 'efficientnetv2-m'),
    ('efficientnetv2-l', 'efficientnetv2-l'),
    ('efficientnetv2-s-21k', 'efficientnetv2-s-21k'),
    ('efficientnetv2-m-21k', 'efficientnetv2-m-21k'),
    ('efficientnetv2-l-21k', 'efficientnetv2-l-21k'),
    ('efficientnetv2-xl-21k', 'efficientnetv2-xl-21k'),
    ('efficientnetv2-b0-21k', 'efficientnetv2-b0-21k'),
    ('efficientnetv2-b1-21k', 'efficientnetv2-b1-21k'),
    ('efficientnetv2-b2-21k', 'efficientnetv2-b2-21k'),
    ('efficientnetv2-b3-21k', 'efficientnetv2-b3-21k'),
    ('efficientnetv2-s-21k-ft1k', 'efficientnetv2-s-21k-ft1k'),
    ('efficientnetv2-m-21k-ft1k', 'efficientnetv2-m-21k-ft1k'),
    ('efficientnetv2-l-21k-ft1k', 'efficientnetv2-l-21k-ft1k'),
    ('efficientnetv2-xl-21k-ft1k', 'efficientnetv2-xl-21k-ft1k'),
    ('efficientnetv2-b0-21k-ft1k', 'efficientnetv2-b0-21k-ft1k'),
    ('efficientnetv2-b1-21k-ft1k', 'efficientnetv2-b1-21k-ft1k'),
    ('efficientnetv2-b2-21k-ft1k', 'efficientnetv2-b2-21k-ft1k'),  
    ('efficientnetv2-b3-21k-ft1k', 'efficientnetv2-b3-21k-ft1k'),   
    ('efficientnetv2-b0', 'efficientnetv2-b0'),
    ('efficientnetv2-b1', 'efficientnetv2-b1'),
    ('efficientnetv2-b2', 'efficientnetv2-b2'),
    ('efficientnetv2-b3', 'efficientnetv2-b3'),
    ('efficientnet_b0', 'efficientnet_b0'),
    ('efficientnet_b1', 'efficientnet_b1'),
    ('efficientnet_b2', 'efficientnet_b2'),
    ('efficientnet_b3', 'efficientnet_b3'),
    ('efficientnet_b4', 'efficientnet_b4'),
    ('efficientnet_b5', 'efficientnet_b5'),
    ('efficientnet_b6', 'efficientnet_b6'),
    ('efficientnet_b7', 'efficientnet_b7'),
    ('bit_s-r50x1', 'bit_s-r50x1'),
    ('inception_v3', 'inception_v3'),
    ('inception_resnet_v2', 'inception_resnet_v2'),
    ('resnet_v1_50', 'resnet_v1_50'),
    ('resnet_v1_101', 'resnet_v1_101'),
    ('resnet_v1_152', 'resnet_v1_152'),
    ('resnet_v2_50', 'resnet_v2_50'),
    ('resnet_v2_101', 'resnet_v2_101'),
    ('resnet_v2_152', 'resnet_v2_152'),
    ('nasnet_mobile', 'nasnet_mobile'),
    ('nasnet_large', 'nasnet_large'),
    ('pnasnet_large', 'pnasnet_large'),
    ('mobilenet_v2_100_224', 'mobilenet_v2_100_224'),
    ('mobilenet_v2_130_224', 'mobilenet_v2_130_224'),
    ('mobilenet_v2_140_224', 'mobilenet_v2_140_224'),
    ('mobilenet_v3_small_100_224', 'mobilenet_v3_small_100_224'),
    ('mobilenet_v3_small_075_224', 'mobilenet_v3_small_075_224'),
    ('mobilenet_v3_large_100_224', 'mobilenet_v3_large_100_224'),
    ('mobilenet_v3_large_075_224', 'mobilenet_v3_large_075_224') 
]
    
# model to store tensorflow trainings
class TFModel(models.Model):
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True, null=True)
    epochs = models.IntegerField(default=20)
    batch_size = models.IntegerField(default=16)
    validation_split = models.FloatField(default=0.2)
    resolution = models.CharField(max_length=10, choices=RESOLUTIONS, default='224')
    data_augmentation = models.BooleanField(default=False)
    grayscale = models.BooleanField(default=False)
    random_grayscale = models.BooleanField(default=False)
    horizontal_flip = models.BooleanField(default=False)
    random_rotation = models.BooleanField(default=False)
    blur = models.BooleanField(default=False)
    pre_model = models.CharField(max_length=100, choices=PRE_MODEL, default='mobilenet_v3_large_075_224')
    default = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.name} {self.default}"
    
class Study(models.Model):
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name
    
class TrainingSession(models.Model):
    study = models.ForeignKey(Study, related_name='training_sessions', blank=True, null=True, on_delete=models.CASCADE)
    name = models.CharField(max_length=100)
    notes = models.TextField(blank=True, null=True)
    dataset = models.ForeignKey(Dataset, related_name='training_sessions', on_delete=models.CASCADE)
    model = models.ForeignKey(TFModel, related_name='training_sessions', on_delete=models.CASCADE)
    class_names = models.TextField(blank=True, null=True)
    status = models.CharField(max_length=30, choices=STATUS, default='Pending')
    model_path = models.CharField(max_length=100, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name
    
class Epoch(models.Model):
    training_session = models.ForeignKey(TrainingSession, related_name='epochs', on_delete=models.CASCADE)
    number = models.IntegerField()
    accuracy = models.FloatField()
    loss = models.FloatField()
    val_accuracy = models.FloatField()
    val_loss = models.FloatField()

class Test(models.Model):
    name = models.CharField(max_length=100)
    notes = models.TextField(blank=True, null=True)
    dataset = models.ForeignKey(Dataset, related_name='tests', on_delete=models.CASCADE)
    training_session = models.ForeignKey(TrainingSession, related_name='tests', on_delete=models.CASCADE)
    status = models.CharField(max_length=30, choices=STATUS, default='Pending')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name

class TestResult(models.Model):
    test = models.ForeignKey(Test, related_name='results', on_delete=models.CASCADE)
    image = models.ForeignKey(Image, related_name='test_results', blank=True, null=True, on_delete=models.CASCADE)
    grad_cam = models.ImageField(upload_to='grad_cam/', blank=True, null=True)
    true_label = models.CharField(max_length=100, blank=True, null=True)
    prediction = models.CharField(max_length=100, blank=True, null=True)
    confidence = models.FloatField()


# @receiver(post_save, sender=TrainingSession)
# def train_model_on_save(sender, instance, created, **kwargs):
#     if created:
#         train_model.delay(instance.id)

    
@receiver(post_save, sender=Test)
def test_images_on_save(sender, instance, created, **kwargs):
    if created:
        test_images.delay(instance.id, instance.training_session.model.resolution)
from django.db import models
from datasets.models import Dataset
from django.db.models.signals import post_save
from django.dispatch import receiver
from .tasks import train_model

SESSION_STATUS = [
    ('Pending', 'Pending'),
    ('Training', 'Training'),
    ('Completed', 'Completed'),
    ('Failed', 'Failed')
]

# model to store tensorflow trainings
class TFModel(models.Model):
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True, null=True)
    epochs = models.IntegerField(default=20)
    batch_size = models.IntegerField(default=16)
    validation_split = models.FloatField(default=0.2)
    data_augmentation = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name
    
class TrainingSession(models.Model):
    name = models.CharField(max_length=100)
    notes = models.TextField(blank=True, null=True)
    dataset = models.ForeignKey(Dataset, related_name='training_sessions', on_delete=models.CASCADE)
    model = models.ForeignKey(TFModel, related_name='training_sessions', on_delete=models.CASCADE)
    status = models.CharField(max_length=30, choices=SESSION_STATUS, default='Pending')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

class Epoch(models.Model):
    training_session = models.ForeignKey(TrainingSession, related_name='epochs', on_delete=models.CASCADE)
    number = models.IntegerField()
    accuracy = models.FloatField()
    loss = models.FloatField()
    val_accuracy = models.FloatField()
    val_loss = models.FloatField()


@receiver(post_save, sender=TrainingSession)
def train_model_on_save(sender, instance, created, **kwargs):
    if created:
        train_model.delay(instance.id)

    


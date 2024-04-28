# from django.db.models.signals import post_save
# from django.dispatch import receiver
# from .tasks import train_model
# from .models import TFModel

# @receiver(post_save, sender=TFModel)
# def train_model_on_save(sender, instance, created, **kwargs):
#     if created:
#         train_model.delay(instance.id)
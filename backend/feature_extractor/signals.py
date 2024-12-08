# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: signals.py
# Copyright (c) 2024

# @receiver(post_save, sender=TFModel)
# def train_model_on_save(sender, instance, created, **kwargs):
#     if created:
#         train_model.delay(instance.id)
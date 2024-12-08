# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: apps.py
# Copyright (c) 2024

from django.apps import AppConfig


class FeatureExtractorConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'feature_extractor'
    
    # def ready(self):
    #     import feature_extractor.signals 
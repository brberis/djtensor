# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: urls.py
# Copyright (c) 2024

from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .api import DatasetViewSet, GenerateDatasetsViewSet, LabelViewSet, ImageViewSet

router = DefaultRouter()
router.register(r'dataset', DatasetViewSet, 'datasets')
router.register(r'generate-dataset', GenerateDatasetsViewSet, 'generate')
router.register(r'label', LabelViewSet, 'labels')
router.register(r'image', ImageViewSet, 'images')

urlpatterns = [
    path('', include(router.urls)),
]
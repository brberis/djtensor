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
from .bulk_upload import bulk_upload, upload_status, disk_status

router = DefaultRouter()
router.register(r'dataset', DatasetViewSet, 'datasets')
router.register(r'generate-dataset', GenerateDatasetsViewSet, 'generate')
router.register(r'label', LabelViewSet, 'labels')
router.register(r'image', ImageViewSet, 'images')

# Custom endpoints must come before the router to avoid the router
# swallowing "bulk-upload" as a detail pk for the image viewset.
urlpatterns = [
    path('image/bulk-upload/', bulk_upload, name='bulk-upload'),
    path('image/upload-status/<str:task_id>/', upload_status, name='upload-status'),
    path('disk-status/', disk_status, name='disk-status'),
    path('', include(router.urls)),
]

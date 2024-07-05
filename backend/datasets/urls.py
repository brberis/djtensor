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
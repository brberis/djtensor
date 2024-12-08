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
from .api import  TFModelViewSet, StudyViewSet, TrainingSessionViewSet, EpochViewSet, TestViewSet, PerformanceViewSet, TestResultViewSet

router = DefaultRouter()
router.register(r'tfmodel', TFModelViewSet, 'tfmodels')
router.register(r'studies', StudyViewSet, 'studies')
router.register(r'trainingsession', TrainingSessionViewSet, 'trainingsessions')
router.register(r'epoch', EpochViewSet, 'epochs')
router.register(r'tests', TestViewSet, 'tests')
router.register(r'testresult', TestResultViewSet, 'testresults')
router.register(r'performance', PerformanceViewSet, 'performance')

urlpatterns = [
    path('', include(router.urls)),
]

# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: admin.py
# Copyright (c) 2024

from django.contrib import admin

from .models import TFModel, Study, TrainingSession, Epoch, Test, TestResult

admin.site.register(TFModel)
admin.site.register(Study)
admin.site.register(TrainingSession)
admin.site.register(Epoch)
admin.site.register(Test)
admin.site.register(TestResult)


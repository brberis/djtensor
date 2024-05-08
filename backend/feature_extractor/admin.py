from django.contrib import admin

from .models import TFModel, TrainingSession, Epoch, Test, TestResult

admin.site.register(TFModel)
admin.site.register(TrainingSession)
admin.site.register(Epoch)
admin.site.register(Test)
admin.site.register(TestResult)


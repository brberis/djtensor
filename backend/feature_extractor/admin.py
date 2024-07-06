from django.contrib import admin

from .models import TFModel, Study, TrainingSession, Epoch, Test, TestResult

admin.site.register(TFModel)
admin.site.register(Study)
admin.site.register(TrainingSession)
admin.site.register(Epoch)
admin.site.register(Test)
admin.site.register(TestResult)


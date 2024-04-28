from django.contrib import admin

from .models import TFModel, TrainingSession, Epoch

admin.site.register(TFModel)
admin.site.register(TrainingSession)
admin.site.register(Epoch)


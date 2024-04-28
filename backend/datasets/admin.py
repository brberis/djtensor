from django.contrib import admin
from .models import Dataset, Image, Label

admin.site.register(Dataset)
admin.site.register(Image)
admin.site.register(Label)



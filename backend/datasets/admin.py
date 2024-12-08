# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: admin.py
# Copyright (c) 2024

from django.contrib import admin
from .models import Dataset, Image, Label
from django.contrib.admin import SimpleListFilter

class UnusedImageFilter(SimpleListFilter):
    title = 'Unused Images'
    parameter_name = 'unused_images'

    def lookups(self, request, model_admin):
        return (
            ('unused', 'Unused'),
        )

    def queryset(self, request, queryset):
        if self.value() == 'unused':
            return queryset.filter(used_for_training=False, used_for_testing=False)
        return queryset

class ImageInline(admin.TabularInline):
    model = Image
    fields = ['dataset', 'image', 'label', 'used_for_training', 'used_for_testing']
    extra = 1  # Number of extra forms to display

@admin.register(Dataset)
class DatasetAdmin(admin.ModelAdmin):
    list_display = ['name', 'study', 'resolution', 'base', 'for_testing', 'created_at']
    search_fields = ['name', 'study__name']
    list_filter = ['resolution', 'base', 'for_testing', 'created_at']
    # inlines = [ImageInline]

@admin.register(Image)
class ImageAdmin(admin.ModelAdmin):
    list_display = ['id', 'image_name', 'dataset', 'label', 'used_for_training', 'used_for_testing', 'created_at']
    list_display_links = ['id', 'image_name']
    search_fields = ['dataset__name', 'label__name']
    list_filter = ['used_for_training', 'used_for_testing', UnusedImageFilter]

    def image_name(self, obj):
        return obj.image.name

    image_name.short_description = 'Image Name'

@admin.register(Label)
class LabelAdmin(admin.ModelAdmin):
    list_display = ['name', 'created_at']
    search_fields = ['name']
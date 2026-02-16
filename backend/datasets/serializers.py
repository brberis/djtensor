# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: serializers.py
# Copyright (c) 2024

from rest_framework import serializers
from .models import Dataset, Image, Label


class DatasetSerializer(serializers.ModelSerializer):
    is_locked = serializers.SerializerMethodField()

    class Meta:
        model = Dataset
        fields = '__all__'

    def get_is_locked(self, obj):
        return (
            obj.training_sessions.filter(status='Completed').exists()
            or obj.tests.filter(status='Completed').exists()
        )


class ImageSerializer(serializers.ModelSerializer):
    file_name = serializers.SerializerMethodField()
    file_extension = serializers.SerializerMethodField()
    file_size = serializers.SerializerMethodField()
    image_width = serializers.SerializerMethodField()
    image_height = serializers.SerializerMethodField()

    class Meta:
        model = Image
        fields = '__all__'

    def get_file_name(self, obj):
        return obj.image.name.split('/')[-1] if obj.image else ''

    def get_file_extension(self, obj):
        name = self.get_file_name(obj)
        return name.split('.')[-1].lower() if '.' in name else ''

    def get_file_size(self, obj):
        try:
            return obj.image.size if obj.image else None
        except Exception:
            return None

    def get_image_width(self, obj):
        try:
            return obj.image.width if obj.image else None
        except Exception:
            return None

    def get_image_height(self, obj):
        try:
            return obj.image.height if obj.image else None
        except Exception:
            return None


class LabelSerializer(serializers.ModelSerializer):
    image_count = serializers.SerializerMethodField()

    class Meta:
        model = Label
        fields = ['id', 'name', 'image_count']

    def get_image_count(self, obj):
        dataset_id = self.context.get('dataset_id')
        if dataset_id:
            return Image.objects.filter(label=obj, dataset__id=dataset_id).count()
        return Image.objects.filter(label=obj).count()

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
    lock_details = serializers.SerializerMethodField()

    class Meta:
        model = Dataset
        fields = '__all__'
        # The 'shared' M2M is populated later via the Studies UI, not at
        # dataset creation time. Mark it optional so the existing Create
        # Dataset form (which never sends 'shared') succeeds.
        extra_kwargs = {
            'shared': {'required': False, 'allow_empty': True},
            'labels': {'required': False, 'allow_empty': True},
        }

    def get_is_locked(self, obj):
        return (
            obj.training_sessions.filter(status='Completed').exists()
            or obj.tests.filter(status='Completed').exists()
        )

    def get_lock_details(self, obj):
        details = []

        completed_training = obj.training_sessions.filter(status='Completed').order_by('-updated_at')
        for session in completed_training[:3]:
            details.append({
                'type': 'training',
                'name': session.name,
                'date': session.updated_at.isoformat() if session.updated_at else None,
            })

        completed_tests = obj.tests.filter(status='Completed').order_by('-updated_at')
        for test in completed_tests[:3]:
            details.append({
                'type': 'testing',
                'name': test.name,
                'date': test.updated_at.isoformat() if test.updated_at else None,
            })

        return sorted(
            details,
            key=lambda item: item.get('date') or '',
            reverse=True,
        )[:5]


class ImageSerializer(serializers.ModelSerializer):
    file_name = serializers.SerializerMethodField()
    file_extension = serializers.SerializerMethodField()
    file_size = serializers.SerializerMethodField()
    image_width = serializers.SerializerMethodField()
    image_height = serializers.SerializerMethodField()
    image = serializers.SerializerMethodField()
    source_image_data = serializers.SerializerMethodField()
    label_name = serializers.CharField(source='label.name', read_only=True, default=None)
    brokenness_overlay_url = serializers.SerializerMethodField()

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

    def get_image(self, obj):
        return self._build_image_url(obj)

    def get_source_image_data(self, obj):
        if not obj.source_image_id:
            return None
        src = obj.source_image
        return {
            'id': src.id,
            'image': self._build_image_url(src),
            'tooth_area': src.tooth_area,
            'completeness': src.completeness,
            'tooth_area_mm2': src.tooth_area_mm2,
            'completeness_mm2': src.completeness_mm2,
            'mm_per_pixel': src.mm_per_pixel,
            'museum_specimen_id': src.museum_specimen_id,
            'museum_species': src.museum_species,
        }

    def _build_image_url(self, obj):
        from django.conf import settings
        import os
        if not obj.image:
            return None
        base = getattr(settings, "BASE_URL", "").rstrip("/")
        url = base + obj.image.url
        try:
            mtime = int(os.path.getmtime(obj.image.path))
            url += "?v=" + str(mtime)
        except Exception:
            pass
        return url

    def get_brokenness_overlay_url(self, obj):
        """Append the file mtime as a cache-busting query string so that
        regenerated overlays are picked up immediately by browsers AND
        Cloudflare edge cache (which otherwise holds the previous PNG
        for up to 4 hours under our current cache-control header).
        """
        if not obj.brokenness_overlay_url:
            return None
        from django.conf import settings
        import os
        url = obj.brokenness_overlay_url
        rel = url.replace(settings.MEDIA_URL.rstrip('/') + '/', '', 1)
        fs_path = os.path.join(settings.MEDIA_ROOT, rel)
        try:
            mtime = int(os.path.getmtime(fs_path))
            sep = '&' if '?' in url else '?'
            url = f"{url}{sep}v={mtime}"
        except Exception:
            pass
        return url


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

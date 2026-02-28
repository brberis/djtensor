# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: serializers.py
# Copyright (c) 2024

from rest_framework import serializers
from django.contrib.auth.models import User
from .models import TFModel, Study, TrainingSession, Epoch, Test, TestResult, StudyMembership
from datasets.models import Dataset
from datasets.serializers import DatasetSerializer  
class TFModelSerializer(serializers.ModelSerializer):
    class Meta:
        model = TFModel
        fields = '__all__'


class EpochSerializer(serializers.ModelSerializer):
    class Meta:
        model = Epoch
        fields = '__all__'
        
class StudySerializer(serializers.ModelSerializer):
    class Meta:
        model = Study
        fields = '__all__'


class UserLightSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'first_name', 'last_name']


class StudyMembershipSerializer(serializers.ModelSerializer):
    user_detail = UserLightSerializer(source='user', read_only=True)

    class Meta:
        model = StudyMembership
        fields = ['id', 'study', 'user', 'user_detail', 'role', 'created_at']

class TrainingSessionSerializer(serializers.ModelSerializer):
    model = TFModelSerializer(read_only=True)
    model_id = serializers.PrimaryKeyRelatedField(
        queryset=TFModel.objects.all(),
        source='model',
        write_only=True,
        required=False  
    )
    dataset = DatasetSerializer(read_only=True)
    dataset_id = serializers.PrimaryKeyRelatedField(
        queryset=Dataset.objects.all(),
        source='dataset',
        write_only=True,
        allow_null=True
    )
    study_id = serializers.PrimaryKeyRelatedField(
        queryset=Study.objects.all(),
        source='study',
        write_only=True,
        required=True
    )
    study = StudySerializer(read_only=True)
    epochs = EpochSerializer(many=True, read_only=True)

    class Meta:
        model = TrainingSession
        fields = ['id', 'study', 'study_id', 'name', 'notes', 'status', 'model', 'model_id', 'dataset', 'dataset_id', 'model_path', 'created_at', 'updated_at', 'epochs']

    def to_internal_value(self, data):
        # Only apply default model logic on create, not on partial update (PATCH)
        if self.instance is None:
            model_id = data.get('model_id')
            if not model_id:
                default_model = TFModel.objects.filter(default=True).first()
                if default_model:
                    data['model_id'] = default_model.id
                else:
                    raise serializers.ValidationError({"model_id": "No default model found and 'model_id' is not provided."})

        return super().to_internal_value(data)
    

    def validate(self, data):
        # Only require hotdataset/dataset_id on create, not on PATCH
        if self.instance is None:
            hotdataset = self.context['request'].data.get('hotdataset')
            dataset_id = self.context['request'].data.get('dataset_id')

            if not hotdataset and not dataset_id:
                raise serializers.ValidationError("Either 'hotdataset' or 'dataset_id' must be provided.")

        return data

    def create(self, validated_data):
        return super().create(validated_data)


class DatasetLightSerializer(serializers.ModelSerializer):
    """Minimal dataset info for list views - skips lock checks."""
    class Meta:
        model = Dataset
        fields = ['id', 'name', 'resolution', 'base', 'for_testing']


class TrainingSessionListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for the training list view. Skips epochs
    and dataset lock checks to avoid extra queries per row."""
    model = TFModelSerializer(read_only=True)
    dataset = DatasetLightSerializer(read_only=True)
    study = StudySerializer(read_only=True)
    created_by_name = serializers.SerializerMethodField()

    def get_created_by_name(self, obj):
        if obj.created_by:
            return obj.created_by.get_full_name() or obj.created_by.username
        return None

    class Meta:
        model = TrainingSession
        fields = ['id', 'study', 'name', 'notes', 'status', 'model',
                  'dataset', 'model_path', 'created_at', 'updated_at',
                  'created_by_name', 'archived_at']

class TestSerializer(serializers.ModelSerializer):
    training_session_id = serializers.PrimaryKeyRelatedField(
        queryset=TrainingSession.objects.all(),
        source='training_session',
        write_only=True
    )
    training_session = TrainingSessionSerializer(read_only=True)

    class Meta:
        model = Test
        fields = '__all__'





class TestListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for the test list view.
    Relies on annotations added by TestViewSet.get_queryset():
      _num_images, _avg_confidence, _num_correct
    """
    training_session = TrainingSessionListSerializer(read_only=True)
    created_by_name = serializers.SerializerMethodField()
    num_images = serializers.SerializerMethodField()
    accuracy = serializers.SerializerMethodField()
    avg_confidence = serializers.SerializerMethodField()

    def get_created_by_name(self, obj):
        if obj.created_by:
            return obj.created_by.get_full_name() or obj.created_by.username
        return None

    def get_num_images(self, obj):
        return getattr(obj, '_num_images', 0)

    def get_accuracy(self, obj):
        total = getattr(obj, '_num_images', 0)
        if total == 0:
            return None
        correct = getattr(obj, '_num_correct', 0)
        return round((correct / total) * 100, 1)

    def get_avg_confidence(self, obj):
        avg = getattr(obj, '_avg_confidence', None)
        if avg is None:
            return None
        return round(avg * 100, 1)

    class Meta:
        model = Test
        fields = '__all__'


class TestResultSerializer(serializers.ModelSerializer):
    grad_cam = serializers.SerializerMethodField()

    def get_grad_cam(self, obj):
        if not obj.grad_cam:
            return None
        # Cache-bust to avoid stale CDN 404s after deployment
        return f"/media/{obj.grad_cam.name}?v={obj.id}"

    class Meta:
        model = TestResult
        depth = 2
        fields = '__all__'

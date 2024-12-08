# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: serializers.py
# Copyright (c) 2024

from rest_framework import serializers
from .models import TFModel, Study, TrainingSession, Epoch, Test, TestResult
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
        model_id = data.get('model_id')

        if not model_id:
            default_model = TFModel.objects.filter(default=True).first()
            if default_model:
                data['model_id'] = default_model.id
            else:
                raise serializers.ValidationError({"model_id": "No default model found and 'model_id' is not provided."})

        return super().to_internal_value(data)
    

    def validate(self, data):
        hotdataset = self.context['request'].data.get('hotdataset')
        dataset_id = self.context['request'].data.get('dataset_id')

        if not hotdataset and not dataset_id:
            raise serializers.ValidationError("Either 'hotdataset' or 'dataset_id' must be provided.")

        return data

    def create(self, validated_data):
        return super().create(validated_data)

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


class TestResultSerializer(serializers.ModelSerializer):
    class Meta:
        model = TestResult
        depth = 2
        fields = '__all__'
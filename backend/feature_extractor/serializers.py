from rest_framework import serializers
from .models import TFModel, TrainingSession, Epoch, Test
from datasets.models import Dataset
from datasets.serializers import DatasetSerializer  
class TFModelSerializer(serializers.ModelSerializer):
    class Meta:
        model = TFModel
        fields = '__all__'

class TrainingSessionSerializer(serializers.ModelSerializer):
    model = TFModelSerializer(read_only=True)
    model_id = serializers.PrimaryKeyRelatedField(
        queryset=TFModel.objects.all(),
        source='model',
        write_only=True
    )
    dataset = DatasetSerializer(read_only=True)
    dataset_id = serializers.PrimaryKeyRelatedField(
        queryset=Dataset.objects.all(),
        source='dataset',
        write_only=True
    )


    class Meta:
        model = TrainingSession
        fields = ['id', 'name', 'notes', 'status', 'model', 'model_id', 'dataset', 'dataset_id', 'model_path', 'created_at', 'updated_at']

class EpochSerializer(serializers.ModelSerializer):
    class Meta:
        model = Epoch
        fields = '__all__'
        

class TestSerializer(serializers.ModelSerializer):
    class Meta:
        model = Test
        fields = '__all__'
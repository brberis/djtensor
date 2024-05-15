from rest_framework import serializers
from .models import TFModel, TrainingSession, Epoch, Test, TestResult
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
        write_only=True,
        allow_null=True
    )

    class Meta:
        model = TrainingSession
        fields = ['id', 'name', 'notes', 'status', 'model', 'model_id', 'dataset', 'dataset_id', 'model_path', 'created_at', 'updated_at']

    def validate(self, data):
        print("Validation data:", data)
        hotdataset = self.context['request'].data.get('hotdataset')
        dataset_id = data.get('dataset_id')
        
        if not hotdataset and not dataset_id:
            raise serializers.ValidationError("Either 'hotdataset' or 'dataset_id' must be provided.")
        
        return data


class EpochSerializer(serializers.ModelSerializer):
    class Meta:
        model = Epoch
        fields = '__all__'
        

class TestSerializer(serializers.ModelSerializer):
    class Meta:
        model = Test
        fields = '__all__'

class TestResultSerializer(serializers.ModelSerializer):
    class Meta:
        model = TestResult
        depth = 2
        fields = '__all__'
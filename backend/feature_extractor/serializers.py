from rest_framework import serializers
from .models import TFModel, TrainingSession, Epoch

class TFModelSerializer(serializers.ModelSerializer):
    class Meta:
        model = TFModel
        fields = '__all__'

class TrainingSessionSerializer(serializers.ModelSerializer):
    class Meta:
        model = TrainingSession
        fields = '__all__'

class EpochSerializer(serializers.ModelSerializer):
    class Meta:
        model = Epoch
        fields = '__all__'
        
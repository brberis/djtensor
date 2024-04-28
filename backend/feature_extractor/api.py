from rest_framework import viewsets
from .models import TFModel, TrainingSession, Epoch
from .serializers import TFModelSerializer, TrainingSessionSerializer, EpochSerializer

class TFModelViewSet(viewsets.ModelViewSet):
    queryset = TFModel.objects.all()
    serializer_class = TFModelSerializer

class TrainingSessionViewSet(viewsets.ModelViewSet):
    queryset = TrainingSession.objects.all()
    serializer_class = TrainingSessionSerializer

class EpochViewSet(viewsets.ModelViewSet):
    queryset = Epoch.objects.all()
    serializer_class = EpochSerializer



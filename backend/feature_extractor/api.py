from rest_framework import viewsets
from .models import TFModel, TrainingSession, Epoch, Test, TestResult
from .serializers import TFModelSerializer, TrainingSessionSerializer, EpochSerializer, TestSerializer, TestResultSerializer
from django_filters.rest_framework import DjangoFilterBackend

class TFModelViewSet(viewsets.ModelViewSet):
    queryset = TFModel.objects.all()
    serializer_class = TFModelSerializer

class TrainingSessionViewSet(viewsets.ModelViewSet):
    queryset = TrainingSession.objects.all()
    serializer_class = TrainingSessionSerializer

class EpochViewSet(viewsets.ModelViewSet):
    queryset = Epoch.objects.all()
    serializer_class = EpochSerializer

class TestViewSet(viewsets.ModelViewSet):
    queryset = Test.objects.all()
    serializer_class = TestSerializer

class TestResultViewSet(viewsets.ModelViewSet):
    queryset = TestResult.objects.all()
    serializer_class = TestResultSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['test__id'] 

class PerformanceViewSet(viewsets.ModelViewSet):
    serializer_class = TrainingSessionSerializer

    def get_queryset(self):
        # return the last 'Completed' training session in a list
        last_session = TrainingSession.objects.filter(status='Completed').last()
        return [last_session] if last_session else TrainingSession.objects.none()
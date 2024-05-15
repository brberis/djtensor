import random
import string
from django.db import transaction
from rest_framework import viewsets, serializers
from .models import TFModel, TrainingSession, Epoch, Test, TestResult
from datasets.models import Dataset, Image
from .serializers import TFModelSerializer, TrainingSessionSerializer, EpochSerializer, TestSerializer, TestResultSerializer
from django_filters.rest_framework import DjangoFilterBackend
from random import sample
from datasets.tasks import create_dataset_archive
from celery import chain
from .tasks import train_model



class TFModelViewSet(viewsets.ModelViewSet):
    queryset = TFModel.objects.all()
    serializer_class = TFModelSerializer
class TrainingSessionViewSet(viewsets.ModelViewSet):
    queryset = TrainingSession.objects.all()
    serializer_class = TrainingSessionSerializer

    def perform_create(self, serializer):
        hotdataset = self.request.data.get('hotdataset')
        if hotdataset:
            base_dataset = Dataset.objects.filter(base=True).last()
            if base_dataset:
                labels = base_dataset.labels.all()
                unique_suffix = ''.join(random.choices(string.ascii_letters + string.digits, k=6))
                dataset_name = f"Hot Dataset {hotdataset} {unique_suffix}"
                new_dataset = Dataset.objects.create(
                    name=dataset_name,
                    description=f"Generated dataset with {hotdataset} samples",
                    resolution=base_dataset.resolution,
                    base=False,
                    for_testing=False
                )
                new_dataset.labels.set(labels)
                for label in labels:
                    images = list(Image.objects.filter(dataset=base_dataset, label=label))
                    selected_images = sample(images, int(hotdataset))
                    for image in selected_images:
                        Image.objects.create(
                            dataset=new_dataset,
                            image=image.image,
                            label=label
                        )
                training_session = serializer.save(dataset=new_dataset)
                print("T?>>>>>>>>>>  raining session created with hot dataset.",training_session, "ID:", training_session.id)
                # Delay the task until the transaction is committed
                transaction.on_commit(lambda: chain(
                    create_dataset_archive.s(new_dataset.id),
                    train_model.s(training_session.id)
                ).apply_async())
            else:
                raise serializers.ValidationError("Base dataset not found.")
        else:
            training_session = serializer.save()
            print("Training session created without hot dataset.", training_session, "ID:", training_session.id)

            transaction.on_commit(lambda: train_model.apply_async((training_session.id,)))  # Adding a delay

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
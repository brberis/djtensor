# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: api.py
# Copyright (c) 2024

import logging
import random

from django.core.exceptions import ObjectDoesNotExist
from django.db import transaction
from django.db.models import Q
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response

from feature_extractor.models import Study
from .models import Dataset, Image, Label
from .serializers import DatasetSerializer, ImageSerializer, LabelSerializer
from .tasks import create_dataset_archive

logger = logging.getLogger(__name__)


def dataset_is_locked(dataset):
    return (
        dataset.training_sessions.filter(status='Completed').exists()
        or dataset.tests.filter(status='Completed').exists()
    )


def dataset_lock_reason(dataset):
    has_training = dataset.training_sessions.filter(status='Completed').exists()
    has_testing = dataset.tests.filter(status='Completed').exists()

    if has_training and has_testing:
        return 'Dataset is locked because it belongs to completed training and testing sessions.'
    if has_training:
        return 'Dataset is locked because it belongs to a completed training session.'
    if has_testing:
        return 'Dataset is locked because it belongs to a completed testing session.'
    return ''


class ImagePagination(PageNumberPagination):
    page_size = 10
    page_size_query_param = 'page_size'
    max_page_size = 100


class DatasetViewSet(viewsets.ModelViewSet):
    queryset = Dataset.objects.all()
    serializer_class = DatasetSerializer

    def update(self, request, *args, **kwargs):
        dataset = self.get_object()
        if dataset_is_locked(dataset):
            return Response({'error': dataset_lock_reason(dataset)}, status=status.HTTP_409_CONFLICT)
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        dataset = self.get_object()
        if dataset_is_locked(dataset):
            return Response({'error': dataset_lock_reason(dataset)}, status=status.HTTP_409_CONFLICT)
        return super().partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        dataset = self.get_object()
        if dataset_is_locked(dataset):
            return Response({'error': dataset_lock_reason(dataset)}, status=status.HTTP_409_CONFLICT)
        return super().destroy(request, *args, **kwargs)


class LabelViewSet(viewsets.ModelViewSet):
    queryset = Label.objects.all()
    serializer_class = LabelSerializer
    filter_backends = (DjangoFilterBackend,)
    filterset_fields = ['datasets__id']

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['dataset_id'] = self.request.query_params.get('datasets__id')
        return context

    def partial_update(self, request, *args, **kwargs):
        label = self.get_object()
        locked_dataset = label.datasets.filter(
            Q(training_sessions__status='Completed') | Q(tests__status='Completed')
        ).distinct().first()

        if locked_dataset:
            return Response({'error': dataset_lock_reason(locked_dataset)}, status=status.HTTP_409_CONFLICT)

        return super().partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        label = self.get_object()
        locked_dataset = label.datasets.filter(
            Q(training_sessions__status='Completed') | Q(tests__status='Completed')
        ).distinct().first()

        if locked_dataset:
            return Response({'error': dataset_lock_reason(locked_dataset)}, status=status.HTTP_409_CONFLICT)

        return super().destroy(request, *args, **kwargs)


class ImageViewSet(viewsets.ModelViewSet):
    queryset = Image.objects.all()
    serializer_class = ImageSerializer
    filter_backends = (DjangoFilterBackend,)
    filterset_fields = ['dataset', 'label']
    pagination_class = ImagePagination

    def create(self, request, *args, **kwargs):
        try:
            dataset = Dataset.objects.get(id=request.data.get('dataset'))
            if dataset_is_locked(dataset):
                return Response({'error': dataset_lock_reason(dataset)}, status=status.HTTP_409_CONFLICT)

            label = Label.objects.get(id=request.data.get('label'))
            images = request.FILES.getlist('image')

            new_images = []
            with transaction.atomic():
                for image in images:
                    img_instance = Image.objects.create(dataset=dataset, label=label, image=image)
                    new_images.append(img_instance)

                create_dataset_archive.delay(dataset.id)

            serializer = self.get_serializer(new_images, many=True)
            return Response(serializer.data)
        except ObjectDoesNotExist as e:
            logger.error(f'Object does not exist: {str(e)}')
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            logger.error(f'Unexpected error occurred: {str(e)}')
            return Response({'error': 'Unexpected error occurred: ' + str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    def update(self, request, *args, **kwargs):
        image = self.get_object()
        if image.dataset and dataset_is_locked(image.dataset):
            return Response({'error': dataset_lock_reason(image.dataset)}, status=status.HTTP_409_CONFLICT)
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        image = self.get_object()
        if image.dataset and dataset_is_locked(image.dataset):
            return Response({'error': dataset_lock_reason(image.dataset)}, status=status.HTTP_409_CONFLICT)
        return super().partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        image = self.get_object()
        if image.dataset and dataset_is_locked(image.dataset):
            return Response({'error': dataset_lock_reason(image.dataset)}, status=status.HTTP_409_CONFLICT)
        return super().destroy(request, *args, **kwargs)

    @action(detail=False, methods=['post'])
    def bulk_delete(self, request):
        dataset_id = request.data.get('dataset_id')
        label_id = request.data.get('label_id')
        image_ids = request.data.get('image_ids', [])
        delete_all = bool(request.data.get('delete_all', False))

        if not dataset_id or not label_id:
            return Response({'error': 'dataset_id and label_id are required.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            dataset = Dataset.objects.get(id=dataset_id)
        except Dataset.DoesNotExist:
            return Response({'error': 'Dataset not found.'}, status=status.HTTP_404_NOT_FOUND)

        if dataset_is_locked(dataset):
            return Response({'error': dataset_lock_reason(dataset)}, status=status.HTTP_409_CONFLICT)

        queryset = Image.objects.filter(dataset_id=dataset_id, label_id=label_id)
        if not delete_all:
            if not image_ids:
                return Response({'error': 'image_ids is required unless delete_all is true.'}, status=status.HTTP_400_BAD_REQUEST)
            queryset = queryset.filter(id__in=image_ids)

        deleted_count = queryset.count()
        queryset.delete()
        create_dataset_archive.delay(dataset.id)

        return Response({'deleted_count': deleted_count}, status=status.HTTP_200_OK)


class GenerateDatasetsViewSet(viewsets.ViewSet):

    def create(self, request, *args, **kwargs):
        formData = request.data

        newDataset = {
            'study': formData.get('study'),
            'name': formData.get('name'),
            'labels': formData['labels'],
            'description': formData.get('description'),
            'resolution': formData.get('resolution'),
            'base': False,
            'for_testing': formData.get('for_testing'),
            'sample_number': int(formData.get('sample_number')),
        }
        logger.info(newDataset)

        try:
            with transaction.atomic():
                study_instance = Study.objects.get(id=newDataset['study'])

                dataset = Dataset.objects.create(
                    study=study_instance,
                    name=newDataset['name'],
                    description=newDataset['description'],
                    resolution=newDataset['resolution'],
                    base=newDataset['base'],
                    for_testing=newDataset['for_testing'],
                )

                labels = Label.objects.filter(id__in=newDataset['labels'])
                dataset.labels.set(labels)

                if newDataset['for_testing']:
                    self._create_testing_dataset(dataset, labels, newDataset['sample_number'])
                else:
                    self._create_non_testing_dataset(dataset, labels, newDataset['sample_number'])

                serializer = DatasetSerializer(dataset)
                transaction.on_commit(lambda: self._trigger_create_dataset_archive(dataset.id))
                return Response(serializer.data, status=status.HTTP_201_CREATED)
        except Exception as e:
            logger.error(f'Error creating dataset: {str(e)}')
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    def _trigger_create_dataset_archive(self, dataset_id):
        create_dataset_archive.delay(dataset_id)

    def _create_testing_dataset(self, dataset, labels, sample_number):
        base_images = Image.objects.filter(dataset__base=True, used_for_testing=False)

        for label in labels:
            label_images = base_images.filter(label=label, dataset__study=dataset.study)
            selected_images = random.sample(list(label_images), sample_number)

            for image in selected_images:
                image.used_for_testing = True
                image.save()
                dataset.images.add(image)

    def _create_non_testing_dataset(self, dataset, labels, sample_number):
        base_images = Image.objects.filter(dataset__base=True, used_for_training=False, dataset__study=dataset.study)
        testing_images = Image.objects.filter(used_for_testing=True, dataset__study=dataset.study)
        training_datasets = Dataset.objects.filter(base=False, for_testing=False, study=dataset.study).order_by('-created_at')

        for label in labels:
            used_images = set(testing_images.filter(label=label).values_list('id', flat=True))
            selected_images = []

            if training_datasets.exists():
                latest_dataset = training_datasets.first()
                latest_images = Image.objects.filter(dataset=latest_dataset, label=label)
                selected_images = list(latest_images)

            if len(selected_images) < sample_number:
                remaining_images = base_images.exclude(id__in=used_images).filter(label=label)
                new_images = random.sample(list(remaining_images), sample_number - len(selected_images))
                selected_images.extend(new_images)

            for image in selected_images:
                image.used_for_training = True
                image.save()
                dataset.images.add(image)

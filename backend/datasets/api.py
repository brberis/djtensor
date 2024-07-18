from rest_framework import viewsets, status
from .models import Dataset, Label, Image
from .serializers import DatasetSerializer, LabelSerializer, ImageSerializer
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.response import Response
from django.core.exceptions import ObjectDoesNotExist
from django.db import transaction
from .tasks import create_dataset_archive
import random
from rest_framework.pagination import PageNumberPagination

class ImagePagination(PageNumberPagination):
    page_size = 10  
    page_size_query_param = 'page_size'
    max_page_size = 100

class DatasetViewSet(viewsets.ModelViewSet):
    queryset = Dataset.objects.all()
    serializer_class = DatasetSerializer

class LabelViewSet(viewsets.ModelViewSet):
    queryset = Label.objects.all()
    serializer_class = LabelSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['datasets__id'] 


class ImageViewSet(viewsets.ModelViewSet):
    queryset = Image.objects.all()
    serializer_class = ImageSerializer
    filter_backends = (DjangoFilterBackend,)
    filterset_fields = ['dataset']
    pagination_class = ImagePagination

    def create(self, request, *args, **kwargs):
        print(request.data.get('dataset'))
        try:
            dataset = Dataset.objects.get(id=request.data.get('dataset'))
            label = Label.objects.get(id=request.data.get('label'))
            images = request.FILES.getlist('image')

            new_images = []
            # Use a transaction to ensure all images are saved successfully
            with transaction.atomic():
                for image in images:
                    img_instance = Image.objects.create(dataset=dataset, label=label, image=image)
                    new_images.append(img_instance)

                # Trigger archive creation after all images are uploaded
                create_dataset_archive.delay(dataset.id)

            serializer = self.get_serializer(new_images, many=True)
            return Response(serializer.data)
        except ObjectDoesNotExist as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            return Response({'error': 'Unexpected error occurred: ' + str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

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
            'sample_number': int(formData.get('sample_number'))
        }
        print(newDataset)
        # try:
        #     with transaction.atomic():
        dataset = Dataset.objects.create(
            name=newDataset['name'],
            description=newDataset['description'],
            resolution=newDataset['resolution'],
            base=newDataset['base'],
            for_testing=newDataset['for_testing']
        )

        labels = Label.objects.filter(id__in=newDataset['labels'])
        dataset.labels.set(labels)

        if newDataset['for_testing']:
            self._create_testing_dataset(dataset, labels, newDataset['sample_number'])
        else:
            self._create_non_testing_dataset(dataset, labels, newDataset['sample_number'])

        serializer = DatasetSerializer(dataset)
        return Response(serializer.data, status=status.HTTP_201_CREATED)
        # except Exception as e:
        #     return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    def _create_testing_dataset(self, dataset, labels, sample_number):
        base_images = Image.objects.filter(dataset__base=True)

        for label in labels:
            label_images = base_images.filter(label=label)
            selected_images = random.sample(list(label_images), sample_number)

            for image in selected_images:
                Image.objects.create(
                    dataset=dataset,
                    image=image.image,
                    label=label
                )

    def _create_non_testing_dataset(self, dataset, labels, sample_number):
        testing_images = Image.objects.filter(dataset__for_testing=True)
        training_datasets = Dataset.objects.filter(for_testing=False).order_by('-created_at')

        for label in labels:
            # Collect used images IDs from testing datasets
            used_images = set(testing_images.filter(label=label).values_list('id', flat=True))
            selected_images = []

            if training_datasets.exists():
                latest_dataset = training_datasets.first()
                latest_images = Image.objects.filter(dataset=latest_dataset, label=label)
                selected_images = list(latest_images)

            if len(selected_images) < sample_number:
                remaining_images = Image.objects.exclude(id__in=used_images).filter(label=label)
                new_images = random.sample(list(remaining_images), sample_number - len(selected_images))
                selected_images.extend(new_images)

            for image in selected_images:
                Image.objects.create(
                    dataset=dataset,
                    image=image.image,
                    label=label
                )
       
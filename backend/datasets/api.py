from rest_framework import viewsets, status
from .models import Dataset, Label, Image
from .serializers import DatasetSerializer, LabelSerializer, ImageSerializer
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.response import Response
from django.core.exceptions import ObjectDoesNotExist

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

    def create(self, request, *args, **kwargs):
        print(request.data.get('dataset'))
        try:
            dataset = Dataset.objects.get(id=request.data.get('dataset'))
            label = Label.objects.get(id=request.data.get('label'))
            images = request.FILES.getlist('image')

            new_images = []
            for image in images:
                img_instance = Image.objects.create(dataset=dataset,
                 label=label, image=image)
                new_images.append(img_instance)

            serializer = self.get_serializer(new_images, many=True)
            return Response(serializer.data)
        except ObjectDoesNotExist as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            return Response({'error': 'Unexpected error occurred: ' + str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
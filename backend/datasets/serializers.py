from rest_framework import serializers
from .models import Dataset, Image, Label

class DatasetSerializer(serializers.ModelSerializer):
    class Meta:
        model = Dataset
        fields = '__all__'

class ImageSerializer(serializers.ModelSerializer):
    class Meta:
        model = Image
        fields = '__all__'

class LabelSerializer(serializers.ModelSerializer):
    image_count = serializers.SerializerMethodField()

    class Meta:
        model = Label
        fields = ['id', 'name', 'image_count']

    def get_image_count(self, obj):
        dataset_id = self.context.get('dataset_id')
        if dataset_id:
            return Image.objects.filter(label=obj, dataset__id=dataset_id).count()
        return Image.objects.filter(label=obj).count()


# Generated by Django 4.2.3 on 2024-07-19 02:04

import datasets.models
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('datasets', '0012_alter_dataset_resolution'),
    ]

    operations = [
        migrations.AlterField(
            model_name='image',
            name='image',
            field=models.ImageField(upload_to=datasets.models.get_image_upload_path),
        ),
    ]

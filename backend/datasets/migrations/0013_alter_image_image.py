# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: 0013_alter_image_image.py
# Copyright (c) 2024

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

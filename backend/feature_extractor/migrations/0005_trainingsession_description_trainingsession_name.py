# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: 0005_trainingsession_description_trainingsession_name.py
# Copyright (c) 2024

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('feature_extractor', '0004_tfmodel_data_augmentation_alter_tfmodel_batch_size'),
    ]

    operations = [
        migrations.AddField(
            model_name='trainingsession',
            name='description',
            field=models.TextField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='trainingsession',
            name='name',
            field=models.CharField(default='training', max_length=100),
            preserve_default=False,
        ),
    ]

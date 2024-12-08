# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: 0014_testresult_image.py
# Copyright (c) 2024

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('datasets', '0007_alter_dataset_resolution'),
        ('feature_extractor', '0013_tfmodel_pre_model'),
    ]

    operations = [
        migrations.AddField(
            model_name='testresult',
            name='image',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='test_results', to='datasets.image'),
        ),
    ]

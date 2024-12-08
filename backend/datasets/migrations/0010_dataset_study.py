# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: 0010_dataset_study.py
# Copyright (c) 2024

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('feature_extractor', '0020_study_trainingsession_study'),
        ('datasets', '0009_alter_dataset_resolution'),
    ]

    operations = [
        migrations.AddField(
            model_name='dataset',
            name='study',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='datasets', to='feature_extractor.study'),
        ),
    ]

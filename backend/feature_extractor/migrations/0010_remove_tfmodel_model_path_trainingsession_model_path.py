# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: 0010_remove_tfmodel_model_path_trainingsession_model_path.py
# Copyright (c) 2024

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('feature_extractor', '0009_tfmodel_model_path_alter_trainingsession_status_test'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='tfmodel',
            name='model_path',
        ),
        migrations.AddField(
            model_name='trainingsession',
            name='model_path',
            field=models.CharField(blank=True, max_length=100, null=True),
        ),
    ]

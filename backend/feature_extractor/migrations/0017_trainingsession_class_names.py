# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: 0017_trainingsession_class_names.py
# Copyright (c) 2024

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('feature_extractor', '0016_alter_tfmodel_resolution'),
    ]

    operations = [
        migrations.AddField(
            model_name='trainingsession',
            name='class_names',
            field=models.TextField(blank=True, null=True),
        ),
    ]

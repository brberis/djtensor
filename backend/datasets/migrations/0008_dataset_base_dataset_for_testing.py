# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: 0008_dataset_base_dataset_for_testing.py
# Copyright (c) 2024

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('datasets', '0007_alter_dataset_resolution'),
    ]

    operations = [
        migrations.AddField(
            model_name='dataset',
            name='base',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='dataset',
            name='for_testing',
            field=models.BooleanField(default=True),
        ),
    ]

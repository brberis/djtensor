# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: 0005_remove_label_dataset_dataset_labels.py
# Copyright (c) 2024

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('datasets', '0004_label_dataset'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='label',
            name='dataset',
        ),
        migrations.AddField(
            model_name='dataset',
            name='labels',
            field=models.ManyToManyField(blank=True, null=True, related_name='datasets', to='datasets.label'),
        ),
    ]

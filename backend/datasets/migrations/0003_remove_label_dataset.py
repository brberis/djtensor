# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: 0003_remove_label_dataset.py
# Copyright (c) 2024

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('datasets', '0002_alter_dataset_name'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='label',
            name='dataset',
        ),
    ]

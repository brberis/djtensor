# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: 0012_alter_dataset_resolution.py
# Copyright (c) 2024

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('datasets', '0011_merge_20240706_0304'),
    ]

    operations = [
        migrations.AlterField(
            model_name='dataset',
            name='resolution',
            field=models.CharField(choices=[('224', '224'), ('384', '384'), ('512', '512')], default='224', max_length=10),
        ),
    ]

# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: 0004_label_dataset.py
# Copyright (c) 2024

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('datasets', '0003_remove_label_dataset'),
    ]

    operations = [
        migrations.AddField(
            model_name='label',
            name='dataset',
            field=models.ForeignKey(default=1, on_delete=django.db.models.deletion.CASCADE, related_name='labels', to='datasets.dataset'),
            preserve_default=False,
        ),
    ]

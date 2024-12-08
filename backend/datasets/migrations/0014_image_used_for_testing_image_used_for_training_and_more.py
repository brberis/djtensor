# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: 0014_image_used_for_testing_image_used_for_training_and_more.py
# Copyright (c) 2024

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('datasets', '0013_alter_image_image'),
    ]

    operations = [
        migrations.AddField(
            model_name='image',
            name='used_for_testing',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='image',
            name='used_for_training',
            field=models.BooleanField(default=False),
        ),
        migrations.AlterField(
            model_name='image',
            name='dataset',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='images', to='datasets.dataset'),
        ),
    ]

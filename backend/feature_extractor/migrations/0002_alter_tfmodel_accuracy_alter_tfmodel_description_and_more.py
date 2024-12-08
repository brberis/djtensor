# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: 0002_alter_tfmodel_accuracy_alter_tfmodel_description_and_more.py
# Copyright (c) 2024

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('feature_extractor', '0001_initial'),
    ]

    operations = [
        migrations.AlterField(
            model_name='tfmodel',
            name='accuracy',
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AlterField(
            model_name='tfmodel',
            name='description',
            field=models.TextField(blank=True, null=True),
        ),
        migrations.AlterField(
            model_name='tfmodel',
            name='loss',
            field=models.CharField(blank=True, max_length=100, null=True),
        ),
        migrations.AlterField(
            model_name='tfmodel',
            name='optimizer',
            field=models.CharField(blank=True, max_length=100, null=True),
        ),
    ]

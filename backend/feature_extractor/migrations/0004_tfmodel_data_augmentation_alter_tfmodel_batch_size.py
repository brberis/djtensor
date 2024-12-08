# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: 0004_tfmodel_data_augmentation_alter_tfmodel_batch_size.py
# Copyright (c) 2024

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('feature_extractor', '0003_remove_tfmodel_accuracy_remove_tfmodel_loss_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='tfmodel',
            name='data_augmentation',
            field=models.BooleanField(default=False),
        ),
        migrations.AlterField(
            model_name='tfmodel',
            name='batch_size',
            field=models.IntegerField(default=16),
        ),
    ]

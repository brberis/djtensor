# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: 0008_alter_trainingsession_status.py
# Copyright (c) 2024

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('feature_extractor', '0007_rename_timestamp_trainingsession_created_at_and_more'),
    ]

    operations = [
        migrations.AlterField(
            model_name='trainingsession',
            name='status',
            field=models.CharField(choices=[('Pending', 'Pending'), ('Training', 'Training'), ('Completed', 'Completed'), ('Failed', 'Failed')], default='Pending', max_length=30),
        ),
    ]

# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: 0007_rename_timestamp_trainingsession_created_at_and_more.py
# Copyright (c) 2024

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('feature_extractor', '0006_rename_description_trainingsession_notes_and_more'),
    ]

    operations = [
        migrations.RenameField(
            model_name='trainingsession',
            old_name='timestamp',
            new_name='created_at',
        ),
        migrations.AddField(
            model_name='trainingsession',
            name='status',
            field=models.CharField(choices=[('Pending', 'Pending'), ('Training', 'Training'), ('Completed', 'Completed'), ('Failed', 'Failed')], default='Pending', max_length=10),
        ),
        migrations.AddField(
            model_name='trainingsession',
            name='updated_at',
            field=models.DateTimeField(auto_now=True),
        ),
    ]

# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: 0006_rename_description_trainingsession_notes_and_more.py
# Copyright (c) 2024

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('datasets', '0001_initial'),
        ('feature_extractor', '0005_trainingsession_description_trainingsession_name'),
    ]

    operations = [
        migrations.RenameField(
            model_name='trainingsession',
            old_name='description',
            new_name='notes',
        ),
        migrations.AddField(
            model_name='trainingsession',
            name='dataset',
            field=models.ForeignKey(default=1, on_delete=django.db.models.deletion.CASCADE, related_name='training_sessions', to='datasets.dataset'),
            preserve_default=False,
        ),
    ]

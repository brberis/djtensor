# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: 0019_alter_dataset_shared.py
# Copyright (c) 2024

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('feature_extractor', '0020_study_trainingsession_study'),
        ('datasets', '0018_alter_dataset_shared'),
    ]

    operations = [
        migrations.AlterField(
            model_name='dataset',
            name='shared',
            field=models.ManyToManyField(blank=True, related_name='shared_datasets', to='feature_extractor.study'),
        ),
    ]

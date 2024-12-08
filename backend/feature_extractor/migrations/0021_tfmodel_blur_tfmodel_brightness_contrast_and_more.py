# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: 0021_tfmodel_blur_tfmodel_brightness_contrast_and_more.py
# Copyright (c) 2024

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('feature_extractor', '0020_study_trainingsession_study'),
    ]

    operations = [
        migrations.AddField(
            model_name='tfmodel',
            name='blur',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='tfmodel',
            name='brightness_contrast',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='tfmodel',
            name='cutout',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='tfmodel',
            name='gaussian_noise',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='tfmodel',
            name='grayscale',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='tfmodel',
            name='horizontal_flip',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='tfmodel',
            name='random_crop',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='tfmodel',
            name='random_grayscale',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='tfmodel',
            name='random_rotation',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='tfmodel',
            name='vertical_flip',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='tfmodel',
            name='zoom',
            field=models.BooleanField(default=False),
        ),
    ]
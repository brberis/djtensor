# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: 0012_remove_testresult_image_testresult_true_label_and_more.py
# Copyright (c) 2024

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('feature_extractor', '0011_testresult'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='testresult',
            name='image',
        ),
        migrations.AddField(
            model_name='testresult',
            name='true_label',
            field=models.CharField(blank=True, max_length=100, null=True),
        ),
        migrations.AlterField(
            model_name='testresult',
            name='prediction',
            field=models.CharField(blank=True, max_length=100, null=True),
        ),
    ]

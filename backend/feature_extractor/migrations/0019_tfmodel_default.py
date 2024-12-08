# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: 0019_tfmodel_default.py
# Copyright (c) 2024

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('feature_extractor', '0018_testresult_grad_cam'),
    ]

    operations = [
        migrations.AddField(
            model_name='tfmodel',
            name='default',
            field=models.BooleanField(default=False),
        ),
    ]

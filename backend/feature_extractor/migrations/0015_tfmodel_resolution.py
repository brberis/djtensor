# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: 0015_tfmodel_resolution.py
# Copyright (c) 2024

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('feature_extractor', '0014_testresult_image'),
    ]

    operations = [
        migrations.AddField(
            model_name='tfmodel',
            name='resolution',
            field=models.CharField(choices=[('224', '224'), ('240', '240'), ('260', '260'), ('299', '299'), ('300', '300'), ('331', '331'), ('456', '456'), ('480', '480'), ('512', '512'), ('528', '528'), ('600', '600')], default='224', max_length=10),
        ),
    ]

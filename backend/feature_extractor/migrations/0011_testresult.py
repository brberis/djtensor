# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: 0011_testresult.py
# Copyright (c) 2024

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('datasets', '0006_alter_dataset_labels'),
        ('feature_extractor', '0010_remove_tfmodel_model_path_trainingsession_model_path'),
    ]

    operations = [
        migrations.CreateModel(
            name='TestResult',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('confidence', models.FloatField()),
                ('image', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='test_results', to='datasets.image')),
                ('prediction', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='test_results', to='datasets.label')),
                ('test', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='results', to='feature_extractor.test')),
            ],
        ),
    ]

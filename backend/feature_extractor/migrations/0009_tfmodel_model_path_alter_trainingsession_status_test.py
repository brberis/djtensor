# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: 0009_tfmodel_model_path_alter_trainingsession_status_test.py
# Copyright (c) 2024

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('datasets', '0006_alter_dataset_labels'),
        ('feature_extractor', '0008_alter_trainingsession_status'),
    ]

    operations = [
        migrations.AddField(
            model_name='tfmodel',
            name='model_path',
            field=models.CharField(blank=True, max_length=100, null=True),
        ),
        migrations.AlterField(
            model_name='trainingsession',
            name='status',
            field=models.CharField(choices=[('Pending', 'Pending'), ('Training', 'Training'), ('Testing', 'Testing'), ('Completed', 'Completed'), ('Failed', 'Failed')], default='Pending', max_length=30),
        ),
        migrations.CreateModel(
            name='Test',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=100)),
                ('notes', models.TextField(blank=True, null=True)),
                ('status', models.CharField(choices=[('Pending', 'Pending'), ('Training', 'Training'), ('Testing', 'Testing'), ('Completed', 'Completed'), ('Failed', 'Failed')], default='Pending', max_length=30)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('dataset', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='tests', to='datasets.dataset')),
                ('training_session', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='tests', to='feature_extractor.trainingsession')),
            ],
        ),
    ]

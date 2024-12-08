# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: 0003_remove_tfmodel_accuracy_remove_tfmodel_loss_and_more.py
# Copyright (c) 2024

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('feature_extractor', '0002_alter_tfmodel_accuracy_alter_tfmodel_description_and_more'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='tfmodel',
            name='accuracy',
        ),
        migrations.RemoveField(
            model_name='tfmodel',
            name='loss',
        ),
        migrations.RemoveField(
            model_name='tfmodel',
            name='optimizer',
        ),
        migrations.AddField(
            model_name='tfmodel',
            name='validation_split',
            field=models.FloatField(default=0.2),
        ),
        migrations.AlterField(
            model_name='tfmodel',
            name='batch_size',
            field=models.IntegerField(default=32),
        ),
        migrations.AlterField(
            model_name='tfmodel',
            name='epochs',
            field=models.IntegerField(default=20),
        ),
        migrations.CreateModel(
            name='TrainingSession',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('timestamp', models.DateTimeField(auto_now_add=True)),
                ('model', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='training_sessions', to='feature_extractor.tfmodel')),
            ],
        ),
        migrations.CreateModel(
            name='Epoch',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('number', models.IntegerField()),
                ('accuracy', models.FloatField()),
                ('loss', models.FloatField()),
                ('val_accuracy', models.FloatField()),
                ('val_loss', models.FloatField()),
                ('training_session', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='epochs', to='feature_extractor.trainingsession')),
            ],
        ),
    ]

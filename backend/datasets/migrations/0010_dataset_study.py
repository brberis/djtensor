# Generated by Django 4.2.3 on 2024-07-05 03:03

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('feature_extractor', '0020_study_trainingsession_study'),
        ('datasets', '0009_alter_dataset_resolution'),
    ]

    operations = [
        migrations.AddField(
            model_name='dataset',
            name='study',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='datasets', to='feature_extractor.study'),
        ),
    ]

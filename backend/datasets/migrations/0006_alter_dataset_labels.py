# Generated by Django 4.2.3 on 2024-05-04 23:10

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('datasets', '0005_remove_label_dataset_dataset_labels'),
    ]

    operations = [
        migrations.AlterField(
            model_name='dataset',
            name='labels',
            field=models.ManyToManyField(related_name='datasets', to='datasets.label'),
        ),
    ]

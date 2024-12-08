# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: 0013_tfmodel_pre_model.py
# Copyright (c) 2024

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('feature_extractor', '0012_remove_testresult_image_testresult_true_label_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='tfmodel',
            name='pre_model',
            field=models.CharField(choices=[('efficientnetv2-s', 'efficientnetv2-s'), ('efficientnetv2-m', 'efficientnetv2-m'), ('efficientnetv2-l', 'efficientnetv2-l'), ('efficientnetv2-s-21k', 'efficientnetv2-s-21k'), ('efficientnetv2-m-21k', 'efficientnetv2-m-21k'), ('efficientnetv2-l-21k', 'efficientnetv2-l-21k'), ('efficientnetv2-xl-21k', 'efficientnetv2-xl-21k'), ('efficientnetv2-b0-21k', 'efficientnetv2-b0-21k'), ('efficientnetv2-b1-21k', 'efficientnetv2-b1-21k'), ('efficientnetv2-b2-21k', 'efficientnetv2-b2-21k'), ('efficientnetv2-b3-21k', 'efficientnetv2-b3-21k'), ('efficientnetv2-s-21k-ft1k', 'efficientnetv2-s-21k-ft1k'), ('efficientnetv2-m-21k-ft1k', 'efficientnetv2-m-21k-ft1k'), ('efficientnetv2-l-21k-ft1k', 'efficientnetv2-l-21k-ft1k'), ('efficientnetv2-xl-21k-ft1k', 'efficientnetv2-xl-21k-ft1k'), ('efficientnetv2-b0-21k-ft1k', 'efficientnetv2-b0-21k-ft1k'), ('efficientnetv2-b1-21k-ft1k', 'efficientnetv2-b1-21k-ft1k'), ('efficientnetv2-b2-21k-ft1k', 'efficientnetv2-b2-21k-ft1k'), ('efficientnetv2-b3-21k-ft1k', 'efficientnetv2-b3-21k-ft1k'), ('efficientnetv2-b0', 'efficientnetv2-b0'), ('efficientnetv2-b1', 'efficientnetv2-b1'), ('efficientnetv2-b2', 'efficientnetv2-b2'), ('efficientnetv2-b3', 'efficientnetv2-b3'), ('efficientnet_b0', 'efficientnet_b0'), ('efficientnet_b1', 'efficientnet_b1'), ('efficientnet_b2', 'efficientnet_b2'), ('efficientnet_b3', 'efficientnet_b3'), ('efficientnet_b4', 'efficientnet_b4'), ('efficientnet_b5', 'efficientnet_b5'), ('efficientnet_b6', 'efficientnet_b6'), ('efficientnet_b7', 'efficientnet_b7'), ('bit_s-r50x1', 'bit_s-r50x1'), ('inception_v3', 'inception_v3'), ('inception_resnet_v2', 'inception_resnet_v2'), ('resnet_v1_50', 'resnet_v1_50'), ('resnet_v1_101', 'resnet_v1_101'), ('resnet_v1_152', 'resnet_v1_152'), ('resnet_v2_50', 'resnet_v2_50'), ('resnet_v2_101', 'resnet_v2_101'), ('resnet_v2_152', 'resnet_v2_152'), ('nasnet_mobile', 'nasnet_mobile'), ('nasnet_large', 'nasnet_large'), ('pnasnet_large', 'pnasnet_large'), ('mobilenet_v2_100_224', 'mobilenet_v2_100_224'), ('mobilenet_v2_130_224', 'mobilenet_v2_130_224'), ('mobilenet_v2_140_224', 'mobilenet_v2_140_224'), ('mobilenet_v3_small_100_224', 'mobilenet_v3_small_100_224'), ('mobilenet_v3_small_075_224', 'mobilenet_v3_small_075_224'), ('mobilenet_v3_large_100_224', 'mobilenet_v3_large_100_224'), ('mobilenet_v3_large_075_224', 'mobilenet_v3_large_075_224')], default='mobilenet_v3_large_075_224', max_length=100),
        ),
    ]

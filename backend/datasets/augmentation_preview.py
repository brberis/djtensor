# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: augmentation_preview.py
# Copyright (c) 2024

"""
Shared augmentation pipeline builder and preview generator.

Extracts the augmentation logic from feature_extractor/tasks.py into a reusable
module so both training and the preview UI use identical transforms.
"""

import io
import numpy as np
from PIL import Image as PILImage


def build_augmentation_pipeline(config, image_size=(384, 384)):
    """
    Build a tf.keras.Sequential augmentation pipeline from a config dict.

    Args:
        config: dict with boolean keys matching TFModel augmentation flags:
            grayscale, random_grayscale, horizontal_flip, vertical_flip,
            random_rotation, zoom, brightness_contrast, random_crop,
            gaussian_noise, blur, cutout
        image_size: tuple (height, width) for crop/resize operations

    Returns:
        tf.keras.Sequential model
    """
    import tensorflow as tf
    try:
        import tensorflow_addons as tfa
    except ImportError:
        from feature_extractor.tfa_compat import tfa_compat as tfa

    # Import custom layers from tasks module
    from feature_extractor.tasks import GrayscaleLayer, BlurLayer

    pipeline = tf.keras.Sequential()

    if config.get('grayscale'):
        pipeline.add(GrayscaleLayer(p=1.0))

    if config.get('random_grayscale'):
        pipeline.add(GrayscaleLayer(p=0.5))

    if config.get('horizontal_flip'):
        pipeline.add(tf.keras.layers.RandomFlip('horizontal'))

    if config.get('vertical_flip'):
        pipeline.add(tf.keras.layers.RandomFlip('vertical'))

    # fill_mode='constant' with fill_value=255 to avoid mirror artifacts
    # (images are in [0, 255] range before normalization)
    if config.get('random_rotation'):
        pipeline.add(tf.keras.layers.RandomRotation(
            0.15, fill_mode='constant', fill_value=255.0))

    if config.get('zoom'):
        pipeline.add(tf.keras.layers.RandomZoom(
            0.05, 0.15, fill_mode='constant', fill_value=255.0))

    if config.get('brightness_contrast'):
        pipeline.add(tf.keras.layers.RandomBrightness(0.1, value_range=(0, 255)))
        pipeline.add(tf.keras.layers.RandomContrast(0.1))
        pipeline.add(tf.keras.layers.Lambda(lambda x: tf.clip_by_value(x, 0.0, 255.0)))

    if config.get('random_crop'):
        h, w = image_size
        # Crop 30px instead of 10 to make the effect more visible
        crop_margin = 30
        pipeline.add(tf.keras.layers.RandomCrop(height=h - crop_margin, width=w - crop_margin))
        pipeline.add(tf.keras.layers.Resizing(h, w))

    if config.get('gaussian_noise'):
        def add_noise(images):
            # 5% noise (was 2%, too subtle to see)
            noise = tf.random.normal(shape=tf.shape(images), mean=0.0, stddev=12.75)  # ~5% of 255
            return images + noise
        pipeline.add(tf.keras.layers.Lambda(add_noise))

    if config.get('blur'):
        def apply_blur(images):
            return tfa.image.gaussian_filter2d(images, filter_shape=(3, 3), sigma=0.7)
        pipeline.add(tf.keras.layers.Lambda(apply_blur))

    if config.get('cutout'):
        def apply_cutout(images):
            # Fill cutout with background (255 = white) instead of black
            return tfa.image.random_cutout(images, mask_size=(40, 40), constant_values=255)
        pipeline.add(tf.keras.layers.Lambda(apply_cutout))

    return pipeline


def generate_preview(image_path, config, n=6):
    """
    Generate N augmented previews of a single image.

    Args:
        image_path: Path to the source image file.
        config: Augmentation config dict (same format as build_augmentation_pipeline).
        n: Number of preview images to generate.

    Returns:
        List of PNG byte buffers.
    """
    import tensorflow as tf

    # Load and prepare image
    # Handle PNG alpha transparency: composite onto white before converting
    img_raw = PILImage.open(image_path)
    if img_raw.mode == 'RGBA':
        bg = PILImage.new('RGB', img_raw.size, (255, 255, 255))
        bg.paste(img_raw, mask=img_raw.split()[3])
        img = bg
    else:
        img = img_raw.convert('RGB')
    # Keep in [0, 255] range — matches training pipeline (augmentation before normalization)
    img_array = np.array(img, dtype=np.float32)
    h, w = img_array.shape[:2]

    pipeline = build_augmentation_pipeline(config, image_size=(h, w))

    previews = []
    for _ in range(n):
        batch = tf.expand_dims(img_array, 0)
        augmented = pipeline(batch, training=True)
        result = augmented.numpy()[0]

        result = np.clip(result, 0, 255).astype(np.uint8)
        pil_img = PILImage.fromarray(result)

        buf = io.BytesIO()
        pil_img.save(buf, format='PNG')
        previews.append(buf.getvalue())

    return previews

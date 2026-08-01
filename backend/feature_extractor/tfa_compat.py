# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: tfa_compat.py
#
# Pure-TensorFlow drop-in for the ONLY two tensorflow_addons.image ops this
# project uses: gaussian_filter2d and random_cutout. tensorflow-addons is EOL
# (archived May 2024, supports TF <= 2.15) and has no arm64 build for the NGC
# TensorFlow container the GB10 (Grace-Blackwell) deployment runs on. This shim
# reproduces tfa's behaviour so training/augmentation parity is preserved.
#
# Exposed as `tfa_compat` with a `.image` namespace mirroring `tfa.image` so the
# existing `import tensorflow_addons as tfa` call sites work unchanged via:
#     try:
#         import tensorflow_addons as tfa
#     except ImportError:
#         from feature_extractor.tfa_compat import tfa_compat as tfa

import tensorflow as tf
from types import SimpleNamespace


def _gaussian_kernel_1d(sigma, size):
    """1D normalized Gaussian, matching tfa's _get_gaussian_kernel exactly.

    tfa uses softmax(-x^2 / (2*sigma^2)), which is identical to a normalized
    exp() Gaussian (the normalizing constant cancels).
    """
    size = int(size)
    start = (-size) // 2 + 1          # floor-div, matches tfa's `-size // 2 + 1`
    end = size // 2 + 1
    x = tf.cast(tf.range(start, end) ** 2, tf.float32)
    return tf.nn.softmax(-x / (2.0 * (float(sigma) ** 2)))


def gaussian_filter2d(image, filter_shape=(3, 3), sigma=1.0,
                      padding="REFLECT", constant_values=0, name=None):
    """Depthwise Gaussian blur; faithful reimplementation of tfa.image.gaussian_filter2d."""
    image = tf.convert_to_tensor(image)
    orig_dtype = image.dtype
    x = tf.cast(image, tf.float32)

    expanded = False
    if x.shape.rank == 3:
        x = x[tf.newaxis, ...]
        expanded = True

    if isinstance(filter_shape, int):
        filter_shape = (filter_shape, filter_shape)
    fh, fw = int(filter_shape[0]), int(filter_shape[1])

    if isinstance(sigma, (list, tuple)):
        sigma_y, sigma_x = float(sigma[0]), float(sigma[1])
    else:
        sigma_y = sigma_x = float(sigma)

    ky = _gaussian_kernel_1d(sigma_y, fh)[:, tf.newaxis]   # (fh, 1)
    kx = _gaussian_kernel_1d(sigma_x, fw)[tf.newaxis, :]   # (1, fw)
    k2d = ky * kx                                          # (fh, fw)
    k2d = k2d[:, :, tf.newaxis, tf.newaxis]                # (fh, fw, 1, 1)

    channels = x.shape[-1]
    k2d = tf.tile(k2d, [1, 1, channels, 1])               # depthwise, per channel

    pad_h, pad_w = fh // 2, fw // 2
    x = tf.pad(x, [[0, 0], [pad_h, pad_h], [pad_w, pad_w], [0, 0]],
               mode=padding, constant_values=constant_values)
    out = tf.nn.depthwise_conv2d(x, k2d, strides=[1, 1, 1, 1], padding="VALID")

    if expanded:
        out = out[0]
    return tf.cast(out, orig_dtype)


def random_cutout(images, mask_size, constant_values=0, seed=None):
    """Random rectangular cutout per image; matches tfa.image.random_cutout behaviour
    (uniform-random center, mask filled with constant_values, clipped to bounds)."""
    images = tf.convert_to_tensor(images)
    orig_dtype = images.dtype
    x = tf.cast(images, tf.float32)

    expanded = False
    if x.shape.rank == 3:
        x = x[tf.newaxis, ...]
        expanded = True

    if isinstance(mask_size, int):
        mask_size = (mask_size, mask_size)
    mh, mw = int(mask_size[0]), int(mask_size[1])
    half_h, half_w = mh // 2, mw // 2

    shp = tf.shape(x)
    batch, H, W = shp[0], shp[1], shp[2]

    cy = tf.random.uniform([batch], 0, H, dtype=tf.int32, seed=seed)
    cx = tf.random.uniform([batch], 0, W, dtype=tf.int32, seed=seed)

    lower = tf.clip_by_value(cy - half_h, 0, H)
    upper = tf.clip_by_value(cy + half_h, 0, H)
    left = tf.clip_by_value(cx - half_w, 0, W)
    right = tf.clip_by_value(cx + half_w, 0, W)

    rows = tf.range(H)[tf.newaxis, :]                      # (1, H)
    cols = tf.range(W)[tf.newaxis, :]                      # (1, W)
    row_mask = (rows >= lower[:, tf.newaxis]) & (rows < upper[:, tf.newaxis])  # (batch, H)
    col_mask = (cols >= left[:, tf.newaxis]) & (cols < right[:, tf.newaxis])   # (batch, W)
    cut = row_mask[:, :, tf.newaxis] & col_mask[:, tf.newaxis, :]              # (batch, H, W)
    cut = cut[..., tf.newaxis]                                                 # (batch, H, W, 1)

    fill = tf.cast(constant_values, tf.float32)
    out = tf.where(cut, fill, x)

    if expanded:
        out = out[0]
    return tf.cast(out, orig_dtype)


# `image` namespace mirroring tfa.image, and the module-level object the code imports.
image = SimpleNamespace(gaussian_filter2d=gaussian_filter2d, random_cutout=random_cutout)
tfa_compat = SimpleNamespace(image=image)

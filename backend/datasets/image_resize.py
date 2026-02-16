# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: image_resize.py
# Copyright (c) 2024

import os
from io import BytesIO

from django.core.files.base import ContentFile
from PIL import Image as PILImage, ImageOps, UnidentifiedImageError


FORMAT_BY_EXTENSION = {
    '.jpg': 'JPEG',
    '.jpeg': 'JPEG',
    '.png': 'PNG',
    '.webp': 'WEBP',
    '.bmp': 'BMP',
    '.tif': 'TIFF',
    '.tiff': 'TIFF',
}


def get_target_resolution(dataset):
    return int(dataset.resolution)


def resize_to_dataset(uploaded_file, dataset_resolution):
    """
    Resize image to dataset target size using center crop + high-quality downscale.
    Reject files that are smaller than the target in either dimension.
    Returns (ContentFile, metadata_dict).
    """
    ext = os.path.splitext(uploaded_file.name)[1].lower()
    output_format = FORMAT_BY_EXTENSION.get(ext, 'PNG')

    uploaded_file.seek(0)
    raw_bytes = uploaded_file.read()
    uploaded_file.seek(0)

    try:
        with PILImage.open(BytesIO(raw_bytes)) as image:
            original_width, original_height = image.size

            if original_width < dataset_resolution or original_height < dataset_resolution:
                raise ValueError(
                    f'Image is too small ({original_width}x{original_height}). '
                    f'Minimum is {dataset_resolution}x{dataset_resolution}.'
                )

            resized = ImageOps.fit(
                image,
                (dataset_resolution, dataset_resolution),
                method=PILImage.Resampling.LANCZOS,
            )

            if output_format == 'JPEG' and resized.mode not in ('RGB', 'L'):
                resized = resized.convert('RGB')

            output = BytesIO()
            save_kwargs = {}
            if output_format in ('JPEG', 'WEBP'):
                save_kwargs['quality'] = 95

            resized.save(output, format=output_format, **save_kwargs)
            output.seek(0)

            content = ContentFile(output.getvalue())
            content.name = uploaded_file.name

            return content, {
                'original_width': original_width,
                'original_height': original_height,
                'width': dataset_resolution,
                'height': dataset_resolution,
            }

    except UnidentifiedImageError as exc:
        raise ValueError(f'Invalid image file: {exc}') from exc

# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: tasks.py
# Copyright (c) 2024

from django.conf import settings
from urllib.parse import urljoin
from celery import shared_task
import matplotlib.pylab as plt
from scipy.ndimage import sobel
import numpy as np
import tensorflow as tf
import tensorflow_hub as hub
from tf_keras_vis.utils.scores import CategoricalScore
from tf_keras_vis.utils.model_modifiers import ReplaceToLinear
from tf_keras_vis.saliency import Saliency
from .model_config import model_handle_map, model_image_size_map
from django.core.files import File
from django.utils.text import get_valid_filename
from uuid import uuid4
from PIL import Image as PILImage, ImageFile

# Tolerate slightly-truncated PNG/JPEG files. Synthetic-fragment generation
# occasionally writes images that PIL flags as truncated even though the
# pixel data is essentially complete. Without this flag, a single bad file
# in remove_alpha() aborts the whole training run.
ImageFile.LOAD_TRUNCATED_IMAGES = True
try:
    import tensorflow_addons as tfa
except ImportError:
    from feature_extractor.tfa_compat import tfa_compat as tfa
import tensorflow.keras.backend as K
import gc
import shutil
import os
import tarfile
import logging

logger = logging.getLogger(__name__)


def is_gpu_busy():
    """Check if any training or testing task is currently using the GPU.
    Auto-fails tasks stuck for over 2 hours to prevent queue deadlocks."""
    from django.utils import timezone
    from datetime import timedelta
    from .models import TrainingSession, Test
    stale_cutoff = timezone.now() - timedelta(hours=2)
    # Auto-fail stale tasks
    TrainingSession.objects.filter(status='Training', updated_at__lt=stale_cutoff).update(status='Failed')
    Test.objects.filter(status='Testing', updated_at__lt=stale_cutoff).update(status='Failed')
    return (
        TrainingSession.objects.filter(status='Training').exists()
        or Test.objects.filter(status='Testing').exists()
    )


def process_next_pending():
    """Dispatch the next pending training or test task if the GPU is free."""
    from django.db import transaction
    from .models import TrainingSession, Test
    with transaction.atomic():
        if is_gpu_busy():
            return
        next_session = (
            TrainingSession.objects
            .select_for_update(skip_locked=True)
            .filter(status='Pending')
            .order_by('created_at')
            .first()
        )
        if next_session:
            train_model.apply_async((next_session.id,))
            return
        next_test = (
            Test.objects
            .select_for_update(skip_locked=True)
            .filter(status='Pending')
            .order_by('created_at')
            .first()
        )
        if next_test:
            resolution = next_test.training_session.model.resolution
            test_images.apply_async((next_test.id, int(resolution)))


def convert_alpha_to_white(image_path):
    """Converts an image with alpha transparency to a white background and saves it in the same location."""
    image = PILImage.open(image_path).convert("RGBA")
    background = PILImage.new("RGB", image.size, (255, 255, 255)) 
    background.paste(image, mask=image.split()[3])  
    background.save(image_path, "PNG")  

def remove_alpha(data_dir):
    """Iterates through all images in the data directory and converts them to remove transparency, saving in-place."""
    skipped = 0
    for root, _, files in os.walk(data_dir):
        for file in files:
            if file.endswith(".png") or file.endswith(".jpg"):
                file_path = os.path.join(root, file)
                try:
                    convert_alpha_to_white(file_path)
                except Exception as exc:
                    skipped += 1
                    logger.warning(f"remove_alpha: skipped {file_path}: {exc}")
    if skipped:
        logger.warning(f"remove_alpha: skipped {skipped} unreadable image(s)")
                

# custom layer to convert RGB to Grayscale
class GrayscaleLayer(tf.keras.layers.Layer):
    def __init__(self, brightness_factor=0.0, p=1.0):
        super(GrayscaleLayer, self).__init__()
        self.brightness_factor = brightness_factor  
        self.p = p  

    def call(self, inputs, training=None):
        if training:
            batch_size = tf.shape(inputs)[0]
            random_values = tf.random.uniform([batch_size], 0, 1)
            mask = tf.less(random_values, self.p)
            mask = tf.cast(mask, dtype=tf.float32)
            mask = tf.reshape(mask, [batch_size, 1, 1, 1])

            grayscale = tf.image.rgb_to_grayscale(inputs)
            rgb = tf.image.grayscale_to_rgb(grayscale)
            adjusted_rgb = tf.image.adjust_brightness(rgb, self.brightness_factor)

            outputs = inputs * (1 - mask) + adjusted_rgb * mask
            return outputs
        else:
            return inputs

# custom layer to apply random blur effect
class BlurLayer(tf.keras.layers.Layer):
    def __init__(self, sigma=3.0, blur_probability=0.5, filter_shape=(7, 7)):
        super(BlurLayer, self).__init__()
        self.sigma = sigma
        self.blur_probability = blur_probability
        self.filter_shape = filter_shape

    def call(self, inputs):
        batch_size = tf.shape(inputs)[0]
        random_values = tf.random.uniform([batch_size], 0, 1)

        blur_mask = tf.less(random_values, self.blur_probability)
        blur_mask = tf.cast(blur_mask, inputs.dtype)
        blur_mask = tf.reshape(blur_mask, [-1, 1, 1, 1])  

        blurred_inputs = tfa.image.gaussian_filter2d(
            inputs, sigma=self.sigma, filter_shape=self.filter_shape
        )

        outputs = inputs * (1 - blur_mask) + blurred_inputs * blur_mask

        return outputs


    
# Scalar feature names for the image_plus_size training input mode. Order
# matters: the saved model takes a tensor with exactly this column order
# and test_images() must rebuild the scalar vector in the same order at
# inference time. Adding a new feature here means retraining.
SIZE_SCALAR_FIELDS = ('tooth_major_axis_mm', 'tooth_minor_axis_mm', 'tooth_area_mm2', 'completeness_mm2')


def _normalize_archive_segment(name):
    """Match create_dataset_archive's filesystem-safe transform: lowercase,
    spaces to underscores. Used to map archive folder names back to
    Dataset/Label DB rows."""
    return name.replace(' ', '_').lower()


def _build_size_scalar_lookup(dataset):
    """Build {(class_dir_name, image_basename): [length, width, area, completeness]}
    from the DB for a given dataset. Used by the image_plus_size training
    loader to join physical-size scalars onto each on-disk image. Images
    that are missing any of the four mm fields are reported back as a
    second return value so the caller can decide whether to abort or
    proceed with a partial training set."""
    import os as _os
    from datasets.models import Image as DatasetImage
    lookup = {}
    missing = []
    images = DatasetImage.objects.filter(dataset=dataset).select_related('label')
    for img in images:
        if not img.image:
            continue
        class_dir = _normalize_archive_segment(img.label.name) if img.label else ''
        basename  = _os.path.basename(img.image.name)
        values = []
        any_missing = False
        for field in SIZE_SCALAR_FIELDS:
            v = getattr(img, field, None)
            if v is None:
                any_missing = True
                values.append(0.0)
            else:
                values.append(float(v))
        if any_missing:
            missing.append((class_dir, basename))
        lookup[(class_dir, basename)] = values
    return lookup, missing


@shared_task
def train_model(training_session_id, *args, **kwargs):
    from .models import TFModel
    from .models import TrainingSession
    from .models import Epoch

    if not training_session_id:
        training_session_id = args[0]

    session_instance = TrainingSession.objects.get(id=training_session_id)
    model_instance = TFModel.objects.get(id=session_instance.model.id)
    model_batch_size = session_instance.batch_size if session_instance.batch_size is not None else model_instance.batch_size
    model_epochs = session_instance.num_epochs if session_instance.num_epochs is not None else model_instance.epochs
    model_learning_rate = session_instance.learning_rate if session_instance.learning_rate is not None else 0.005
    model_validation_split = model_instance.validation_split
    model_fine_tuning = model_instance.fine_tuning
    # Phase 2: which input pipeline to use. Defaults to 'image_only' for
    # backwards compatibility with every existing training session row.
    input_mode = (session_instance.input_mode or 'image_only')
    use_scalars = (input_mode == 'image_plus_size')
    model_data_augmentation = model_instance.data_augmentation
    model_grayscale = model_instance.grayscale
    model_random_grayscale = model_instance.random_grayscale
    model_horizontal_flip = model_instance.horizontal_flip
    model_random_rotation = model_instance.random_rotation
    model_blur = model_instance.blur
    model_vertical_flip = model_instance.vertical_flip
    model_zoom = model_instance.zoom
    model_brightness_contrast = model_instance.brightness_contrast
    model_random_crop = model_instance.random_crop
    model_gaussian_noise = model_instance.gaussian_noise
    model_cutout = model_instance.cutout
  
    session_instance.status = 'Training'
    session_instance.save()

    try:
        
        logger.info(f"Training model {model_instance.name} with id {model_instance.id}")
        logger.info(f"Batch size: {model_batch_size}")
        logger.info(f"Epochs: {model_epochs}")
        logger.info(f"Learning rate: {model_learning_rate}")
        logger.info(f"Validation split: {model_validation_split}")
        
        logger.info('Starting training...')

        print("TF version:", tf.__version__)
        print("Hub version:", hub.__version__)
        print("GPU is", "available" if tf.config.list_physical_devices('GPU') else "NOT AVAILABLE")
        
        physical_devices = tf.config.list_physical_devices('GPU')
        for device in physical_devices:
            print(device)
            tf.config.experimental.set_memory_growth(device, True)

        print("TF_GPU_ALLOCATOR is set to:", os.getenv("TF_GPU_ALLOCATOR"))
        
        #@title
        # Selection of the pre train model  
        
        model_name = model_instance.pre_model
        
        model_handle = model_handle_map.get(model_name)
        pixels = model_image_size_map.get(model_name, 224)

        print(f"Selected model: {model_name} : {model_handle}")

        IMAGE_SIZE = (pixels, pixels)
        print(f"Input size {IMAGE_SIZE}")

        BATCH_SIZE = model_batch_size 
        logger.info(f"Batch size: {BATCH_SIZE}")

        # Import dataset
        file_name = session_instance.dataset.name.replace(' ', '_').lower()
        logger.info(f"Dataset NAME: {file_name}")

        # Use local archive file instead of downloading through Cloudflare
        local_tar = os.path.join(settings.MEDIA_ROOT, 'archive', file_name + '.tar.gz')
        cache_dir = os.path.join('/root/.keras/datasets')
        data_dir = os.path.join(cache_dir, file_name)
        logger.info(f"Local archive: {local_tar}")

        if not os.path.isdir(data_dir):
            os.makedirs(cache_dir, exist_ok=True)
            logger.info(f"Extracting archive to {cache_dir}...")
            with tarfile.open(local_tar, 'r:gz') as tar:
                tar.extractall(path=cache_dir)
        else:
            logger.info(f"Dataset already cached at {data_dir}")

        logger.info(f"Dataset data_dir: {data_dir}")


        ##############################################
        # Build the training and validation datasets #
        ##############################################

        logger.info("Building and compiling model...")

        remove_alpha(data_dir)

        # Build a {(class_dir, basename): [length_mm, width_mm, area_mm2,
        # completeness_mm2]} table from the DB when training in
        # image_plus_size mode. Done once before the loaders are built so
        # both training and validation can share the lookup without extra
        # queries per image.
        scalar_lookup = None
        if use_scalars:
            scalar_lookup, missing = _build_size_scalar_lookup(session_instance.dataset)
            if missing:
                logger.warning(
                    "train_model: image_plus_size dataset has %d images "
                    "missing one or more size fields. They will train with "
                    "0.0 in the missing slots. First 5: %s",
                    len(missing), missing[:5],
                )
            if not scalar_lookup:
                raise RuntimeError(
                    "image_plus_size training requires DB rows with the "
                    "size scalar fields but the dataset has no images. "
                    "Run completeness/scale calibration first."
                )
            logger.info(
                "train_model: image_plus_size mode loaded %d scalar rows "
                "(features=%s)", len(scalar_lookup), SIZE_SCALAR_FIELDS,
            )

        def build_image_only_dataset(subset):
            """Phase I single-input loader: yields (image, one_hot_label)."""
            return tf.keras.preprocessing.image_dataset_from_directory(
                data_dir,
                validation_split=model_validation_split,
                subset=subset,
                label_mode="categorical",
                seed=123,
                image_size=IMAGE_SIZE,
                batch_size=1,
            )

        def build_multi_input_dataset(subset, class_names_list):
            """Multi-input loader: yields ((image, scalar_vec), one_hot_label).
            Mirrors image_dataset_from_directory's deterministic split (same
            seed, same validation_split semantics) so train/val partitions
            line up across input modes for paper comparisons."""
            files = []
            label_ids = []
            scalars = []
            for ci, cn in enumerate(class_names_list):
                cdir = os.path.join(data_dir, cn)
                if not os.path.isdir(cdir):
                    continue
                for fn in sorted(os.listdir(cdir)):
                    fpath = os.path.join(cdir, fn)
                    if not os.path.isfile(fpath):
                        continue
                    key = (cn, fn)
                    if key not in scalar_lookup:
                        # File on disk has no DB row in this dataset — would
                        # happen if create_dataset_archive ran on a stale
                        # snapshot. Fill zeros so training doesn't abort,
                        # log the orphan for the user.
                        logger.warning("train_model: orphan archive file with no DB row: %s/%s", cn, fn)
                        scalars.append([0.0] * len(SIZE_SCALAR_FIELDS))
                    else:
                        scalars.append(scalar_lookup[key])
                    files.append(fpath)
                    label_ids.append(ci)
            if not files:
                raise RuntimeError(f"build_multi_input_dataset: no files for subset={subset}")
            # Deterministic shuffle, same seed as image_dataset_from_directory,
            # so the val split matches what image_only would have used.
            rng = np.random.RandomState(123)
            order = rng.permutation(len(files))
            files     = [files[i]     for i in order]
            label_ids = [label_ids[i] for i in order]
            scalars   = [scalars[i]   for i in order]
            n = len(files)
            n_val = int(round(n * model_validation_split))
            if subset == 'training':
                files     = files[n_val:]
                label_ids = label_ids[n_val:]
                scalars   = scalars[n_val:]
            elif subset == 'validation':
                files     = files[:n_val]
                label_ids = label_ids[:n_val]
                scalars   = scalars[:n_val]
            scalars_np  = np.asarray(scalars,   dtype=np.float32)
            files_np    = np.asarray(files,     dtype=object)
            labels_np   = np.asarray(label_ids, dtype=np.int32)
            num_classes = len(class_names_list)
            def _load_one(filepath, scalar_vec, label_id):
                raw = tf.io.read_file(filepath)
                img = tf.image.decode_image(raw, channels=3, expand_animations=False)
                img.set_shape([None, None, 3])
                img = tf.image.resize(img, IMAGE_SIZE)
                img = tf.cast(img, tf.float32)
                one_hot = tf.one_hot(label_id, depth=num_classes)
                return (img, scalar_vec), one_hot
            ds = tf.data.Dataset.from_tensor_slices((files_np, scalars_np, labels_np))
            ds = ds.map(_load_one, num_parallel_calls=tf.data.AUTOTUNE)
            return ds, len(files)

        if use_scalars:
            # Discover class_names from the directory listing (same order
            # image_dataset_from_directory uses: sorted by name).
            class_names = tuple(sorted(
                d for d in os.listdir(data_dir)
                if os.path.isdir(os.path.join(data_dir, d))
            ))
            train_ds, train_size = build_multi_input_dataset("training", list(class_names))
        else:
            train_ds = build_image_only_dataset("training")
            class_names = tuple(train_ds.class_names)
            train_size = train_ds.cardinality().numpy()
            train_ds = train_ds.unbatch()

        # store class_names in the session_instance
        session_instance.class_names = ', '.join(class_names)
        session_instance.save()

        train_ds = train_ds.shuffle(buffer_size=train_size).batch(BATCH_SIZE)
        train_ds = train_ds.repeat()

        normalization_layer = tf.keras.layers.Rescaling(1. / 255)
        preprocessing_model = tf.keras.Sequential([normalization_layer])

        @tf.function
        def preprocess(images, labels):
            return preprocessing_model(images), labels

        @tf.function
        def normalization(images, labels):
            return normalization_layer(images), labels

        # Multi-input variants apply pixel normalization only to the image
        # tensor; scalar features pass through unchanged.
        @tf.function
        def preprocess_multi(inputs, labels):
            image, scalar = inputs
            return (preprocessing_model(image), scalar), labels

        @tf.function
        def normalization_multi(inputs, labels):
            image, scalar = inputs
            return (normalization_layer(image), scalar), labels
        
        #train_ds = train_ds.map(normalization) # AP commented out this line

        #####################
        # Data Augmentation #
        #####################

        def save_image(image_array, file_name):
            """Save a NumPy array as an image file in the Django media directory."""
            rescaled_image = np.clip(image_array * 255, 0, 255).astype(np.uint8)

            image = PILImage.fromarray(rescaled_image)
            image_path = os.path.join(settings.MEDIA_ROOT, 'augmented_images', file_name)
            image.save(image_path)
            return image_path  
        
        # preprocessing_model = tf.keras.Sequential([
        #     GrayscaleLayer(),  
        # ])
            
        # data_augmentation = tf.keras.Sequential([
        #     GrayscaleLayer(),
        #     tf.keras.layers.RandomRotation(0.1), 
        #     tf.keras.layers.RandomTranslation(0.1, 0.1),
        #     tf.keras.layers.RandomFlip('horizontal'),
        #     tf.keras.layers.RandomZoom(0.1),
        # ])

        data_augmentation = tf.keras.Sequential()

        if model_grayscale:
            logger.info("<--- Grayscale enabled --->")
            data_augmentation.add(GrayscaleLayer(p=1.0))  
        
        # Apply random grayscale if the model specifies random grayscale
        if model_random_grayscale:
            logger.info("<--- Random Grayscale enabled --->")
            data_augmentation.add(GrayscaleLayer(p=0.5))  # Randomly apply grayscale 50% of the time
        
        # Apply horizontal flip if the model specifies horizontal flipping
        if model_horizontal_flip:
            logger.info("<--- Horizontal Flip enabled --->")
            data_augmentation.add(tf.keras.layers.RandomFlip('horizontal'))
        
        # Apply vertical flip if the model specifies vertical flipping (new)
        if model_vertical_flip:  # Assuming you want to control vertical flip separately
            logger.info("<--- Vertical Flip enabled --->")
            data_augmentation.add(tf.keras.layers.RandomFlip('vertical'))
        
        # Apply random rotation with a smaller angle range (±15 degrees)
        # fill_mode='constant' with white fill to avoid mirror artifacts at edges
        if model_random_rotation:
            logger.info("<--- Random Rotation enabled --->")
            data_augmentation.add(tf.keras.layers.RandomRotation(
                0.15, fill_mode='constant', fill_value=255.0))

        # Apply zoom if the model specifies random zoom
        if model_zoom:
            logger.info("<--- Random Zoom enabled --->")
            data_augmentation.add(tf.keras.layers.RandomZoom(
                0.05, 0.15, fill_mode='constant', fill_value=255.0))

        def clip_values(images):
            return tf.clip_by_value(images, 0.0, 255.0)

        # Apply brightness and contrast adjustments if enabled
        if model_brightness_contrast:
            logger.info("<--- Random Brightness and Contrast enabled --->")
            data_augmentation.add(tf.keras.layers.RandomBrightness(0.1, value_range=(0, 255)))
            data_augmentation.add(tf.keras.layers.RandomContrast(0.1))
            data_augmentation.add(tf.keras.layers.Lambda(clip_values))

        # Apply random crop and resize if enabled
        if model_random_crop:
            logger.info("<--- Random Crop and Rescale enabled --->")
            crop_margin = 30
            data_augmentation.add(tf.keras.layers.RandomCrop(height=IMAGE_SIZE[0] - crop_margin, width=IMAGE_SIZE[1] - crop_margin))
            data_augmentation.add(tf.keras.layers.Resizing(IMAGE_SIZE[0], IMAGE_SIZE[1]))

        # Apply Gaussian noise if specified
        if model_gaussian_noise:
            logger.info("<--- Gaussian Noise enabled --->")
            def add_gaussian_noise(images):
                noise = tf.random.normal(shape=tf.shape(images), mean=0.0, stddev=12.75, dtype=tf.float32)  # ~5% of 255
                return images + noise
            data_augmentation.add(tf.keras.layers.Lambda(add_gaussian_noise))

        # Apply Gaussian blur if specified
        if model_blur:
            logger.info("<--- Gaussian Blur enabled --->")
            def apply_gaussian_blur(images):
                blurred_images = tfa.image.gaussian_filter2d(images, filter_shape=(3, 3), sigma=0.7)
                return blurred_images
            data_augmentation.add(tf.keras.layers.Lambda(apply_gaussian_blur))

        # Apply Cutout if enabled (white fill instead of black)
        if model_cutout:
            logger.info("<--- Cutout enabled --->")
            def apply_random_cutout(images):
                cutout_images = tfa.image.random_cutout(images, mask_size=(40, 40), constant_values=255)
                return cutout_images
            data_augmentation.add(tf.keras.layers.Lambda(apply_random_cutout))
   
        # Define whether to apply data augmentation
        apply_data_augmentation = model_data_augmentation

        # Log the state of data augmentation
        if apply_data_augmentation:
            logger.info("<--- Data Augmentation enabled --->")
        else:
            logger.info("<--- Data Augmentation disabled --->")

        # Define the function that conditionally applies augmentation based on the flag
        def apply_augmentation(images, labels):
            if apply_data_augmentation:
                return data_augmentation(images, training=True), labels
            return images, labels

        # Multi-input version: augmentation is image-only, scalars pass through.
        def apply_augmentation_multi(inputs, labels):
            image, scalar = inputs
            if apply_data_augmentation:
                image = data_augmentation(image, training=True)
            return (image, scalar), labels

        if use_scalars:
            post_train_ds = train_ds.map(apply_augmentation_multi)
            post_train_ds = post_train_ds.map(normalization_multi)
        else:
            post_train_ds = train_ds.map(apply_augmentation)
            post_train_ds = post_train_ds.map(normalization)

        # Save the augmented images for debugging purposes. Skipped in
        # image_plus_size mode because train_ds yields ((image, scalar),
        # label) and this debug loop assumes a plain (image, label) tuple.
        # The save calls below are commented out anyway, so this is a no-op
        # in practice; the directory is still set up so the rest of the
        # pipeline can find it if someone re-enables saves.
        if apply_data_augmentation:
            logger.info("<--- Data Augmentation enabled --->")
            augmented_images_dir = os.path.join(settings.MEDIA_ROOT, 'augmented_images')

            if os.path.exists(augmented_images_dir):
                shutil.rmtree(augmented_images_dir)

            os.makedirs(augmented_images_dir, exist_ok=True)
            logger.info(f"Created clean directory at {augmented_images_dir}.")

            if not use_scalars:
                for idx, (image_array, label) in enumerate(train_ds.take(train_size)):
                    image_np = image_array.numpy()[0]
                    augmented_image = data_augmentation(tf.expand_dims(image_np, 0))

                    # Remove the batch dimension and save
                    augmented_image_np = augmented_image.numpy()[0]

                    # Convert to image and save
                    # file_name = f"augmented_image_{uuid4().hex}_{idx}.png"
                    # save_image(augmented_image_np, file_name)
                    # logger.info(f"Saved {file_name} to media directory.")
            
            
        if use_scalars:
            val_ds, valid_size = build_multi_input_dataset("validation", list(class_names))
            val_ds = val_ds.batch(BATCH_SIZE)
            val_ds = val_ds.map(preprocess_multi)
        else:
            val_ds = build_image_only_dataset("validation")
            valid_size = val_ds.cardinality().numpy()
            val_ds = val_ds.unbatch().batch(BATCH_SIZE)
            val_ds = val_ds.map(preprocess)



        ###################
        # Build the model #
        ###################

        do_fine_tuning = model_fine_tuning #@param {type:"boolean"}
        if do_fine_tuning:
            print(">>>> Model is fine-tuning <<<<")

        print("Building model with", model_handle)
        if use_scalars:
            # Multi-input model: image branch (transfer-learned backbone) +
            # scalar branch (4-dim physical-size vector). Scalar branch is
            # tiny on purpose (16 → 8) so it cannot dominate the image
            # backbone; it nudges the classifier with absolute-size priors
            # while the morphology features come from pixels. Normalization
            # stats are adapted from the training-set scalars and saved
            # inside the model so inference works without external state.
            image_input  = tf.keras.layers.Input(shape=IMAGE_SIZE + (3,), name='image')
            scalar_input = tf.keras.layers.Input(shape=(len(SIZE_SCALAR_FIELDS),), name='size_scalars')
            image_features = hub.KerasLayer(model_handle, trainable=do_fine_tuning)(image_input)
            image_features = tf.keras.layers.Dropout(rate=0.2)(image_features)
            scalar_norm = tf.keras.layers.Normalization(name='size_norm')
            # Adapt the normalization layer to the training-set scalars so
            # the model itself knows the mean/std (no external preprocessing
            # required at inference time).
            _adapt_scalars = np.asarray(
                [scalar_lookup[k] for k in scalar_lookup],
                dtype=np.float32,
            )
            scalar_norm.adapt(_adapt_scalars)
            scalar_features = scalar_norm(scalar_input)
            scalar_features = tf.keras.layers.Dense(16, activation='relu', name='size_dense_1')(scalar_features)
            scalar_features = tf.keras.layers.Dense(8, activation='relu', name='size_dense_2')(scalar_features)
            merged = tf.keras.layers.Concatenate(name='image_plus_size_concat')([image_features, scalar_features])
            output = tf.keras.layers.Dense(
                len(class_names),
                kernel_regularizer=tf.keras.regularizers.l2(0.0001),
                name='classifier',
            )(merged)
            model = tf.keras.Model(inputs=[image_input, scalar_input], outputs=output)
        else:
            model = tf.keras.Sequential([
                tf.keras.layers.InputLayer(input_shape=IMAGE_SIZE + (3,)),
                hub.KerasLayer(model_handle, trainable=do_fine_tuning),
                tf.keras.layers.Dropout(rate=0.2),
                tf.keras.layers.Dense(len(class_names),
                    kernel_regularizer=tf.keras.regularizers.l2(0.0001))
            ])
            model.build((None,)+IMAGE_SIZE+(3,))
        model.summary()



        ###################
        # Train the model #
        ###################

        logger.info("Starting model training...")

        model.compile(
            optimizer=tf.keras.optimizers.SGD(learning_rate=model_learning_rate, momentum=0.9),
            loss=tf.keras.losses.CategoricalCrossentropy(from_logits=True, label_smoothing=0.1),
            metrics=['accuracy'])

        steps_per_epoch = train_size // BATCH_SIZE
        validation_steps = valid_size // BATCH_SIZE

        class SaveAllImagesCallback(tf.keras.callbacks.Callback):
            def __init__(self, dataset, steps_per_epoch):
                self.dataset = dataset
                self.steps_per_epoch = steps_per_epoch  # Limit the number of batches to steps_per_epoch

            def on_epoch_end(self, epoch, logs=None):
                """Save all images processed during each epoch."""
                logger.info(f"Saving all images for epoch {epoch+1}")
                
                # Iterate through the dataset for only one epoch (steps_per_epoch batches)
                for batch_idx, (images, labels) in zip(range(self.steps_per_epoch), self.dataset):
                    for image_idx, image in enumerate(images):
                        # Convert image to numpy array and save it
                        image_np = image.numpy()
                        file_name = f"epoch_{epoch+1}_batch_{batch_idx+1}_image_{image_idx+1}.png"
                        save_image(image_np, file_name)
                        logger.info(f"Saved {file_name} to media directory.")


                logger.info(f"Saved all images for epoch {epoch+1}, total batches: {self.steps_per_epoch}.")


        save_all_images_callback = SaveAllImagesCallback(post_train_ds, steps_per_epoch)

        # Fit the model and get the History object. verbose=2 emits one
        # summary line per epoch instead of carriage-return progress bars,
        # which read cleanly through the Redis log pipe.
        history_obj = model.fit(
            post_train_ds,
            epochs=model_epochs,
            steps_per_epoch=steps_per_epoch,
            validation_data=val_ds,
            validation_steps=validation_steps,
            verbose=2,
            # callbacks=[save_all_images_callback]
            )

        hist = history_obj.history 
        logger.info("Training completed")

        for epoch in range(1, len(hist['accuracy']) + 1):
            accuracy = hist['accuracy'][epoch - 1]
            loss = hist['loss'][epoch - 1]
            val_accuracy = hist['val_accuracy'][epoch - 1]
            val_loss = hist['val_loss'][epoch - 1]
            logger.info(f'Epoch {epoch}: Accuracy: {accuracy}, Loss: {loss}, Val Accuracy: {val_accuracy}, Val Loss: {val_loss}')



        ###################
        # Plots (object)  #
        ###################
            
        plt.figure()
        plt.ylabel("Loss (training and validation)")
        plt.xlabel("Training Steps")
        plt.ylim([0,2])
        plt.plot(hist["loss"])
        plt.plot(hist["val_loss"])

        plt.figure()
        plt.ylabel("Accuracy (training and validation)")
        plt.xlabel("Training Steps")
        plt.ylim([0,1])
        plt.plot(hist["accuracy"])
        plt.plot(hist["val_accuracy"])

        # Save metrics for each epoch        
        for epoch in range(1, len(hist['accuracy']) + 1):
            Epoch.objects.create(
                training_session=session_instance,
                number=epoch,
                accuracy=hist['accuracy'][epoch - 1],
                loss=hist['loss'][epoch - 1],
                val_accuracy=hist['val_accuracy'][epoch - 1],
                val_loss=hist['val_loss'][epoch - 1]
            )

        ###################
        # Save the model  #
        ###################

        # x, y = next(iter(val_ds))
        # image = x[0, :, :, :]
        # true_index = np.argmax(y[0])
        # plt.imshow(image)
        # plt.axis('off')
        # plt.show()

        # save the model
        model_file_name = session_instance.name.replace(' ', '_').lower()
        model_path = settings.MEDIA_ROOT / 'models' / f'{model_file_name}.h5'
        model.save(model_path)
        session_instance.model_path = model_path
        session_instance.status = 'Completed'

    except Exception as e:
        print(f"Error during training: {e}")
        session_instance.status = 'Failed'
    finally:
        K.clear_session()  
        gc.collect()  

    session_instance.save()
    process_next_pending()


# Predict the label of an image

@shared_task
def test_images(test_id, image_size=224):
    from .models import Test, TestResult
    from datasets.models import Image

    IMAGE_SIZE = (int(image_size), int(image_size))

    try:
        test_instance = Test.objects.get(id=test_id)

        # Guard: skip if results already exist (prevents duplicate runs)
        if TestResult.objects.filter(test=test_instance).exists():
            logger.warning(f"Test {test_id} already has results, skipping duplicate run")
            if test_instance.status in ('Pending', 'Testing'):
                test_instance.status = 'Completed'
                test_instance.save(update_fields=['status'])
            process_next_pending()
            return

        test_instance.status = 'Testing'
        test_instance.save()

        model_file = test_instance.training_session.model_path
        class_names = test_instance.training_session.class_names.split(', ')
        # Multi-input models were trained with [image, size_scalars]. The
        # test pipeline has to feed the same two-tensor input and skip the
        # saliency map (the saliency lib does not handle multi-input models
        # cleanly: gradients would be computed against both inputs).
        input_mode = test_instance.training_session.input_mode or 'image_only'
        use_scalars = (input_mode == 'image_plus_size')
        logger.info(f"MODEL FILE: {model_file}")
        logger.info(f"Input mode: {input_mode}")

        logger.info(f"Testing Dataset Name: {test_instance.dataset.name}")

        # Load the model
        model = tf.keras.models.load_model(model_file, custom_objects={'KerasLayer': hub.KerasLayer})
        print('Model Summary:', model.summary())
        softmax = tf.keras.layers.Softmax()

        print('Model Summary:', model.summary())

        # Define the saliency object (image-only models only)
        saliency = None if use_scalars else Saliency(model, model_modifier=ReplaceToLinear())

        # Retrieve all images related to the dataset
        image_objects = Image.objects.filter(dataset=test_instance.dataset)

        for image_obj in image_objects:
            image_path = image_obj.image.path
            convert_alpha_to_white(image_path)
            image = tf.keras.preprocessing.image.load_img(image_path, target_size=IMAGE_SIZE)
            image_array = tf.keras.preprocessing.image.img_to_array(image)
            image_array = np.expand_dims(image_array, axis=0)

            # Normalize the image
            normalization_layer = tf.keras.layers.Rescaling(1. / 255)
            image_array = normalization_layer(image_array)

            # Perform prediction. For image_plus_size models, build the
            # scalar vector in the exact column order the model was trained
            # on (SIZE_SCALAR_FIELDS) and pass both inputs as a list.
            if use_scalars:
                scalar_values = []
                for field in SIZE_SCALAR_FIELDS:
                    v = getattr(image_obj, field, None)
                    scalar_values.append(0.0 if v is None else float(v))
                scalar_array = np.asarray([scalar_values], dtype=np.float32)
                logits = model.predict([image_array, scalar_array])
            else:
                logits = model.predict(image_array)
            probabilities = softmax(logits).numpy()
            predicted_index = np.argmax(probabilities)
            predicted_label = class_names[predicted_index]
            confidence = probabilities[0][predicted_index]
            true_label = image_obj.label.name.lower().replace(" ", "_")

            print(f"Predicted probabilities: {probabilities[0]}")
            print(f"Predicted label: {predicted_label}, Confidence: {confidence:.2%}")
            print(f"True label: {true_label}")
            print(f"Filename: {image_obj.image.name}")

            fig, axes = plt.subplots(1, 2, figsize=(10, 5))
            image = PILImage.open(image_path)
            if image.mode == 'RGBA':
                bg = PILImage.new("RGB", image.size, (0, 0, 0))
                image = PILImage.alpha_composite(bg.convert('RGBA'), image).convert('RGB')
            else:
                image = image.convert('RGB')

            axes[0].imshow(image)
            axes[0].set_title(f"True: {true_label}")
            axes[0].axis('off')

            # Generate saliency map for the predicted class (image-only
            # models only — the saliency lib does not handle a multi-input
            # model's gradients cleanly, so for image_plus_size we just
            # render the photo on the right side and skip the heat map).
            if saliency is not None:
                score = CategoricalScore([predicted_index])
                saliency_map = saliency(score, image_array)[0]

                # Normalize the saliency map
                saliency_map = (saliency_map - saliency_map.min()) / (saliency_map.max() - saliency_map.min())

                # Apply Sobel filter to enhance edges
                saliency_sobel_x = sobel(saliency_map, axis=0)
                saliency_sobel_y = sobel(saliency_map, axis=1)
                edge_map = np.hypot(saliency_sobel_x, saliency_sobel_y)

                # Combine saliency map with edge map
                combined_map = saliency_map + edge_map
                combined_map = (combined_map - combined_map.min()) / (combined_map.max() - combined_map.min())

                # Display the combined map
                im = axes[1].imshow(combined_map, cmap='viridis')
                axes[1].set_title(f"Predicted: {predicted_label}")
                axes[1].axis('off')

                # Add color bar at the bottom
                cbar = fig.colorbar(im, ax=axes, orientation='horizontal', fraction=0.02, pad=0.04)
                cbar.set_label('Saliency Value')
                plt.suptitle(f"Saliency Map for {image_obj.image.name}")
            else:
                axes[1].imshow(image)
                axes[1].set_title(f"Predicted: {predicted_label} (image+size model — no saliency)")
                axes[1].axis('off')
                plt.suptitle(f"Prediction for {image_obj.image.name}")

            unique_filename = f"saliency_map_{uuid4().hex}_{get_valid_filename(image_obj.image.name)}"
            plt.savefig(unique_filename)
            plt.close()

            # Save test results
            if unique_filename:
                with open(unique_filename, 'rb') as f:
                    grad_cam_file = File(f)
                    test_result = TestResult(
                        test=test_instance,
                        image=image_obj,
                        true_label=true_label,
                        prediction=predicted_label,
                        confidence=float(confidence),
                        grad_cam=grad_cam_file
                    )
                    test_result.save()
                os.remove(unique_filename)

        test_instance.status = 'Completed'
    except Exception as e:
        logger.error(f"Error during testing: {e}")
        test_instance.status = 'Failed'
    finally:
        test_instance.save()
        K.clear_session()  
        gc.collect()
    process_next_pending()  

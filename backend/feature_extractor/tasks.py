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
from PIL import Image as PILImage
import tensorflow_addons as tfa
import tensorflow.keras.backend as K
import gc
import shutil
import os
# from tensorflow.keras.preprocessing.image import load_img, img_to_array
import logging
logger = logging.getLogger(__name__)

def convert_alpha_to_white(image_path):
    """Converts an image with alpha transparency to a white background and saves it in the same location."""
    image = PILImage.open(image_path).convert("RGBA")
    background = PILImage.new("RGB", image.size, (255, 255, 255)) 
    background.paste(image, mask=image.split()[3])  
    background.save(image_path, "PNG")  

def remove_alpha(data_dir):
    """Iterates through all images in the data directory and converts them to remove transparency, saving in-place."""
    for root, _, files in os.walk(data_dir):
        for file in files:
            if file.endswith(".png") or file.endswith(".jpg"):
                file_path = os.path.join(root, file)
                convert_alpha_to_white(file_path)
                

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


    
@shared_task
def train_model(training_session_id, *args, **kwargs):
    from .models import TFModel  
    from .models import TrainingSession
    from .models import Epoch

    if not training_session_id:
        training_session_id = args[0]
    
    session_instance = TrainingSession.objects.get(id=training_session_id)
    model_instance = TFModel.objects.get(id=session_instance.model.id)
    model_batch_size = model_instance.batch_size
    model_epochs = model_instance.epochs
    model_validation_split = model_instance.validation_split
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

        base_media_url = urljoin(settings.BASE_URL, settings.MEDIA_URL)
        logger.info(f"Dataset NAME: " + base_media_url)
        tar_path = urljoin(base_media_url, 'archive/' + file_name + '.tar.gz')    
        logger.info(f"Dataset PATH: {tar_path}")

        data_dir = tf.keras.utils.get_file(
        file_name,
        tar_path,
        untar=True)

        logger.info(f"Dataset data_dir: {data_dir}")


        ##############################################
        # Build the training and validation datasets #
        ##############################################

        logger.info("Building and compiling model...")

        remove_alpha(data_dir)

        def build_dataset(subset):
            return tf.keras.preprocessing.image_dataset_from_directory(
                data_dir,
                validation_split=model_validation_split,
                subset=subset,
                label_mode="categorical",
                seed=123,
                image_size=IMAGE_SIZE,
                batch_size=1
            )

        train_ds = build_dataset("training")
        class_names = tuple(train_ds.class_names)

        # store clas_names in the session_instance
        session_instance.class_names = ', '.join(class_names)
        session_instance.save()

        train_size = train_ds.cardinality().numpy()
        train_ds = train_ds.unbatch().batch(BATCH_SIZE)
        train_ds = train_ds.repeat()

        normalization_layer = tf.keras.layers.Rescaling(1. / 255)
        preprocessing_model = tf.keras.Sequential([normalization_layer])

            
        @tf.function
        def preprocess(images, labels):
            return preprocessing_model(images), labels

        @tf.function
        def normalization(images, labels):
            return normalization_layer(images), labels
        
        train_ds = train_ds.map(normalization)

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
        if model_random_rotation:
            logger.info("<--- Random Rotation enabled --->")
            data_augmentation.add(tf.keras.layers.RandomRotation(0.15))  # Rotate randomly by ±15 degrees
        
        # Apply zoom if the model specifies random zoom
        if model_zoom:
            logger.info("<--- Random Zoom enabled --->")
            data_augmentation.add(tf.keras.layers.RandomZoom(0.05, 0.15))  # Zoom in/out by 5%-15%
        
        def clip_values(images):
            return tf.clip_by_value(images, 0.0, 1.0)
        
        # Apply brightness and contrast adjustments if enabled
        if model_brightness_contrast:
            logger.info("<--- Random Brightness and Contrast enabled --->")
            data_augmentation.add(tf.keras.layers.RandomBrightness(0.1))  # Adjust brightness by ±10%
            data_augmentation.add(tf.keras.layers.RandomContrast(0.1))    # Adjust contrast by ±10%
            data_augmentation.add(tf.keras.layers.Lambda(clip_values)) 

        # Apply random crop and resize if enabled
        if model_random_crop:
            logger.info("<--- Random Crop and Rescale enabled --->")
            data_augmentation.add(tf.keras.layers.RandomCrop(height=IMAGE_SIZE[0] - 10, width=IMAGE_SIZE[1] - 10))  
            data_augmentation.add(tf.keras.layers.Resizing(IMAGE_SIZE[0], IMAGE_SIZE[1]))  # Resize to original dimensions
        
        # Apply Gaussian noise if specified
        if model_gaussian_noise:
            logger.info("<--- Gaussian Noise enabled --->")
            def add_gaussian_noise(images):
                noise = tf.random.normal(shape=tf.shape(images), mean=0.0, stddev=0.02, dtype=tf.float32)  # 2% noise
                return images + noise
            data_augmentation.add(tf.keras.layers.Lambda(add_gaussian_noise))
        
        # Apply Gaussian blur if specified (new)
        if model_blur:
            logger.info("<--- Gaussian Blur enabled --->")
            def apply_gaussian_blur(images):
                blurred_images = tfa.image.gaussian_filter2d(images, filter_shape=(3, 3), sigma=0.7)  # Moderate blur
                return blurred_images
            data_augmentation.add(tf.keras.layers.Lambda(apply_gaussian_blur))
        
        # Optionally, apply Cutout if enabled
        if model_cutout:
            logger.info("<--- Cutout enabled --->")
            def apply_random_cutout(images):
                cutout_images = tfa.image.random_cutout(images, mask_size=(20, 20))
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

        post_train_ds = train_ds.map(apply_augmentation)

        # Save the augmented images for debugging purposes
        if apply_data_augmentation:
            logger.info("<--- Data Augmentation enabled --->")
            augmented_images_dir = os.path.join(settings.MEDIA_ROOT, 'augmented_images')
            
            if os.path.exists(augmented_images_dir):
                shutil.rmtree(augmented_images_dir) 
            
            os.makedirs(augmented_images_dir, exist_ok=True)
            logger.info(f"Created clean directory at {augmented_images_dir}.")

            for idx, (image_array, label) in enumerate(train_ds.take(train_size)): 
                image_np = image_array.numpy()[0]
                augmented_image = data_augmentation(tf.expand_dims(image_np, 0))
                
                # Remove the batch dimension and save
                augmented_image_np = augmented_image.numpy()[0]
                
                # Convert to image and save
                # file_name = f"augmented_image_{uuid4().hex}_{idx}.png"
                # save_image(augmented_image_np, file_name)
                # logger.info(f"Saved {file_name} to media directory.")
            
            
        val_ds = build_dataset("validation")
        valid_size = val_ds.cardinality().numpy()
        val_ds = val_ds.unbatch().batch(BATCH_SIZE)

        val_ds = val_ds.map(preprocess)



        ###################
        # Build the model #
        ###################

        do_fine_tuning = True #@param {type:"boolean"}

        print("Building model with", model_handle)
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
            optimizer=tf.keras.optimizers.SGD(learning_rate=0.005, momentum=0.9), 
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

        # Fit the model and get the History object
        history_obj = model.fit(
            post_train_ds,
            epochs=model_epochs, 
            steps_per_epoch=steps_per_epoch,
            validation_data=val_ds,
            validation_steps=validation_steps,
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



        ###################123456!
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


# Predict the label of an image

@shared_task
def test_images(test_id, image_size=224):
    from .models import Test, TestResult
    from datasets.models import Image

    IMAGE_SIZE = (int(image_size), int(image_size))

    try:
        test_instance = Test.objects.get(id=test_id)
        test_instance.status = 'Testing'
        test_instance.save()

        model_file = test_instance.training_session.model_path
        class_names = test_instance.training_session.class_names.split(', ')
        logger.info(f"MODEL FILE: {model_file}")

        logger.info(f"Testing Dataset Name: {test_instance.dataset.name}")

        # Load the model
        model = tf.keras.models.load_model(model_file, custom_objects={'KerasLayer': hub.KerasLayer})
        print('Model Summary:', model.summary())
        softmax = tf.keras.layers.Softmax()

        print('Model Summary:', model.summary())

        # Define the saliency object
        saliency = Saliency(model, model_modifier=ReplaceToLinear())

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

            # Perform prediction
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

            # Generate saliency map for the predicted class
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

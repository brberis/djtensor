# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: tests.py
# Copyright (c) 2024
#
# Tests for bulk image upload: deduplication, archive handling, validation.
# Uses the "Test" study/dataset as a safe sandbox.

import hashlib
import io
import os
import tarfile
import tempfile
import zipfile

from django.conf import settings
from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient, APITestCase
from unittest.mock import patch

from .models import Dataset, Label, Image
from .bulk_upload import compute_file_hash, get_file_extension, check_disk_space


def _make_test_image(name='test.jpg', size=(2, 2), color='red'):
    """Create a minimal valid JPEG image in memory."""
    from PIL import Image as PILImage
    buf = io.BytesIO()
    img = PILImage.new('RGB', size, color=color)
    img.save(buf, format='JPEG')
    buf.seek(0)
    return SimpleUploadedFile(name, buf.read(), content_type='image/jpeg')


def _make_zip_archive(image_files):
    """
    Create a ZIP archive containing the given image files.
    image_files: list of (filename, bytes) tuples
    Returns a SimpleUploadedFile.
    """
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as zf:
        for fname, data in image_files:
            zf.writestr(fname, data)
    buf.seek(0)
    return SimpleUploadedFile('test_archive.zip', buf.read(), content_type='application/zip')


def _make_tar_gz_archive(image_files):
    """
    Create a tar.gz archive containing the given image files.
    image_files: list of (filename, bytes) tuples
    Returns a SimpleUploadedFile.
    """
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode='w:gz') as tf:
        for fname, data in image_files:
            info = tarfile.TarInfo(name=fname)
            info.size = len(data)
            tf.addfile(info, io.BytesIO(data))
    buf.seek(0)
    return SimpleUploadedFile('test_archive.tar.gz', buf.read(), content_type='application/gzip')


class FileHashTests(TestCase):
    """Test the SHA-256 hashing utility."""

    def test_compute_hash_produces_hex_string(self):
        f = _make_test_image('hash_test.jpg')
        h = compute_file_hash(f)
        self.assertEqual(len(h), 64)
        # Should be valid hex
        int(h, 16)

    def test_same_content_same_hash(self):
        """Identical file content should produce identical hashes."""
        content = b'\x89PNG\r\n\x1a\n' + b'\x00' * 100
        f1 = SimpleUploadedFile('a.png', content, content_type='image/png')
        f2 = SimpleUploadedFile('b.png', content, content_type='image/png')
        self.assertEqual(compute_file_hash(f1), compute_file_hash(f2))

    def test_different_content_different_hash(self):
        content1 = b'\x89PNG\r\n\x1a\n' + b'\x00' * 100
        content2 = b'\x89PNG\r\n\x1a\n' + b'\xff' * 100
        f1 = SimpleUploadedFile('a.png', content1)
        f2 = SimpleUploadedFile('b.png', content2)
        self.assertNotEqual(compute_file_hash(f1), compute_file_hash(f2))


class FileExtensionTests(TestCase):
    """Test file extension detection, including double extensions."""

    def test_simple_extension(self):
        self.assertEqual(get_file_extension('photo.jpg'), '.jpg')
        self.assertEqual(get_file_extension('image.PNG'), '.png')

    def test_tar_gz_extension(self):
        self.assertEqual(get_file_extension('archive.tar.gz'), '.tar.gz')
        self.assertEqual(get_file_extension('ARCHIVE.TAR.GZ'), '.tar.gz')

    def test_tgz_extension(self):
        self.assertEqual(get_file_extension('archive.tgz'), '.tgz')


# Use a temp directory for media during tests so we do not pollute real storage
TEMP_MEDIA = tempfile.mkdtemp(prefix='djtensor_test_media_')


@override_settings(MEDIA_ROOT=TEMP_MEDIA)
class BulkUploadAPITests(APITestCase):
    """Integration tests for the bulk upload endpoint."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        os.makedirs(TEMP_MEDIA, exist_ok=True)

    def setUp(self):
        self.user = User.objects.create_user(username='testuser', password='testpass')
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.label = Label.objects.create(name='Test Label')
        self.dataset = Dataset.objects.create(name='Test Upload Dataset')
        self.dataset.labels.add(self.label)

    def tearDown(self):
        # Clean up created image files
        Image.objects.filter(dataset=self.dataset).delete()
        Dataset.objects.filter(id=self.dataset.id).delete()

    def test_upload_single_image(self):
        """Uploading a single image should create one Image record."""
        img = _make_test_image('single.jpg')
        response = self.client.post('/api/datasets/image/bulk-upload/', {
            'dataset_id': self.dataset.id,
            'label_id': self.label.id,
            'image': img,
        }, format='multipart')
        self.assertIn(response.status_code, [200, 201])
        data = response.json()
        self.assertEqual(data['summary']['created_count'], 1)
        self.assertEqual(data['summary']['duplicate_count'], 0)

    def test_upload_duplicate_detected(self):
        """Uploading the same image twice should detect the duplicate."""
        img1 = _make_test_image('dup.jpg', color='blue')
        # First upload
        self.client.post('/api/datasets/image/bulk-upload/', {
            'dataset_id': self.dataset.id,
            'label_id': self.label.id,
            'image': img1,
        }, format='multipart')

        # Second upload with same content
        img2 = _make_test_image('dup.jpg', color='blue')
        response = self.client.post('/api/datasets/image/bulk-upload/', {
            'dataset_id': self.dataset.id,
            'label_id': self.label.id,
            'image': img2,
        }, format='multipart')
        data = response.json()
        self.assertEqual(data['summary']['duplicate_count'], 1)
        self.assertEqual(data['summary']['created_count'], 0)

    def test_upload_rejects_unsupported_format(self):
        """Non-image files should be reported as errors."""
        txt = SimpleUploadedFile('readme.txt', b'hello world', content_type='text/plain')
        response = self.client.post('/api/datasets/image/bulk-upload/', {
            'dataset_id': self.dataset.id,
            'label_id': self.label.id,
            'image': txt,
        }, format='multipart')
        data = response.json()
        self.assertEqual(data['summary']['error_count'], 1)
        self.assertIn('Unsupported format', data['errors'][0]['reason'])

    def test_upload_missing_dataset(self):
        """Request with nonexistent dataset should return 404."""
        img = _make_test_image('missing_ds.jpg')
        response = self.client.post('/api/datasets/image/bulk-upload/', {
            'dataset_id': 99999,
            'label_id': self.label.id,
            'image': img,
        }, format='multipart')
        self.assertEqual(response.status_code, 404)

    def test_upload_no_files(self):
        """Request with no files should return 400."""
        response = self.client.post('/api/datasets/image/bulk-upload/', {
            'dataset_id': self.dataset.id,
            'label_id': self.label.id,
        }, format='multipart')
        self.assertEqual(response.status_code, 400)

    @patch('datasets.bulk_upload.check_disk_space', return_value=100)
    def test_upload_rejects_when_disk_full(self, mock_disk):
        """Upload should be rejected when disk space is below threshold."""
        img = _make_test_image('disk_full.jpg')
        response = self.client.post('/api/datasets/image/bulk-upload/', {
            'dataset_id': self.dataset.id,
            'label_id': self.label.id,
            'image': img,
        }, format='multipart')
        self.assertEqual(response.status_code, 507)

    def test_archive_upload_returns_task_id(self):
        """Uploading a zip archive should queue a task and return task_id."""
        from PIL import Image as PILImage
        # Create a tiny valid image for the archive
        buf = io.BytesIO()
        PILImage.new('RGB', (2, 2), 'red').save(buf, format='JPEG')
        img_bytes = buf.getvalue()

        archive = _make_zip_archive([('image1.jpg', img_bytes), ('image2.jpg', img_bytes)])
        with patch('datasets.bulk_upload.process_archive_upload') as mock_task:
            mock_task.delay.return_value.id = 'fake-task-id'
            response = self.client.post('/api/datasets/image/bulk-upload/', {
                'dataset_id': self.dataset.id,
                'label_id': self.label.id,
                'archive': archive,
            }, format='multipart')
        self.assertEqual(response.status_code, 202)
        data = response.json()
        self.assertEqual(data['status'], 'processing')
        self.assertIn('task_id', data)


@override_settings(MEDIA_ROOT=TEMP_MEDIA)
class ArchiveTaskTests(TestCase):
    """Test the Celery archive processing task directly (without broker)."""

    def setUp(self):
        self.user = User.objects.create_user(username='tasktest', password='pass')
        self.label = Label.objects.create(name='Archive Label')
        self.dataset = Dataset.objects.create(name='Archive Dataset')
        self.dataset.labels.add(self.label)

    def tearDown(self):
        Image.objects.filter(dataset=self.dataset).delete()

    @patch('datasets.upload_tasks.process_archive_upload.update_state')
    @patch('datasets.tasks.create_dataset_archive.delay')
    def test_zip_extraction_creates_images(self, mock_archive, mock_state):
        """Extracting a zip should create Image records for each image inside."""
        from .upload_tasks import process_archive_upload
        from PIL import Image as PILImage

        # Build a zip with 3 images
        images = []
        for i in range(3):
            buf = io.BytesIO()
            PILImage.new('RGB', (4, 4), color=(i * 80, 0, 0)).save(buf, format='JPEG')
            images.append((f'img_{i}.jpg', buf.getvalue()))

        # Write the zip to a temp file
        zip_buf = io.BytesIO()
        with zipfile.ZipFile(zip_buf, 'w') as zf:
            for name, data in images:
                zf.writestr(name, data)
        zip_buf.seek(0)

        temp_dir = os.path.join(TEMP_MEDIA, 'temp_uploads')
        os.makedirs(temp_dir, exist_ok=True)
        archive_path = os.path.join(temp_dir, 'test.zip')
        with open(archive_path, 'wb') as f:
            f.write(zip_buf.read())

        # Run the task directly (not via Celery broker)
        result = process_archive_upload(archive_path, self.dataset.id, self.label.id)

        self.assertEqual(result['summary']['created_count'], 3)
        self.assertEqual(result['summary']['duplicate_count'], 0)
        self.assertEqual(Image.objects.filter(dataset=self.dataset).count(), 3)

    @patch('datasets.upload_tasks.process_archive_upload.update_state')
    @patch('datasets.tasks.create_dataset_archive.delay')
    def test_archive_dedup_across_runs(self, mock_archive, mock_state):
        """Running archive extraction twice with same images should deduplicate."""
        from .upload_tasks import process_archive_upload
        from PIL import Image as PILImage

        buf = io.BytesIO()
        PILImage.new('RGB', (4, 4), color='green').save(buf, format='JPEG')
        img_data = buf.getvalue()

        temp_dir = os.path.join(TEMP_MEDIA, 'temp_uploads')
        os.makedirs(temp_dir, exist_ok=True)

        # First run
        zip_buf = io.BytesIO()
        with zipfile.ZipFile(zip_buf, 'w') as zf:
            zf.writestr('green.jpg', img_data)
        archive_path = os.path.join(temp_dir, 'run1.zip')
        with open(archive_path, 'wb') as f:
            f.write(zip_buf.getvalue())
        result1 = process_archive_upload(archive_path, self.dataset.id, self.label.id)
        self.assertEqual(result1['summary']['created_count'], 1)

        # Second run with same image
        zip_buf2 = io.BytesIO()
        with zipfile.ZipFile(zip_buf2, 'w') as zf:
            zf.writestr('green.jpg', img_data)
        archive_path2 = os.path.join(temp_dir, 'run2.zip')
        with open(archive_path2, 'wb') as f:
            f.write(zip_buf2.getvalue())
        result2 = process_archive_upload(archive_path2, self.dataset.id, self.label.id)
        self.assertEqual(result2['summary']['created_count'], 0)
        self.assertEqual(result2['summary']['duplicate_count'], 1)

    @patch('datasets.upload_tasks.process_archive_upload.update_state')
    @patch('datasets.tasks.create_dataset_archive.delay')
    def test_tar_gz_extraction(self, mock_archive, mock_state):
        """tar.gz archives should be extracted and processed correctly."""
        from .upload_tasks import process_archive_upload
        from PIL import Image as PILImage

        buf = io.BytesIO()
        PILImage.new('RGB', (4, 4), color='purple').save(buf, format='JPEG')
        img_data = buf.getvalue()

        temp_dir = os.path.join(TEMP_MEDIA, 'temp_uploads')
        os.makedirs(temp_dir, exist_ok=True)

        tar_buf = io.BytesIO()
        with tarfile.open(fileobj=tar_buf, mode='w:gz') as tf:
            info = tarfile.TarInfo(name='purple.jpg')
            info.size = len(img_data)
            tf.addfile(info, io.BytesIO(img_data))
        tar_buf.seek(0)

        archive_path = os.path.join(temp_dir, 'test.tar.gz')
        with open(archive_path, 'wb') as f:
            f.write(tar_buf.read())

        result = process_archive_upload(archive_path, self.dataset.id, self.label.id)
        self.assertEqual(result['summary']['created_count'], 1)


class DiskStatusTests(APITestCase):
    """Test the disk status endpoint."""

    def setUp(self):
        self.user = User.objects.create_user(username='disktest', password='pass')
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_disk_status_returns_info(self):
        response = self.client.get('/api/datasets/disk-status/')
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn('free_gb', data)
        self.assertIn('usage_percent', data)

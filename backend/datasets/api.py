# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: api.py
# Copyright (c) 2024

import logging
import random

from django.core.exceptions import ObjectDoesNotExist
from django.db import transaction
from django.db.models import Q
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response

from feature_extractor.models import Study
from .models import Dataset, Image, Label
from .serializers import DatasetSerializer, ImageSerializer, LabelSerializer
from .tasks import (
    create_dataset_archive,
    compute_completeness_for_dataset,
    compute_completeness_mm2_for_dataset,
    generate_synthetic_dataset,
    emit_processed_dataset,
    extract_museum_metadata_for_dataset,
)
from .synthetic_fracture import load_fracture_profiles
from .image_resize import resize_to_dataset, get_target_resolution
from feature_extractor.permissions import IsSyntheticToolsEnabled

logger = logging.getLogger(__name__)


def dataset_is_locked(dataset):
    return (
        dataset.training_sessions.filter(status='Completed').exists()
        or dataset.tests.filter(status='Completed').exists()
    )


def dataset_lock_reason(dataset):
    has_training = dataset.training_sessions.filter(status='Completed').exists()
    has_testing = dataset.tests.filter(status='Completed').exists()

    if has_training and has_testing:
        return 'Dataset is locked because it belongs to completed training and testing sessions.'
    if has_training:
        return 'Dataset is locked because it belongs to a completed training session.'
    if has_testing:
        return 'Dataset is locked because it belongs to a completed testing session.'
    return ''


class ImagePagination(PageNumberPagination):
    page_size = 10
    page_size_query_param = 'page_size'
    max_page_size = 100


class DatasetViewSet(viewsets.ModelViewSet):
    serializer_class = DatasetSerializer

    def get_queryset(self):
        qs = Dataset.objects.all()
        if not self.request.user.is_superuser:
            from feature_extractor.models import StudyMembership
            user_studies = StudyMembership.objects.filter(
                user=self.request.user
            ).values_list('study_id', flat=True)
            qs = qs.filter(
                Q(study__in=user_studies) | Q(shared__in=user_studies)
            ).distinct()
        # Handle ?study=<id> manually so it matches both owned and shared
        # datasets — DjangoFilterBackend's default exact-FK filter would only
        # return datasets owned by that study and silently hide shared ones,
        # which broke the "Create New Test" dialog (test datasets are usually
        # shared into SF-* studies rather than owned).
        study_param = self.request.query_params.get('study')
        if study_param:
            try:
                study_id = int(study_param)
                qs = qs.filter(Q(study_id=study_id) | Q(shared__id=study_id)).distinct()
            except (TypeError, ValueError):
                pass
        return qs
    filter_backends = (DjangoFilterBackend,)
    filterset_fields = ['for_testing']

    def update(self, request, *args, **kwargs):
        dataset = self.get_object()
        if dataset_is_locked(dataset):
            return Response({'error': dataset_lock_reason(dataset)}, status=status.HTTP_409_CONFLICT)
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        dataset = self.get_object()
        if dataset_is_locked(dataset):
            return Response({'error': dataset_lock_reason(dataset)}, status=status.HTTP_409_CONFLICT)
        return super().partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        dataset = self.get_object()
        if dataset_is_locked(dataset):
            return Response({'error': dataset_lock_reason(dataset)}, status=status.HTTP_409_CONFLICT)
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=['get', 'post'])
    def share(self, request, pk=None):
        """GET: list studies and current sharing state. POST: set shared studies.

        Sharing does not copy images; only M2M pointers are updated. Only users
        who can edit the dataset's owner study (owner/editor) may change sharing.
        """
        from feature_extractor.permissions import effective_role
        from feature_extractor.models import StudyMembership

        dataset = self.get_object()

        if request.method == 'GET':
            if request.user.is_superuser:
                studies_qs = Study.objects.all().order_by('display_order', '-created_at')
            else:
                user_study_ids = StudyMembership.objects.filter(
                    user=request.user
                ).values_list('study_id', flat=True)
                studies_qs = Study.objects.filter(id__in=user_study_ids).order_by('display_order', '-created_at')
            return Response({
                'owner_study': dataset.study_id,
                'shared': list(dataset.shared.values_list('id', flat=True)),
                'studies': [{'id': s.id, 'name': s.name} for s in studies_qs],
            })

        # POST
        owner_study = dataset.study
        if owner_study is None:
            if not request.user.is_superuser:
                return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)
        else:
            role = effective_role(request.user, owner_study)
            if role not in ('owner', 'editor'):
                return Response({'error': 'Only owners/editors of the source study can share'}, status=status.HTTP_403_FORBIDDEN)

        raw_ids = request.data.get('study_ids', [])
        try:
            ids = [int(x) for x in raw_ids]
        except (TypeError, ValueError):
            return Response({'error': 'study_ids must be a list of integers'}, status=status.HTTP_400_BAD_REQUEST)

        valid = list(Study.objects.filter(id__in=ids).values_list('id', flat=True))
        dataset.shared.set(valid)
        return Response({
            'owner_study': dataset.study_id,
            'shared': sorted(valid),
        })

    @action(detail=True, methods=['post'], permission_classes=[IsSyntheticToolsEnabled])
    def compute_completeness(self, request, pk=None):
        dataset = self.get_object()
        reference_dataset_id = request.data.get('reference_dataset_id')
        compute_completeness_for_dataset.delay(dataset.id, reference_dataset_id)
        return Response({'status': 'queued', 'dataset': dataset.name}, status=status.HTTP_202_ACCEPTED)

    @action(detail=True, methods=['post'], permission_classes=[IsSyntheticToolsEnabled], url_path='compute-completeness-mm2')
    def compute_completeness_mm2(self, request, pk=None):
        """Phase 2 mm-anchored completeness pass. Parallel to compute_completeness."""
        dataset = self.get_object()
        reference_dataset_id = request.data.get('reference_dataset_id')
        assumed_tick_mm = float(request.data.get('assumed_tick_spacing_mm', 10.0))
        compute_completeness_mm2_for_dataset.delay(
            dataset.id, reference_dataset_id, assumed_tick_spacing_mm=assumed_tick_mm,
        )
        return Response({'status': 'queued', 'dataset': dataset.name, 'metric': 'mm2'}, status=status.HTTP_202_ACCEPTED)

    @action(detail=True, methods=['get'], permission_classes=[IsSyntheticToolsEnabled], url_path='review-queue')
    def review_queue(self, request, pk=None):
        """Return images flagged for human review, grouped by issue category."""
        from .review import get_review_flags, REVIEW_FLAGS, REVIEW_FLAG_LABELS, REVIEW_FLAG_DESCRIPTIONS
        from .serializers import ImageSerializer
        from .models import Image
        dataset = self.get_object()
        flags = get_review_flags(dataset.id)
        categories = []
        total = 0
        total_problems = 0
        for key in REVIEW_FLAGS:
            imgs = flags.get(key, [])
            total += len(imgs)
            if key != 'pending_review':
                total_problems += len(imgs)
            categories.append({
                'key': key,
                'label': REVIEW_FLAG_LABELS[key],
                'description': REVIEW_FLAG_DESCRIPTIONS[key],
                'count': len(imgs),
                'items': ImageSerializer(imgs, many=True, context={'request': request}).data,
            })
        # Plus a summary of already-resolved counts so the queue can show progress.
        resolved_counts = {}
        for status_key in ('unreviewed', 'reviewed', 'excluded'):
            resolved_counts[status_key] = Image.objects.filter(dataset=dataset, review_status=status_key).count()

        # Pipeline progress stats - powers the guided pipeline card on the
        # dataset detail page. Denominators take source_kind into account so
        # MASKED images aren't flagged as "missing OCR" (they can't carry a
        # catalog label by construction) and PROCESSED images aren't flagged
        # as "missing calibration" (the scale bar is cropped out of those).
        from django.db.models import Q
        total_images = Image.objects.filter(dataset=dataset).count()
        # OCR-eligible: source_kind == 'raw' OR NULL (unknown source defaults
        # to "we'll try"). Masked and processed are explicitly excluded.
        ocr_eligible = Image.objects.filter(dataset=dataset).filter(
            Q(source_kind='raw') | Q(source_kind__isnull=True)
        )
        # Calibration-eligible: anything that hasn't been explicitly tagged
        # as 'processed' (since processed has the scale bar removed).
        calib_eligible = Image.objects.filter(dataset=dataset).exclude(source_kind='processed')
        derived = Dataset.objects.filter(source_dataset=dataset).order_by('-id')
        pipeline_stats = {
            'total_images': total_images,
            'ocr_eligible_count':   ocr_eligible.count(),
            'calib_eligible_count': calib_eligible.count(),
            'with_ocr':         ocr_eligible.filter(museum_specimen_id__isnull=False).count(),
            'with_calibration': calib_eligible.filter(mm_per_pixel__isnull=False).count(),
            'with_completeness': calib_eligible.filter(completeness_mm2__isnull=False).count(),
            'source_kind_counts': {
                'raw':       Image.objects.filter(dataset=dataset, source_kind='raw').count(),
                'masked':    Image.objects.filter(dataset=dataset, source_kind='masked').count(),
                'processed': Image.objects.filter(dataset=dataset, source_kind='processed').count(),
                'unknown':   Image.objects.filter(dataset=dataset, source_kind__isnull=True).count(),
            },
            'derived_datasets_count': derived.count(),
            'derived_datasets': [
                {'id': d.id, 'name': d.name, 'transformation_type': d.transformation_type}
                for d in derived[:10]
            ],
        }

        return Response({
            'dataset_id': dataset.id,
            'dataset_name': dataset.name,
            # Backwards-compatible: total_flagged counts ALL queue items
            # (problems + pending review). total_problems counts only the
            # auto-detected issue categories so the panel can distinguish
            # "needs decision" from "broken".
            'total_flagged': total,
            'total_problems': total_problems,
            'total_pending_review': total - total_problems,
            'categories': categories,
            'review_status_counts': resolved_counts,
            'pipeline_stats': pipeline_stats,
        })

    @action(detail=True, methods=['post'], permission_classes=[IsSyntheticToolsEnabled], url_path='review-bulk')
    def review_bulk(self, request, pk=None):
        """Apply a review action to many images in this dataset at once."""
        from .review import apply_review_action
        from .models import Image
        dataset = self.get_object()
        action_name = request.data.get('action')
        image_ids = request.data.get('image_ids') or []
        notes = request.data.get('notes') or None
        if not action_name:
            return Response({'error': 'action is required'}, status=status.HTTP_400_BAD_REQUEST)
        if not image_ids:
            return Response({'error': 'image_ids is required and must not be empty'}, status=status.HTTP_400_BAD_REQUEST)
        images = Image.objects.filter(dataset=dataset, id__in=image_ids).select_related('label')
        succeeded = 0
        failed = []
        for img in images:
            ok, err = apply_review_action(img, action_name, user=request.user, notes=notes)
            if ok:
                succeeded += 1
            else:
                failed.append({'image_id': img.id, 'error': err})
        return Response({
            'status': 'ok',
            'succeeded': succeeded,
            'failed': failed,
            'requested_count': len(image_ids),
        })

    @action(detail=True, methods=['post'], permission_classes=[IsSyntheticToolsEnabled], url_path='extract-museum-metadata')
    def extract_museum_metadata(self, request, pk=None):
        """Run the FLMNH catalog-label OCR pass on every image in this dataset."""
        dataset = self.get_object()
        extract_museum_metadata_for_dataset.delay(dataset.id)
        return Response({'status': 'queued', 'dataset': dataset.name, 'task': 'extract_museum_metadata'}, status=status.HTTP_202_ACCEPTED)

    @action(detail=True, methods=['post'], permission_classes=[IsSyntheticToolsEnabled], url_path='emit-processed')
    def emit_processed(self, request, pk=None):
        """
        Queue the Phase 2 image curation step: produce a new derived dataset
        of 384x384 PROCESSED images from this source. Body params:
          mode: 'A' (uniform pixel density) or 'B' (scale-preserving). Default 'A'.
          target_size: edge length of the PROCESSED square. Default 384.
          mode_b_px_per_mm: pixels per millimetre for Mode B. Default 6.0.
          name_suffix: optional override for the derived dataset's name suffix.
        """
        dataset = self.get_object()
        mode = (request.data.get('mode') or 'A').upper()
        if mode not in ('A', 'B'):
            return Response({'error': "mode must be 'A' or 'B'"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            target_size = int(request.data.get('target_size', 384))
            mode_b_px_per_mm = float(request.data.get('mode_b_px_per_mm', 6.0))
        except (TypeError, ValueError):
            return Response({'error': 'invalid numeric parameter'}, status=status.HTTP_400_BAD_REQUEST)
        name_suffix = request.data.get('name_suffix') or None

        emit_processed_dataset.delay(
            dataset.id,
            mode=mode,
            target_size=target_size,
            mode_b_px_per_mm=mode_b_px_per_mm,
            name_suffix=name_suffix,
        )
        return Response(
            {
                'status': 'queued',
                'source_dataset': dataset.name,
                'mode': mode,
                'target_size': target_size,
                'mode_b_px_per_mm': mode_b_px_per_mm if mode == 'B' else None,
            },
            status=status.HTTP_202_ACCEPTED,
        )

    @action(detail=False, methods=['get'], permission_classes=[IsSyntheticToolsEnabled])
    def fracture_profiles(self, request):
        """Return the fracture profiles JSON for the UI."""
        profiles = load_fracture_profiles()
        return Response(profiles)

    @action(detail=True, methods=['post'], permission_classes=[IsSyntheticToolsEnabled])
    def generate_synthetic(self, request, pk=None):
        dataset = self.get_object()
        bins = request.data.get('completeness_bins', [0.8, 0.6, 0.4])
        images_per_bin = int(request.data.get('images_per_bin', 10))
        use_all_sources = bool(request.data.get('use_all_sources', False))
        name = request.data.get('name', f"Synthetic from {dataset.name}")
        profile_overrides = request.data.get('profile_overrides')
        augmentations = request.data.get('augmentations')
        target_study_id = request.data.get('target_study_id')

        # Resolve target study: the study the new dataset should live in.
        # Defaults to the source dataset's study. Must be a study the user can
        # edit (superusers bypass).
        target_study = dataset.study
        if target_study_id is not None:
            try:
                target_study = Study.objects.get(pk=int(target_study_id))
            except (Study.DoesNotExist, TypeError, ValueError):
                return Response({'error': 'Invalid target_study_id'}, status=status.HTTP_400_BAD_REQUEST)
            if not request.user.is_superuser:
                from feature_extractor.permissions import effective_role
                role = effective_role(request.user, target_study)
                if role not in ('owner', 'editor'):
                    return Response({'error': 'No edit permission on target study'}, status=status.HTTP_403_FORBIDDEN)

        # Handle name collisions
        base_name = name
        counter = 1
        while Dataset.objects.filter(name=name).exists():
            counter += 1
            name = f"{base_name} ({counter})"

        # Determine transformation type
        has_augmentations = augmentations and any(v for v in (augmentations or {}).values())
        transform_type = 'fracture+augmentation' if has_augmentations else 'fracture'

        # Create dataset record synchronously so we can return the ID
        syn_dataset = Dataset.objects.create(
            study=target_study,
            name=name,
            description=f"Synthetic fragments from {dataset.name}. Bins: {bins}",
            resolution=dataset.resolution,
            base=False,
            for_testing=False,
            synthetic=True,
            source_dataset=dataset,
            transformation_type=transform_type,
            generation_config={
                'completeness_bins': bins,
                'images_per_bin': images_per_bin,
                'use_all_sources': use_all_sources,
                'profile_overrides': profile_overrides,
                'augmentations': augmentations,
            },
        )
        syn_dataset.labels.set(dataset.labels.all())

        # Queue Celery task to populate the dataset with images
        generate_synthetic_dataset.delay(
            syn_dataset.id, bins, images_per_bin, profile_overrides, augmentations,
            use_all_sources=use_all_sources,
        )
        return Response({'status': 'queued', 'name': name, 'dataset_id': syn_dataset.id}, status=status.HTTP_202_ACCEPTED)


class LabelViewSet(viewsets.ModelViewSet):
    queryset = Label.objects.all()
    serializer_class = LabelSerializer
    filter_backends = (DjangoFilterBackend,)
    filterset_fields = ['datasets__id']

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['dataset_id'] = self.request.query_params.get('datasets__id')
        return context

    def partial_update(self, request, *args, **kwargs):
        label = self.get_object()
        locked_dataset = label.datasets.filter(
            Q(training_sessions__status='Completed') | Q(tests__status='Completed')
        ).distinct().first()

        if locked_dataset:
            return Response({'error': dataset_lock_reason(locked_dataset)}, status=status.HTTP_409_CONFLICT)

        return super().partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        label = self.get_object()
        locked_dataset = label.datasets.filter(
            Q(training_sessions__status='Completed') | Q(tests__status='Completed')
        ).distinct().first()

        if locked_dataset:
            return Response({'error': dataset_lock_reason(locked_dataset)}, status=status.HTTP_409_CONFLICT)

        return super().destroy(request, *args, **kwargs)


class ImageViewSet(viewsets.ModelViewSet):
    queryset = Image.objects.all()
    serializer_class = ImageSerializer
    filter_backends = (DjangoFilterBackend,)
    filterset_fields = ['dataset', 'label']
    pagination_class = ImagePagination

    def get_queryset(self):
        qs = super().get_queryset().select_related('source_image')
        search = self.request.query_params.get("search", "").strip()
        if search:
            qs = qs.filter(image__icontains=search)
        return qs

    def create(self, request, *args, **kwargs):
        try:
            dataset = Dataset.objects.get(id=request.data.get('dataset'))
            if dataset_is_locked(dataset):
                return Response({'error': dataset_lock_reason(dataset)}, status=status.HTTP_409_CONFLICT)

            label = Label.objects.get(id=request.data.get('label'))
            images = request.FILES.getlist('image')

            target_resolution = get_target_resolution(dataset)
            new_images = []
            with transaction.atomic():
                for image in images:
                    resized_image, _meta = resize_to_dataset(image, target_resolution)
                    img_instance = Image.objects.create(dataset=dataset, label=label, image=resized_image)
                    new_images.append(img_instance)

                create_dataset_archive.delay(dataset.id)

            serializer = self.get_serializer(new_images, many=True)
            return Response(serializer.data)
        except ObjectDoesNotExist as e:
            logger.error(f'Object does not exist: {str(e)}')
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            logger.error(f'Unexpected error occurred: {str(e)}')
            return Response({'error': 'Unexpected error occurred: ' + str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    def update(self, request, *args, **kwargs):
        image = self.get_object()
        if image.dataset and dataset_is_locked(image.dataset):
            return Response({'error': dataset_lock_reason(image.dataset)}, status=status.HTTP_409_CONFLICT)
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        image = self.get_object()
        if image.dataset and dataset_is_locked(image.dataset):
            return Response({'error': dataset_lock_reason(image.dataset)}, status=status.HTTP_409_CONFLICT)
        return super().partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        image = self.get_object()
        if image.dataset and dataset_is_locked(image.dataset):
            return Response({'error': dataset_lock_reason(image.dataset)}, status=status.HTTP_409_CONFLICT)
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=['post'], permission_classes=[IsSyntheticToolsEnabled], url_path='review')
    def review(self, request, pk=None):
        """Apply a single-image review action and audit-log it."""
        from .review import apply_review_action
        image = self.get_object()
        action_name = request.data.get('action')
        notes = request.data.get('notes') or None
        if not action_name:
            return Response({'error': 'action is required'}, status=status.HTTP_400_BAD_REQUEST)
        ok, err = apply_review_action(image, action_name, user=request.user, notes=notes)
        if not ok:
            return Response({'error': err}, status=status.HTTP_400_BAD_REQUEST)
        # Return the freshly-saved row so the UI can update in place.
        return Response(ImageSerializer(image, context={'request': request}).data)

    @action(detail=True, methods=['get'], permission_classes=[IsSyntheticToolsEnabled], url_path='review-history')
    def review_history(self, request, pk=None):
        """Return the audit log for one image."""
        from .models import ImageReviewEvent
        image = self.get_object()
        events = ImageReviewEvent.objects.filter(image=image).select_related('user').order_by('-created_at')
        out = []
        for ev in events:
            out.append({
                'id': ev.id,
                'action': ev.action,
                'previous_status': ev.previous_status,
                'new_status': ev.new_status,
                'notes': ev.notes,
                'metadata': ev.metadata,
                'created_at': ev.created_at.isoformat(),
                'user': ev.user.username if ev.user else None,
            })
        return Response({'image_id': image.id, 'events': out})

    @action(detail=True, methods=['post'], permission_classes=[IsSyntheticToolsEnabled])
    def augmentation_preview(self, request, pk=None):
        """Generate N augmented preview images for a single image."""
        import os
        import uuid
        from django.conf import settings
        from .augmentation_preview import generate_preview

        image = self.get_object()
        config = {k: v for k, v in request.data.items() if k != 'count'}
        n = int(request.data.get('count', 6))
        n = min(n, 20)  # Cap at 20

        try:
            previews = generate_preview(image.image.path, config, n)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        preview_dir = os.path.join(settings.MEDIA_ROOT, 'augmentation_previews')
        os.makedirs(preview_dir, exist_ok=True)

        urls = []
        for img_bytes in previews:
            filename = f"preview_{uuid.uuid4().hex}.png"
            filepath = os.path.join(preview_dir, filename)
            with open(filepath, 'wb') as f:
                f.write(img_bytes)
            urls.append(f"/media/augmentation_previews/{filename}")

        base_url = getattr(settings, "BASE_URL", "").rstrip("/")
        original_url = base_url + image.image.url

        return Response({
            'original': original_url,
            'previews': [base_url + u for u in urls],
        })

    @action(detail=True, methods=['get'], permission_classes=[IsSyntheticToolsEnabled])
    def segmentation(self, request, pk=None):
        """Return the binary segmentation mask as a PNG image."""
        from django.http import HttpResponse
        from .segmentation import segment_tooth, get_mask_as_image
        import io

        image = self.get_object()
        try:
            mask = segment_tooth(image.image.path)
            mask_img = get_mask_as_image(mask)
            buf = io.BytesIO()
            mask_img.save(buf, format='PNG')
            buf.seek(0)
            return HttpResponse(buf.getvalue(), content_type='image/png')
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=True, methods=['post'], permission_classes=[IsSyntheticToolsEnabled])
    def regenerate(self, request, pk=None):
        """Regenerate a single synthetic image from its source."""
        from .synthetic_fracture import generate_synthetic_fragment
        from .segmentation import segment_tooth, compute_tooth_area
        from django.core.files.base import ContentFile
        import io
        import numpy as np

        image = self.get_object()
        if not image.source_image:
            return Response({'error': 'Not a synthetic image'}, status=status.HTTP_400_BAD_REQUEST)

        src = image.source_image
        target = image.target_completeness or 0.8
        label_name = image.label.name if image.label else 'default'

        # Load species profile if dataset has generation_config
        profile_override = None
        if image.dataset and image.dataset.generation_config:
            overrides = image.dataset.generation_config.get('profile_overrides')
            if overrides and label_name in overrides:
                profile_override = overrides[label_name]

        try:
            # Derive acceptable range from the dataset's generation config
            bins = []
            if image.dataset and image.dataset.generation_config:
                bins = image.dataset.generation_config.get('completeness_bins', [])
            absolute_min = (min(bins) - 0.10) if bins else 0.10
            min_acceptable = max(target - 0.25, absolute_min, 0.05)
            max_acceptable = min(target + 0.20, 0.98)
            max_attempts = 50

            result_img = None
            actual_compl = None
            for attempt in range(max_attempts):
                # Boost target slightly to compensate for morphological cleanup shrinkage
                boost = np.random.uniform(0.02, 0.08)
                result_img, actual_compl = generate_synthetic_fragment(
                    src.image.path,
                    target_completeness=min(target + boost, 0.98),
                    species=label_name,
                    profile_override=profile_override,
                )
                if min_acceptable <= actual_compl <= max_acceptable:
                    break

            if actual_compl is None or actual_compl > max_acceptable or actual_compl < min_acceptable:
                return Response(
                    {'error': f'Could not generate within range after {max_attempts} attempts (got {actual_compl:.0%})'},
                    status=status.HTTP_422_UNPROCESSABLE_ENTITY,
                )

            buf = io.BytesIO()
            result_img.save(buf, format='PNG')
            buf.seek(0)

            # Compute tooth_area from source
            src_area = src.tooth_area
            if src_area is None:
                mask = segment_tooth(src.image.path)
                src_area = compute_tooth_area(mask)
                src.tooth_area = src_area
                src.save(update_fields=['tooth_area'])

            result_area = int(actual_compl * src_area) if src_area else None

            # Replace the image file
            old_name = image.image.name.split('/')[-1]
            image.image.save(old_name, ContentFile(buf.getvalue()), save=False)
            image.completeness = actual_compl
            image.tooth_area = result_area
            image.save(update_fields=['image', 'completeness', 'tooth_area'])

            return Response(ImageSerializer(image, context={'request': request}).data)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=False, methods=['post'])
    def bulk_delete(self, request):
        dataset_id = request.data.get('dataset_id')
        label_id = request.data.get('label_id')
        image_ids = request.data.get('image_ids', [])
        delete_all = bool(request.data.get('delete_all', False))

        if not dataset_id or not label_id:
            return Response({'error': 'dataset_id and label_id are required.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            dataset = Dataset.objects.get(id=dataset_id)
        except Dataset.DoesNotExist:
            return Response({'error': 'Dataset not found.'}, status=status.HTTP_404_NOT_FOUND)

        if dataset_is_locked(dataset):
            return Response({'error': dataset_lock_reason(dataset)}, status=status.HTTP_409_CONFLICT)

        queryset = Image.objects.filter(dataset_id=dataset_id, label_id=label_id)
        if not delete_all:
            if not image_ids:
                return Response({'error': 'image_ids is required unless delete_all is true.'}, status=status.HTTP_400_BAD_REQUEST)
            queryset = queryset.filter(id__in=image_ids)

        deleted_count = queryset.count()
        queryset.delete()
        create_dataset_archive.delay(dataset.id)

        return Response({'deleted_count': deleted_count}, status=status.HTTP_200_OK)


class GenerateDatasetsViewSet(viewsets.ViewSet):

    def create(self, request, *args, **kwargs):
        formData = request.data

        newDataset = {
            'study': formData.get('study'),
            'name': formData.get('name'),
            'labels': formData['labels'],
            'description': formData.get('description'),
            'resolution': formData.get('resolution'),
            'base': False,
            'for_testing': formData.get('for_testing'),
            'sample_number': int(formData.get('sample_number')),
        }
        logger.info(newDataset)

        try:
            with transaction.atomic():
                study_instance = Study.objects.get(id=newDataset['study'])

                dataset = Dataset.objects.create(
                    study=study_instance,
                    name=newDataset['name'],
                    description=newDataset['description'],
                    resolution=newDataset['resolution'],
                    base=newDataset['base'],
                    for_testing=newDataset['for_testing'],
                )

                labels = Label.objects.filter(id__in=newDataset['labels'])
                dataset.labels.set(labels)

                if newDataset['for_testing']:
                    self._create_testing_dataset(dataset, labels, newDataset['sample_number'])
                else:
                    self._create_non_testing_dataset(dataset, labels, newDataset['sample_number'])

                serializer = DatasetSerializer(dataset)
                transaction.on_commit(lambda: self._trigger_create_dataset_archive(dataset.id))
                return Response(serializer.data, status=status.HTTP_201_CREATED)
        except Exception as e:
            logger.error(f'Error creating dataset: {str(e)}')
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    def _trigger_create_dataset_archive(self, dataset_id):
        create_dataset_archive.delay(dataset_id)

    def _create_testing_dataset(self, dataset, labels, sample_number):
        base_images = Image.objects.filter(dataset__base=True, used_for_testing=False)

        for label in labels:
            label_images = base_images.filter(label=label, dataset__study=dataset.study)
            selected_images = random.sample(list(label_images), sample_number)

            for image in selected_images:
                image.used_for_testing = True
                image.save()
                dataset.images.add(image)

    def _create_non_testing_dataset(self, dataset, labels, sample_number):
        base_images = Image.objects.filter(dataset__base=True, used_for_training=False, dataset__study=dataset.study)
        testing_images = Image.objects.filter(used_for_testing=True, dataset__study=dataset.study)
        training_datasets = Dataset.objects.filter(base=False, for_testing=False, study=dataset.study).order_by('-created_at')

        for label in labels:
            used_images = set(testing_images.filter(label=label).values_list('id', flat=True))
            selected_images = []

            if training_datasets.exists():
                latest_dataset = training_datasets.first()
                latest_images = Image.objects.filter(dataset=latest_dataset, label=label)
                selected_images = list(latest_images)

            if len(selected_images) < sample_number:
                remaining_images = base_images.exclude(id__in=used_images).filter(label=label)
                new_images = random.sample(list(remaining_images), sample_number - len(selected_images))
                selected_images.extend(new_images)

            for image in selected_images:
                image.used_for_training = True
                image.save()
                dataset.images.add(image)

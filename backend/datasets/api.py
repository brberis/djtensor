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
from django.db.models import Aggregate, FloatField, Q
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
    build_brokenness_reference_for_dataset,
    compute_brokenness_for_dataset,
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


class Median(Aggregate):
    """Median of a numeric column, via Postgres percentile_cont.

    Django ships no Median. It matters here because tooth measurements are
    heavily right-skewed within a species: Otodus megalodon complete-tooth
    areas span 93x, and its mean sits 58% above its median, so a handful of
    very large specimens drag a mean away from anything typical. The species
    reference used for completeness is a median for the same reason, and a
    summary that reported a mean beside it would be quoting two different
    centres for the same population.
    """
    function = 'PERCENTILE_CONT'
    name = 'median'
    output_field = FloatField()
    template = "%(function)s(0.5) WITHIN GROUP (ORDER BY %(expressions)s)"


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

    @action(detail=True, methods=['post'], permission_classes=[IsSyntheticToolsEnabled], url_path='build-brokenness-reference')
    def build_brokenness_reference(self, request, pk=None):
        """Build Katie's per-species mean-mask reference assets for this dataset.

        Optional body params:
          n_quantiles: int, default 4
          threshold:   float, default 0.2
        """
        dataset = self.get_object()
        try:
            n_quantiles = int(request.data.get('n_quantiles', 4))
            threshold = float(request.data.get('threshold', 0.2))
        except (TypeError, ValueError):
            return Response({'error': 'invalid numeric parameter'}, status=status.HTTP_400_BAD_REQUEST)
        build_brokenness_reference_for_dataset.delay(dataset.id, n_quantiles=n_quantiles, threshold=threshold)
        return Response(
            {'status': 'queued', 'dataset': dataset.name, 'task': 'build_brokenness_reference',
             'n_quantiles': n_quantiles, 'threshold': threshold},
            status=status.HTTP_202_ACCEPTED,
        )

    @action(detail=True, methods=['post'], permission_classes=[IsSyntheticToolsEnabled], url_path='compute-brokenness')
    def compute_brokenness(self, request, pk=None):
        """Run Katie's mean-shape brokenness pass on every image in this dataset.

        Optional body params:
          reference_dataset_id: int (defaults to this dataset)
        """
        dataset = self.get_object()
        ref_id = request.data.get('reference_dataset_id')
        compute_brokenness_for_dataset.delay(dataset.id, ref_id)
        return Response(
            {'status': 'queued', 'dataset': dataset.name, 'task': 'compute_brokenness',
             'reference_dataset_id': ref_id or dataset.id},
            status=status.HTTP_202_ACCEPTED,
        )

    @action(detail=True, methods=['get'], permission_classes=[IsSyntheticToolsEnabled], url_path='scale-summary')
    def scale_summary(self, request, pk=None):
        """Coverage summary for the Summary tab: how much of this dataset can
        actually be measured in millimetres, and where the losses are.

        Every bucket carries the filter that produced it, so the UI can link
        each number straight into a filtered image list. A number the team
        cannot drill into is a number they cannot act on.
        """
        from django.db.models import Avg, Count, Max, Min, Q
        from .review import get_review_flags, LOW_RESOLUTION_PX, REVIEW_FLAGS, REVIEW_FLAG_LABELS

        dataset = self.get_object()
        images = Image.objects.filter(dataset=dataset)
        total = images.count()

        calibrated = Q(mm_per_pixel__isnull=False)
        with_ocr = Q(museum_specimen_id__isnull=False)
        with_completeness = Q(completeness_mm2__isnull=False)

        # Per species. Median is not portable across DB backends, so report
        # the mean plus the range, which is enough to spot a species whose
        # calibration has gone wrong.
        by_species = []
        rows = (
            images.values('label_id', 'label__name')
            .annotate(
                total=Count('id'),
                calibrated=Count('id', filter=calibrated),
                ocr=Count('id', filter=with_ocr),
                completeness=Count('id', filter=with_completeness),
                median_len=Median('tooth_major_axis_mm'),
                median_area=Median('tooth_area_mm2'),
                min_len=Min('tooth_major_axis_mm'),
                max_len=Max('tooth_major_axis_mm'),
            )
            .order_by('label__name')
        )
        # Completeness distribution per species, in the same 20% bands Alexa
        # bins by qualitatively, so the two can be read side by side. Counts
        # come from one query rather than a per-species loop.
        bin_edges = ((0.0, 0.2), (0.2, 0.4), (0.4, 0.6), (0.6, 0.8), (0.8, 1.01))
        bins_by_label = {}
        values_by_label = {}
        for label_id, compl in (images
                                .filter(completeness_mm2__isnull=False)
                                .values_list('label_id', 'completeness_mm2')):
            slot = bins_by_label.setdefault(label_id, [0] * len(bin_edges))
            value = float(compl)
            values_by_label.setdefault(label_id, []).append(value)
            for i, (lo, hi) in enumerate(bin_edges):
                if lo <= value < hi:
                    slot[i] += 1
                    break

        # Median completeness per species. Median for the same reason the
        # reference is one: the distributions are skewed, so a mean would name
        # a value that describes few of the specimens.
        import statistics as _stats
        median_completeness = {
            label_id: round(_stats.median(vals) * 100, 1)
            for label_id, vals in values_by_label.items() if vals
        }

        for r in rows:
            by_species.append({
                'label_id': r['label_id'],
                'completeness_bins': bins_by_label.get(r['label_id']) or [0] * len(bin_edges),
                'median_completeness_pct': median_completeness.get(r['label_id']),
                'label': r['label__name'],
                'total': r['total'],
                'calibrated': r['calibrated'],
                'uncalibrated': r['total'] - r['calibrated'],
                'calibrated_pct': round(r['calibrated'] / r['total'] * 100, 1) if r['total'] else 0,
                'with_ocr': r['ocr'],
                'with_completeness': r['completeness'],
                'median_tooth_mm': round(r['median_len'], 1) if r['median_len'] else None,
                # Area is what completeness divides by, so it belongs on the
                # page beside the length rather than being implied. Length
                # stays the headline: published size ranges for these species
                # are crown heights, so it is the figure anyone can sanity
                # check, while an area in mm2 checks against nothing.
                'median_area_mm2': round(r['median_area']) if r['median_area'] else None,
                'min_tooth_mm': round(r['min_len'], 1) if r['min_len'] else None,
                'max_tooth_mm': round(r['max_len'], 1) if r['max_len'] else None,
                'filter': {'label': r['label_id']},
            })

        # Review flags double as the "why did it fail" breakdown.
        flags = get_review_flags(dataset.id)
        flag_rows = [{
            'key': key,
            'label': REVIEW_FLAG_LABELS[key],
            'count': len(flags.get(key, [])),
            'image_ids': [i.id for i in flags.get(key, [])][:500],
        } for key in REVIEW_FLAGS]

        calibrated_count = images.filter(calibrated).count()
        return Response({
            'dataset_id': dataset.id,
            'dataset_name': dataset.name,
            'resolution': dataset.resolution,
            'low_resolution_threshold_px': LOW_RESOLUTION_PX,
            'totals': {
                'images': total,
                'calibrated': calibrated_count,
                'uncalibrated': total - calibrated_count,
                'calibrated_pct': round(calibrated_count / total * 100, 1) if total else 0,
                'with_ocr': images.filter(with_ocr).count(),
                'with_completeness': images.filter(with_completeness).count(),
                'reviewed': images.filter(review_status='reviewed').count(),
                'excluded': images.filter(review_status='excluded').count(),
                'unreviewed': images.filter(review_status='unreviewed').count(),
            },
            'by_species': by_species,
            'by_flag': flag_rows,
        })

    @action(detail=True, methods=['get'], permission_classes=[IsSyntheticToolsEnabled], url_path='review-queue')
    def review_queue(self, request, pk=None):
        """Return images flagged for human review, grouped by issue category."""
        from .review import get_review_flags, REVIEW_FLAGS, REVIEW_FLAG_LABELS, REVIEW_FLAG_DESCRIPTIONS
        from .serializers import ImageSerializer
        from .models import Image
        dataset = self.get_object()

        # The dataset detail page wants the counts and the pipeline stats; it
        # never reads `items`. Serialising every flagged image for it sent
        # 4.5 MB of JSON that the browser then had to parse and throw away,
        # which was most of that page's load time. `?counts_only=1` returns
        # the same shape with empty item lists.
        counts_only = request.query_params.get('counts_only') in ('1', 'true', 'yes')

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
                'items': ([] if counts_only
                          else ImageSerializer(imgs, many=True, context={'request': request}).data),
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

    @action(detail=True, methods=['post'], permission_classes=[IsSyntheticToolsEnabled], url_path='manual-scale')
    def manual_scale(self, request, pk=None):
        """Set mm/px from two points a reviewer clicked on a known reference.

        Automatic detection cannot read every frame: a coin instead of a card,
        a card occluded by its label, a scale design nobody has seen. Rather
        than push the detector into guessing on those, a person marks the two
        ends of something whose real size is known and says what it is.

        Body:
          x1, y1, x2, y2   point coordinates in ORIGINAL image pixels
          reference_mm     real-world distance between them
          reference_label  what was measured, e.g. "US nickel", stored for audit

        Returns the updated image plus the resulting tooth size, so the caller
        can show the reviewer what their measurement implies before they move
        on. A calibration that produces an absurd tooth is far easier to catch
        by looking at the millimetres than at mm/px.
        """
        import math
        from .models import ImageReviewEvent
        from .scale_calibration import detect_tooth_only

        image = self.get_object()
        if image.dataset and dataset_is_locked(image.dataset):
            return Response({'error': dataset_lock_reason(image.dataset)},
                            status=status.HTTP_409_CONFLICT)
        try:
            x1 = float(request.data['x1']); y1 = float(request.data['y1'])
            x2 = float(request.data['x2']); y2 = float(request.data['y2'])
            reference_mm = float(request.data['reference_mm'])
        except (KeyError, TypeError, ValueError):
            return Response({'error': 'x1, y1, x2, y2 and reference_mm are required numbers'},
                            status=status.HTTP_400_BAD_REQUEST)
        if reference_mm <= 0:
            return Response({'error': 'reference_mm must be positive'},
                            status=status.HTTP_400_BAD_REQUEST)

        distance_px = math.hypot(x2 - x1, y2 - y1)
        if distance_px < 5:
            return Response({'error': 'the two points are too close together to measure'},
                            status=status.HTTP_400_BAD_REQUEST)

        mm_per_pixel = reference_mm / distance_px
        reference_label = (request.data.get('reference_label') or 'manual measurement')[:120]

        # Snapshot what is being replaced so undo is a restore rather than a
        # recomputation. Re-running the detector to undo costs about twenty
        # seconds and, on the frames where anyone actually reaches for the
        # manual tool, usually concludes what it concluded the first time:
        # nothing.
        previous_state = {
            'mm_per_pixel': float(image.mm_per_pixel) if image.mm_per_pixel else None,
            'scale_bar_detected': bool(image.scale_bar_detected),
            'scale_bar_source': image.scale_bar_source or '',
            'tooth_bbox': list(image.tooth_bbox) if image.tooth_bbox else None,
            'tooth_area_mm2': float(image.tooth_area_mm2) if image.tooth_area_mm2 else None,
            'tooth_width_mm': float(image.tooth_width_mm) if image.tooth_width_mm else None,
            'tooth_height_mm': float(image.tooth_height_mm) if image.tooth_height_mm else None,
            'tooth_major_axis_mm': float(image.tooth_major_axis_mm) if image.tooth_major_axis_mm else None,
            'tooth_minor_axis_mm': float(image.tooth_minor_axis_mm) if image.tooth_minor_axis_mm else None,
        }

        # Reuse the existing segmentation to convert the new scale into the
        # tooth measurements, so a manual calibration produces exactly the same
        # fields as an automatic one and nothing downstream needs to special
        # case it.
        tooth = None
        try:
            # Tooth outline only. The full detector would spend around twenty
            # seconds hunting for a scale bar we are in the middle of
            # replacing by hand, which is dead time in front of the reviewer.
            tooth = detect_tooth_only(image.image.path)
        except Exception:
            pass

        image.mm_per_pixel = mm_per_pixel
        image.scale_bar_detected = True
        image.scale_bar_source = 'manual'
        if tooth is not None:
            tx0, ty0, tx1, ty1 = tooth.bbox
            image.tooth_bbox = list(tooth.bbox)
            image.tooth_area_mm2 = float(tooth.area_px) * mm_per_pixel ** 2
            image.tooth_width_mm = (tx1 - tx0 + 1) * mm_per_pixel
            image.tooth_height_mm = (ty1 - ty0 + 1) * mm_per_pixel
            # Anatomical length/width, not the size-sorted major/minor:
            # on a broad tooth the longer axis is the WIDTH.
            length = float(tooth.length_px or 0.0) * mm_per_pixel
            width = float(tooth.width_px or 0.0) * mm_per_pixel
            image.tooth_major_axis_mm = length if length > 0 else None
            image.tooth_minor_axis_mm = width if width > 0 else None
        # Completeness is relative to a species reference and is now stale.
        image.completeness_mm2 = None
        image.save(update_fields=[
            'mm_per_pixel', 'scale_bar_detected', 'scale_bar_source', 'tooth_bbox',
            'tooth_area_mm2', 'tooth_width_mm', 'tooth_height_mm',
            'tooth_major_axis_mm', 'tooth_minor_axis_mm', 'completeness_mm2',
        ])

        ImageReviewEvent.objects.create(
            image=image,
            user=request.user if request.user.is_authenticated else None,
            action='manual_scale',
            previous_status=image.review_status,
            new_status=image.review_status,
            notes='Scale set by hand from %s' % reference_label,
            metadata={
                'x1': x1, 'y1': y1, 'x2': x2, 'y2': y2,
                'distance_px': round(distance_px, 2),
                'reference_mm': reference_mm,
                'reference_label': reference_label,
                'mm_per_pixel': mm_per_pixel,
                'previous_state': previous_state,
            },
        )

        tooth_length_mm = None
        if tooth is not None:
            tx0, ty0, tx1, ty1 = tooth.bbox
            tooth_length_mm = round(max(tx1 - tx0 + 1, ty1 - ty0 + 1) * mm_per_pixel, 1)

        return Response({
            'image': ImageSerializer(image, context={'request': request}).data,
            'mm_per_pixel': mm_per_pixel,
            'distance_px': round(distance_px, 2),
            'tooth_length_mm': tooth_length_mm,
            'tooth_found': tooth is not None,
        })

    @action(detail=True, methods=['post'], permission_classes=[IsSyntheticToolsEnabled], url_path='reset-scale')
    def reset_scale(self, request, pk=None):
        """Undo a hand-set scale and go back to whatever the detector says.

        Setting a scale by hand means clicking two points, and a reviewer who
        clicks the wrong two has no way back otherwise: the manual value simply
        replaces whatever was there. This re-runs the detector and takes its
        answer, which is either the original automatic calibration or none at
        all, and either is recoverable.

        Refuses to touch anything that was not set by hand, so it can never
        quietly discard an automatic calibration.
        """
        from .models import ImageReviewEvent
        from .scale_calibration import detect_scale_bar

        image = self.get_object()
        if image.dataset and dataset_is_locked(image.dataset):
            return Response({'error': dataset_lock_reason(image.dataset)},
                            status=status.HTTP_409_CONFLICT)
        if image.scale_bar_source != 'manual':
            return Response(
                {'error': 'this image was not calibrated by hand, so there is nothing to undo'},
                status=status.HTTP_400_BAD_REQUEST)

        previous_mm_per_pixel = float(image.mm_per_pixel) if image.mm_per_pixel else None

        # Restore the snapshot the manual pass took, rather than recomputing.
        # Re-running the detector here costs about twenty seconds and, on the
        # frames a reviewer actually measures by hand, usually reaches the same
        # conclusion it reached the first time: no calibration.
        event = (ImageReviewEvent.objects
                 .filter(image=image, action='manual_scale')
                 .order_by('-id').first())
        snapshot = (event.metadata or {}).get('previous_state') if event else None

        if snapshot is not None:
            image.mm_per_pixel = snapshot.get('mm_per_pixel')
            image.scale_bar_detected = bool(snapshot.get('scale_bar_detected'))
            image.scale_bar_source = snapshot.get('scale_bar_source') or ''
            image.tooth_bbox = snapshot.get('tooth_bbox')
            image.tooth_area_mm2 = snapshot.get('tooth_area_mm2')
            image.tooth_width_mm = snapshot.get('tooth_width_mm')
            image.tooth_height_mm = snapshot.get('tooth_height_mm')
            image.tooth_major_axis_mm = snapshot.get('tooth_major_axis_mm')
            image.tooth_minor_axis_mm = snapshot.get('tooth_minor_axis_mm')
            restored_from = 'snapshot'
        else:
            # Older manual calibrations predate the snapshot, so fall back to
            # asking the detector again.
            result = None
            try:
                result = detect_scale_bar(image.image.path)
            except Exception:
                pass
            tooth = (next((b for b in result.blobs if b.classification == 'tooth'), None)
                     if result is not None else None)
            image.mm_per_pixel = result.mm_per_pixel if result else None
            image.scale_bar_detected = bool(result and result.mm_per_pixel)
            image.scale_bar_source = (result.calibration_method
                                      if result and result.mm_per_pixel else '')
            if tooth is not None and image.mm_per_pixel:
                mm = float(image.mm_per_pixel)
                tx0, ty0, tx1, ty1 = tooth.bbox
                image.tooth_bbox = list(tooth.bbox)
                image.tooth_area_mm2 = float(tooth.area_px) * mm ** 2
                image.tooth_width_mm = (tx1 - tx0 + 1) * mm
                image.tooth_height_mm = (ty1 - ty0 + 1) * mm
                # Anatomical length/width, not the size-sorted major/minor:
                # on a broad tooth the longer axis is the WIDTH.
                length = float(tooth.length_px or 0.0) * mm
                width = float(tooth.width_px or 0.0) * mm
                image.tooth_major_axis_mm = length if length > 0 else None
                image.tooth_minor_axis_mm = width if width > 0 else None
            else:
                image.tooth_area_mm2 = None
                image.tooth_width_mm = None
                image.tooth_height_mm = None
                image.tooth_major_axis_mm = None
                image.tooth_minor_axis_mm = None
            restored_from = 'detector'
        image.completeness_mm2 = None
        image.save(update_fields=[
            'mm_per_pixel', 'scale_bar_detected', 'scale_bar_source', 'tooth_bbox',
            'tooth_area_mm2', 'tooth_width_mm', 'tooth_height_mm',
            'tooth_major_axis_mm', 'tooth_minor_axis_mm', 'completeness_mm2',
        ])

        ImageReviewEvent.objects.create(
            image=image,
            user=request.user if request.user.is_authenticated else None,
            action='reset_manual_scale',
            previous_status=image.review_status,
            new_status=image.review_status,
            notes='Hand-set scale removed; reverted to automatic detection',
            metadata={
                'previous_mm_per_pixel': previous_mm_per_pixel,
                'mm_per_pixel': image.mm_per_pixel,
                'restored_from': restored_from,
            },
        )

        return Response({
            'image': ImageSerializer(image, context={'request': request}).data,
            'mm_per_pixel': image.mm_per_pixel,
            'recalibrated_automatically': bool(image.mm_per_pixel),
        })

    @action(detail=True, methods=['post'], permission_classes=[IsSyntheticToolsEnabled], url_path='find-circle')
    def find_circle(self, request, pk=None):
        """Measure a round reference the reviewer pointed at, without naming it.

        Clicking two edges of a coin by hand is fiddly and the error lands
        straight in mm/px. The machine can measure a circle far more precisely
        than a person can click one, so it does that part.

        What it deliberately does NOT do is decide WHICH coin. Telling a nickel
        from a quarter on a 600 px web photo runs at 14-20% error, and that
        error multiplies into every downstream area. So this returns geometry
        only; the reviewer supplies the identity and reads the resulting size
        back before committing. Machine measures, human identifies.

        Body: x, y in ORIGINAL image pixels, anywhere inside the coin.
        Returns the diameter and the two endpoints to hand to manual-scale.
        """
        from .scale_calibration import segment_blobs

        image = self.get_object()
        try:
            px = float(request.data['x'])
            py = float(request.data['y'])
        except (KeyError, TypeError, ValueError):
            return Response({'error': 'x and y are required numbers'},
                            status=status.HTTP_400_BAD_REQUEST)

        try:
            # Shapes only. Running the whole detector here spent about twenty
            # seconds looking for a scale bar before answering a question about
            # a circle, which read in the UI as a click that did nothing.
            blobs = segment_blobs(image.image.path)
        except Exception:
            return Response({'error': 'could not read this image'},
                            status=status.HTTP_400_BAD_REQUEST)

        # The click only has to land inside the blob; the reviewer is pointing
        # at a coin, not tracing it.
        hit = None
        for blob in blobs:
            bx0, by0, bx1, by1 = blob.bbox
            if bx0 <= px <= bx1 and by0 <= py <= by1:
                if hit is None or blob.area_px < hit.area_px:
                    hit = blob      # smallest containing blob: the coin, not the backdrop
        if hit is None:
            return Response({'error': 'nothing detected at that point - click on the coin itself, '
                                      'or set the two points by hand'},
                            status=status.HTTP_404_NOT_FOUND)

        bx0, by0, bx1, by1 = hit.bbox
        width = bx1 - bx0 + 1
        height = by1 - by0 + 1
        aspect = max(width, height) / float(max(1, min(width, height)))

        # A disc inscribed in its bounding box fills pi/4 = 0.785 of it. Check
        # the shape really is round before reporting a diameter, so a click on
        # the tooth or the label cannot be mistaken for a reference.
        if aspect > 1.25 or not (0.60 <= hit.fill_ratio <= 0.95):
            return Response({
                'error': 'that shape is not round enough to measure as a coin '
                         '(%dx%d, %.0f%% filled) - set the two points by hand'
                         % (width, height, hit.fill_ratio * 100),
            }, status=status.HTTP_400_BAD_REQUEST)

        diameter_px = (width + height) / 2.0
        cx = (bx0 + bx1) / 2.0
        cy = (by0 + by1) / 2.0
        return Response({
            'diameter_px': round(diameter_px, 1),
            'centre': {'x': round(cx, 1), 'y': round(cy, 1)},
            'x1': round(cx - diameter_px / 2.0, 1), 'y1': round(cy, 1),
            'x2': round(cx + diameter_px / 2.0, 1), 'y2': round(cy, 1),
            'bbox': [bx0, by0, bx1, by1],
            'fill_ratio': round(hit.fill_ratio, 3),
            'aspect_ratio': round(aspect, 3),
        })

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

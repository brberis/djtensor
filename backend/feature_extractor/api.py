# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: api.py
# Copyright (c) 2024

import random
import re
import string
from rest_framework import viewsets, serializers, status
from rest_framework.response import Response
from rest_framework.decorators import action
from django.db import transaction
from django.utils import timezone
from django.db.models import Count, Avg, Case, When, FloatField, F, Q
from .models import TFModel, Study, TrainingSession, Epoch, Test, TestResult, StudyMembership
from datasets.models import Dataset, Image
from .serializers import TFModelSerializer, StudySerializer, TrainingSessionSerializer, TrainingSessionListSerializer, EpochSerializer, TestSerializer, TestListSerializer, TestResultSerializer, StudyMembershipSerializer
from .permissions import effective_role, CanCreateInStudy
from django_filters.rest_framework import DjangoFilterBackend
from random import sample
from datasets.tasks import create_dataset_archive
from celery import chain
from .tasks import train_model, test_images, is_gpu_busy, process_next_pending



class TFModelViewSet(viewsets.ModelViewSet):
    queryset = TFModel.objects.all()
    serializer_class = TFModelSerializer

class StudyViewSet(viewsets.ModelViewSet):
    serializer_class = StudySerializer

    def get_queryset(self):
        if self.request.user.is_superuser:
            return Study.objects.all().order_by('display_order', '-created_at')
        user_studies = StudyMembership.objects.filter(
            user=self.request.user
        ).values_list('study_id', flat=True)
        return Study.objects.filter(id__in=user_studies).order_by('display_order', '-created_at')

    def perform_create(self, serializer):
        study = serializer.save()
        StudyMembership.objects.create(study=study, user=self.request.user, role='owner')

    def destroy(self, request, *args, **kwargs):
        study = self.get_object()
        role = effective_role(request.user, study)
        if role != 'owner':
            return Response({'error': 'Only the study owner can delete a study'}, status=status.HTTP_403_FORBIDDEN)
        return super().destroy(request, *args, **kwargs)

    @action(detail=False, methods=['post'])
    def reorder(self, request):
        """Reorder studies (superuser only)."""
        if not request.user.is_superuser:
            return Response({'error': 'Admin only'}, status=status.HTTP_403_FORBIDDEN)
        ordered_ids = request.data.get('order', [])
        for idx, study_id in enumerate(ordered_ids):
            Study.objects.filter(pk=study_id).update(display_order=idx + 1)
        return Response({'status': 'ok'})

    @action(detail=True, methods=['get'])
    def performance(self, request, pk=None):
        """Aggregated performance data for a single study."""
        from django.db.models import Count, Avg, Max, Min, F
        from collections import defaultdict

        study = self.get_object()

        sessions = (
            TrainingSession.objects
            .filter(study=study, status='Completed')
            .select_related('model', 'dataset')
            .prefetch_related('epochs', 'tests__results')
        )

        session_data = []
        all_tests = []
        model_accuracies = defaultdict(list)

        for sess in sessions:
            epochs = list(sess.epochs.all().order_by('number'))
            tests = list(sess.tests.all())

            # Per-class image counts for this session's dataset
            label_counts = (
                Image.objects
                .filter(dataset=sess.dataset)
                .values('label__name')
                .annotate(count=Count('id'))
            )
            images_per_class = {lc['label__name']: lc['count'] for lc in label_counts}
            total_images = sum(images_per_class.values())
            num_classes = len(images_per_class) or 1
            avg_images_per_class = total_images / num_classes

            epoch_data = [
                {
                    'number': e.number,
                    'accuracy': e.accuracy,
                    'loss': e.loss,
                    'val_accuracy': e.val_accuracy,
                    'val_loss': e.val_loss,
                }
                for e in epochs
            ]

            best_val_acc = max((e.val_accuracy for e in epochs), default=0)

            session_tests = []
            for test in tests:
                results = list(test.results.all())
                if not results:
                    continue

                correct = sum(1 for r in results if r.true_label == r.prediction)
                accuracy = correct / len(results) if results else 0
                avg_confidence = sum(r.confidence for r in results) / len(results)

                # Per-class precision/recall
                class_tp = defaultdict(int)
                class_fp = defaultdict(int)
                class_fn = defaultdict(int)
                confusion = defaultdict(int)  # (true, pred) -> count

                for r in results:
                    confusion[(r.true_label, r.prediction)] += 1
                    if r.true_label == r.prediction:
                        class_tp[r.true_label] += 1
                    else:
                        class_fp[r.prediction] += 1
                        class_fn[r.true_label] += 1

                all_labels = sorted(set(
                    [r.true_label for r in results] + [r.prediction for r in results]
                ))

                # Group results by true_label for per-class stats
                class_results = defaultdict(list)
                for r in results:
                    class_results[r.true_label].append(r)

                per_class = []
                for label in all_labels:
                    tp = class_tp.get(label, 0)
                    fp = class_fp.get(label, 0)
                    fn = class_fn.get(label, 0)
                    precision = tp / (tp + fp) if (tp + fp) > 0 else 0
                    recall = tp / (tp + fn) if (tp + fn) > 0 else 0
                    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0

                    # Per-class accuracy and confidence
                    cls_res = class_results.get(label, [])
                    cls_total = len(cls_res)
                    cls_correct = [r for r in cls_res if r.prediction == r.true_label]

                    per_class.append({
                        'label': label,
                        'precision': round(precision, 4),
                        'recall': round(recall, 4),
                        'f1': round(f1, 4),
                        'accuracy': round(tp / cls_total, 4) if cls_total > 0 else 0,
                        'avg_confidence': round(sum(r.confidence for r in cls_res) / cls_total, 4) if cls_total > 0 else 0,
                        'avg_correct_confidence': round(sum(r.confidence for r in cls_correct) / len(cls_correct), 4) if cls_correct else 0,
                        'misidentifications': fn,
                        'total': cls_total,
                    })

                # Macro F1
                macro_f1 = sum(c['f1'] for c in per_class) / len(per_class) if per_class else 0

                # Confusion matrix as list of {true, predicted, count}
                confusion_list = [
                    {'true_label': t, 'predicted': p, 'count': c}
                    for (t, p), c in confusion.items()
                ]

                test_entry = {
                    'test_id': test.id,
                    'test_name': test.name,
                    'accuracy': round(accuracy, 4),
                    'avg_confidence': round(avg_confidence, 4),
                    'macro_f1': round(macro_f1, 4),
                    'total_results': len(results),
                    'per_class': per_class,
                    'confusion': confusion_list,
                    'labels': all_labels,
                }
                session_tests.append(test_entry)
                all_tests.append(test_entry)
                model_accuracies[sess.model.name].append(accuracy)

            sess_entry = {
                'session_id': sess.id,
                'session_name': sess.name,
                'model_name': sess.model.name,
                'model_resolution': sess.model.resolution,
                'dataset_name': sess.dataset.name,
                'dataset_id': sess.dataset.id,
                'images_per_class': images_per_class,
                'avg_images_per_class': round(avg_images_per_class, 1),
                'total_images': total_images,
                'num_epochs': len(epochs),
                'epochs': epoch_data,
                'best_val_accuracy': round(best_val_acc, 4),
                'tests': session_tests,
                'created_at': sess.created_at.isoformat(),
            }
            session_data.append(sess_entry)

        # Model comparison aggregation
        model_comparison = [
            {
                'model_name': name,
                'avg_accuracy': round(sum(accs) / len(accs), 4),
                'num_tests': len(accs),
            }
            for name, accs in model_accuracies.items()
        ]

        # Summary stats
        all_accuracies = [t['accuracy'] for t in all_tests]
        summary = {
            'total_sessions': len(session_data),
            'total_tests': len(all_tests),
            'best_accuracy': max(all_accuracies) if all_accuracies else 0,
            'avg_accuracy': round(sum(all_accuracies) / len(all_accuracies), 4) if all_accuracies else 0,
            'date_range': {
                'start': min((s['created_at'] for s in session_data), default=None),
                'end': max((s['created_at'] for s in session_data), default=None),
            },
        }

        # Aggregated confusion matrix across all tests
        agg_confusion = defaultdict(int)
        agg_labels = set()
        for t in all_tests:
            for c in t.get('confusion', []):
                agg_confusion[(c['true_label'], c['predicted'])] += c['count']
                agg_labels.add(c['true_label'])
                agg_labels.add(c['predicted'])

        agg_confusion_list = [
            {'true_label': tl, 'predicted': p, 'count': c}
            for (tl, p), c in agg_confusion.items()
        ]

        # Aggregated per-class metrics across all tests
        agg_class_tp = defaultdict(int)
        agg_class_fp = defaultdict(int)
        agg_class_fn = defaultdict(int)
        for t in all_tests:
            for c in t.get('confusion', []):
                if c['true_label'] == c['predicted']:
                    agg_class_tp[c['true_label']] += c['count']
                else:
                    agg_class_fp[c['predicted']] += c['count']
                    agg_class_fn[c['true_label']] += c['count']

        agg_per_class = []
        for label in sorted(agg_labels):
            tp = agg_class_tp.get(label, 0)
            fp = agg_class_fp.get(label, 0)
            fn = agg_class_fn.get(label, 0)
            precision = tp / (tp + fp) if (tp + fp) > 0 else 0
            recall = tp / (tp + fn) if (tp + fn) > 0 else 0
            f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0
            agg_per_class.append({
                'label': label,
                'precision': round(precision, 4),
                'recall': round(recall, 4),
                'f1': round(f1, 4),
            })

        # Count unique models and datasets across sessions
        unique_models = set(s['model_name'] for s in session_data)
        unique_datasets = set(s['dataset_name'] for s in session_data)
        # Check if sample sizes vary across sessions
        sample_sizes = [s['avg_images_per_class'] for s in session_data]
        has_varying_sample_sizes = len(set(sample_sizes)) > 1

        # Misidentification summary per class
        misidentification_summary = []
        for label in sorted(agg_labels):
            misid_count = sum(
                c for (tl, p), c in agg_confusion.items()
                if tl == label and p != label
            )
            total_samples = sum(
                c for (tl, p), c in agg_confusion.items()
                if tl == label
            )
            confused_with = sorted(
                [
                    {'predicted': p, 'count': c}
                    for (tl, p), c in agg_confusion.items()
                    if tl == label and p != label
                ],
                key=lambda x: -x['count']
            )
            misidentification_summary.append({
                'label': label,
                'total_samples': total_samples,
                'misidentifications': misid_count,
                'misid_rate': round(misid_count / total_samples, 4) if total_samples else 0,
                'confused_with': confused_with,
            })

        return Response({
            'study_id': study.id,
            'study_name': study.name,
            'summary': summary,
            'sessions': session_data,
            'all_tests': all_tests,
            'model_comparison': model_comparison,
            'aggregated_confusion': {
                'confusion': agg_confusion_list,
                'labels': sorted(agg_labels),
                'per_class': agg_per_class,
            },
            'misidentification_summary': misidentification_summary,
            'unique_models': sorted(unique_models),
            'unique_datasets': sorted(unique_datasets),
            'has_varying_sample_sizes': has_varying_sample_sizes,
        })


    @action(detail=False, methods=['get'])
    def compare(self, request):
        """Compare metrics across multiple studies side by side."""
        from collections import defaultdict

        study_ids = request.query_params.getlist('ids')
        if not study_ids:
            return Response({'error': 'Provide study IDs via ?ids=1&ids=2'}, status=400)

        studies = self.get_queryset().filter(id__in=study_ids)
        results = []

        for study in studies:
            sessions = (
                TrainingSession.objects
                .filter(study=study, status='Completed')
                .select_related('model', 'dataset')
                .prefetch_related('tests__results', 'epochs')
            )

            models_used = set()
            datasets_used = set()
            all_accuracies = []
            all_confidences = []
            total_tests = 0
            sample_sizes = []

            for sess in sessions:
                models_used.add(sess.model.name)
                datasets_used.add(sess.dataset.name)

                for test in sess.tests.all():
                    test_results = list(test.results.all())
                    if not test_results:
                        continue
                    total_tests += 1
                    correct = sum(1 for r in test_results if r.true_label == r.prediction)
                    acc = correct / len(test_results)
                    avg_conf = sum(r.confidence for r in test_results) / len(test_results)
                    all_accuracies.append(acc)
                    all_confidences.append(avg_conf)

                # Avg images per class for this session
                label_counts = (
                    Image.objects
                    .filter(dataset=sess.dataset)
                    .values('label__name')
                    .annotate(count=Count('id'))
                )
                total_images = sum(lc['count'] for lc in label_counts)
                num_classes = len(label_counts) or 1
                sample_sizes.append(total_images / num_classes)

            # Average epoch curves across all sessions
            epoch_sums = defaultdict(lambda: {'accuracy': 0, 'loss': 0, 'val_accuracy': 0, 'val_loss': 0, 'count': 0})
            for sess in sessions:
                for e in sess.epochs.all():
                    d = epoch_sums[e.number]
                    d['accuracy'] += (e.accuracy or 0)
                    d['loss'] += (e.loss or 0)
                    d['val_accuracy'] += (e.val_accuracy or 0)
                    d['val_loss'] += (e.val_loss or 0)
                    d['count'] += 1

            avg_epochs = []
            for num in sorted(epoch_sums.keys()):
                d = epoch_sums[num]
                c = d['count'] or 1
                avg_epochs.append({
                    'number': num,
                    'accuracy': round(d['accuracy'] / c, 4),
                    'loss': round(d['loss'] / c, 4),
                    'val_accuracy': round(d['val_accuracy'] / c, 4),
                    'val_loss': round(d['val_loss'] / c, 4),
                })

            results.append({
                'study_id': study.id,
                'study_name': study.name,
                'total_sessions': sessions.count(),
                'total_tests': total_tests,
                'best_accuracy': round(max(all_accuracies), 4) if all_accuracies else 0,
                'avg_accuracy': round(sum(all_accuracies) / len(all_accuracies), 4) if all_accuracies else 0,
                'avg_confidence': round(sum(all_confidences) / len(all_confidences), 4) if all_confidences else 0,
                'avg_sample_size': round(sum(sample_sizes) / len(sample_sizes), 1) if sample_sizes else 0,
                'models_used': sorted(models_used),
                'datasets_used': sorted(datasets_used),
                'avg_epochs': avg_epochs,
            })

        return Response(results)


class TrainingSessionViewSet(viewsets.ModelViewSet):
    serializer_class = TrainingSessionSerializer
    permission_classes_by_action = {}  # Handled inline

    def get_queryset(self):
        qs = TrainingSession.objects.select_related('model', 'dataset', 'study').prefetch_related('epochs')
        if not self.request.user.is_superuser:
            user_studies = StudyMembership.objects.filter(
                user=self.request.user
            ).values_list('study_id', flat=True)
            qs = qs.filter(study__in=user_studies)
        if self.request.query_params.get('show_archived') != 'true':
            qs = qs.filter(archived_at__isnull=True)
        return qs.all()

    def get_serializer_class(self):
        if self.action == 'list':
            return TrainingSessionListSerializer
        return TrainingSessionSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['status']

    def create(self, request, *args, **kwargs):
        print('request.data:', request.data)
        serializer = self.get_serializer(data=request.data)
        try:
            serializer.is_valid(raise_exception=True)
            print('Serializer is valid')
        except serializers.ValidationError as e:
            print('Validation error:', e.detail)
            return Response(e.detail, status=status.HTTP_400_BAD_REQUEST)
        
        self.perform_create(serializer)
        headers = self.get_success_headers(serializer.data)
        return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)

    def perform_create(self, serializer):
        hotdataset = self.request.data.get('hotdataset')
        if hotdataset:
            base_dataset = Dataset.objects.filter(base=True).last()
            if base_dataset:
                labels = base_dataset.labels.all()
                unique_suffix = ''.join(random.choices(string.ascii_letters + string.digits, k=6))
                dataset_name = f"Dataset {hotdataset}-{unique_suffix}"
                new_dataset = Dataset.objects.create(
                    name=dataset_name,
                    description=f"Generated dataset with {hotdataset} samples",
                    resolution=base_dataset.resolution,
                    base=False,
                    for_testing=False
                )
                new_dataset.labels.set(labels)
                for label in labels:
                    images = list(Image.objects.filter(dataset=base_dataset, label=label))
                    selected_images = sample(images, int(hotdataset))
                    for image in selected_images:
                        Image.objects.create(
                            dataset=new_dataset,
                            image=image.image,
                            label=label
                        )
                training_session = serializer.save(dataset=new_dataset, created_by=self.request.user)
                # Delay the task until the transaction is committed
                if is_gpu_busy():
                    # GPU busy: only create archive, training will be picked up by queue
                    transaction.on_commit(lambda: create_dataset_archive.apply_async((new_dataset.id,)))
                else:
                    transaction.on_commit(lambda: chain(
                        create_dataset_archive.s(new_dataset.id),
                        train_model.s(training_session.id)
                    ).apply_async())
            else:
                raise serializers.ValidationError("Base dataset not found.")
        else:
            training_session = serializer.save(created_by=self.request.user)
            if not is_gpu_busy():
                transaction.on_commit(lambda: train_model.apply_async((training_session.id,)))


    @action(detail=True, methods=['post'])
    def clone(self, request, pk=None):
        """Clone a training session with auto-incremented suffix."""
        source = self.get_object()
        base_name = source.name
        # Strip existing T-N suffix to get base name
        match = re.match(r'^(.*?)\s+T-(\d+)$', base_name)
        if match:
            base_name = match.group(1)
        # Find the highest existing suffix
        existing = TrainingSession.objects.filter(
            name__regex=r'^' + re.escape(base_name) + r'\s+T-\d+$'
        ).values_list('name', flat=True)
        max_num = 0
        for name in existing:
            m = re.search(r'T-(\d+)$', name)
            if m:
                max_num = max(max_num, int(m.group(1)))
        # Also count the source itself if it has no suffix
        if max_num == 0:
            max_num = 1
        new_name = f"{base_name} T-{max_num + 1}"
        # Check permissions
        role = effective_role(request.user, source.study)
        if role not in ('owner', 'editor'):
            return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)
        new_session = TrainingSession.objects.create(
            study=source.study,
            name=new_name,
            notes=source.notes,
            dataset=source.dataset,
            model=source.model,
            status='Pending',
            created_by=request.user,
        )
        if not is_gpu_busy():
            train_model.apply_async((new_session.id,))
        serializer = self.get_serializer(new_session)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

            
    def destroy(self, request, *args, **kwargs):
        obj = self.get_object()
        role = effective_role(request.user, obj.study)
        if role == 'owner':
            return super().destroy(request, *args, **kwargs)
        elif role == 'editor':
            obj.archived_at = timezone.now()
            obj.archived_by = request.user
            obj.save(update_fields=['archived_at', 'archived_by'])
            return Response(status=status.HTTP_204_NO_CONTENT)
        return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

    @action(detail=True, methods=['post'])
    def archive(self, request, pk=None):
        obj = self.get_object()
        role = effective_role(request.user, obj.study)
        if role not in ('owner', 'editor'):
            return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)
        obj.archived_at = timezone.now()
        obj.archived_by = request.user
        obj.save(update_fields=['archived_at', 'archived_by'])
        return Response({'status': 'archived'})

    @action(detail=True, methods=['post'])
    def unarchive(self, request, pk=None):
        obj = self.get_object()
        role = effective_role(request.user, obj.study)
        if role != 'owner':
            return Response({'error': 'Only the owner can unarchive'}, status=status.HTTP_403_FORBIDDEN)
        obj.archived_at = None
        obj.archived_by = None
        obj.save(update_fields=['archived_at', 'archived_by'])
        return Response({'status': 'unarchived'})

            
class EpochViewSet(viewsets.ModelViewSet):
    queryset = Epoch.objects.all()
    serializer_class = EpochSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['training_session']

class TestViewSet(viewsets.ModelViewSet):
    serializer_class = TestSerializer

    def get_queryset(self):
        qs = Test.objects.select_related(
            'training_session', 'training_session__model',
            'training_session__dataset', 'training_session__study',
            'created_by',
        ).prefetch_related('training_session__epochs')
        if not self.request.user.is_superuser:
            user_studies = StudyMembership.objects.filter(
                user=self.request.user
            ).values_list('study_id', flat=True)
            qs = qs.filter(training_session__study__in=user_studies)
        if self.request.query_params.get('show_archived') != 'true':
            qs = qs.filter(archived_at__isnull=True)
        # Annotate aggregate stats for list view (avoids N+1 queries)
        if self.action == 'list':
            qs = qs.annotate(
                _num_images=Count('results'),
                _avg_confidence=Avg('results__confidence'),
                _num_correct=Count(
                    'results',
                    filter=Q(results__prediction=F('results__true_label'))
                ),
            )
        return qs.all()

    def get_serializer_class(self):
        if self.action == 'list':
            return TestListSerializer
        return TestSerializer


    @action(detail=True, methods=["post"])
    def retest(self, request, pk=None):
        # Re-run a test against the same dataset and training session.
        # Delete existing results so the operation is idempotent.
        test_instance = self.get_object()

        TestResult.objects.filter(test=test_instance).delete()

        test_instance.status = "Pending"
        test_instance.save(update_fields=["status", "updated_at"])

        role = effective_role(request.user, test_instance.training_session.study)
        if role not in ('owner', 'editor'):
            return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)
        test_images.delay(test_instance.id, test_instance.training_session.model.resolution)
        return Response({"status": "queued"}, status=status.HTTP_202_ACCEPTED)


    @action(detail=True, methods=['post'])
    def stop(self, request, pk=None):
        test_instance = self.get_object()
        role = effective_role(request.user, test_instance.training_session.study)
        if role not in ('owner', 'editor'):
            return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)
        if test_instance.status not in ('Testing', 'Pending'):
            return Response({'error': f'Cannot stop test with status {test_instance.status}'}, status=status.HTTP_400_BAD_REQUEST)
        test_instance.status = 'Failed'
        test_instance.save()
        process_next_pending()
        return Response({'status': 'stopped'}, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'])
    def clone(self, request, pk=None):
        source = self.get_object()
        base_name = source.name
        match = re.match(r'^(.*?)\s+T-(\d+)$', base_name)
        if match:
            base_name = match.group(1)
        existing = Test.objects.filter(
            name__regex=r'^' + re.escape(base_name) + r'\s+T-\d+$'
        ).values_list('name', flat=True)
        max_num = 0
        for name in existing:
            m = re.search(r'T-(\d+)$', name)
            if m:
                max_num = max(max_num, int(m.group(1)))
        if max_num == 0:
            max_num = 1
        new_name = f"{base_name} T-{max_num + 1}"
        role = effective_role(request.user, source.training_session.study)
        if role not in ('owner', 'editor'):
            return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)
        new_test = Test.objects.create(
            name=new_name,
            notes=source.notes,
            dataset=source.dataset,
            training_session=source.training_session,
            status='Pending',
            created_by=request.user,
        )
        process_next_pending()
        serializer = self.get_serializer(new_test)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    def create(self, request, *args, **kwargs):
        # Print the request object
        print(request)
        
        # Optionally, you can print specific details from the request object
        print(request.data)  # Print the posted data

        # Perform the create operation
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        headers = self.get_success_headers(serializer.data)
        return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    def destroy(self, request, *args, **kwargs):
        obj = self.get_object()
        study = obj.training_session.study
        role = effective_role(request.user, study)
        if role == 'owner':
            return super().destroy(request, *args, **kwargs)
        elif role == 'editor':
            obj.archived_at = timezone.now()
            obj.archived_by = request.user
            obj.save(update_fields=['archived_at', 'archived_by'])
            return Response(status=status.HTTP_204_NO_CONTENT)
        return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

    @action(detail=True, methods=['post'])
    def archive(self, request, pk=None):
        obj = self.get_object()
        study = obj.training_session.study
        role = effective_role(request.user, study)
        if role not in ('owner', 'editor'):
            return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)
        obj.archived_at = timezone.now()
        obj.archived_by = request.user
        obj.save(update_fields=['archived_at', 'archived_by'])
        return Response({'status': 'archived'})

    @action(detail=True, methods=['post'])
    def unarchive(self, request, pk=None):
        obj = self.get_object()
        study = obj.training_session.study
        role = effective_role(request.user, study)
        if role != 'owner':
            return Response({'error': 'Only the owner can unarchive'}, status=status.HTTP_403_FORBIDDEN)
        obj.archived_at = None
        obj.archived_by = None
        obj.save(update_fields=['archived_at', 'archived_by'])
        return Response({'status': 'unarchived'})


class TestResultViewSet(viewsets.ModelViewSet):
    queryset = TestResult.objects.select_related('test', 'image').all()
    serializer_class = TestResultSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['test__id'] 

class PerformanceViewSet(viewsets.ModelViewSet):
    serializer_class = TrainingSessionSerializer

    def get_queryset(self):
        last_session = TrainingSession.objects.filter(status='Completed').last()
        return TrainingSession.objects.select_related('model', 'dataset', 'study').prefetch_related('epochs').filter(id=last_session.id) if last_session else TrainingSession.objects.none()


class StudyMembershipViewSet(viewsets.ModelViewSet):
    serializer_class = StudyMembershipSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['study']

    def get_queryset(self):
        return StudyMembership.objects.select_related('user', 'study').all()

    def create(self, request, *args, **kwargs):
        study_id = request.data.get('study')
        try:
            study = Study.objects.get(pk=study_id)
        except Study.DoesNotExist:
            return Response({'error': 'Study not found'}, status=status.HTTP_404_NOT_FOUND)
        role = effective_role(request.user, study)
        if role != 'owner':
            return Response({'error': 'Only the study owner can manage members'}, status=status.HTTP_403_FORBIDDEN)
        return super().create(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        membership = self.get_object()
        role = effective_role(request.user, membership.study)
        if role != 'owner':
            return Response({'error': 'Only the study owner can remove members'}, status=status.HTTP_403_FORBIDDEN)
        if membership.role == 'owner':
            return Response({'error': 'Cannot remove the study owner'}, status=status.HTTP_400_BAD_REQUEST)
        return super().destroy(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        membership = self.get_object()
        role = effective_role(request.user, membership.study)
        if role != 'owner':
            return Response({'error': 'Only the study owner can change roles'}, status=status.HTTP_403_FORBIDDEN)
        return super().partial_update(request, *args, **kwargs)

    @action(detail=False, methods=['post'])
    def batch(self, request):
        """Batch assign users to studies (superuser only)."""
        if not request.user.is_superuser:
            return Response({'error': 'Admin only'}, status=status.HTTP_403_FORBIDDEN)

        user_ids = request.data.get('user_ids', [])
        study_ids = request.data.get('study_ids', [])
        role = request.data.get('role', 'viewer')

        if role not in ('editor', 'viewer'):
            return Response({'error': 'Role must be editor or viewer'}, status=status.HTTP_400_BAD_REQUEST)
        if not user_ids or not study_ids:
            return Response({'error': 'user_ids and study_ids are required'}, status=status.HTTP_400_BAD_REQUEST)

        created = 0
        updated = 0
        for study_id in study_ids:
            for user_id in user_ids:
                try:
                    existing = StudyMembership.objects.filter(
                        study_id=study_id, user_id=user_id
                    ).first()
                    if existing:
                        if existing.role != 'owner':
                            existing.role = role
                            existing.save()
                            updated += 1
                    else:
                        StudyMembership.objects.create(
                            study_id=study_id, user_id=user_id, role=role
                        )
                        created += 1
                except Exception:
                    pass  # skip invalid ids

        return Response({'created': created, 'updated': updated})


class SiteSettingsViewSet(viewsets.ViewSet):
    """Singleton site settings for feature flags."""

    def list(self, request):
        from .models import SiteSettings
        settings = SiteSettings.get()
        return Response({'show_synthetic_tools': settings.show_synthetic_tools})

    @action(detail=False, methods=['patch'])
    def update_settings(self, request):
        if not request.user.is_superuser:
            return Response({'error': 'Admin only'}, status=status.HTTP_403_FORBIDDEN)
        from .models import SiteSettings
        settings = SiteSettings.get()
        if 'show_synthetic_tools' in request.data:
            settings.show_synthetic_tools = request.data['show_synthetic_tools']
            settings.save()
        return Response({'show_synthetic_tools': settings.show_synthetic_tools})

# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: api.py
# Copyright (c) 2024

import random
import string
from rest_framework import viewsets, serializers, status
from rest_framework.response import Response
from rest_framework.decorators import action
from django.db import transaction
from .models import TFModel, Study, TrainingSession, Epoch, Test, TestResult
from datasets.models import Dataset, Image
from .serializers import TFModelSerializer, StudySerializer, TrainingSessionSerializer, TrainingSessionListSerializer, EpochSerializer, TestSerializer, TestListSerializer, TestResultSerializer
from django_filters.rest_framework import DjangoFilterBackend
from random import sample
from datasets.tasks import create_dataset_archive
from celery import chain
from .tasks import train_model, test_images



class TFModelViewSet(viewsets.ModelViewSet):
    queryset = TFModel.objects.all()
    serializer_class = TFModelSerializer

class StudyViewSet(viewsets.ModelViewSet):
    queryset = Study.objects.all()
    serializer_class = StudySerializer

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

                per_class = []
                for label in all_labels:
                    tp = class_tp.get(label, 0)
                    fp = class_fp.get(label, 0)
                    fn = class_fn.get(label, 0)
                    precision = tp / (tp + fp) if (tp + fp) > 0 else 0
                    recall = tp / (tp + fn) if (tp + fn) > 0 else 0
                    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0
                    per_class.append({
                        'label': label,
                        'precision': round(precision, 4),
                        'recall': round(recall, 4),
                        'f1': round(f1, 4),
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
                'tests': [t for t in all_tests if any(
                    test.training_session_id == sess.id
                    for test in sess.tests.all()
                )],
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

        return Response({
            'study_id': study.id,
            'study_name': study.name,
            'summary': summary,
            'sessions': session_data,
            'all_tests': all_tests,
            'model_comparison': model_comparison,
        })


class TrainingSessionViewSet(viewsets.ModelViewSet):
    queryset = TrainingSession.objects.select_related('model', 'dataset', 'study').prefetch_related('epochs').all()
    serializer_class = TrainingSessionSerializer

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
                training_session = serializer.save(dataset=new_dataset)
                # Delay the task until the transaction is committed
                transaction.on_commit(lambda: chain(
                    create_dataset_archive.s(new_dataset.id),
                    train_model.s(training_session.id)
                ).apply_async())
            else:
                raise serializers.ValidationError("Base dataset not found.")
        else:
            training_session = serializer.save()
            transaction.on_commit(lambda: train_model.apply_async((training_session.id,)))  # Adding a delay

            
class EpochViewSet(viewsets.ModelViewSet):
    queryset = Epoch.objects.all()
    serializer_class = EpochSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['training_session']

class TestViewSet(viewsets.ModelViewSet):
    queryset = Test.objects.select_related(
        'training_session',
        'training_session__model',
        'training_session__dataset',
        'training_session__study',
    ).prefetch_related('training_session__epochs').all()
    serializer_class = TestSerializer

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

        test_images.delay(test_instance.id, test_instance.training_session.model.resolution)
        return Response({"status": "queued"}, status=status.HTTP_202_ACCEPTED)

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

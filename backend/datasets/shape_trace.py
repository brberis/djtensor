"""
The inspector's shape-analysis trace for one image, with caching.

Shared by the shape-trace endpoint and phase2_shape_study, so the numbers a
study stores and the animation a reviewer watches come from one place.
"""
import json
import logging
import os

import cv2
from django.conf import settings

logger = logging.getLogger(__name__)

DEFAULT_REFERENCE_DATASET = 72


class ShapeTraceUnavailable(Exception):
    """This image cannot be analysed; the message says why, for the reviewer."""


def _completeness_reference(image):
    """The species reference behind this image's stored completeness_mm2.

    The "true size" frame has to use the same reference the side panel's
    completeness used, or the two would disagree on the same tooth. Rather
    than assume which reference dataset that was, find the row that
    reproduces the stored value.
    """
    from .models import SpeciesReferenceArea
    if not image.tooth_area_mm2 or image.completeness_mm2 is None:
        return None, None
    rows = (SpeciesReferenceArea.objects.filter(label_id=image.label_id)
            .exclude(avg_area_mm2=None).order_by('-id'))
    for row in rows:
        if row.avg_area_mm2 and abs(min(1.0, image.tooth_area_mm2 / row.avg_area_mm2)
                                    - image.completeness_mm2) < 1e-6:
            return (float(image.tooth_area_mm2) / float(row.avg_area_mm2),
                    {'dataset': row.dataset_id, 'median_mm2': round(float(row.avg_area_mm2), 1),
                     'teeth': row.sample_count_mm2})
    return None, None


def get_shape_trace(image, reference=None):
    """Return the replay of Katie's shape score for `image`.

    Raises ShapeTraceUnavailable when the image cannot be analysed, and
    brokenness.trace.TraceMismatch if the replay fails to reproduce her
    score, which it never should.
    """
    from .brokenness import load_mask
    from .brokenness.trace import TRACE_VERSION, trace_shape_brokenness
    from .tasks import brokenness_input_path

    meta = image.brokenness_meta or {}
    try:
        ref_id = int(reference or meta.get('reference_dataset_id') or DEFAULT_REFERENCE_DATASET)
    except (TypeError, ValueError):
        raise ShapeTraceUnavailable('The reference must be a dataset id.')

    ref_dir = os.path.join(settings.MEDIA_ROOT, 'brokenness_reference', str(ref_id))
    edges_path = os.path.join(ref_dir, 'quantile_edges.json')
    if image.label is None or not os.path.exists(edges_path):
        raise ShapeTraceUnavailable('No shape templates have been built for dataset %d.' % ref_id)
    with open(edges_path) as f:
        all_edges = json.load(f)
    species = image.label.name
    if species not in all_edges:
        raise ShapeTraceUnavailable('No shape templates exist for %s.' % species)
    edges = all_edges[species]
    template_paths = {q: os.path.join(ref_dir, '%s_mean_mask_q%d.png' % (species, q))
                      for q in range(1, len(edges))}
    if not all(os.path.exists(t) for t in template_paths.values()):
        raise ShapeTraceUnavailable('The %s templates are incomplete.' % species)

    input_path = brokenness_input_path(image)
    if not input_path or not os.path.exists(input_path):
        raise ShapeTraceUnavailable('This image has no tooth outline to analyse.')

    area_ratio, area_ref = _completeness_reference(image)

    def mtime(path):
        return round(os.path.getmtime(path), 3)
    key = [TRACE_VERSION, input_path, mtime(input_path), mtime(edges_path),
           max(mtime(t) for t in template_paths.values()),
           image.mm_per_pixel, round(area_ratio, 6) if area_ratio else None]
    cache_path = os.path.join(settings.MEDIA_ROOT, 'brokenness_traces', str(ref_id), '%d.json' % image.id)

    trace = None
    if os.path.exists(cache_path):
        try:
            with open(cache_path) as f:
                cached = json.load(f)
            if cached.get('key') == key:
                trace = cached['trace']
        except (OSError, ValueError):
            trace = None
    if trace is None:
        templates = {q: (cv2.imread(t, cv2.IMREAD_GRAYSCALE) > 127).astype('uint8')
                     for q, t in template_paths.items()}
        trace = trace_shape_brokenness(
            load_mask(input_path), templates, edges,
            context={'mm_per_pixel': image.mm_per_pixel, 'area_ratio': area_ratio},
        )
        os.makedirs(os.path.dirname(cache_path), exist_ok=True)
        with open(cache_path, 'w') as f:
            json.dump({'key': key, 'trace': trace}, f)

    # Captions only; attached fresh so an edited estimate shows at once.
    trace['context'] = {
        'species': species,
        'reference_dataset': ref_id,
        'mm_per_pixel': image.mm_per_pixel,
        'area_ratio': round(area_ratio, 4) if area_ratio else None,
        'area_completeness': round(image.completeness_mm2 * 100, 1) if image.completeness_mm2 is not None else None,
        'area_reference': area_ref,
        'alexa_pct': meta.get('alexa_pct'),
    }
    return trace

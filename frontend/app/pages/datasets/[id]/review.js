/*
 * Shark AI
 * Author: Cristobal Barberis
 * License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
 * For academic use only. Commercial use is prohibited without prior written permission.
 * Contact: cristobal@barberis.com
 *
 * File: review.js
 * Copyright (c) 2024
 *
 * Phase 2 curation / sanity-gate review queue. Lists every image in the
 * dataset that needs a human decision, grouped by the kind of problem,
 * and gives each row one-click actions (Trust OCR, Trust Folder, Mark
 * Reviewed, Exclude). Plus bulk actions and a per-image audit-log
 * accordion so reviewers can see who decided what.
 */

import { Fragment, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/router';
import { Dialog, Transition } from '@headlessui/react';
import Layout from '../../../components/Layout';
import { ArrowLeftIcon, ArrowRightIcon, ExclamationTriangleIcon, CheckIcon, XMarkIcon } from '@heroicons/react/24/outline';
import theme from '../../../theme';

function normalizeMediaUrl(url) {
  if (!url) return '';
  if (url.startsWith('http')) return url;
  if (url.startsWith('/')) return url;
  return '/' + url;
}

export default function ReviewQueue() {
  const router = useRouter();
  const { id } = router.query;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actingIds, setActingIds] = useState(new Set());
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [expandedHistory, setExpandedHistory] = useState({});
  const [historyData, setHistoryData] = useState({});
  const [status, setStatus] = useState(null);
  const [inspectorImageId, setInspectorImageId] = useState(null);

  // A flat ordered list of all flagged image objects (across categories),
  // so the inspector's Prev/Next can navigate them.
  const flatImages = useMemo(() => {
    if (!data) return [];
    const seen = new Set();
    const out = [];
    for (const cat of data.categories || []) {
      for (const img of cat.items || []) {
        if (seen.has(img.id)) continue;
        seen.add(img.id);
        out.push({ ...img, _category: cat.label });
      }
    }
    return out;
  }, [data]);

  const inspectorImage = useMemo(
    () => flatImages.find((x) => x.id === inspectorImageId) || null,
    [flatImages, inspectorImageId],
  );

  const inspectorIndex = useMemo(
    () => flatImages.findIndex((x) => x.id === inspectorImageId),
    [flatImages, inspectorImageId],
  );

  const showStatus = (tone, message) => {
    setStatus({ tone, message });
    setTimeout(() => setStatus(prev => (prev && prev.message === message ? null : prev)), 6000);
  };

  const fetchQueue = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/datasets/dataset/${id}/review-queue`);
      const payload = await res.json();
      setData(payload);
    } catch (e) {
      console.error('Failed to fetch review queue', e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchQueue(); }, [fetchQueue]);

  const onAction = async (imageId, action, label) => {
    setActingIds(prev => new Set(prev).add(imageId));
    try {
      const res = await fetch(`/api/datasets/image/${imageId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        showStatus('success', `Image #${imageId}: ${label}`);
        await fetchQueue();
        setSelectedIds(prev => {
          const next = new Set(prev); next.delete(imageId); return next;
        });
      } else {
        const data = await res.json().catch(() => ({}));
        showStatus('error', data.message || data.error || `Failed: ${label}`);
      }
    } catch (e) {
      console.error(e);
      showStatus('error', `Network error: ${label}`);
    } finally {
      setActingIds(prev => { const next = new Set(prev); next.delete(imageId); return next; });
    }
  };

  const onBulkAction = async (action, label) => {
    const ids = Array.from(selectedIds);
    if (!ids.length) {
      showStatus('error', 'Select at least one image first');
      return;
    }
    try {
      const res = await fetch(`/api/datasets/dataset/${id}/review-bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, image_ids: ids }),
      });
      if (res.ok) {
        const out = await res.json();
        showStatus('success', `${label}: ${out.succeeded}/${out.requested_count} succeeded`);
        await fetchQueue();
        setSelectedIds(new Set());
      } else {
        const data = await res.json().catch(() => ({}));
        showStatus('error', data.message || data.error || `Failed bulk ${label}`);
      }
    } catch (e) {
      console.error(e);
      showStatus('error', `Network error during bulk ${label}`);
    }
  };

  const toggleSelect = (imageId) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(imageId)) next.delete(imageId); else next.add(imageId);
      return next;
    });
  };

  const selectAllInCategory = (category) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      for (const item of category.items) next.add(item.id);
      return next;
    });
  };

  const toggleHistory = async (imageId) => {
    const open = !expandedHistory[imageId];
    setExpandedHistory(prev => ({ ...prev, [imageId]: open }));
    if (open && !historyData[imageId]) {
      try {
        const res = await fetch(`/api/datasets/image/${imageId}/review-history`);
        const payload = await res.json();
        setHistoryData(prev => ({ ...prev, [imageId]: payload.events || [] }));
      } catch (e) { console.error(e); }
    }
  };

  return (
    <Layout>
      {status && (
        <div className={`fixed top-4 right-4 z-40 max-w-md rounded-lg shadow-lg ring-1 ring-black/5 px-4 py-3 text-sm ${
          status.tone === 'success' ? 'bg-green-50 text-green-900 ring-green-200'
            : status.tone === 'error' ? 'bg-red-50 text-red-900 ring-red-200'
            : 'bg-blue-50 text-blue-900 ring-blue-200'
        }`} role="status">
          <div className="flex items-start gap-3">
            <span className="flex-1">{status.message}</span>
            <button onClick={() => setStatus(null)} className="text-gray-400 hover:text-gray-600">×</button>
          </div>
        </div>
      )}

      <div className="mb-6">
        <div className="flex items-center gap-x-3">
          <button onClick={() => router.push('/datasets')} className="text-sm text-gray-500 hover:text-gray-700">Datasets</button>
          <span className="text-gray-300">/</span>
          <button onClick={() => router.push(`/datasets/${id}`)} className="text-sm text-gray-500 hover:text-gray-700">{data?.dataset_name || 'Dataset'}</button>
          <span className="text-gray-300">/</span>
          <span className="text-sm font-medium text-gray-900">Review Queue</span>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Review Queue</h1>
            {data && (
              <p className="mt-1 text-sm text-gray-500">
                <span className="font-medium text-amber-700">{data.total_flagged}</span> flagged ·
                {' '}{data.review_status_counts?.unreviewed || 0} unreviewed ·
                {' '}<span className="text-green-700">{data.review_status_counts?.reviewed || 0} reviewed</span> ·
                {' '}<span className="text-red-700">{data.review_status_counts?.excluded || 0} excluded</span>
              </p>
            )}
          </div>
          <button
            onClick={() => router.push(`/datasets/${id}`)}
            className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 inline-flex items-center gap-1"
          >
            <ArrowLeftIcon className="h-4 w-4" /> Back to dataset
          </button>
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className="sticky top-0 z-20 mb-4 rounded-lg bg-blue-50 ring-1 ring-blue-200 px-4 py-3 flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-blue-900">{selectedIds.size} selected</span>
          <button onClick={() => onBulkAction('mark_reviewed', 'Mark reviewed')} className="rounded-md bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-500">Mark Reviewed</button>
          <button onClick={() => onBulkAction('mark_excluded', 'Exclude')} className="rounded-md bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-500">Exclude</button>
          <button onClick={() => onBulkAction('mark_unreviewed', 'Reset to unreviewed')} className="rounded-md bg-white px-3 py-1 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50">Reset</button>
          <button onClick={() => setSelectedIds(new Set())} className="ml-auto text-xs text-blue-700 hover:underline">Clear selection</button>
        </div>
      )}

      {loading && <p className="text-sm text-gray-500">Loading flagged images…</p>}

      {!loading && data && data.total_flagged === 0 && (
        <div className="rounded-xl border border-green-200 bg-green-50 px-6 py-10 text-center">
          <CheckIcon className="mx-auto h-10 w-10 text-green-500" />
          <h3 className="mt-3 text-lg font-semibold text-green-900">All clear</h3>
          <p className="mt-1 text-sm text-green-800">No images in this dataset are currently flagged for review.</p>
        </div>
      )}

      {!loading && data && data.categories.map(cat => cat.count > 0 && (
        <section key={cat.key} className="mb-8 rounded-xl bg-white ring-1 ring-gray-900/5 shadow-sm overflow-hidden">
          <header className="border-b border-gray-100 px-5 py-3 flex items-center gap-3">
            <ExclamationTriangleIcon className="h-5 w-5 text-amber-500" />
            <div className="flex-1">
              <h2 className="text-base font-semibold text-gray-900">{cat.label}</h2>
              <p className="text-xs text-gray-500">{cat.description}</p>
            </div>
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">{cat.count}</span>
            <button onClick={() => selectAllInCategory(cat)} className="text-xs text-blue-600 hover:underline">Select all in this category</button>
          </header>
          <ul className="divide-y divide-gray-100">
            {cat.items.map(img => (
              <ReviewRow
                key={img.id}
                img={img}
                acting={actingIds.has(img.id)}
                selected={selectedIds.has(img.id)}
                onToggleSelect={() => toggleSelect(img.id)}
                onAction={onAction}
                expanded={expandedHistory[img.id]}
                history={historyData[img.id]}
                onToggleHistory={() => toggleHistory(img.id)}
                onInspect={() => setInspectorImageId(img.id)}
              />
            ))}
          </ul>
        </section>
      ))}

      <ReviewInspector
        img={inspectorImage}
        position={inspectorIndex >= 0 ? inspectorIndex + 1 : 0}
        total={flatImages.length}
        onClose={() => setInspectorImageId(null)}
        onPrev={() => {
          if (inspectorIndex > 0) setInspectorImageId(flatImages[inspectorIndex - 1].id);
        }}
        onNext={() => {
          if (inspectorIndex >= 0 && inspectorIndex < flatImages.length - 1) {
            setInspectorImageId(flatImages[inspectorIndex + 1].id);
          }
        }}
        onAction={async (imgId, action, label) => {
          await onAction(imgId, action, label);
          // After acting, advance to the next still-flagged image if any.
          if (inspectorIndex >= 0 && inspectorIndex < flatImages.length - 1) {
            setInspectorImageId(flatImages[inspectorIndex + 1].id);
          } else {
            setInspectorImageId(null);
          }
        }}
      />
    </Layout>
  );
}

function ReviewRow({ img, acting, selected, onToggleSelect, onAction, expanded, history, onToggleHistory, onInspect }) {
  return (
    <li className="px-5 py-4 hover:bg-gray-50 transition-colors">
      <div className="flex items-start gap-4">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-600"
        />
        {/* Plain img is fine here; the URL already includes a cache-bust query param from the serializer. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={normalizeMediaUrl(img.image)}
          alt={img.file_name || ''}
          className="h-20 w-20 object-cover rounded-md ring-1 ring-gray-200 bg-gray-50"
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">{img.image?.split('/').pop()?.split('?')[0]}</p>
          <p className="text-xs text-gray-500 mt-0.5">
            <span className="text-gray-400">label:</span> <span className="font-medium">{img.label_name || img.label}</span>
            {img.museum_species && (
              <>  <span className="text-gray-400">·  OCR species:</span> <em className="font-medium">{img.museum_species}</em></>
            )}
            {img.museum_specimen_id && (
              <>  <span className="text-gray-400">·  ID:</span> {img.museum_specimen_id}</>
            )}
          </p>
          {(img.tooth_major_axis_mm != null || img.completeness_mm2 != null) && (
            <p className="text-xs text-gray-500 mt-0.5">
              {img.tooth_major_axis_mm != null && (
                <><span className="text-gray-400">L×W:</span> {img.tooth_major_axis_mm.toFixed(1)} × {img.tooth_minor_axis_mm?.toFixed(1) ?? '-'} mm  </>
              )}
              {img.completeness_mm2 != null && (
                <><span className="text-gray-400">·  completeness:</span> {Math.round(img.completeness_mm2 * 100)}%  </>
              )}
              {img.mm_per_pixel != null && (
                <><span className="text-gray-400">·  scale:</span> {img.mm_per_pixel.toFixed(5)} mm/px</>
              )}
            </p>
          )}
          {img.scale_bar_detected === false && (
            <span className="mt-1 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600">scale bar not detected</span>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <ActionButton onClick={onInspect} tone="neutral">
              Inspect…
            </ActionButton>
            <ActionButton onClick={() => onAction(img.id, 'mark_reviewed', 'Marked reviewed')} disabled={acting} tone="primary">
              {img.review_status === 'reviewed' ? 'Re-review' : 'Mark Reviewed'}
            </ActionButton>
            {img.museum_species && img.museum_species.toLowerCase() !== (img.label_name || '').toLowerCase() && (
              <ActionButton onClick={() => onAction(img.id, 'trust_ocr', `Trusted OCR (${img.museum_species})`)} disabled={acting} tone="primary">
                Trust OCR ({img.museum_species})
              </ActionButton>
            )}
            {img.museum_species && img.museum_species.toLowerCase() !== (img.label_name || '').toLowerCase() && (
              <ActionButton onClick={() => onAction(img.id, 'trust_folder', `Kept folder label`)} disabled={acting} tone="neutral">
                Trust Folder
              </ActionButton>
            )}
            <ActionButton onClick={() => onAction(img.id, 'mark_unreviewed', 'Reset to unreviewed')} disabled={acting} tone="neutral">
              Mark Unreviewed
            </ActionButton>
            <ActionButton onClick={() => onAction(img.id, 'mark_excluded', 'Excluded')} disabled={acting} tone="danger">
              Exclude
            </ActionButton>
            <button
              type="button"
              onClick={onToggleHistory}
              className="text-xs text-gray-500 hover:underline ml-auto"
            >
              {expanded ? 'Hide history' : 'View history'}
            </button>
          </div>
          {expanded && (
            <div className="mt-2 rounded-md bg-gray-50 ring-1 ring-gray-200 px-3 py-2 text-xs space-y-1">
              {!history && <span className="text-gray-500">Loading…</span>}
              {history && history.length === 0 && <span className="text-gray-500">No review events yet.</span>}
              {history && history.map(ev => (
                <div key={ev.id} className="flex items-baseline gap-2">
                  <span className="text-gray-400 whitespace-nowrap">{new Date(ev.created_at).toLocaleString()}</span>
                  <span className="font-medium">{ev.action}</span>
                  {ev.previous_status && ev.new_status && ev.previous_status !== ev.new_status && (
                    <span className="text-gray-500">{ev.previous_status} → {ev.new_status}</span>
                  )}
                  {ev.user && <span className="text-gray-500">by {ev.user}</span>}
                  {ev.notes && <span className="text-gray-700">— {ev.notes}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function ActionButton({ children, onClick, disabled, tone }) {
  const base = 'rounded-md px-3 py-1 text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed';
  const toneClass = tone === 'danger'
    ? 'bg-red-600 text-white hover:bg-red-500'
    : tone === 'neutral'
    ? 'bg-white text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50'
    : 'bg-blue-600 text-white hover:bg-blue-500';
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`${base} ${toneClass}`}>
      {children}
    </button>
  );
}


// ---------------------------------------------------------------------------
// ReviewInspector: full image viewer with detection overlays + actions
// ---------------------------------------------------------------------------

function ReviewInspector({ img, position, total, onClose, onPrev, onNext, onAction }) {
  const [showTooth, setShowTooth] = useState(true);
  const [showScaleBar, setShowScaleBar] = useState(true);
  const [showLabel, setShowLabel] = useState(true);
  const [showTicks, setShowTicks] = useState(true);
  const [showOcrText, setShowOcrText] = useState(false);
  const [hoverTooth, setHoverTooth] = useState(false);
  // Cursor position (image-percentage, 0..1) and the live-measured displayed
  // image-container size. Together they let the loupe compute which slice of
  // the source image to show, at 3x zoom, centered on the cursor.
  const [cursorPct, setCursorPct] = useState(null);
  const [containerSize, setContainerSize] = useState(null);
  const imageContainerRef = useRef(null);

  // Reset transient UI state when navigating to a different image.
  useEffect(() => {
    setHoverTooth(false);
    setShowOcrText(false);
    setCursorPct(null);
  }, [img?.id]);

  // Track the displayed image container's pixel size so the loupe knows how
  // to scale the source image at 3x.
  useEffect(() => {
    if (!img) return;
    const measure = () => {
      const el = imageContainerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setContainerSize({ width: rect.width, height: rect.height });
    };
    // Defer one frame so the image has its final layout.
    const t = setTimeout(measure, 0);
    window.addEventListener('resize', measure);
    return () => { clearTimeout(t); window.removeEventListener('resize', measure); };
  }, [img?.id]);

  if (!img) return null;

  const w = img.image_width || 1;
  const h = img.image_height || 1;
  const toPct = (bbox) => {
    if (!bbox || bbox.length < 4) return null;
    const [x0, y0, x1, y1] = bbox;
    return {
      left:   (x0 / w) * 100 + '%',
      top:    (y0 / h) * 100 + '%',
      width:  ((x1 - x0) / w) * 100 + '%',
      height: ((y1 - y0) / h) * 100 + '%',
    };
  };

  const toothPct    = showTooth     ? toPct(img.tooth_bbox)         : null;
  const scaleBarPct = showScaleBar  ? toPct(img.scale_bar_bbox)     : null;
  const labelPct    = showLabel     ? toPct(img.museum_metadata?.label_bbox) : null;

  // Pre-compute the dimension annotation positions for the tooth bbox.
  const toothDims = (() => {
    if (!img.tooth_bbox || img.tooth_bbox.length < 4) return null;
    const [x0, y0, x1, y1] = img.tooth_bbox;
    return {
      xCenterPct: ((x0 + x1) / 2 / w) * 100,
      yCenterPct: ((y0 + y1) / 2 / h) * 100,
      leftPct:    (x0 / w) * 100,
      topPct:     (y0 / h) * 100,
    };
  })();

  // Pre-compute tick-line geometries (only when ticks are on and we have
  // both the bbox and the tick positions).
  const tickLines = (() => {
    if (!showTicks) return [];
    const ticks = img.scale_bar_ticks;
    if (!ticks || !ticks.positions || !img.scale_bar_bbox) return [];
    const [bx0, by0, bx1, by1] = img.scale_bar_bbox;
    return ticks.positions.map((pos, i) => {
      if (ticks.long_axis === 'x') {
        return {
          key: i,
          horizontal: false,
          left: (pos / w) * 100 + '%',
          top:  (by0 / h) * 100 + '%',
          height: ((by1 - by0) / h) * 100 + '%',
        };
      }
      return {
        key: i,
        horizontal: true,
        top:  (pos / h) * 100 + '%',
        left: (bx0 / w) * 100 + '%',
        width: ((bx1 - bx0) / w) * 100 + '%',
      };
    });
  })();

  const speciesMismatch = img.museum_species
    && img.label_name
    && img.museum_species.trim().toLowerCase() !== img.label_name.trim().toLowerCase();

  return (
    <Transition.Root show={!!img} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child as={Fragment}
          enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100"
          leave="ease-in duration-150"   leaveFrom="opacity-100" leaveTo="opacity-0">
          <div className="fixed inset-0 bg-gray-900/80" />
        </Transition.Child>
        <div className="fixed inset-0 z-10 overflow-y-auto">
          <div className="flex min-h-full items-stretch justify-center p-4">
            <Transition.Child as={Fragment}
              enter="ease-out duration-200" enterFrom="opacity-0 scale-95" enterTo="opacity-100 scale-100"
              leave="ease-in duration-150"   leaveFrom="opacity-100 scale-100" leaveTo="opacity-0 scale-95">
              <Dialog.Panel className="relative flex w-full max-w-7xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <ExclamationTriangleIcon className="h-5 w-5 text-amber-500 shrink-0" />
                    <div className="min-w-0">
                      <Dialog.Title className="text-base font-semibold text-gray-900 truncate">
                        {img.image?.split('/').pop()?.split('?')[0] || `Image #${img.id}`}
                      </Dialog.Title>
                      <p className="text-xs text-gray-500">{img._category}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500">{position} / {total}</span>
                    <button onClick={onPrev} disabled={position <= 1}
                      className="rounded-md p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-30">
                      <ArrowLeftIcon className="h-5 w-5" />
                    </button>
                    <button onClick={onNext} disabled={position >= total}
                      className="rounded-md p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-30">
                      <ArrowRightIcon className="h-5 w-5" />
                    </button>
                    <button onClick={onClose} className="rounded-md p-1 text-gray-500 hover:bg-gray-100">
                      <XMarkIcon className="h-5 w-5" />
                    </button>
                  </div>
                </div>

                {/* Body */}
                <div className="flex flex-col md:flex-row min-h-[600px]">
                  {/* Image with overlays */}
                  <div className="flex-1 bg-gray-50 p-4 flex flex-col">
                    {/* Toggle bar */}
                    <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-gray-500 font-medium">Overlays:</span>
                      <OverlayToggle on={showTooth}    setOn={setShowTooth}    color="green"  label="Tooth"      disabled={!img.tooth_bbox} />
                      <OverlayToggle on={showScaleBar} setOn={setShowScaleBar} color="amber"  label="Scale bar"  disabled={!img.scale_bar_bbox} />
                      <OverlayToggle on={showLabel}    setOn={setShowLabel}    color="sky"    label="Label"      disabled={!img.museum_metadata?.label_bbox} />
                      <OverlayToggle on={showTicks}    setOn={setShowTicks}    color="red"    label="Ticks"      disabled={!img.scale_bar_ticks?.positions?.length} />
                    </div>

                    {/* Image canvas — generous padding so badges that extend outside
                        the photo (tooth chip, L/W dimension labels) remain visible
                        instead of being clipped by the canvas border. */}
                    <div className="relative flex-1 bg-white rounded-lg ring-1 ring-gray-200 flex items-center justify-center p-12">
                      <div ref={imageContainerRef} className="relative" style={{ aspectRatio: `${w} / ${h}`, width: '100%', maxHeight: '64vh' }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={normalizeMediaUrl(img.image)}
                          alt={img.file_name || ''}
                          className="absolute inset-0 w-full h-full object-contain"
                        />
                        {/* Scale bar - render first so tick lines and others draw on top */}
                        {scaleBarPct && (
                          <div className="absolute ring-4 ring-amber-500/80 rounded-sm pointer-events-none" style={scaleBarPct} title="Scale bar">
                            <span className="absolute -top-5 left-0 rounded bg-amber-500/90 px-1.5 py-0.5 text-[10px] font-semibold text-white">scale bar</span>
                          </div>
                        )}
                        {/* Detected tick lines inside the scale bar */}
                        {tickLines.map((t) => (
                          <div
                            key={`tick-${t.key}`}
                            className="absolute bg-red-500 pointer-events-none"
                            style={
                              t.horizontal
                                ? { left: t.left, top: t.top, width: t.width, height: '1px' }
                                : { left: t.left, top: t.top, width: '1px', height: t.height }
                            }
                          />
                        ))}
                        {/* Catalog label */}
                        {labelPct && (
                          <div className="absolute ring-4 ring-sky-500/80 rounded-sm pointer-events-none" style={labelPct} title="Catalog label">
                            <span className="absolute -top-5 left-0 rounded bg-sky-500/90 px-1.5 py-0.5 text-[10px] font-semibold text-white">label</span>
                          </div>
                        )}
                        {/* Tooth - bbox outline only; the precise tooth-shaped fill appears
                            on hover via the mask PNG below. */}
                        {toothPct && (
                          <div
                            className={`absolute rounded-sm transition-opacity duration-150 ${
                              hoverTooth ? 'ring-4 ring-green-600' : 'ring-4 ring-green-500/80'
                            }`}
                            style={toothPct}
                            onMouseEnter={() => setHoverTooth(true)}
                            onMouseLeave={() => { setHoverTooth(false); setCursorPct(null); }}
                            onMouseMove={(e) => {
                              const el = imageContainerRef.current;
                              if (!el) return;
                              const r = el.getBoundingClientRect();
                              const px = (e.clientX - r.left) / r.width;
                              const py = (e.clientY - r.top) / r.height;
                              setCursorPct({
                                px: Math.max(0, Math.min(1, px)),
                                py: Math.max(0, Math.min(1, py)),
                              });
                            }}
                            title={img.tooth_area_mm2 != null ? `Tooth area: ${img.tooth_area_mm2.toFixed(1)} mm²` : 'Tooth blob'}
                          >
                            <span className="absolute -top-5 left-0 rounded bg-green-500/90 px-1.5 py-0.5 text-[10px] font-semibold text-white pointer-events-none">tooth</span>

                            {/* Precise tooth-shape mask PNG. Pre-generated server-side, cropped to
                                bbox, green where mask=1 and transparent elsewhere. Opacity is 0
                                when not hovering so it doesn't obscure the underlying photo. */}
                            {img.tooth_mask_url && (
                              <img
                                src={normalizeMediaUrl(img.tooth_mask_url)}
                                alt=""
                                aria-hidden="true"
                                className={`absolute inset-0 w-full h-full pointer-events-none transition-opacity duration-150 ${
                                  hoverTooth ? 'opacity-90' : 'opacity-0'
                                }`}
                              />
                            )}

                            {/* Area badge centered inside on hover */}
                            {hoverTooth && img.tooth_area_mm2 != null && (
                              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                <span className="rounded-md bg-white/95 px-3 py-1.5 text-sm font-bold text-green-900 ring-2 ring-green-700 shadow-lg">
                                  {img.tooth_area_mm2.toFixed(1)} mm²
                                </span>
                              </div>
                            )}

                            {/* Length label - just OUTSIDE the bbox at the left edge,
                                vertically centered. Parent canvas padding gives the badge
                                room to extend past the image without clipping. */}
                            {toothDims && img.tooth_major_axis_mm != null && (
                              <div className="absolute pointer-events-none" style={{ right: '100%', top: '50%', transform: 'translate(-8px, -50%)' }}>
                                <span className="inline-block whitespace-nowrap rounded-md bg-green-700 px-1.5 py-0.5 text-[10px] font-bold text-white shadow ring-1 ring-green-900/40">
                                  L: {img.tooth_major_axis_mm.toFixed(1)} mm
                                </span>
                              </div>
                            )}

                            {/* Width label - just OUTSIDE the bbox below, centered. */}
                            {toothDims && img.tooth_minor_axis_mm != null && (
                              <div className="absolute pointer-events-none" style={{ left: '50%', top: '100%', transform: 'translate(-50%, 8px)' }}>
                                <span className="inline-block whitespace-nowrap rounded-md bg-green-700 px-1.5 py-0.5 text-[10px] font-bold text-white shadow ring-1 ring-green-900/40">
                                  W: {img.tooth_minor_axis_mm.toFixed(1)} mm
                                </span>
                              </div>
                            )}

                            {/* Loupe: appears next to the tooth bbox while hovering. Shows the
                                source image at 3x zoom centered on the cursor, WITHOUT the
                                green mask overlay so the researcher sees real detail. Flips
                                to the LEFT of the bbox when the bbox sits in the right half
                                of the canvas, so the loupe stays inside the visible area. */}
                            {hoverTooth && cursorPct && containerSize && (() => {
                              const zoom = 3;
                              const loupeSize = 260;
                              const gap = 64;
                              const half = loupeSize / 2;
                              const bgW = containerSize.width * zoom;
                              const bgH = containerSize.height * zoom;
                              const bgX = cursorPct.px * bgW - half;
                              const bgY = cursorPct.py * bgH - half;
                              const bboxRightPct = (img.tooth_bbox[2] / w) * 100;
                              const onLeft = bboxRightPct > 60;
                              const posStyle = onLeft
                                ? { right: '100%', top: '50%', transform: `translate(-${gap}px, -50%)` }
                                : { left: '100%',  top: '50%', transform: `translate(${gap}px, -50%)` };
                              return (
                                <div
                                  className="absolute pointer-events-none"
                                  style={{ ...posStyle, width: loupeSize, height: loupeSize, zIndex: 50 }}
                                >
                                  <div
                                    className="relative w-full h-full overflow-hidden rounded-full bg-black ring-4 ring-white shadow-2xl"
                                    style={{ boxShadow: '0 8px 28px rgba(0,0,0,0.4), 0 0 0 2px rgba(0,0,0,0.25)' }}
                                  >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                      src={normalizeMediaUrl(img.image)}
                                      alt=""
                                      style={{
                                        position: 'absolute',
                                        width: bgW + 'px',
                                        height: bgH + 'px',
                                        left: (-bgX) + 'px',
                                        top: (-bgY) + 'px',
                                        maxWidth: 'none',
                                        maxHeight: 'none',
                                      }}
                                    />
                                    {/* Crosshair at loupe center */}
                                    <div className="absolute inset-0 flex items-center justify-center">
                                      <div className="relative h-5 w-5">
                                        <div className="absolute left-0 right-0 top-1/2 h-px bg-red-500" />
                                        <div className="absolute top-0 bottom-0 left-1/2 w-px bg-red-500" />
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Side panel */}
                  <aside className="md:w-96 border-l border-gray-200 p-5 overflow-y-auto max-h-[70vh] md:max-h-none text-sm">
                    {speciesMismatch && (
                      <div className="mb-4 rounded-md bg-amber-50 ring-1 ring-amber-200 p-3 text-xs text-amber-900">
                        <strong>Species mismatch:</strong> folder says <em>{img.label_name}</em>, OCR says <em>{img.museum_species}</em>.
                      </div>
                    )}

                    <FieldGroup title="Image">
                      <Field label="File" value={img.image?.split('/').pop()?.split('?')[0]} />
                      <Field label="Resolution" value={img.image_width && img.image_height ? `${img.image_width} × ${img.image_height}` : '-'} />
                      <Field label="Folder label" value={img.label_name || img.label} />
                    </FieldGroup>

                    {(img.mm_per_pixel != null || img.scale_bar_bbox) && (
                      <FieldGroup title="Calibration">
                        <Field label="mm / pixel" value={img.mm_per_pixel?.toFixed(5)} />
                        <Field label="Scale bar detected" value={img.scale_bar_detected ? 'yes' : 'no'} />
                      </FieldGroup>
                    )}

                    {(img.tooth_major_axis_mm != null || img.tooth_area_mm2 != null) && (
                      <FieldGroup title="Tooth Dimensions">
                        <Field label="Length" value={img.tooth_major_axis_mm != null ? `${img.tooth_major_axis_mm.toFixed(1)} mm` : '-'} />
                        <Field label="Width" value={img.tooth_minor_axis_mm != null ? `${img.tooth_minor_axis_mm.toFixed(1)} mm` : '-'} />
                        <Field label="Area" value={img.tooth_area_mm2 != null ? `${img.tooth_area_mm2.toFixed(1)} mm²` : '-'} />
                        {img.completeness_mm2 != null && (
                          <Field label="Completeness (mm²)" value={`${Math.round(img.completeness_mm2 * 100)} %`} />
                        )}
                      </FieldGroup>
                    )}

                    {(img.museum_specimen_id || img.museum_species) && (
                      <FieldGroup title="Museum Metadata (OCR)">
                        <Field label="Specimen ID" value={img.museum_specimen_id} />
                        <Field label="Species" value={img.museum_species} italic />
                        <Field label="Category" value={img.museum_completeness_category} />
                        <Field label="Locality" value={img.museum_metadata?.locality} />
                        <Field label="Formation" value={img.museum_metadata?.formation} />
                        <Field label="Age" value={img.museum_metadata?.age} />
                        <Field label="Collector" value={img.museum_metadata?.collector} />
                        <Field label="Date" value={img.museum_metadata?.date} />
                        {img.museum_metadata?.confidence != null && (
                          <Field label="Confidence" value={`${Math.round(img.museum_metadata.confidence * 100)} %`} />
                        )}
                      </FieldGroup>
                    )}

                    {img.ocr_label_text && (
                      <div className="mb-4 pb-4 border-b border-gray-100">
                        <button onClick={() => setShowOcrText(!showOcrText)}
                          className="text-xs font-medium text-blue-600 hover:underline">
                          {showOcrText ? 'Hide raw OCR text' : 'View raw OCR text'}
                        </button>
                        {showOcrText && (
                          <pre className="mt-2 rounded-md bg-gray-50 ring-1 ring-gray-200 p-2 text-[11px] text-gray-800 overflow-x-auto whitespace-pre-wrap">{img.ocr_label_text}</pre>
                        )}
                      </div>
                    )}
                  </aside>
                </div>

                {/* Footer: actions */}
                <div className="border-t border-gray-200 bg-gray-50 px-5 py-3 flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => onAction(img.id, 'mark_reviewed', 'Marked reviewed')}
                    className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-500"
                  >
                    {img.review_status === 'reviewed' ? 'Re-review' : 'Mark Reviewed'}
                  </button>
                  {speciesMismatch && (
                    <>
                      <button onClick={() => onAction(img.id, 'trust_ocr', `Trusted OCR (${img.museum_species})`)}
                        className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-500">
                        Trust OCR ({img.museum_species})
                      </button>
                      <button onClick={() => onAction(img.id, 'trust_folder', 'Kept folder label')}
                        className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50">
                        Trust Folder
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => onAction(img.id, 'mark_unreviewed', 'Reset to unreviewed')}
                    className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
                  >
                    Mark Unreviewed
                  </button>
                  <button
                    onClick={() => onAction(img.id, 'mark_excluded', 'Excluded')}
                    className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-500"
                  >
                    Exclude
                  </button>
                  <span className="ml-auto text-xs text-gray-500">
                    Acting advances to the next flagged image
                  </span>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  );
}

function OverlayToggle({ on, setOn, color, label, disabled }) {
  const dotColors = {
    green:  'bg-green-500',
    amber:  'bg-amber-500',
    sky:    'bg-sky-500',
    red:    'bg-red-500',
  };
  return (
    <button
      type="button"
      onClick={() => setOn(!on)}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ring-1 ring-inset transition-colors ${
        disabled
          ? 'bg-gray-100 text-gray-400 ring-gray-200 cursor-not-allowed'
          : on
            ? 'bg-white text-gray-900 ring-gray-300 hover:bg-gray-50'
            : 'bg-gray-50 text-gray-500 ring-gray-200 hover:bg-white'
      }`}
    >
      <span className={`h-2 w-2 rounded-full ${on && !disabled ? dotColors[color] : 'bg-gray-300'}`} />
      {label}
    </button>
  );
}

function FieldGroup({ title, children }) {
  return (
    <div className="mb-4 pb-4 border-b border-gray-100">
      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-2">{title}</h4>
      <dl className="space-y-1">{children}</dl>
    </div>
  );
}

function Field({ label, value, italic }) {
  if (value == null || value === '') return null;
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-xs text-gray-500 w-32 shrink-0">{label}</dt>
      <dd className={`text-xs text-gray-900 break-words ${italic ? 'italic' : ''}`}>{value}</dd>
    </div>
  );
}

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

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import Image from 'next/image';
import Layout from '../../../components/Layout';
import ReviewInspector from '../../../components/ReviewInspector';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { ArrowLeftIcon, ExclamationTriangleIcon, CheckIcon } from '@heroicons/react/24/outline';
import theme from '../../../theme';

function normalizeMediaUrl(url) {
  if (!url) return '';
  // Keep media same-origin. The API hands back an absolute URL on the public
  // hostname, and letting the image optimiser use that would send every
  // thumbnail request out over the internet and back. Trimming to the /media
  // path routes it through the internal rewrite to nginx instead.
  const media = url.indexOf('/media/');
  if (media >= 0) return url.slice(media);
  if (url.startsWith('http')) return url;
  if (url.startsWith('/')) return url;
  return '/' + url;
}

function describeReviewAction(action) {
  switch (action) {
    case 'mark_reviewed':
      return 'Mark this image as reviewed. It will be counted as approved in the pipeline. The audit log keeps the previous status.';
    case 'mark_unreviewed':
      return 'Send this image back to the unreviewed pool. Any previous reviewed/excluded decision will be cleared but the audit log keeps the history.';
    case 'mark_excluded':
      return 'Exclude this image from the dataset. It will not be used downstream until you re-include it.';
    case 'trust_ocr':
      return 'Re-label this image with the species OCR parsed from the catalog card and mark it as reviewed. The previous folder label is recorded in the audit log.';
    case 'trust_folder':
      return 'Keep the existing folder label (ignore the OCR species) and mark this image as reviewed.';
    default:
      return 'Are you sure?';
  }
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
  // Pending review action awaiting user confirmation (single-image or bulk).
  // Shape: { kind: 'single'|'bulk', imageId?, action, label }
  const [pendingAction, setPendingAction] = useState(null);

  // Filters arrive in the URL so the Summary tab can link straight to a
  // subset: ?flag=no_scale_bar, ?label=3, ?state=uncalibrated. Reading them
  // from the query rather than component state also makes any view shareable.
  const { flag: flagFilter, label: labelFilter, state: stateFilter } = router.query;
  const hasFilter = Boolean(flagFilter || labelFilter || stateFilter);

  // Images measured during this visit. They are kept visible even once they
  // stop matching the filter, because a reviewer working the "no calibration"
  // queue would otherwise watch each tooth disappear the instant they measured
  // it, with no chance to check the result. They drop out on the next refresh.
  const [justMeasured, setJustMeasured] = useState(() => new Set());

  const matchesFilters = useCallback((img) => {
    if (labelFilter && String(img.label) !== String(labelFilter)) return false;
    if (justMeasured.has(img.id)) return true;
    if (stateFilter === 'uncalibrated' && img.mm_per_pixel != null) return false;
    if (stateFilter === 'calibrated' && img.mm_per_pixel == null) return false;
    return true;
  }, [labelFilter, stateFilter, justMeasured]);

  // Categories after filtering, used for both display and the counts.
  const visibleCategories = useMemo(() => {
    if (!data) return [];
    return (data.categories || [])
      .filter((cat) => !flagFilter || cat.key === flagFilter)
      .map((cat) => ({ ...cat, items: (cat.items || []).filter(matchesFilters) }))
      .map((cat) => ({ ...cat, count: cat.items.length }));
  }, [data, flagFilter, matchesFilters]);

  const visibleTotal = useMemo(
    () => visibleCategories.reduce((n, c) => n + c.count, 0),
    [visibleCategories],
  );

  const clearFilters = () => router.push(`/datasets/${id}/review`);

  const filterLabel = useMemo(() => {
    const parts = [];
    if (flagFilter) {
      const cat = (data?.categories || []).find((c) => c.key === flagFilter);
      parts.push(cat ? cat.label : flagFilter);
    }
    if (labelFilter) {
      const first = (data?.categories || [])
        .flatMap((c) => c.items || [])
        .find((i) => String(i.label) === String(labelFilter));
      parts.push(first?.label_name || `label ${labelFilter}`);
    }
    if (stateFilter === 'uncalibrated') parts.push('no calibration');
    if (stateFilter === 'calibrated') parts.push('calibrated');
    return parts.join(' · ');
  }, [data, flagFilter, labelFilter, stateFilter]);

  // A flat ordered list of the VISIBLE flagged images, so the inspector's
  // Prev/Next walks the filtered set rather than the whole queue.
  const flatImages = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const cat of visibleCategories) {
      for (const img of cat.items || []) {
        if (seen.has(img.id)) continue;
        seen.add(img.id);
        out.push({ ...img, _category: cat.label });
      }
    }
    return out;
  }, [visibleCategories]);

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

  const performAction = async (imageId, action, label) => {
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

  const performBulkAction = async (action, label) => {
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

  // Per-image actions go through a confirmation prompt before firing. The
  // Inspector's onAction also goes through this so the user sees the same
  // confirm flow from the queue card, the inspector footer, and the dataset
  // detail page's Image-details dialog.
  const onAction = (imageId, action, label) => {
    setPendingAction({ kind: 'single', imageId, action, label });
  };

  const onBulkAction = (action, label) => {
    if (!selectedIds.size) {
      showStatus('error', 'Select at least one image first');
      return;
    }
    setPendingAction({ kind: 'bulk', action, label });
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
                <span className="font-medium text-amber-700">{data.total_problems ?? 0}</span> flagged ·
                {' '}<span className="font-medium text-gray-700">{data.total_pending_review ?? 0}</span> pending review ·
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

      {loading && <p className="text-sm text-gray-500">Loading review queue…</p>}

      {!loading && data && hasFilter && (
        <div className="mb-5 flex items-center gap-3 rounded-lg bg-blue-50 px-4 py-2.5 ring-1 ring-blue-200">
          <span className="text-sm text-blue-900">
            Showing <b>{visibleTotal}</b> {visibleTotal === 1 ? 'image' : 'images'} filtered by <b>{filterLabel}</b>
          </span>
          <button onClick={clearFilters} className="ml-auto text-sm font-medium text-blue-700 hover:underline">
            Show everything
          </button>
        </div>
      )}

      {!loading && data && hasFilter && visibleTotal === 0 && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-6 py-10 text-center">
          <h3 className="text-base font-semibold text-gray-900">Nothing matches this filter</h3>
          <p className="mt-1 text-sm text-gray-600">
            These images may already have been reviewed or excluded.
          </p>
          <button onClick={clearFilters} className="mt-3 text-sm font-medium text-blue-700 hover:underline">
            Show everything
          </button>
        </div>
      )}

      {!loading && data && !hasFilter && data.total_flagged === 0 && (
        <div className="rounded-xl border border-green-200 bg-green-50 px-6 py-10 text-center">
          <CheckIcon className="mx-auto h-10 w-10 text-green-500" />
          <h3 className="mt-3 text-lg font-semibold text-green-900">All clear</h3>
          <p className="mt-1 text-sm text-green-800">Every image in this dataset has been reviewed or excluded.</p>
        </div>
      )}

      {!loading && data && visibleCategories.map(cat => cat.count > 0 && (
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
        onImageUpdated={(updated) => {
          // Merge the new measurement into the queue in place, so the
          // inspector redraws with the tooth outline and size without
          // refetching the whole review queue.
          setData((prev) => prev && ({
            ...prev,
            categories: (prev.categories || []).map((cat) => ({
              ...cat,
              items: (cat.items || []).map((it) => (it.id === updated.id ? { ...it, ...updated } : it)),
            })),
          }));
          // Pin it so it survives the active filter. Measuring an image in the
          // "no calibration" queue makes it stop matching that filter at once,
          // which dropped it from the list and closed the inspector on top of
          // the reviewer before they could look at the result.
          setJustMeasured((prev) => new Set(prev).add(updated.id));
        }}
        onAction={(imgId, action, label) => {
          // The Inspector's actions also go through the shared confirm flow.
          // When confirmed, advance to the next flagged image (or close the
          // inspector if this was the last one).
          setPendingAction({
            kind: 'single',
            imageId: imgId,
            action,
            label,
            advanceInspector: true,
          });
        }}
        footerHint="Confirming the action advances to the next flagged image"
      />

      <ConfirmDialog
        isOpen={!!pendingAction}
        onClose={() => setPendingAction(null)}
        onConfirm={async () => {
          const p = pendingAction;
          setPendingAction(null);
          if (!p) return;
          if (p.kind === 'bulk') {
            await performBulkAction(p.action, p.label);
          } else if (p.kind === 'single') {
            await performAction(p.imageId, p.action, p.label);
            if (p.advanceInspector) {
              if (inspectorIndex >= 0 && inspectorIndex < flatImages.length - 1) {
                setInspectorImageId(flatImages[inspectorIndex + 1].id);
              } else {
                setInspectorImageId(null);
              }
            }
          }
        }}
        title={
          pendingAction
            ? (pendingAction.kind === 'bulk'
                ? `${pendingAction.label} on ${selectedIds.size} image${selectedIds.size === 1 ? '' : 's'}?`
                : `${pendingAction.label}?`)
            : ''
        }
        message={
          pendingAction
            ? (pendingAction.kind === 'bulk'
                ? `Apply "${pendingAction.label}" to ${selectedIds.size} selected image${selectedIds.size === 1 ? '' : 's'}. The audit log keeps a record per image.`
                : describeReviewAction(pendingAction.action))
            : ''
        }
        confirmLabel={pendingAction?.label || 'Confirm'}
        confirmTone={
          pendingAction?.action === 'mark_excluded' ? 'danger' : 'primary'
        }
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
        {/* An 80px thumbnail was being drawn from the full original, which for
            the newly imported photographs is 4948x3280 and several megabytes.
            Twenty rows meant tens of megabytes of image data for postage
            stamps. next/image resizes and caches on the server and defers
            offscreen rows, so a row costs a few kilobytes instead. */}
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-md ring-1 ring-gray-200 bg-gray-50">
          <Image
            src={normalizeMediaUrl(img.image)}
            alt={img.file_name || ''}
            fill
            sizes="80px"
            quality={55}
            className="object-cover"
            unoptimized={false}
          />
        </div>
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
          {/* Says at a glance that a person set this scale, not the detector.
              Without it a hand-measured row looks identical to an automatic
              one and there is no way to tell which numbers were checked. */}
          {img.scale_bar_source === 'manual' && (
            <span className="mt-1 inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800">
              measured by hand
            </span>
          )}
          {(() => {
            const folder = (img.label_name || '').trim();
            const ocr    = (img.museum_species || '').trim();
            const mismatch = !!folder && !!ocr && folder.toLowerCase() !== ocr.toLowerCase();
            return (
              <>
                {mismatch && (
                  <div className="mt-2 rounded-md bg-amber-50 ring-1 ring-amber-200 px-3 py-2 text-[11px] text-amber-900">
                    <strong>Species mismatch.</strong> Folder says <em>{folder}</em>, OCR says <em>{ocr}</em>.
                    Choose which one is correct: keep the folder label or relabel this image with the OCR species.
                  </div>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  <ActionButton onClick={onInspect} tone="neutral">
                    Inspect…
                  </ActionButton>
                  {mismatch ? (
                    <>
                      <ActionButton onClick={() => onAction(img.id, 'trust_folder', `Kept folder label (${folder})`)} disabled={acting} tone="primary">
                        Keep folder ({folder})
                      </ActionButton>
                      <ActionButton onClick={() => onAction(img.id, 'trust_ocr', `Relabeled to OCR (${ocr})`)} disabled={acting} tone="primary">
                        Relabel to OCR ({ocr})
                      </ActionButton>
                    </>
                  ) : (
                    <ActionButton onClick={() => onAction(img.id, 'mark_reviewed', 'Marked reviewed')} disabled={acting} tone="primary">
                      Mark Reviewed
                    </ActionButton>
                  )}
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
              </>
            );
          })()}
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


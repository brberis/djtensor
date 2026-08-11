/*
 * Shark AI
 * Author: Cristobal Barberis
 * License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
 * For academic use only. Commercial use is prohibited without prior written permission.
 * Contact: cristobal@barberis.com
 *
 * File: ReviewInspector.js
 * Copyright (c) 2024
 *
 * Full-image curation inspector with overlay toggles (tooth, scale bar,
 * label, ticks), live magnifier loupe on tooth hover, and per-image
 * action buttons. Shared between the dataset review queue page and the
 * dataset detail Image-details dialog so both surfaces give the same
 * inspection experience.
 */

import { Fragment, useEffect, useRef, useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { ArrowLeftIcon, ArrowRightIcon, ExclamationTriangleIcon, XMarkIcon } from '@heroicons/react/24/outline';

// Stored paths are URL-encoded; show the name the specimen is actually known by.
function displayFileName(url) {
  const raw = url?.split('/').pop()?.split('?')[0] || '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function normalizeMediaUrl(url) {
  if (!url) return '';
  // Same-origin: the API returns an absolute URL on the public hostname, so
  // the browser would fetch every photograph out over the internet and back
  // instead of straight from nginx. The inspector still loads the full
  // resolution file, which the loupe needs.
  const media = url.indexOf('/media/');
  if (media >= 0) return url.slice(media);
  if (url.startsWith('http')) return url;
  if (url.startsWith('/')) return url;
  return '/' + url;
}

// Physical references a reviewer can measure against.
//
// Ordered by how often they actually come up. Nearly every photograph that
// fails automatic measurement has a RULER or a scale card in frame; coins
// appear in a couple of dozen web-sourced images. The list used to lead with
// coins, which put the rare case in front of the common one.
const SCALE_REFERENCES = [
  { key: 'cm1', label: 'Ruler, 1 cm', mm: 10 },
  { key: 'cm2', label: 'Ruler, 2 cm', mm: 20 },
  { key: 'cm5', label: 'Ruler, 5 cm', mm: 50 },
  { key: 'inch', label: 'Scale card, 1 inch band', mm: 25.4 },
  { key: 'halfinch', label: 'Scale card, 0.5 inch row', mm: 12.7 },
  { key: 'cm3', label: 'Scale card, 3 cm row', mm: 30 },
  { key: 'nickel', label: 'US nickel (diameter)', mm: 21.21 },
  { key: 'quarter', label: 'US quarter (diameter)', mm: 24.26 },
  { key: 'penny', label: 'US penny (diameter)', mm: 19.05 },
  { key: 'dime', label: 'US dime (diameter)', mm: 17.91 },
  { key: 'custom', label: 'Custom distance…', mm: null },
];

export default function ReviewInspector({
  img,
  position,
  total,
  onClose,
  onPrev,
  onNext,
  onAction,
  onImageUpdated,
  showNav = true,
  footerHint,
}) {
  const [showTooth, setShowTooth] = useState(true);
  const [showScaleBar, setShowScaleBar] = useState(true);
  const [showLabel, setShowLabel] = useState(true);
  const [showTicks, setShowTicks] = useState(true);
  const [showOcrText, setShowOcrText] = useState(false);
  const [hoverTooth, setHoverTooth] = useState(false);
  const [cursorPct, setCursorPct] = useState(null);
  const [containerSize, setContainerSize] = useState(null);
  const imageContainerRef = useRef(null);

  // Manual scale: the reviewer clicks the two ends of something whose real
  // size is known, then says what it is. Points are held as fractions of the
  // container so they survive resizing, and are converted to original image
  // pixels only when sent.
  const [measuring, setMeasuring] = useState(false);
  const [points, setPoints] = useState([]);
  // Defaults to a ruler, because that is what is in nearly every frame the
  // detector could not read.
  const [referenceKey, setReferenceKey] = useState('cm1');
  const [customMm, setCustomMm] = useState('');
  const [savingScale, setSavingScale] = useState(false);
  const [scaleError, setScaleError] = useState(null);
  const [scaleResult, setScaleResult] = useState(null);

  // Coin helper: one click inside a round reference and the system measures
  // its diameter, which it does far more precisely than a hand can click two
  // edges. It never guesses WHICH coin - that stays with the reviewer.
  const [snapMode, setSnapMode] = useState(false);
  const [snapping, setSnapping] = useState(false);
  const [snapInfo, setSnapInfo] = useState(null);
  const [resettingScale, setResettingScale] = useState(false);

  // Cursor position while measuring, for the loupe. Picking the edge of a
  // coin or a ruler mark is a sub-pixel job at fit-to-screen size, so the
  // reviewer gets a magnified view of whatever is under the pointer.
  const [measureCursor, setMeasureCursor] = useState(null);

  useEffect(() => {
    setHoverTooth(false);
    setShowOcrText(false);
    setCursorPct(null);
    // Drop any half-finished measurement when moving to another image, so
    // points from one photograph can never be applied to the next.
    setMeasuring(false);
    setPoints([]);
    setScaleResult(null);
    setScaleError(null);
    setSnapMode(false);
    setSnapInfo(null);
    setMeasureCursor(null);
  }, [img?.id]);

  useEffect(() => {
    if (!img) return;
    const measure = () => {
      const el = imageContainerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setContainerSize({ width: rect.width, height: rect.height });
    };
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

  const isReviewed = img.review_status === 'reviewed';
  const isExcluded = img.review_status === 'excluded';

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
                        {displayFileName(img.image) || `Image #${img.id}`}
                      </Dialog.Title>
                      <p className="text-xs text-gray-500">{img._category || img.review_status || ''}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {showNav && total > 0 && (
                      <>
                        <span className="text-xs text-gray-500">{position} / {total}</span>
                        <button onClick={onPrev} disabled={position <= 1}
                          className="rounded-md p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-30">
                          <ArrowLeftIcon className="h-5 w-5" />
                        </button>
                        <button onClick={onNext} disabled={position >= total}
                          className="rounded-md p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-30">
                          <ArrowRightIcon className="h-5 w-5" />
                        </button>
                      </>
                    )}
                    <button onClick={onClose} className="rounded-md p-1 text-gray-500 hover:bg-gray-100">
                      <XMarkIcon className="h-5 w-5" />
                    </button>
                  </div>
                </div>

                {/* Body */}
                <div className="flex flex-col md:flex-row min-h-[600px]">
                  {/* Image with overlays */}
                  <div className="flex-1 bg-gray-50 p-4 flex flex-col">
                    <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-gray-500 font-medium">Overlays:</span>
                      <OverlayToggle on={showTooth}    setOn={setShowTooth}    color="green"  label="Tooth"      disabled={!img.tooth_bbox} />
                      <OverlayToggle on={showScaleBar} setOn={setShowScaleBar} color="amber"  label="Scale bar"  disabled={!img.scale_bar_bbox} />
                      <OverlayToggle on={showLabel}    setOn={setShowLabel}    color="sky"    label="Label"      disabled={!img.museum_metadata?.label_bbox} />
                      <OverlayToggle on={showTicks}    setOn={setShowTicks}    color="red"    label="Ticks"      disabled={!img.scale_bar_ticks?.positions?.length} />
                      <button
                        onClick={() => {
                          setMeasuring((on) => !on);
                          setPoints([]); setScaleResult(null); setScaleError(null);
                        }}
                        className={`ml-auto rounded-full px-3 py-1 text-xs font-medium ring-1 ${
                          measuring
                            ? 'bg-fuchsia-600 text-white ring-fuchsia-600'
                            : 'bg-white text-gray-700 ring-gray-300 hover:bg-gray-50'
                        }`}
                      >
                        {measuring ? 'Cancel' : 'Set scale manually'}
                      </button>

                      {/* Undo, offered ONLY for a scale a person set. Two
                          clicks in the wrong place would otherwise be
                          permanent, because the hand-set value replaces
                          whatever the detector had found. */}
                      {!measuring && img.scale_bar_source === 'manual' && (
                        <button
                          disabled={resettingScale}
                          onClick={async () => {
                            setResettingScale(true); setScaleError(null);
                            try {
                              const res = await fetch(`/api/datasets/image/${img.id}/reset-scale`, { method: 'POST' });
                              const data = await res.json();
                              if (!res.ok) throw new Error(data.message || 'Could not undo the manual scale');
                              setScaleResult(null);
                              setPoints([]);
                              if (data.image && onImageUpdated) onImageUpdated(data.image);
                            } catch (err) {
                              setScaleError(err.message);
                            } finally {
                              setResettingScale(false);
                            }
                          }}
                          className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ${
                            resettingScale
                              ? 'bg-gray-100 text-gray-400 ring-gray-200'
                              : 'bg-white text-amber-800 ring-amber-300 hover:bg-amber-50'
                          }`}
                          title="Discard the hand-set scale and go back to automatic detection"
                        >
                          {resettingScale ? 'Undoing…' : 'Undo manual scale'}
                        </button>
                      )}

                      {!measuring && scaleError && (
                        <span className="text-xs text-red-700">{scaleError}</span>
                      )}
                    </div>

                    {measuring && (
                      <div className="mb-3 rounded-lg bg-fuchsia-50 px-4 py-3 ring-1 ring-fuchsia-200">
                        <p className="text-sm text-fuchsia-900">
                          {snapping && 'Measuring that circle…'}
                          {!snapping && snapMode && 'Click once inside the coin.'}
                          {!snapping && !snapMode && points.length === 0 && 'Mark two points a known distance apart on the ruler, for example the 1 cm and 2 cm marks.'}
                          {!snapping && !snapMode && points.length === 1 && 'Now mark the second point.'}
                          {!snapping && !snapMode && points.length === 2 && 'Say what the distance between them is, then apply.'}
                        </p>

                        {/* The coin helper is deliberately quiet. Almost every
                            frame that fails automatic measurement has a ruler
                            or a scale card in it; coins turn up in a couple of
                            dozen web-sourced photographs. Leading with the
                            coin put the rare case in front of the common one. */}
                        {points.length < 2 && !snapping && (
                          snapMode ? (
                            <button
                              onClick={() => { setSnapMode(false); setScaleError(null); }}
                              className="mt-2 rounded-md px-2.5 py-1 text-xs font-medium bg-fuchsia-600 text-white ring-1 ring-fuchsia-600"
                            >
                              Cancel coin measuring
                            </button>
                          ) : (
                            <button
                              onClick={() => { setSnapMode(true); setScaleError(null); }}
                              className="mt-1 text-xs text-fuchsia-700 underline hover:text-fuchsia-900"
                            >
                              This photo has a coin instead of a ruler
                            </button>
                          )
                        )}

                        {snapInfo && (
                          <p className="mt-2 text-xs text-fuchsia-800">
                            Measured a circle <b>{snapInfo.diameter_px} px</b> across.
                            Now say which coin it is — the size below will tell you if it is the right one.
                          </p>
                        )}

                        {points.length === 2 && (
                          <div className="mt-3 flex flex-wrap items-end gap-3">
                            <label className="text-xs text-fuchsia-900">
                              <span className="block mb-1 font-medium">What did you measure?</span>
                              <select
                                value={referenceKey}
                                onChange={(e) => { setReferenceKey(e.target.value); setScaleResult(null); }}
                                className="rounded-md border-gray-300 text-sm"
                              >
                                {SCALE_REFERENCES.map((r) => (
                                  <option key={r.key} value={r.key}>
                                    {r.label}{r.mm ? ` — ${r.mm} mm` : ''}
                                  </option>
                                ))}
                              </select>
                            </label>

                            {referenceKey === 'custom' && (
                              <label className="text-xs text-fuchsia-900">
                                <span className="block mb-1 font-medium">Distance in mm</span>
                                <input
                                  type="number" step="0.01" min="0"
                                  value={customMm}
                                  onChange={(e) => { setCustomMm(e.target.value); setScaleResult(null); }}
                                  className="w-28 rounded-md border-gray-300 text-sm"
                                  placeholder="e.g. 21.21"
                                />
                              </label>
                            )}

                            <button
                              disabled={savingScale}
                              onClick={async () => {
                                const ref = SCALE_REFERENCES.find((r) => r.key === referenceKey);
                                const mm = ref?.mm ?? parseFloat(customMm);
                                if (!mm || mm <= 0) { setScaleError('Enter a positive distance in mm.'); return; }
                                setSavingScale(true); setScaleError(null);
                                try {
                                  const [a, b] = points;
                                  const res = await fetch(`/api/datasets/image/${img.id}/manual-scale`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                      x1: a.px * w, y1: a.py * h,
                                      x2: b.px * w, y2: b.py * h,
                                      reference_mm: mm,
                                      reference_label: ref?.label || 'custom distance',
                                    }),
                                  });
                                  const data = await res.json();
                                  if (!res.ok) throw new Error(data.message || 'Could not set the scale');
                                  setScaleResult(data);
                                  // Leave measuring mode and hand the updated
                                  // image back, so the photograph immediately
                                  // shows the tooth outline with its size the
                                  // same way an automatically measured one
                                  // does. Staying in the marking UI made it
                                  // look as though nothing had happened.
                                  if (data.image && onImageUpdated) onImageUpdated(data.image);
                                  setMeasuring(false);
                                  setSnapMode(false);
                                  setSnapInfo(null);
                                  setPoints([]);
                                } catch (err) {
                                  setScaleError(err.message);
                                } finally {
                                  setSavingScale(false);
                                }
                              }}
                              className={`rounded-md px-3 py-1.5 text-sm font-medium text-white ${
                                savingScale ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'
                              }`}
                            >
                              {savingScale ? 'Applying…' : 'Apply scale'}
                            </button>

                            <button
                              onClick={() => { setPoints([]); setScaleResult(null); setScaleError(null); }}
                              className="text-xs text-fuchsia-700 hover:underline"
                            >
                              Clear points
                            </button>
                          </div>
                        )}

                        {scaleError && <p className="mt-2 text-sm text-red-700">{scaleError}</p>}

                        {/* Show what the measurement implies before the
                            reviewer moves on. A wrong click is obvious in
                            millimetres and invisible in mm/px. */}
                      </div>
                    )}

                    {/* Outcome of a hand-set scale, shown AFTER leaving the
                        marking UI. The reviewer's answer is the tooth size on
                        the photograph, not the mm/px, so the banner stays
                        short and the measurement itself is drawn on the image
                        exactly as it is for an automatically measured tooth. */}
                    {!measuring && scaleResult && (
                      <div className="mb-3 rounded-lg bg-emerald-50 px-4 py-3 ring-1 ring-emerald-200">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <p className="text-sm text-emerald-900">
                            Measured by hand:{' '}
                            {scaleResult.tooth_length_mm != null ? (
                              <>this tooth is <b>{scaleResult.tooth_length_mm} mm</b> across
                                {' '}<span className="text-emerald-700">({scaleResult.mm_per_pixel?.toFixed(5)} mm per pixel)</span>
                              </>
                            ) : (
                              <>scale saved at <b>{scaleResult.mm_per_pixel?.toFixed(5)} mm per pixel</b></>
                            )}
                          </p>
                          <button
                            onClick={() => { setMeasuring(true); setPoints([]); setScaleResult(null); setScaleError(null); }}
                            className="rounded-md px-2.5 py-1 text-xs font-medium bg-white text-emerald-800 ring-1 ring-emerald-300 hover:bg-emerald-50"
                          >
                            Measure again
                          </button>
                        </div>
                        {!scaleResult.tooth_found && (
                          <p className="mt-1 text-xs text-amber-700">
                            The scale was saved, but no tooth outline was found in this image, so no tooth size could be computed.
                          </p>
                        )}
                      </div>
                    )}

                    <div className="relative flex-1 bg-white rounded-lg ring-1 ring-gray-200 flex items-center justify-center p-12">
                      <div
                        ref={imageContainerRef}
                        // Shrink-wrap the photograph instead of imposing a
                        // box on it. This element defines the coordinate
                        // space for every overlay AND for manual-scale
                        // clicks, so it has to be exactly the rendered image
                        // and nothing more. It previously used width:100%
                        // with an aspect-ratio plus maxHeight:64vh; whenever
                        // the height clamp bit, the box stayed full width,
                        // object-contain letterboxed the image inside it,
                        // and every overlay drew wider than the photo. Worse,
                        // click fractions were taken against this box and
                        // then multiplied by the image width, so a correctly
                        // clicked coin yielded too large a distance and a
                        // wrong mm/px.
                        className={`relative inline-block max-w-full ${measuring ? 'cursor-crosshair' : ''}`}
                        onMouseMove={(e) => {
                          if (!measuring) { if (measureCursor) setMeasureCursor(null); return; }
                          const el = imageContainerRef.current;
                          if (!el) return;
                          const r = el.getBoundingClientRect();
                          setMeasureCursor({
                            px: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
                            py: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
                          });
                        }}
                        onMouseLeave={() => setMeasureCursor(null)}
                        onClick={async (e) => {
                          if (!measuring || snapping) return;
                          const el = imageContainerRef.current;
                          if (!el) return;
                          const r = el.getBoundingClientRect();
                          const px = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
                          const py = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
                          setScaleResult(null);
                          setScaleError(null);

                          // Coin mode: hand the point to the backend and let
                          // it measure the circle, then drop the two ends in
                          // as if they had been clicked by hand.
                          if (snapMode) {
                            setSnapping(true);
                            try {
                              const res = await fetch(`/api/datasets/image/${img.id}/find-circle`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ x: px * w, y: py * h }),
                              });
                              const data = await res.json();
                              if (!res.ok) throw new Error(data.message || 'Could not measure a circle there');
                              setPoints([
                                { px: data.x1 / w, py: data.y1 / h },
                                { px: data.x2 / w, py: data.y2 / h },
                              ]);
                              setSnapInfo(data);
                              setSnapMode(false);
                            } catch (err) {
                              // Do not strand the reviewer. If no circle was
                              // found where they clicked, drop out of coin
                              // mode and keep the click as an ordinary first
                              // point, so marking two points by hand carries
                              // straight on. Previously the click was simply
                              // swallowed and nothing appeared on the image.
                              setSnapMode(false);
                              setPoints([{ px, py }]);
                              setScaleError(
                                `${err.message}. Coin measuring is off; mark the two points by hand instead.`,
                              );
                            } finally {
                              setSnapping(false);
                            }
                            return;
                          }

                          // A third click starts a fresh measurement rather
                          // than silently ignoring it.
                          setPoints((prev) => (prev.length >= 2 ? [{ px, py }] : [...prev, { px, py }]));
                          setSnapInfo(null);
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {/* In normal flow, not absolute: the image sizes the
                            wrapper, so overlay percentages and click
                            fractions are both measured against the photo
                            itself. No letterboxing can open up between
                            them. */}
                        <img
                          src={normalizeMediaUrl(img.image)}
                          alt={img.file_name || ''}
                          className="block w-auto h-auto max-w-full"
                          style={{ maxHeight: '64vh' }}
                          // The wrapper now takes its size from this image,
                          // so it has none until the image has loaded. The
                          // loupe reads that size, so re-measure on load.
                          onLoad={() => {
                            const el = imageContainerRef.current;
                            if (!el) return;
                            const r = el.getBoundingClientRect();
                            setContainerSize({ width: r.width, height: r.height });
                          }}
                        />
                        {scaleBarPct && (
                          <div className="absolute ring-4 ring-amber-500/80 rounded-sm pointer-events-none" style={scaleBarPct} title="Scale bar">
                            <span className="absolute -top-5 left-0 rounded bg-amber-500/90 px-1.5 py-0.5 text-[10px] font-semibold text-white">scale bar</span>
                          </div>
                        )}
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
                        {/* Manual-scale markers: the two clicked ends and the
                            line between them, so the reviewer sees exactly
                            what distance they are about to declare. */}
                        {points.length === 2 && (() => {
                          const [a, b] = points;
                          const dx = (b.px - a.px) * 100;
                          const dy = (b.py - a.py) * 100;
                          const len = Math.sqrt(dx * dx + dy * dy);
                          const angle = Math.atan2(dy, dx) * (180 / Math.PI);
                          return (
                            <div
                              className="absolute bg-fuchsia-500 pointer-events-none"
                              style={{
                                left: `${a.px * 100}%`, top: `${a.py * 100}%`,
                                width: `${len}%`, height: '2px',
                                transform: `rotate(${angle}deg)`, transformOrigin: '0 50%',
                              }}
                            />
                          );
                        })()}
                        {/* Crosshairs, not dots. A filled dot covers the very
                            edge the reviewer is trying to mark, so it hides
                            the thing being measured. Two thin arms leave the
                            exact point visible at their intersection, and the
                            gap in the middle keeps it uncovered entirely. */}
                        {points.map((p, i) => (
                          <div
                            key={`pt-${i}`}
                            className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                            style={{ left: `${p.px * 100}%`, top: `${p.py * 100}%`, width: '28px', height: '28px' }}
                          >
                            {['top', 'bottom', 'left', 'right'].map((side) => {
                              const vertical = side === 'top' || side === 'bottom';
                              return (
                                <div
                                  key={side}
                                  className="absolute bg-fuchsia-500"
                                  style={{
                                    // Arms stop short of the centre so the
                                    // marked pixel itself is never painted.
                                    ...(vertical
                                      ? { left: '50%', width: '2px', height: '10px', marginLeft: '-1px',
                                          [side]: 0 }
                                      : { top: '50%', height: '2px', width: '10px', marginTop: '-1px',
                                          [side]: 0 }),
                                    boxShadow: '0 0 0 1px rgba(255,255,255,0.9)',
                                  }}
                                />
                              );
                            })}
                          </div>
                        ))}
                        {/* Measuring loupe, in the manner of a document
                            scanner picking up a paper edge: the magnified
                            view sits BESIDE the pointer, never under it, so
                            the pixel being chosen is never hidden by the
                            thing helping you choose it. It flips side and
                            vertical offset near the edges of the frame so it
                            always stays on the image. */}
                        {measuring && measureCursor && containerSize && (() => {
                          const zoom = 5;          // edges are a sub-pixel job
                          const size = 180;
                          const gap = 28;
                          const half = size / 2;
                          const cx = measureCursor.px * containerSize.width;
                          const cy = measureCursor.py * containerSize.height;
                          // Keep the loupe clear of the pointer and inside
                          // the frame; flip rather than let it run off.
                          const flipX = cx + gap + size > containerSize.width;
                          const flipY = cy - gap - size < 0;
                          const left = flipX ? cx - gap - size : cx + gap;
                          const top = flipY ? cy + gap : cy - gap - size;
                          const bgW = containerSize.width * zoom;
                          const bgH = containerSize.height * zoom;
                          return (
                            <div
                              className="absolute pointer-events-none"
                              style={{ left: `${left}px`, top: `${top}px`, width: size, height: size, zIndex: 60 }}
                            >
                              <div
                                className="relative w-full h-full overflow-hidden rounded-full bg-black ring-4 ring-white"
                                style={{ boxShadow: '0 8px 28px rgba(0,0,0,0.45), 0 0 0 2px rgba(0,0,0,0.25)' }}
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={normalizeMediaUrl(img.image)}
                                  alt=""
                                  style={{
                                    position: 'absolute',
                                    width: bgW + 'px', height: bgH + 'px',
                                    left: (-(measureCursor.px * bgW - half)) + 'px',
                                    top: (-(measureCursor.py * bgH - half)) + 'px',
                                    maxWidth: 'none', maxHeight: 'none',
                                    imageRendering: 'pixelated',
                                  }}
                                />
                                {/* Same crosshair as the placed markers, so
                                    what you line up is what gets recorded. */}
                                <div className="absolute inset-0 flex items-center justify-center">
                                  <div className="relative" style={{ width: 34, height: 34 }}>
                                    <div className="absolute left-1/2 top-0 bg-fuchsia-500" style={{ width: 1.5, height: 12, marginLeft: -0.75 }} />
                                    <div className="absolute left-1/2 bottom-0 bg-fuchsia-500" style={{ width: 1.5, height: 12, marginLeft: -0.75 }} />
                                    <div className="absolute top-1/2 left-0 bg-fuchsia-500" style={{ height: 1.5, width: 12, marginTop: -0.75 }} />
                                    <div className="absolute top-1/2 right-0 bg-fuchsia-500" style={{ height: 1.5, width: 12, marginTop: -0.75 }} />
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })()}
                        {labelPct && (
                          <div className="absolute ring-4 ring-sky-500/80 rounded-sm pointer-events-none" style={labelPct} title="Catalog label">
                            <span className="absolute -top-5 left-0 rounded bg-sky-500/90 px-1.5 py-0.5 text-[10px] font-semibold text-white">label</span>
                          </div>
                        )}
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
                          >
                            <span className="absolute -top-5 left-0 rounded bg-green-500/90 px-1.5 py-0.5 text-[10px] font-semibold text-white pointer-events-none">tooth</span>

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

                            {hoverTooth && img.tooth_area_mm2 != null && (
                              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                <span className="rounded-md bg-white/95 px-3 py-1.5 text-sm font-bold text-green-900 ring-2 ring-green-700 shadow-lg">
                                  {img.tooth_area_mm2.toFixed(1)} mm²
                                </span>
                              </div>
                            )}

                            {toothDims && img.tooth_major_axis_mm != null && (
                              <div className="absolute pointer-events-none" style={{ right: '100%', top: '50%', transform: 'translate(-8px, -50%)' }}>
                                <span className="inline-block whitespace-nowrap rounded-md bg-green-700 px-1.5 py-0.5 text-[10px] font-bold text-white shadow ring-1 ring-green-900/40">
                                  L: {img.tooth_major_axis_mm.toFixed(1)} mm
                                </span>
                              </div>
                            )}

                            {toothDims && img.tooth_minor_axis_mm != null && (
                              <div className="absolute pointer-events-none" style={{ left: '50%', top: '100%', transform: 'translate(-50%, 8px)' }}>
                                <span className="inline-block whitespace-nowrap rounded-md bg-green-700 px-1.5 py-0.5 text-[10px] font-bold text-white shadow ring-1 ring-green-900/40">
                                  W: {img.tooth_minor_axis_mm.toFixed(1)} mm
                                </span>
                              </div>
                            )}

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
                {onAction && (
                  <div className="border-t border-gray-200 bg-gray-50 px-5 py-3 flex flex-wrap items-center gap-2">
                    {!isReviewed && !speciesMismatch && (
                      <button
                        onClick={() => onAction(img.id, 'mark_reviewed', 'Marked reviewed')}
                        className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-500"
                      >
                        Mark Reviewed
                      </button>
                    )}
                    {!isReviewed && speciesMismatch && (
                      <>
                        <button onClick={() => onAction(img.id, 'trust_folder', `Kept folder label (${img.label_name})`)}
                          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-500">
                          Keep folder ({img.label_name})
                        </button>
                        <button onClick={() => onAction(img.id, 'trust_ocr', `Relabeled to OCR (${img.museum_species})`)}
                          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-500">
                          Relabel to OCR ({img.museum_species})
                        </button>
                      </>
                    )}
                    {(isReviewed || isExcluded) && (
                      <button
                        onClick={() => onAction(img.id, 'mark_unreviewed', 'Reset to unreviewed')}
                        className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
                      >
                        Mark Unreviewed
                      </button>
                    )}
                    {!isExcluded && (
                      <button
                        onClick={() => onAction(img.id, 'mark_excluded', 'Excluded')}
                        className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-500"
                      >
                        Exclude
                      </button>
                    )}
                    {footerHint && (
                      <span className="ml-auto text-xs text-gray-500">{footerHint}</span>
                    )}
                  </div>
                )}
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

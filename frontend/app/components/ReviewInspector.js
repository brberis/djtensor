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

function normalizeMediaUrl(url) {
  if (!url) return '';
  if (url.startsWith('http')) return url;
  if (url.startsWith('/')) return url;
  return '/' + url;
}

export default function ReviewInspector({
  img,
  position,
  total,
  onClose,
  onPrev,
  onNext,
  onAction,
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

  useEffect(() => {
    setHoverTooth(false);
    setShowOcrText(false);
    setCursorPct(null);
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
                        {img.image?.split('/').pop()?.split('?')[0] || `Image #${img.id}`}
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
                    </div>

                    <div className="relative flex-1 bg-white rounded-lg ring-1 ring-gray-200 flex items-center justify-center p-12">
                      <div ref={imageContainerRef} className="relative" style={{ aspectRatio: `${w} / ${h}`, width: '100%', maxHeight: '64vh' }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={normalizeMediaUrl(img.image)}
                          alt={img.file_name || ''}
                          className="absolute inset-0 w-full h-full object-contain"
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
                    {!isReviewed && (
                      <button
                        onClick={() => onAction(img.id, 'mark_reviewed', 'Marked reviewed')}
                        className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-500"
                      >
                        Mark Reviewed
                      </button>
                    )}
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

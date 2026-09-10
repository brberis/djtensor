/*
 * Shark AI
 * Author: Cristobal Barberis
 *
 * Animated replay of Katie's shape-completeness score for one tooth.
 *
 * The backend replays her algorithm and checks the replay against her own
 * function before sending it (GET /api/datasets/image/<id>/shape-trace), so
 * every pose drawn here is one her code actually evaluated, and the final
 * colouring is her pixel result, not a redrawing of it. The only frame that
 * is not part of her method is "True size", which is labelled as context.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  chain, easeInOut, lerp, lerpMatrix, outlinePath, proportionsPose,
  resizedPose, scale, searchPose, toSvg, translate,
} from '../utils/shapeTraceMath';

const FRAGMENT = '#2a78d6';
const TEMPLATE_FILL = '#e6e9ee';
const TEMPLATE_STROKE = '#64748b';
const INK = '#334155';
const MUTED = '#64748b';

// SVG window onto the 512 padded canvas: the 256 working square plus margin.
const VIEW = { x: 80, y: 80, w: 352, h: 352 };

// Template-choice layout, in canvas units.
const THUMB = 62;
const THUMB_Y = 138;
const THUMB_X = [130, 214, 298, 382];
const LINE = { x0: 110, x1: 402, y: 252 };
const FRAG_THUMB = { cx: 256, cy: 340, size: 70 };

const SEARCH_TWEEN = 200;
const SEARCH_HOLD = 130;
const SETTLE = 600;

const fmt = (n, d = 0) => (n == null ? '-' : Number(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }));
const clamp01 = (x) => Math.min(1, Math.max(0, x));

function buildTimeline(hasTrueSize, candidates) {
  const segs = [];
  let t = 0;
  const add = (id, dur) => { segs.push({ id, start: t, end: t + dur }); t += dur; };
  add('template', 3600);
  if (hasTrueSize) add('truesize', 3200);
  add('resize', hasTrueSize ? 3000 : 3600);
  add('centre', 2000);
  add('search', candidates * (SEARCH_TWEEN + SEARCH_HOLD) + SETTLE + 500);
  add('score', 3800);
  return { segs, total: t };
}

const STEP_LABELS = {
  template: 'Template',
  truesize: 'True size',
  resize: 'Resize',
  centre: 'Centre',
  search: 'Search',
  score: 'Score',
};

function frameAt(trace, timeline, t) {
  const { segs } = timeline;
  const seg = segs.find((s) => t < s.end) || segs[segs.length - 1];
  const local = Math.min(t, seg.end) - seg.start;
  const { pad, canvas } = trace.canvas;
  const sel = trace.selection;
  const q = sel.quartile;
  const hasTrue = segs.some((s) => s.id === 'truesize');
  const idx = segs.indexOf(seg);

  const templateThumb = chain(translate(THUMB_X[q - 1], THUMB_Y), scale(THUMB / 256), translate(-128, -128));
  const templateMain = resizedPose(pad);
  const fragThumb = proportionsPose(trace.fragment.fit_scale, FRAG_THUMB.size, FRAG_THUMB.cx, FRAG_THUMB.cy);
  const trueK = Math.min(trace.fragment.true_scale || 1, 1.25);
  const [tcx, tcy] = trace.centroid.template;
  const fragTrue = proportionsPose(trace.fragment.fit_scale, 256 * trueK, tcx, tcy);
  const fragResized = resizedPose(pad);
  const base = { pad, canvas, centroidShift: trace.centroid.shift, center: trace.search.center };

  const f = {
    seg, local, idx,
    overview: 0,
    markerX: LINE.x0,
    highlight: 0,
    templateM: templateMain,
    fragM: fragResized,
    fragFill: 0.35,
    frame: 0,
    centroids: 0,
    candidate: -1,
    settled: false,
    regions: 0,
    counters: 0,
  };

  const aspectX = (a) => {
    const e = sel.edges;
    const v = Math.min(e[e.length - 1], Math.max(e[0], a));
    return LINE.x0 + ((v - e[0]) / (e[e.length - 1] - e[0])) * (LINE.x1 - LINE.x0);
  };

  if (seg.id === 'template') {
    f.overview = 1;
    f.templateM = templateThumb;
    f.fragM = fragThumb;
    f.markerX = lerp(LINE.x0, aspectX(sel.aspect), easeInOut(local / 1400));
    f.highlight = clamp01((local - 1400) / 500);
    return f;
  }

  // Leaving the overview: fade it, bring the chosen template to full size.
  const leaving = hasTrue ? seg.id === 'truesize' : seg.id === 'resize';
  if (leaving) {
    const p = easeInOut(local / 1400);
    f.overview = 1 - clamp01(local / 600);
    f.highlight = 1;
    f.markerX = aspectX(sel.aspect);
    f.templateM = lerpMatrix(templateThumb, templateMain, p);
  }

  if (seg.id === 'truesize') {
    f.fragM = lerpMatrix(fragThumb, fragTrue, easeInOut(local / 1400));
    return f;
  }
  if (seg.id === 'resize') {
    const from = hasTrue ? fragTrue : fragThumb;
    const p = easeInOut(local / 1500);
    f.fragM = lerpMatrix(from, fragResized, p);
    f.frame = clamp01((local - 900) / 500);
    return f;
  }

  f.frame = 1;
  if (seg.id === 'centre') {
    const p = easeInOut(local / 1000);
    f.fragM = searchPose({ ...base, centroidShift: trace.centroid.shift.map((v) => v * p) });
    f.centroids = 1;
    f.centreProgress = p;
    return f;
  }

  const cands = trace.search.candidates;
  const best = trace.search.best;
  const paramsOf = (c) => ({ flipScale: c.flipped ? -1 : 1, angle: c.angle, dx: c.dx, dy: c.dy });
  const start = { flipScale: 1, angle: 0, dx: 0, dy: 0 };

  if (seg.id === 'search') {
    const slot = SEARCH_TWEEN + SEARCH_HOLD;
    const i = Math.min(cands.length - 1, Math.floor(local / slot));
    const inSweep = local < cands.length * slot;
    let from; let to; let p;
    if (inSweep) {
      from = i === 0 ? start : paramsOf(cands[i - 1]);
      to = paramsOf(cands[i]);
      p = easeInOut((local - i * slot) / SEARCH_TWEEN);
      f.candidate = i;
    } else {
      from = paramsOf(cands[cands.length - 1]);
      to = paramsOf(best);
      p = easeInOut((local - cands.length * slot) / SETTLE);
      f.candidate = cands.findIndex((c) => c.flipped === best.flipped && c.angle === best.angle);
      f.settled = true;
    }
    const params = {
      flipScale: lerp(from.flipScale, to.flipScale, p),
      angle: lerp(from.angle, to.angle, p),
      dx: lerp(from.dx, to.dx, p),
      dy: lerp(from.dy, to.dy, p),
    };
    f.fragM = searchPose({ ...base, ...params });
    f.visited = inSweep ? i + 1 : cands.length;
    return f;
  }

  // Score
  f.fragM = searchPose({ ...base, ...paramsOf(best) });
  f.candidate = cands.findIndex((c) => c.flipped === best.flipped && c.angle === best.angle);
  f.settled = true;
  f.visited = cands.length;
  f.regions = clamp01(local / 700);
  f.fragFill = 0.35 * (1 - f.regions);
  f.counters = easeInOut((local - 700) / 1500);
  return f;
}

function caption(trace, f) {
  const sel = trace.selection;
  const ctx = trace.context || {};
  const range = sel.templates.find((t) => t.quartile === sel.quartile)?.range || [];
  const species = ctx.species || 'this species';
  switch (f.seg.id) {
    case 'template':
      return `Template choice. Katie sorts complete ${species} teeth into four shape classes by height ÷ width. `
        + `This fragment's own height ÷ width is ${fmt(sel.aspect, 2)}, which falls in q${sel.quartile} `
        + `(${fmt(range[0], 2)} to ${fmt(range[1], 2)}), so only the q${sel.quartile} template is used.`;
    case 'truesize':
      return `True size, for comparison. From the ruler, this fragment has ${fmt(ctx.area_ratio * 100, 0)}% of the area `
        + `of a typical complete ${species} tooth (median of ${fmt(ctx.area_reference?.teeth)} teeth). `
        + 'This frame is not part of Katie\'s method: it shows what the next step discards.'
        + (trace.fragment.true_scale > 1.25 ? ' Drawn smaller than true size to fit.' : '');
    case 'resize': {
      const ratio = `${fmt(trace.resize.fragment_px / trace.resize.template_px, 2)}× the template's area`;
      if (Math.abs(trace.resize.scale_x - trace.resize.scale_y) < 1e-9) {
        return `Resize. The fragment is scaled evenly (×${fmt(trace.resize.scale_x, 3)}) until its longer side fills `
          + `the 256 × 256 square. Its shape is kept, but its real size is lost here: it is now ${ratio}.`;
      }
      return `Resize. The fragment is stretched to fill a 256 × 256 square (×${fmt(trace.resize.scale_x, 3)} wide, `
        + `×${fmt(trace.resize.scale_y, 3)} tall). Its real size is lost here: it is now ${ratio}.`;
    }
    case 'centre':
      return `Centre. The fragment is moved so the centre of its outline sits on the template's centre, `
        + `a shift of (${fmt(trace.centroid.shift[0], 1)}, ${fmt(trace.centroid.shift[1], 1)}) px. No rotation or scaling.`;
    case 'search': {
      const b = trace.search.best;
      const c = f.candidate >= 0 ? trace.search.candidates[f.candidate] : null;
      if (f.settled) {
        return `Best fit: ${b.flipped ? 'mirrored, ' : ''}${b.angle > 0 ? '+' : ''}${b.angle}°, shifted (${b.dx}, ${b.dy}) px, `
          + `overlap score (IoU) ${fmt(b.iou, 3)}. This is the pose Katie's code keeps.`;
      }
      return `Search. ${fmt(trace.search.evaluated)} poses are tried: ${trace.search.angles.length} rotations `
        + `(${trace.search.angles[0]}° to +${trace.search.angles[trace.search.angles.length - 1]}°), `
        + `${trace.search.shifts.length * trace.search.shifts.length} shifts, and a mirror flip. `
        + (c ? `Showing the best shift at ${c.flipped ? 'mirrored ' : ''}${c.angle > 0 ? '+' : ''}${c.angle}°: IoU ${fmt(c.iou, 3)}.` : '');
    }
    default: {
      const fin = trace.final;
      return `Score. Completeness = template pixels covered ÷ all template pixels = ${fmt(fin.covered_px)} ÷ `
        + `${fmt(fin.template_px)} = ${fmt(fin.completeness, 1)}%. The ${fmt(fin.overhang_px)} fragment pixels `
        + 'outside the template are not counted.';
    }
  }
}

function Readout({ trace, f }) {
  const ctx = trace.context || {};
  const fin = trace.final;
  const rows = [];
  const add = (k, v, strong) => rows.push({ k, v, strong });
  switch (f.seg.id) {
    case 'template': {
      const r = trace.selection.templates.find((t) => t.quartile === trace.selection.quartile)?.range;
      add('Fragment height ÷ width', fmt(trace.selection.aspect, 3), true);
      add('Template class', `q${trace.selection.quartile}`, true);
      add('Class range', r ? `${fmt(r[0], 3)} to ${fmt(r[1], 3)}` : '-');
      add('Fragment size', `${fmt(trace.fragment.native_w)} × ${fmt(trace.fragment.native_h)} px`);
      break;
    }
    case 'truesize':
      add('Area vs typical complete tooth', `${fmt(ctx.area_ratio * 100, 0)}%`, true);
      add('Typical complete area', `${fmt(ctx.area_reference?.median_mm2, 0)} mm²`);
      add('Fragment extent', trace.fragment.native_mm ? `${fmt(trace.fragment.native_mm[0], 1)} × ${fmt(trace.fragment.native_mm[1], 1)} mm` : '-');
      break;
    case 'resize':
      if (Math.abs(trace.resize.scale_x - trace.resize.scale_y) < 1e-9) {
        add('Scale', `× ${fmt(trace.resize.scale_x, 4)}`);
        add('Proportions', 'kept');
      } else {
        add('Scale, wide', `× ${fmt(trace.resize.scale_x, 4)}`);
        add('Scale, tall', `× ${fmt(trace.resize.scale_y, 4)}`);
        add('Proportions changed by', `${fmt(Math.abs(trace.resize.scale_x / trace.resize.scale_y - 1) * 100, 0)}%`);
      }
      add('Fragment ÷ template area', `${fmt(trace.resize.fragment_px / trace.resize.template_px, 2)}×`, true);
      break;
    case 'centre':
      add('Shift x', `${fmt(trace.centroid.shift[0], 2)} px`);
      add('Shift y', `${fmt(trace.centroid.shift[1], 2)} px`);
      break;
    case 'search': {
      const c = f.candidate >= 0 ? trace.search.candidates[f.candidate] : null;
      add('Poses evaluated', fmt(trace.search.evaluated));
      if (c) {
        add(f.settled ? 'Kept' : 'Showing', `${c.flipped ? 'mirrored ' : ''}${c.angle > 0 ? '+' : ''}${c.angle}°, (${c.dx}, ${c.dy})`);
        add('IoU', fmt(c.iou, 3), true);
      }
      break;
    }
    default: {
      const k = f.counters;
      add('Template pixels', fmt(fin.template_px));
      add('Covered', fmt(Math.round(fin.covered_px * k)));
      add('Missing', fmt(Math.round(fin.missing_px * k)));
      add('Outside template (ignored)', fmt(Math.round(fin.overhang_px * k)));
      add('Shape completeness', `${fmt(fin.completeness * k, 1)}%`, true);
    }
  }
  return (
    <dl className="space-y-2">
      {rows.map((r) => (
        <div key={r.k} className="flex items-baseline justify-between gap-3">
          <dt className="text-gray-500">{r.k}</dt>
          <dd className={`tabular-nums text-right ${r.strong ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>{r.v}</dd>
        </div>
      ))}
    </dl>
  );
}

function IouStrip({ trace, f }) {
  const cands = trace.search.candidates;
  const max = Math.max(...cands.map((c) => c.iou));
  const min = Math.min(...cands.map((c) => c.iou));
  const best = trace.search.best;
  const firstMirrored = cands.findIndex((c) => c.flipped);
  return (
    <div>
      <div className="mb-1 flex justify-between text-[10px] uppercase tracking-wide text-gray-400">
        <span>Normal</span><span>Mirrored</span>
      </div>
      <div className="flex h-12 items-end gap-[3px]" aria-hidden="true">
        {cands.map((c, i) => {
          const seen = f.visited != null && i < f.visited;
          const isBest = c.flipped === best.flipped && c.angle === best.angle;
          const h = seen ? 18 + 82 * ((c.iou - min) / Math.max(1e-6, max - min)) : 8;
          let color = '#e5e7eb';
          if (seen) color = '#9cb9e0';
          if (seen && i === f.candidate && !f.settled) color = FRAGMENT;
          if (f.settled && isBest) color = FRAGMENT;
          return <div key={i} className="flex-1 rounded-t-sm transition-colors" style={{ height: `${h}%`, background: color, marginLeft: i === firstMirrored && i > 0 ? 6 : 0 }} title={`${c.flipped ? 'mirrored ' : ''}${c.angle}°: IoU ${c.iou.toFixed(3)}`} />;
        })}
      </div>
      <div className="mt-1 text-[10px] text-gray-400">Best IoU at each rotation, −10° to +8°</div>
    </div>
  );
}

export default function ShapeAnalysis({ imageId }) {
  const [trace, setTrace] = useState(null);
  const [error, setError] = useState(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const raf = useRef(null);
  const last = useRef(null);
  const tRef = useRef(0);
  const reduced = useRef(false);

  const seek = (v) => { tRef.current = v; setT(v); };

  useEffect(() => {
    reduced.current = typeof window !== 'undefined'
      && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  useEffect(() => {
    let cancelled = false;
    setTrace(null); setError(null); setPlaying(false); seek(0);
    if (!imageId) return undefined;
    fetch(`/api/datasets/image/${imageId}/shape-trace`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || 'The shape analysis could not be loaded.');
        return d;
      })
      .then((d) => { if (!cancelled) setTrace(d); })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [imageId]);

  const timeline = useMemo(
    () => (trace ? buildTimeline(!!trace.fragment.true_scale, trace.search.candidates.length) : null),
    [trace],
  );

  useEffect(() => {
    if (!timeline) return;
    if (reduced.current) { seek(timeline.total); setPlaying(false); } else { seek(0); setPlaying(true); }
  }, [timeline]);

  useEffect(() => {
    if (!playing || !timeline) return undefined;
    last.current = null;
    const tick = (now) => {
      if (last.current == null) last.current = now;
      const dt = now - last.current;
      last.current = now;
      const next = Math.min(timeline.total, tRef.current + dt);
      seek(next);
      if (next >= timeline.total) { setPlaying(false); return; }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, timeline]);

  if (error) {
    return <div className="flex flex-1 items-center justify-center rounded-lg border border-gray-200 bg-white p-8 text-sm text-gray-600">{error}</div>;
  }
  if (!trace || !timeline) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-lg border border-gray-200 bg-white p-8 text-sm text-gray-500">
        Replaying Katie&apos;s search on this tooth. The first time takes about ten seconds.
      </div>
    );
  }

  const f = frameAt(trace, timeline, t);
  const sel = trace.selection;
  const { pad } = trace.canvas;
  const ctx = trace.context || {};
  const fragmentPath = outlinePath(trace.fragment.outline_256);
  const done = t >= timeline.total;

  const jump = (id) => {
    const s = timeline.segs.find((x) => x.id === id);
    if (!s) return;
    if (reduced.current) { seek(s.end - 1); setPlaying(false); return; }
    seek(s.start); setPlaying(true);
  };

  const edgeX = (e) => LINE.x0 + ((e - sel.edges[0]) / (sel.edges[sel.edges.length - 1] - sel.edges[0])) * (LINE.x1 - LINE.x0);

  return (
    <div className="flex flex-1 flex-col gap-3">
      {/* Step rail and controls */}
      <div className="flex flex-wrap items-center gap-2">
        <ol className="flex flex-wrap items-center gap-1.5 text-xs">
          {timeline.segs.map((s, i) => {
            const state = i < f.idx || (done && i === f.idx) ? 'done' : i === f.idx ? 'current' : 'next';
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => jump(s.id)}
                  className={`rounded-full px-2.5 py-1 font-medium ring-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                    state === 'current' ? 'bg-blue-600 text-white ring-blue-600'
                      : state === 'done' ? 'bg-blue-50 text-blue-800 ring-blue-200 hover:bg-blue-100'
                        : 'bg-white text-gray-600 ring-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {i + 1}. {STEP_LABELS[s.id]}
                </button>
              </li>
            );
          })}
        </ol>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => { if (done) seek(0); setPlaying((p) => !p || done); }}
            className="rounded-md bg-white px-3 py-1 text-xs font-medium text-gray-700 ring-1 ring-gray-300 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            {playing ? 'Pause' : done ? 'Replay' : 'Play'}
          </button>
        </div>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-gray-200" aria-hidden="true">
        <div className="h-full bg-blue-600" style={{ width: `${(100 * t) / timeline.total}%` }} />
      </div>

      <div className="flex flex-1 flex-col gap-4 lg:flex-row">
        <div className="flex-1 rounded-lg border border-gray-200 bg-white p-2">
          <svg
            viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`}
            className="mx-auto block h-auto w-full max-w-[560px]"
            role="img"
            aria-label={caption(trace, f)}
          >
            <defs>
              <clipPath id="shape-analysis-square"><rect x={pad} y={pad} width="256" height="256" /></clipPath>
            </defs>

            {/* Template-choice overview */}
            <g opacity={f.overview}>
              {sel.templates.map((tpl) => {
                const chosen = tpl.quartile === sel.quartile;
                const m = chain(translate(THUMB_X[tpl.quartile - 1], THUMB_Y), scale(THUMB / 256), translate(-128, -128));
                return (
                  <g key={tpl.quartile}>
                    <rect
                      x={THUMB_X[tpl.quartile - 1] - THUMB / 2 - 5} y={THUMB_Y - THUMB / 2 - 5}
                      width={THUMB + 10} height={THUMB + 10} rx="4"
                      fill={chosen ? `rgba(42,120,214,${0.08 * f.highlight})` : 'none'}
                      stroke={chosen ? FRAGMENT : '#e5e7eb'} strokeOpacity={chosen ? f.highlight : 1}
                    />
                    {!chosen && (
                      <path d={outlinePath(tpl.outline)} transform={toSvg(m)} fill={TEMPLATE_FILL} stroke={TEMPLATE_STROKE} strokeWidth="1" vectorEffect="non-scaling-stroke" />
                    )}
                    <text x={THUMB_X[tpl.quartile - 1]} y={THUMB_Y + THUMB / 2 + 18} textAnchor="middle" fontSize="10" fontWeight="600" fill={chosen && f.highlight > 0.5 ? FRAGMENT : INK}>q{tpl.quartile}</text>
                    <text x={THUMB_X[tpl.quartile - 1]} y={THUMB_Y + THUMB / 2 + 30} textAnchor="middle" fontSize="8" fill={MUTED}>{tpl.range[0].toFixed(2)} to {tpl.range[1].toFixed(2)}</text>
                  </g>
                );
              })}
              {/* Aspect number line */}
              {sel.edges.slice(0, -1).map((e, i) => (
                <rect key={i} x={edgeX(e)} y={LINE.y - 5} width={edgeX(sel.edges[i + 1]) - edgeX(e)} height="10"
                  fill={i + 1 === sel.quartile ? `rgba(42,120,214,${0.12 + 0.2 * f.highlight})` : (i % 2 ? '#f1f5f9' : '#e2e8f0')} />
              ))}
              {sel.edges.map((e, i) => (
                <g key={`e${i}`}>
                  <line x1={edgeX(e)} x2={edgeX(e)} y1={LINE.y - 8} y2={LINE.y + 8} stroke={MUTED} strokeWidth="0.8" />
                  <text x={edgeX(e)} y={LINE.y + 20} textAnchor="middle" fontSize="7.5" fill={MUTED}>{e.toFixed(2)}</text>
                </g>
              ))}
              <text x={LINE.x0} y={LINE.y - 22} fontSize="8" fill={MUTED}>height ÷ width</text>
              <g transform={`translate(${f.markerX} 0)`}>
                <line x1="0" x2="0" y1={LINE.y - 12} y2={LINE.y + 8} stroke={FRAGMENT} strokeWidth="1.6" />
                <path d={`M-4.5,${LINE.y - 18} L4.5,${LINE.y - 18} L0,${LINE.y - 11} Z`} fill={FRAGMENT} />
              </g>
              <text x={FRAG_THUMB.cx} y={FRAG_THUMB.cy + FRAG_THUMB.size / 2 + 16} textAnchor="middle" fontSize="9" fill={INK}>
                fragment, height ÷ width = {sel.aspect.toFixed(2)}
              </text>
            </g>

            {/* The 256 working square: the score is taken inside it only. */}
            <g opacity={f.frame}>
              <rect x={pad} y={pad} width="256" height="256" fill="none" stroke="#94a3b8" strokeDasharray="3 3" strokeWidth="0.8" />
              <text x={pad} y={pad + 256 + 12} fontSize="8" fill={MUTED} stroke="#fff" strokeWidth="3" paintOrder="stroke">
                256 × 256 working square: only pixels inside it are scored
              </text>
            </g>

            {/* Chosen template */}
            <path d={outlinePath(trace.template.outline_256)} transform={toSvg(f.templateM)}
              fill={TEMPLATE_FILL} fillOpacity={1 - f.regions} stroke={TEMPLATE_STROKE} strokeWidth="1.2" vectorEffect="non-scaling-stroke" />

            {/* Katie's pixel result, faded in at the end */}
            {f.regions > 0 && (
              <image href={trace.final.regions_png} x={pad} y={pad} width="256" height="256" opacity={f.regions}
                style={{ imageRendering: 'pixelated' }} preserveAspectRatio="none" />
            )}

            {/* Fragment. Once scored, clipped to the square: Katie's crop drops the rest. */}
            <path d={fragmentPath} transform={toSvg(f.fragM)} fill={FRAGMENT} fillOpacity={f.fragFill}
              stroke={FRAGMENT} strokeWidth="1.4" vectorEffect="non-scaling-stroke"
              clipPath={f.regions > 0 ? 'url(#shape-analysis-square)' : undefined} />

            {/* Template outline on top once the colours are in, so its edge stays readable */}
            {f.regions > 0 && (
              <path d={outlinePath(trace.template.outline_256)} transform={toSvg(f.templateM)} fill="none"
                stroke="#1f2937" strokeWidth="1" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" opacity={f.regions} />
            )}

            {/* Centroids */}
            {f.seg.id === 'centre' && (
              <g>
                <path d={`M${trace.centroid.template[0] - 6},${trace.centroid.template[1]} h12 M${trace.centroid.template[0]},${trace.centroid.template[1] - 6} v12`} stroke="#1f2937" strokeWidth="1.4" />
                <circle
                  cx={trace.centroid.fragment[0] + trace.centroid.shift[0] * (f.centreProgress || 0)}
                  cy={trace.centroid.fragment[1] + trace.centroid.shift[1] * (f.centreProgress || 0)}
                  r="3" fill={FRAGMENT} stroke="#fff" strokeWidth="1" />
              </g>
            )}
          </svg>
        </div>

        <aside className="w-full shrink-0 space-y-4 text-xs lg:w-64">
          <div className="rounded-lg border border-gray-200 bg-white p-3">
            <Readout trace={trace} f={f} />
          </div>
          {(f.seg.id === 'search' || f.seg.id === 'score') && (
            <div className="rounded-lg border border-gray-200 bg-white p-3">
              <IouStrip trace={trace} f={f} />
            </div>
          )}
          {f.seg.id === 'score' && (
            <div className="rounded-lg border border-gray-200 bg-white p-3">
              <div className="mb-2 font-medium text-gray-700">Legend</div>
              <ul className="space-y-1.5">
                <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm" style={{ background: '#2a78d6' }} />Template covered, counts as present</li>
                <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm" style={{ background: '#eb6834' }} />Template not covered, counts as missing</li>
                <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm" style={{ background: '#9085e9' }} />Fragment outside the template, ignored</li>
              </ul>
            </div>
          )}
          {f.seg.id === 'score' && (
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                ['Shape', trace.final.completeness],
                ['Area (ruler)', ctx.area_completeness],
                ['Alexa', ctx.alexa_pct],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg border border-gray-200 bg-white px-2 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-gray-400">{k}</div>
                  <div className="text-sm font-semibold tabular-nums text-gray-900">{v == null ? '-' : `${fmt(v, 0)}%`}</div>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>

      <p className="min-h-[3.5rem] text-sm leading-relaxed text-gray-700" aria-live="polite">{caption(trace, f)}</p>
    </div>
  );
}

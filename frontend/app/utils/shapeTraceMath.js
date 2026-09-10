/*
 * Pose maths for the shape-analysis animation.
 *
 * Every pose here reproduces a transform in Katie's _run(), in the same
 * coordinates: a 256 working square padded by 128 on each side (a 512
 * canvas). Outlines arrive in the 256 frame; a pose maps them onto the
 * canvas. Kept free of React so it can be checked against the backend's
 * own matrices.
 *
 * Matrices are 3x3 row-major arrays [[a, c, e], [b, d, f], [0, 0, 1]],
 * which is SVG's matrix(a b c d e f).
 */

export const IDENTITY = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

export function mul(A, B) {
  const out = [[0, 0, 0], [0, 0, 0], [0, 0, 1]];
  for (let i = 0; i < 2; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      out[i][j] = A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j];
    }
  }
  return out;
}

export function chain(...ms) {
  return ms.reduce((acc, m) => mul(acc, m), IDENTITY);
}

export const translate = (tx, ty) => [[1, 0, tx], [0, 1, ty], [0, 0, 1]];
export const scale = (sx, sy = sx) => [[sx, 0, 0], [0, sy, 0], [0, 0, 1]];

// cv2.getRotationMatrix2D(center, angle, 1.0): positive angle turns
// counter-clockwise on screen, about `center`.
export function rotateCv(angleDeg, cx, cy) {
  const r = (angleDeg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [[c, s, (1 - c) * cx - s * cy], [-s, c, s * cx + (1 - c) * cy], [0, 0, 1]];
}

// cv2.flip(img, 1) sends column x to (canvas - 1 - x). `s` runs from 1 to -1
// so the flip can be shown turning over rather than jumping.
export function flipX(s, canvas) {
  const m = (canvas - 1) / 2;
  return chain(translate(m, 0), scale(s, 1), translate(-m, 0));
}

export function apply(M, [x, y]) {
  return [M[0][0] * x + M[0][1] * y + M[0][2], M[1][0] * x + M[1][1] * y + M[1][2]];
}

export function toSvg(M) {
  const f = (v) => (Math.abs(v) < 1e-9 ? 0 : +v.toFixed(5));
  return `matrix(${f(M[0][0])} ${f(M[1][0])} ${f(M[0][1])} ${f(M[1][1])} ${f(M[0][2])} ${f(M[1][2])})`;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function lerpMatrix(A, B, t) {
  return [0, 1, 2].map((i) => [0, 1, 2].map((j) => lerp(A[i][j], B[i][j], t)));
}

export function easeInOut(t) {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export function outlinePath(points) {
  if (!points || points.length < 3) return '';
  return `M${points.map(([x, y]) => `${x},${y}`).join('L')}Z`;
}

// ---- Poses of the fragment outline (256 frame -> 512 canvas) ------------

// Native proportions, fitted into a box of side `size` centred on (cx, cy).
export function proportionsPose(fitScale, size, cx, cy) {
  const [fx, fy] = fitScale;
  const k = size / 256;
  return chain(translate(cx, cy), scale(k * fx, k * fy), translate(-128, -128));
}

// After normalize(): the 256 square placed in the padded canvas.
export function resizedPose(pad) {
  return translate(pad, pad);
}

// The search's composite, in _run() order: pad, centroid shift, flip,
// rotation about the canvas centre, then the shift under test.
export function searchPose({ pad, canvas, centroidShift, flipScale = 1, angle = 0, dx = 0, dy = 0, center }) {
  const [cx, cy] = center || [canvas / 2, canvas / 2];
  return chain(
    translate(dx, dy),
    rotateCv(angle, cx, cy),
    flipX(flipScale, canvas),
    translate(centroidShift[0], centroidShift[1]),
    translate(pad, pad),
  );
}

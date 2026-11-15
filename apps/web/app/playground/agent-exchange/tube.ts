// Vendored from github.com/wheresryan22/anatomy (MIT, (c) 2026 Ryan; text in ../software-factory/kit/LICENSE), kit/tube.mjs and the kit/lathe.mjs helpers it uses.
// Typed and trimmed: no braid rings, no clamp crossings.
import { cameraOf, iso, pathOf, type Flat, type Point3, type Projection } from "../software-factory/kit/iso-kit";

export const dot3 = (a: Point3, b: Point3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const add3 = (a: Point3, b: Point3): Point3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub3 = (a: Point3, b: Point3): Point3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul3 = (a: Point3, k: number): Point3 => [a[0] * k, a[1] * k, a[2] * k];
export const len3 = (a: Point3) => Math.hypot(a[0], a[1], a[2]);
export const unit3 = (a: Point3): Point3 => {
  const length = len3(a) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
};
export const cross3 = (a: Point3, b: Point3): Point3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const lerp3 = (a: Point3, b: Point3, t: number): Point3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export function viewOf(P: Projection): Point3 {
  const { sinA, cosA, sinE, cosE } = cameraOf(P);
  return [cosA * cosE, sinA * cosE, sinE];
}
export const scaleOf = (P: Projection) => cameraOf(P).k;

export function frameAlong(o: Point3, a: Point3) {
  const axis = unit3(a);
  const helper: Point3 = Math.abs(axis[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  const u = unit3(cross3(helper, axis));
  const v = cross3(axis, u);
  return { o, a: axis, u, v };
}

/** Rounds every corner of a polyline with a bend of `radius`, clamped to the room available. */
export function fillet(points: Point3[], radius: number, perArc = 7, { P = null, tube = 0, margin = 1.3 }: { P?: Projection | null; tube?: number; margin?: number } = {}): Point3[] {
  if (points.length < 3) return points.map((p) => [...p] as Point3);
  const V = P && tube ? viewOf(P) : null;
  const out: Point3[] = [[...points[0]!] as Point3];
  for (let index = 1; index < points.length - 1; index++) {
    const prev = points[index - 1]!;
    const here = points[index]!;
    const next = points[index + 1]!;
    const into = unit3(sub3(here, prev));
    const outOf = unit3(sub3(next, here));
    const cosTurn = Math.max(-1, Math.min(1, dot3(into, outOf)));
    const turn = Math.acos(cosTurn);
    if (turn < 1e-3) {
      out.push([...here] as Point3);
      continue;
    }
    const room = Math.min(len3(sub3(here, prev)), len3(sub3(next, here))) * 0.48;
    const facing = V ? Math.abs(dot3(unit3(cross3(into, outOf)), V)) : 1;
    const bend = V ? Math.max(radius, (margin * tube) / (0.7 * Math.max(0.05, facing) ** 2)) : radius;
    const cutAt = Math.min(bend * Math.tan(turn / 2), room);
    const a = sub3(here, mul3(into, cutAt));
    const b = add3(here, mul3(outOf, cutAt));
    const count = Math.max(2, Math.ceil((perArc * turn) / (Math.PI / 2)));
    for (let step = 0; step <= count; step++) {
      const t = step / count;
      out.push(lerp3(lerp3(a, here, t), lerp3(here, b, t), t));
    }
  }
  out.push([...points[points.length - 1]!] as Point3);
  return out;
}

export function resample(points: Point3[], spacing: number): Point3[] {
  const lengths = [0];
  for (let index = 1; index < points.length; index++) lengths.push(lengths[index - 1]! + len3(sub3(points[index]!, points[index - 1]!)));
  const total = lengths[lengths.length - 1]!;
  const count = Math.max(1, Math.round(total / spacing));
  const out: Point3[] = [];
  let segment = 1;
  for (let step = 0; step <= count; step++) {
    const at = (total * step) / count;
    while (segment < points.length - 1 && lengths[segment]! < at) segment++;
    const a = points[segment - 1]!;
    const b = points[segment]!;
    const span = lengths[segment]! - lengths[segment - 1]! || 1;
    out.push(lerp3(a, b, Math.min(1, Math.max(0, (at - lengths[segment - 1]!) / span))));
  }
  return out;
}

export function pathLength(points: Point3[]) {
  let total = 0;
  for (let index = 1; index < points.length; index++) total += len3(sub3(points[index]!, points[index - 1]!));
  return total;
}

export function cut(points: Point3[], from: number, to: number): Point3[] {
  const out: Point3[] = [];
  let walked = 0;
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1]!;
    const b = points[index]!;
    const length = len3(sub3(b, a));
    const start = walked;
    const end = walked + length;
    if (end >= from && start <= to) {
      const t0 = Math.max(0, (from - start) / (length || 1));
      const t1 = Math.min(1, (to - start) / (length || 1));
      if (!out.length) out.push(lerp3(a, b, t0));
      out.push(lerp3(a, b, t1));
    }
    walked = end;
  }
  return out;
}

export const pointAlong = (points: Point3[], at: number): Point3 => cut(points, at, at + 0.01)[0] ?? points[points.length - 1]!;

const LIGHT = (() => {
  const length = Math.hypot(-0.55, -0.835);
  return [-0.55 / length, -0.835 / length] as Flat;
})();

const poly = (points: Flat[], closed = true) => pathOf(points, closed);

const area = (points: Flat[]) =>
  points.reduce((sum, [x, y], index) => {
    const [nx, ny] = points[(index + 1) % points.length]!;
    return sum + x * ny - nx * y;
  }, 0);

interface Frame { p: Flat; nx: number; ny: number; half: number }

function sideOf(frames: Frame[]) {
  const out = { left: [] as Flat[], right: [] as Flat[], shineA: [] as Flat[], shineB: [] as Flat[], shadeA: [] as Flat[], shadeB: [] as Flat[] };
  for (const { p, nx, ny, half } of frames) {
    out.left.push([p[0] + nx * half, p[1] + ny * half]);
    out.right.push([p[0] - nx * half, p[1] - ny * half]);
    const toward = nx * LIGHT[0] + ny * LIGHT[1];
    const shineAt = half * 0.44 * toward;
    const shineHalf = half * 0.24;
    out.shineA.push([p[0] + nx * (shineAt + shineHalf), p[1] + ny * (shineAt + shineHalf)]);
    out.shineB.push([p[0] + nx * (shineAt - shineHalf), p[1] + ny * (shineAt - shineHalf)]);
    const shadeAt = -half * 0.62 * toward;
    const shadeHalf = half * 0.2;
    out.shadeA.push([p[0] + nx * (shadeAt + shadeHalf), p[1] + ny * (shadeAt + shadeHalf)]);
    out.shadeB.push([p[0] + nx * (shadeAt - shadeHalf), p[1] + ny * (shadeAt - shadeHalf)]);
  }
  return out;
}

function capOf(centre: Point3, tangent: Point3, radius: number, inward: Flat, P: Projection) {
  const V = viewOf(P);
  let n1 = cross3(tangent, V);
  if (len3(n1) < 1e-6) n1 = frameAlong([0, 0, 0], tangent).u;
  n1 = unit3(n1);
  const n2 = unit3(cross3(tangent, n1));
  const steps = 28;
  const ring = Array.from({ length: steps }, (_, index) => {
    const angle = (index / steps) * Math.PI * 2;
    return iso(add3(centre, add3(mul3(n1, radius * Math.cos(angle)), mul3(n2, radius * Math.sin(angle)))), P);
  });
  const c = iso(centre, P);
  const probe = iso(add3(centre, n2), P);
  const along = (probe[0] - c[0]) * inward[0] + (probe[1] - c[1]) * inward[1];
  const from = along > 0 ? steps / 2 : 0;
  const half = (start: number) => Array.from({ length: steps / 2 + 1 }, (_, index) => ring[(start + index) % steps]!);
  return { ring, arc: half(from), inner: half((from + steps / 2) % steps) };
}

function stripeEnd(half: Flat[], centre: Flat, nx: number, ny: number, from: number, to: number): Flat[] {
  const offset = (p: Flat) => (p[0] - centre[0]) * nx + (p[1] - centre[1]) * ny;
  const values = half.map(offset);
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const points: Flat[] = [];
  const crossAt = (k: number, level: number): Flat => {
    const t = (level - values[k]!) / (values[k + 1]! - values[k]! || 1e-9);
    return [half[k]![0] + (half[k + 1]![0] - half[k]![0]) * t, half[k]![1] + (half[k + 1]![1] - half[k]![1]) * t];
  };
  for (let k = 0; k < half.length; k++) {
    if (values[k]! >= lo && values[k]! <= hi) points.push(half[k]!);
    if (k < half.length - 1) for (const level of [lo, hi]) if ((values[k]! - level) * (values[k + 1]! - level) < 0) points.push(crossAt(k, level));
  }
  return points
    .map((p) => [p, offset(p)] as [Flat, number])
    .sort((x, y) => (from > to ? y[1] - x[1] : x[1] - y[1]))
    .map(([p]) => p);
}

interface Span { from: number; to: number; open0: boolean; open1: boolean; gap0: boolean; gap1: boolean }

function spansOf(total: number, gaps: [number, number][], breaks: number[], maxLength: number, closed: boolean): Span[] {
  const cuts = gaps
    .map(([a, b]) => [Math.max(0, Math.min(a, b)), Math.min(total, Math.max(a, b))] as [number, number])
    .filter(([a, b]) => b - a > 1e-6)
    .sort((x, y) => x[0] - y[0]);
  const runs: [number, number, boolean, boolean][] = [];
  let at = 0;
  for (const [a, b] of cuts) {
    if (a > at + 1e-6) runs.push([at, a, at > 0, true]);
    at = Math.max(at, b);
  }
  if (total > at + 1e-6) runs.push([at, total, at > 0, cuts.length > 0 && cuts[cuts.length - 1]![1] >= total - 1e-6]);
  const pieces: Span[] = [];
  for (const [from, to, gapStart, gapEnd] of runs) {
    const stops = [from, ...breaks.filter((b) => b > from + 1e-6 && b < to - 1e-6).sort((x, y) => x - y), to];
    for (let index = 0; index < stops.length - 1; index++) {
      const a = stops[index]!;
      const b = stops[index + 1]!;
      const count = Math.max(1, Math.ceil((b - a) / maxLength - 1e-9));
      for (let c = 0; c < count; c++) {
        pieces.push({
          from: a + ((b - a) * c) / count,
          to: a + ((b - a) * (c + 1)) / count,
          open0: !(index === 0 && c === 0),
          open1: !(index === stops.length - 2 && c === count - 1),
          gap0: index === 0 && c === 0 && gapStart,
          gap1: index === stops.length - 2 && c === count - 1 && gapEnd,
        });
      }
    }
  }
  if (closed && !cuts.length && pieces.length) {
    pieces[0]!.open0 = true;
    pieces[pieces.length - 1]!.open1 = true;
  }
  return pieces;
}

export interface TubePiece {
  mid: Point3;
  body: string;
  shine: string;
  shade: string;
  edges: string;
  wide: boolean;
  points: Point3[];
  radii: number[];
  ends: [boolean, boolean];
  from: number;
  to: number;
}

export interface TubeOptions {
  maxLength?: number;
  spacing?: number;
  closed?: boolean;
  breaks?: number[];
  gaps?: [number, number][];
  caps?: boolean | [boolean, boolean];
  stripes?: "auto" | boolean;
}

/** Splits a 3D route into depth-sortable chunks, each drawn as a shaded ribbon with elliptical end caps. */
export function tubePieces(points3: Point3[], radius: number | ((t: number) => number), P: Projection, { maxLength = 30, spacing = 2.2, closed = false, breaks = [], gaps = [], caps = true, stripes = "auto" }: TubeOptions = {}): TubePiece[] {
  const dense = resample(points3, spacing);
  const total = pathLength(dense);
  const radiusAt = typeof radius === "function" ? radius : () => radius;
  const k = scaleOf(P);
  const wide = stripes === "auto" ? Math.max(...Array.from({ length: 33 }, (_, index) => radiusAt(index / 32))) * k > 1.3 : Boolean(stripes);
  const lead = 0.5;
  const out: TubePiece[] = [];
  const looped = closed && !gaps.length;
  const wrap = (at: number) => (looped ? ((at % total) + total) % total : Math.max(0, Math.min(total, at)));
  const step = Math.max(0.05, Math.min(spacing, total / 4) * 0.5);
  const frameAt = (at: number, p: Flat, width: number): Frame => {
    const a = iso(pointAlong(dense, wrap(at - step)), P);
    const b = iso(pointAlong(dense, wrap(at + step)), P);
    let tx = b[0] - a[0];
    let ty = b[1] - a[1];
    const length = Math.hypot(tx, ty) || 1;
    tx /= length;
    ty /= length;
    return { p, nx: -ty, ny: tx, half: width };
  };
  const partOf = (start: number, end: number) => {
    let points = cut(dense, Math.max(0, start), Math.min(total, end));
    if (looped && start < 0) points = [...cut(dense, total + start, total), ...points.slice(1)];
    if (looped && end > total) points = [...points, ...cut(dense, 0, end - total).slice(1)];
    let walked = looped ? start : Math.max(0, start);
    const along = points.map((point, index) => {
      if (index > 0) walked += len3(sub3(point, points[index - 1]!));
      return walked;
    });
    const flat = points.map((point) => iso(point, P));
    const widths = along.map((at) => radiusAt(looped ? wrap(at) / total : Math.min(1, Math.max(0, at / total))) * k);
    const frames = flat.map((p, index) => frameAt(along[index]!, p, widths[index]!));
    return { points, flat, widths, frames };
  };
  const capList = Array.isArray(caps) ? caps : [caps, caps];
  for (const piece of spansOf(total, gaps, breaks, maxLength, closed)) {
    const openStart = piece.open0 && (piece.from > 0 || looped);
    const openEnd = piece.open1 && (piece.to < total || looped);
    const body = partOf(openStart ? piece.from - lead : piece.from, openEnd ? piece.to + lead : piece.to);
    if (body.points.length < 2) continue;
    const stripe = openStart || openEnd ? partOf(openStart ? piece.from - 2 * lead : piece.from, openEnd ? piece.to + 2 * lead : piece.to) : body;
    const { points: part, flat, widths, frames } = body;
    const sides = sideOf(frames);
    const bands = stripe === body ? sides : sideOf(stripe.frames);
    let bodyPath = poly([...sides.left, ...sides.right.slice().reverse()]);
    let edges = pathOf(sides.left) + pathOf(sides.right);
    const ends: [boolean, boolean] = [!piece.open0 && !looped && (piece.from <= 1e-6 || piece.gap0), !piece.open1 && !looped && (piece.to >= total - 1e-6 || piece.gap1)];
    const capped = [ends[0] && (piece.gap0 || capList[0]), ends[1] && (piece.gap1 || capList[1])];
    const sign = Math.sign(area([...sides.left, ...sides.right.slice().reverse()]));
    const tips: ({ half: Flat[]; frame: Frame } | null)[] = [null, null];
    for (const side of [0, 1]) {
      if (!capped[side]) continue;
      const at = side ? part.length - 1 : 0;
      const other = side ? part.length - 2 : 1;
      const tangent = unit3(sub3(part[side ? at : other]!, part[side ? other : at]!));
      const outward = side ? tangent : mul3(tangent, -1);
      const inward: Flat = [flat[other]![0] - flat[at]![0], flat[other]![1] - flat[at]![1]];
      const { ring, arc, inner } = capOf(part[at]!, tangent, widths[at]! / k, inward, P);
      const oriented = Math.sign(area(ring)) === sign ? ring : ring.slice().reverse();
      bodyPath += poly(oriented);
      edges += pathOf(arc);
      const open = dot3(outward, viewOf(P)) > 0;
      if (open) edges += pathOf(inner);
      tips[side] = { half: open ? inner : arc, frame: frames[at]! };
    }
    const band = (a: Flat[], b: Flat[], offsets: (frame: Frame) => [number, number]) => {
      const head = tips[1] ? stripeEnd(tips[1].half, tips[1].frame.p, tips[1].frame.nx, tips[1].frame.ny, offsets(tips[1].frame)[0], offsets(tips[1].frame)[1]) : [];
      const tail = tips[0] ? stripeEnd(tips[0].half, tips[0].frame.p, tips[0].frame.nx, tips[0].frame.ny, offsets(tips[0].frame)[1], offsets(tips[0].frame)[0]) : [];
      return poly([...a, ...head, ...b.slice().reverse(), ...tail]);
    };
    const toward = ({ nx, ny }: Frame) => nx * LIGHT[0] + ny * LIGHT[1];
    const shineOffsets = (frame: Frame): [number, number] => [frame.half * 0.44 * toward(frame) + frame.half * 0.24, frame.half * 0.44 * toward(frame) - frame.half * 0.24];
    const shadeOffsets = (frame: Frame): [number, number] => [-frame.half * 0.62 * toward(frame) + frame.half * 0.2, -frame.half * 0.62 * toward(frame) - frame.half * 0.2];
    out.push({
      mid: pointAlong(dense, (piece.from + piece.to) / 2),
      body: bodyPath,
      shine: band(bands.shineA, bands.shineB, shineOffsets),
      shade: band(bands.shadeA, bands.shadeB, shadeOffsets),
      edges,
      wide,
      points: part,
      radii: widths.map((width) => width / k),
      ends,
      from: piece.from,
      to: piece.to,
    });
  }
  return out;
}

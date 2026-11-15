import * as k from "../software-factory/kit/iso-kit";
import type { Flat, Plan, Point3, Projection, SolidPaths } from "../software-factory/kit/iso-kit";

// World layout: x across the desk, +y toward the controller (the viewer), z up. The desk is
// larger than the view and is cropped by the frame.
export const WIDTH = 760;
export const HEIGHT = 420;
const RAD = Math.PI / 180;

// The strip board: a rack leaning back at PHI, four bays side by side, strips stacked along its slant.
export const PHI = 62 * RAD;
export const BOARD = { x: 0, w: 194, front: -10, lip: 4, slant: 58, back: 6 };
export const BAY_PITCH = 48;
export const BAYS = 4;
export const SLOTS = 4;
export const STRIP = { length: 40, height: 7, thick: 1.4 };
export const TRAY = { x: 152, w: 48, front: 50, lip: 4, slant: 42, back: 6, slots: 3 };
export const PRINTER = { x: -54, w: 44, front: 4, lip: 4, slant: 22, back: 8 };
export const SCOPE = { x: -108, y: 4, r: 50, top: 13.4, screen: 44 };

export const P = k.fitProjection([[-214, -50, 0], [-214, 74, 0], [204, 74, 0], [204, -52, 0], [97, -46, 58], [SCOPE.x, SCOPE.y - SCOPE.r, 16]], WIDTH, HEIGHT, {
  pad: 8,
  azimuth: 50,
  elevation: 38,
});

export const at = (point: Point3) => k.iso(point, P);
const slab = (plan: Plan, z: number, h: number, steps = 3, bevel = 0) => k.slabOf(plan, z, h, P, steps, bevel);

export interface SolidPart { paths: SolidPaths; tone?: k.Tone; crease?: k.Tone | "none"; lit?: boolean; inner?: string; className?: string }
export interface LinePart { d: string; tone?: k.LineTone; free?: boolean; className?: string }
export interface Layer { solids: SolidPart[]; lines: LinePart[]; dots: { points: k.Flat[]; size?: number; tone?: k.Tone }[] }
const layer = (): Layer => ({ solids: [], lines: [], dots: [] });

// A planar polygon extruded along any vector. The kit only extrudes along z; the slanted racks
// and the strips lying on them need this.
type V3 = Point3;
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];

function hull(points: Flat[]): Flat[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const turn = (o: Flat, a: Flat, b: Flat) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Flat[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && turn(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Flat[] = [];
  for (const p of [...sorted].reverse()) {
    while (upper.length >= 2 && turn(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function viewOf(projection: Projection): V3 {
  const { sinA, cosA, sinE, cosE } = k.cameraOf(projection);
  return [cosA * cosE, sinA * cosE, sinE];
}

export function prism(poly: Point3[], along: Point3, projection: Projection, convex = true): SolidPaths {
  const n = poly.length;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % n]!;
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const n0 = unit([nx, ny, nz]);
  const flip = dot(n0, along) < 0 ? -1 : 1;
  const view = viewOf(projection);
  const { sinA, cosA } = k.cameraOf(projection);
  const A = poly.map((p) => k.iso(p, projection));
  const B = poly.map((p) => k.iso(add(p, along), projection));
  const capA = scale(n0, -flip);
  const capB = scale(n0, flip);
  const capAVisible = dot(capA, view) > 1e-9;
  const capBVisible = dot(capB, view) > 1e-9;
  const sideNormal = poly.map((a, i) => unit(cross(sub(poly[(i + 1) % n]!, a), n0)));
  const sideVisible = sideNormal.map((normal) => dot(normal, view) > 1e-9);

  const outline: string[] = [];
  const crease: string[] = [];
  const edge = (p: Flat, q: Flat, visA: boolean, visB: boolean, nA: V3, nB: V3) => {
    if (visA !== visB) outline.push(k.pathOf([p, q]));
    else if (visA && dot(nA, nB) < 0.8) crease.push(k.pathOf([p, q]));
  };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const prev = (i + n - 1) % n;
    edge(A[i]!, A[j]!, capAVisible, sideVisible[i]!, capA, sideNormal[i]!);
    edge(B[i]!, B[j]!, capBVisible, sideVisible[i]!, capB, sideNormal[i]!);
    edge(A[i]!, B[i]!, sideVisible[prev]!, sideVisible[i]!, sideNormal[prev]!, sideNormal[i]!);
  }

  const faces: { normal: V3; points: Flat[] }[] = [];
  if (capAVisible) faces.push({ normal: capA, points: A });
  if (capBVisible) faces.push({ normal: capB, points: B });
  for (let i = 0; i < n; i++) {
    if (!sideVisible[i]) continue;
    const j = (i + 1) % n;
    faces.push({ normal: sideNormal[i]!, points: [A[i]!, A[j]!, B[j]!, B[i]!] });
  }
  const top: string[] = [];
  const shades: string[][] = [[], [], [], []];
  const [lx, ly] = [-sinA, cosA];
  for (const face of faces) {
    const d = k.pathOf(face.points, true);
    if (face.normal[2] > 0.6) {
      top.push(d);
      continue;
    }
    const lit = face.normal[2] < -0.6 ? 0 : (face.normal[0] * lx + face.normal[1] * ly + 1) / 2;
    shades[Math.min(3, Math.max(0, Math.floor(lit * 4)))]!.push(d);
  }
  const fill = convex ? k.pathOf(hull([...A, ...B]), true) : faces.map((face) => k.pathOf(face.points, true)).join("");
  return { fill, outline: outline.join(""), crease: crease.join(""), top: top.join(""), shades: shades.map((list) => list.join("")) };
}

// Slanted racks share one local frame: bx along x, s up the slant, n out of the face.
interface Rack { x: number; w: number; front: number; lip: number; slant: number; back: number }
export const rackPoint = (rack: Rack, bx: number, s: number, n: number): Point3 => [
  rack.x + bx,
  rack.front - s * Math.cos(PHI) + n * Math.sin(PHI),
  rack.lip + s * Math.sin(PHI) + n * Math.cos(PHI),
];
const rackBody = (rack: Rack) => {
  const top = rack.lip + rack.slant * Math.sin(PHI);
  const yTop = rack.front - rack.slant * Math.cos(PHI);
  const profile: Point3[] = [[rack.x, rack.front, 0], [rack.x, rack.front, rack.lip], [rack.x, yTop, top], [rack.x, yTop - rack.back, top], [rack.x, yTop - rack.back, 0]];
  return prism(profile, [rack.w, 0, 0], P);
};
// A box lying on a rack face: bx0..bx1 along the rack, s0..s1 up the slant, n0..n1 out of it.
const rackBox = (rack: Rack, bx0: number, bx1: number, s0: number, s1: number, n0: number, n1: number) =>
  prism([rackPoint(rack, bx0, s0, n0), rackPoint(rack, bx0, s1, n0), rackPoint(rack, bx0, s1, n1), rackPoint(rack, bx0, s0, n1)], [bx1 - bx0, 0, 0], P);
const rackTopY = (rack: Rack) => rack.front - rack.slant * Math.cos(PHI) - rack.back / 2;
const rackTopZ = (rack: Rack) => rack.lip + rack.slant * Math.sin(PHI);

export const slotS = (index: number) => BOARD.slant - 17 - index * 10;
export const traySlotS = (index: number) => TRAY.slant - 11 - index * 10;
const ORIGIN = rackPoint(BOARD, 0, 0, 0);
export const bayOrigin = (bay: number) => BOARD.x + 4 + bay * BAY_PITCH;
// World offsets from the strip's build position to each resting place.
export const boardSlot = (bay: number, index: number): Point3 => sub(rackPoint(BOARD, 4 + bay * BAY_PITCH, slotS(index), 0), ORIGIN);
export const traySlot = (index: number): Point3 => sub(rackPoint(TRAY, 4, traySlotS(index), 0), ORIGIN);
export const printerMouth: Point3 = sub(rackPoint(PRINTER, 3, 8, 0.6), ORIGIN);
export const NORMAL: Point3 = [0, Math.sin(PHI), Math.cos(PHI)];
export const lerp3 = (a: Point3, b: Point3, t: number): Point3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const offset = (p: Point3, n: number): Point3 => add(p, scale(NORMAL, n));

// The desk and a mat under the keyboard.
function desk(): Layer {
  const out = layer();
  out.solids.push({ paths: slab({ x: -420, y: -320, w: 840, d: 440, r: 2 }, -12, 12, 2), tone: "lo", crease: "none" });
  out.lines.push({ d: k.lineOnTop([-420, -70], [420, -70], 0, P), tone: "faint" });
  out.solids.push({ paths: slab({ x: 10, y: 20, w: 140, d: 44, r: 3 }, 0, 0.6, 4), tone: "lo", crease: "none" });
  return out;
}

// The strip board: body, dividers, bay header rails, slot lips, and lamp housings on top.
export const LAMP_PATHS = Array.from({ length: BAYS }, (_, bay) => {
  const x = bayOrigin(bay) + STRIP.length / 2;
  return { body: k.cylinder(x, rackTopY(BOARD), 2.4, rackTopZ(BOARD), 2.2, P, 20), cap: k.cylinder(x, rackTopY(BOARD), 1.6, rackTopZ(BOARD) + 2.2, 1, P, 16) };
});
function board(): Layer {
  const out = layer();
  out.solids.push({ paths: rackBody(BOARD), tone: "mid" });
  for (let bay = 0; bay <= BAYS; bay++) out.solids.push({ paths: rackBox(BOARD, bay * BAY_PITCH, bay * BAY_PITCH + 2, 0, BOARD.slant, 0, 2), tone: "mid", crease: "none" });
  for (let bay = 0; bay < BAYS; bay++) {
    const x0 = bay * BAY_PITCH + 2;
    const x1 = x0 + BAY_PITCH - 2;
    out.solids.push({ paths: rackBox(BOARD, x0, x1, BOARD.slant - 8, BOARD.slant - 4.5, 0, 1.2), tone: "mid", crease: "none" });
    out.lines.push({ d: k.pathOf([at(rackPoint(BOARD, x0 + 3, BOARD.slant - 6.2, 1.21)), at(rackPoint(BOARD, x0 + 18, BOARD.slant - 6.2, 1.21))]), tone: "lo", free: true });
    for (let i = 0; i < SLOTS; i++) out.solids.push({ paths: rackBox(BOARD, x0, x1, slotS(i) - 1, slotS(i), 0, 1.6), tone: "mid", crease: "none" });
  }
  return out;
}

// One strip built at the board's origin; the live code translates it to its slot.
export const STRIP_ART = {
  body: rackBox(BOARD, 0, STRIP.length, 0, STRIP.height, 0, STRIP.thick),
  tab: rackBox(BOARD, 0, 5.5, 0, STRIP.height, STRIP.thick, STRIP.thick + 0.5),
  rules: [
    k.pathOf([at(rackPoint(BOARD, 8.5, 4.6, STRIP.thick + 0.01)), at(rackPoint(BOARD, 30, 4.6, STRIP.thick + 0.01))]),
    k.pathOf([at(rackPoint(BOARD, 8.5, 2.3, STRIP.thick + 0.01)), at(rackPoint(BOARD, 22, 2.3, STRIP.thick + 0.01))]),
  ],
  hole: k.pathOf(
    Array.from({ length: 10 }, (_, i) => {
      const a = (i / 10) * Math.PI * 2;
      return at(rackPoint(BOARD, 36 + 1.1 * Math.cos(a), 3.5 + 1.1 * Math.sin(a), STRIP.thick + 0.01));
    }),
    true,
  ),
};

// The Done tray, a one-bay rack in front of the board, and its front lip drawn over the strips.
function tray(): Layer {
  const out = layer();
  out.solids.push({ paths: rackBody(TRAY), tone: "mid" });
  for (const bx of [0, TRAY.w - 2]) out.solids.push({ paths: rackBox(TRAY, bx, bx + 2, 0, TRAY.slant, 0, 2), tone: "mid", crease: "none" });
  for (let i = 0; i < TRAY.slots; i++) out.solids.push({ paths: rackBox(TRAY, 2, TRAY.w - 2, traySlotS(i) - 1, traySlotS(i), 0, 1.6), tone: "mid", crease: "none" });
  return out;
}
export const TRAY_LIP = rackBox(TRAY, 0, TRAY.w, 0, 6, 0, 3);
export const TRAY_LABEL = k.pathOf([at(rackPoint(TRAY, 6, 3, 3.01)), at(rackPoint(TRAY, 20, 3, 3.01))]);

// The strip printer: a small rack-shaped box whose slanted face has a slot the new strips come out of.
function printer(): Layer {
  const out = layer();
  out.solids.push({ paths: rackBody(PRINTER), tone: "mid" });
  out.lines.push({
    d: k.pathOf([at(rackPoint(PRINTER, 2, 7, 0.01)), at(rackPoint(PRINTER, 2, 9.5, 0.01)), at(rackPoint(PRINTER, PRINTER.w - 2, 9.5, 0.01)), at(rackPoint(PRINTER, PRINTER.w - 2, 7, 0.01))], true),
    tone: "lo",
  });
  out.solids.push({ paths: rackBox(PRINTER, 4, 10, 15, 18, 0, 1.2), tone: "hi", crease: "lo" });
  out.dots.push({ points: [at(rackPoint(PRINTER, PRINTER.w - 6, 16.5, 0.01))], size: 0.7, tone: "hi" });
  return out;
}

// The radar scope: housing, bezel, screen, range rings, and a control strip with knobs.
function scope(): Layer {
  const out = layer();
  const { x, y, r, screen } = SCOPE;
  out.solids.push({ paths: k.cylinder(x, y, r, 0, 10, P, 72), tone: "mid" });
  out.solids.push({ paths: k.cylinder(x, y, r, 10, 3, P, 72, 0.8), tone: "hi", crease: "lo" });
  out.lines.push({ d: k.sideArc(x, y, r, 10, P, 40), tone: "faint" });
  out.solids.push({ paths: k.cylinder(x, y, screen, 13, 0.4, P, 72), tone: "lo", crease: "none", className: "wt-crt" });
  for (const rr of [14, 28]) out.lines.push({ d: k.ring(x, y, rr, SCOPE.top, P, 56), tone: "lo", className: "wt-ring" });
  out.lines.push({ d: k.ring(x, y, 42, SCOPE.top, P, 72), tone: "lo", className: "wt-ring" });
  out.lines.push({ d: k.lineOnTop([x - 42, y], [x + 42, y], SCOPE.top, P) + k.lineOnTop([x, y - 42], [x, y + 42], SCOPE.top, P), tone: "lo", className: "wt-ring" });
  const ticks = k.radialTicks(x, y, 42, 36, 3, SCOPE.top, [1.2, 2.4], P);
  out.lines.push({ d: ticks.minor, tone: "lo", className: "wt-ring" }, { d: ticks.major, tone: "mid", className: "wt-ring" });
  const strip: Plan = { x: x - 34, y: y + r + 6, w: 68, d: 14, r: 2 };
  out.solids.push({ paths: slab(strip, 0, 4, 3, 0.5), tone: "mid" });
  for (const kx of [x - 22, x, x + 22]) {
    out.solids.push({ paths: k.cylinder(kx, strip.y + 7, 3.6, 4, 3, P, 24), tone: "mid" });
    out.lines.push({ d: k.knurl(kx, strip.y + 7, 3.6, 4, 7, 24, P), tone: "lo" });
    out.lines.push({ d: k.lineOnTop([kx, strip.y + 7], [kx, strip.y + 4], 7, P), tone: "hi" });
  }
  return out;
}
export const SWEEP = { period: 4.2, trail: [3, 6, 9, 12] };
export const sweepPath = (angle: number, back = 0) => {
  const a = angle - back * RAD;
  return k.lineOnTop([SCOPE.x, SCOPE.y], [SCOPE.x + 41 * Math.cos(a), SCOPE.y + 41 * Math.sin(a)], SCOPE.top + 0.2, P);
};
export const blipAt = (angle: number, radius: number) => at([SCOPE.x + radius * Math.cos(angle), SCOPE.y + radius * Math.sin(angle), SCOPE.top + 0.2]);

// Keyboard, the clear-ready key, handset on its cradle, and a mug.
function deskware(): Layer {
  const out = layer();
  const kb: Plan = { x: 16, y: 26, w: 92, d: 30, r: 2 };
  out.solids.push({ paths: slab(kb, 0.6, 3, 3, 0.5), tone: "mid" });
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 14; col++) {
      out.solids.push({ paths: slab({ x: kb.x + 4 + col * 6 + row * 1.2, y: kb.y + 3.5 + row * 6.4, w: 4.6, d: 4.6, r: 0.8 }, 3.6, 1.4, 2), tone: "mid", crease: "none" });
    }
  }
  out.solids.push({ paths: slab({ x: kb.x + 22, y: kb.y + 22.7, w: 44, d: 4.6, r: 0.8 }, 3.6, 1.4, 2), tone: "mid", crease: "none" });
  out.solids.push({ paths: slab({ x: 116, y: 31, w: 24, d: 15, r: 2 }, 0.6, 2.4, 3), tone: "mid" });
  const cradle: Plan = { x: -214, y: 26, w: 40, d: 18, r: 3 };
  out.solids.push({ paths: slab(cradle, 0, 4, 4, 0.6), tone: "mid" });
  out.solids.push({ paths: slab({ x: -212, y: 31, w: 36, d: 8, r: 4 }, 4, 5, 6, 0.6), tone: "hi", crease: "lo" });
  for (const hx of [-207, -181]) out.solids.push({ paths: k.cylinder(hx, 35, 5, 9, 2, P, 24), tone: "hi", crease: "lo" });
  out.solids.push({ paths: k.cylinder(-42, 62, 6, 0, 10, P, 28, 0.6), tone: "hi", crease: "lo" });
  // A C-shaped handle on the near flank, extruded across the mug's tangent so it has sides.
  const side = -10 * RAD;
  const tangent: Point3 = [-Math.sin(side) * 1.8, Math.cos(side) * 1.8, 0];
  const arc = (r: number, span: number, steps: number): Point3[] =>
    Array.from({ length: steps + 1 }, (_, i) => {
      const a = (-span + (2 * span * i) / steps) * RAD;
      const reach = 8.4 + r * Math.cos(a);
      return [-42 + Math.cos(side) * reach - tangent[0] / 2, 62 + Math.sin(side) * reach - tangent[1] / 2, 5.6 + r * Math.sin(a)];
    });
  const handle = [...arc(3.6, 131.8, 14), ...arc(2.6, 157, 14).reverse()];
  out.solids.push({ paths: prism(handle, tangent, P, false), tone: "hi", crease: "lo" });
  out.lines.push({ d: k.ring(-42, 62, 5, 10, P, 28), tone: "lo" });
  return out;
}
export const CLEAR_KEY = slab({ x: 118, y: 33, w: 20, d: 11, r: 1.5 }, 3, 2.4, 3, 0.4);
export const CLEAR_RULE = k.lineOnTop([122, 38.5], [134, 38.5], 5.4, P);

export const LAYERS = { desk: desk(), board: board(), printer: printer(), scope: scope(), tray: tray(), deskware: deskware() };

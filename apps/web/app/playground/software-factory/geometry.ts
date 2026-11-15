import * as k from "./kit/iso-kit";
import type { Plan, Point3, SolidPaths } from "./kit/iso-kit";

// World layout of the factory: x runs along the belt, +y toward the viewer, z up.
export const WIDTH = 760;
export const HEIGHT = 420;

export const BELT_TOP = 17;
export const CARD = { w: 34, d: 28, h: 5 };
export const SPAWN_X = -190;
export const SPAWN_Z = 50;
export const STOPS = { agent: -80, checks: 40, gate: 128, tray: 229 };
export const BELT_END = 205;
export const GATE_PAST = 172;
export const GATE_LIFT = 13;
export const TRAY_FLOOR = 2;
export const STACK_MAX = 3;

export const HEAD_REST = 66;
export const HEAD_WORK = 27;
export const PROBE_REST = 40;
export const PROBE_TOUCH = BELT_TOP + CARD.h;

const BASE: Plan = { x: -272, y: -100, w: 544, d: 162, r: 10 };
const BEAM_TOP = 142;

export const P = k.fitProjection(
  [...k.boxCorners(BASE, -17, 0), [-80, -48, BEAM_TOP], [-80, 16, 122], [-190, -24, 88], [40, -16, 104]],
  WIDTH,
  HEIGHT,
  { pad: 18, azimuth: 60, elevation: 30 },
);

export const BASE_HALO = k.haloOf(BASE, -17, 12, P);
export const at = (point: Point3) => k.iso(point, P);
const byDepth = (points: [number, number][]) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
const slab = (plan: Plan, z: number, h: number, steps = 3, bevel = 0) => k.slabOf(plan, z, h, P, steps, bevel);

export interface SolidPart { paths: SolidPaths; tone?: k.Tone; crease?: k.Tone | "none"; lit?: boolean; inner?: string }
export interface LinePart { d: string; tone?: k.LineTone; free?: boolean }
export interface Layer { solids: SolidPart[]; lines: LinePart[]; dots: { points: k.Flat[]; size?: number; tone?: k.Tone }[] }

const layer = (): Layer => ({ solids: [], lines: [], dots: [] });

// Base plate, feet, ruler strip and screws.
function base(): Layer {
  const out = layer();
  for (const [x, y] of byDepth(k.corners(BASE, 26))) {
    out.solids.push({ paths: k.cylinder(x, y, 8, -17, 1.6, P, 28), tone: "lo" });
    out.solids.push({ paths: k.cylinder(x, y, 6, -15.4, 3.4, P, 28), tone: "mid" });
  }
  out.solids.push({ paths: k.slabOf(BASE, -12, 12, P, 8, 1.6), tone: "mid" });
  out.lines.push({ d: k.planOutline(k.insetPlan(BASE, 5), 0, P), tone: "lo" });
  const screws = k.corners(BASE, 11);
  out.lines.push({ d: screws.map(([x, y]) => k.ring(x, y, 2.4, 0, P, 16)).join(""), tone: "lo" });
  out.dots.push({ points: screws.map(([x, y]) => at([x, y, 0])) });
  const strip: Plan = { x: -250, y: 46, w: 500, d: 7, r: 1 };
  out.solids.push({ paths: slab(strip, 0, 0.6), tone: "lo", crease: "none" });
  const ticks = k.topTicks(strip.x + 5, strip.x + strip.w - 5, 5, 5, strip.y + 0.8, 0.6, [2, 3.8], P);
  out.lines.push({ d: ticks.minor, tone: "lo" }, { d: ticks.major, tone: "mid" });
  return out;
}

// The connected machine the agent runs on, behind the belt, with its screen facing the line.
export const SCREEN = { x0: -42, x1: -12, z0: 12, z1: 38, y: -62 };
function machine(): Layer {
  const out = layer();
  const plan: Plan = { x: -48, y: -92, w: 42, d: 30, r: 3 };
  out.solids.push({ paths: slab(k.insetPlan(plan, -2), 0, 3, 4), tone: "lo" });
  out.solids.push({ paths: slab(plan, 3, 41, 4, 0.8), tone: "mid", inner: k.lineSvg(k.sideSeam(plan, 8, P, 4), { tone: "faint" }) });
  const { x0, x1, z0, z1, y } = SCREEN;
  out.lines.push({ d: k.pathOf([at([x0, y, z0]), at([x1, y, z0]), at([x1, y, z1]), at([x0, y, z1])], true), tone: "mid" });
  out.lines.push({ d: k.pathOf([at([x0 - 2, y, z0 - 2]), at([x1 + 2, y, z0 - 2]), at([x1 + 2, y, z1 + 2]), at([x0 - 2, y, z1 + 2])], true), tone: "faint" });
  out.lines.push({ d: k.planOutline({ x: -42, y: -88, w: 14, d: 8, r: 1 }, 44, P, 2), tone: "faint" });
  out.dots.push({ points: [at([-35, -84, 44]), at([-14, -70, 44])], size: 0.5, tone: "hi" });
  return out;
}

export const SCREEN_LINES = [32, 27.5, 23, 18.5].map((z, index) => ({ z, width: [22, 15, 19, 10][index] }));
export const screenLine = (z: number, width: number) => k.segment([SCREEN.x0 + 3, SCREEN.y, z], [SCREEN.x0 + 3 + width, SCREEN.y, z], P);

// Columns behind the belt: hopper support, gantry back post, checks column with its lamp bar, gate back post.
export const LAMP_X = [56, 66, 76, 86];
export const LAMP_PATHS = LAMP_X.map((x) => ({ body: k.cylinder(x, -34, 3.2, 46, 2.6, P, 24), cap: k.cylinder(x, -34, 2, 48.6, 1.4, P, 20) }));
function backColumns(): Layer {
  const out = layer();
  out.solids.push({ paths: slab({ x: -200, y: -54, w: 20, d: 20, r: 2 }, 0, 4, 3, 0.5), tone: "lo" });
  out.solids.push({ paths: slab({ x: -196, y: -50, w: 12, d: 12, r: 1.5 }, 4, 88, 3, 0.4), tone: "mid" });
  out.solids.push({ paths: slab({ x: -94, y: -50, w: 28, d: 20, r: 2 }, 0, 4, 3, 0.5), tone: "lo" });
  out.solids.push({ paths: slab({ x: -90, y: -46, w: 20, d: 12, r: 1.5 }, 4, 108, 3, 0.5), tone: "mid" });
  out.solids.push({ paths: slab({ x: 26, y: -56, w: 28, d: 22, r: 2 }, 0, 4, 3, 0.5), tone: "lo" });
  out.solids.push({ paths: slab({ x: 30, y: -52, w: 20, d: 14, r: 1.5 }, 4, 82, 3, 0.5), tone: "mid" });
  out.solids.push({ paths: slab({ x: 46, y: -38, w: 46, d: 8, r: 1.5 }, 40, 6, 3, 0.5), tone: "mid" });
  out.dots.push({ points: [at([50, -34, 46]), at([90, -34, 46])], size: 0.45 });
  out.solids.push({ paths: slab({ x: 144, y: -32, w: 12, d: 9, r: 1.5 }, 0, 74, 3, 0.4), tone: "mid" });
  return out;
}

export const WIRE = { from: at([-27, -77, 44]), via: [at([-27, -77, 132]), at([-80, -40, 132])], to: at([-80, -40, 122]) };

// Belt bed, belt, flow lines and the tray's floor and back wall.
function belt(): Layer {
  const out = layer();
  const bed: Plan = { x: -232, y: -24, w: 434, d: 48, r: 3 };
  out.solids.push({ paths: slab(bed, 0, 14, 4, 0.6), tone: "mid", inner: k.lineSvg(k.sideSeam(bed, 4, P, 4), { tone: "faint" }) });
  out.dots.push({ points: [-200, -120, -40, 40, 120, 180].map((x) => at([x, 24, 9])), size: 0.45, tone: "lo" });
  out.solids.push({ paths: slab({ x: -230, y: -20, w: 430, d: 40, r: 3 }, 14, 3, 4), tone: "lo" });
  out.solids.push({ paths: slab({ x: -232, y: -24, w: 434, d: 3, r: 1 }, 14, 7, 2, 0.3), tone: "mid" });
  out.solids.push({ paths: slab({ x: 206, y: -24, w: 46, d: 48, r: 2 }, 0, TRAY_FLOOR, 3), tone: "mid" });
  out.solids.push({ paths: slab({ x: 206, y: -24, w: 46, d: 3, r: 1 }, TRAY_FLOOR, 14, 2, 0.3), tone: "mid" });
  return out;
}

export const FLOW = [-14, 14].map((y) => k.lineOnTop([-226, y], [196, y], BELT_TOP, P));

// One task card, built at x = 0 on the belt; the live code moves it with translateAlong.
export const CARD_PLAN: Plan = { x: -CARD.w / 2, y: -CARD.d / 2, w: CARD.w, d: CARD.d, r: 2 };
const cardTop = BELT_TOP + CARD.h;
export const CARD_ART = {
  paths: slab(CARD_PLAN, BELT_TOP, CARD.h, 3, 0.5),
  groove: k.planOutline(k.insetPlan(CARD_PLAN, 2.5), cardTop, P, 3),
  ref: k.lineOnTop([-13, -9], [-3, -9], cardTop, P),
  code: [-4, 0, 4, 8].map((y, index) => k.lineOnTop([-11 + (index % 2) * 3, y], [[4, 9, 1, 6][index], y], cardTop, P)),
  check: k.onTop([[7, -10], [9, -7.5], [13.5, -11.5]], cardTop, P),
};
export const stackPaths = (index: number) => k.slabOf({ ...CARD_PLAN, x: STOPS.tray - CARD.w / 2 }, TRAY_FLOOR + index * CARD.h, CARD.h, P, 3, 0.5);

// The gate plate, built closed; it lifts by GATE_LIFT.
export const GATE_PATHS = slab({ x: 147, y: -20, w: 6, d: 40, r: 1 }, BELT_TOP, 30, 2, 0.4);
export const GATE_SLOTS = [27, 37].map((z) => k.segment([153, -20, z], [153, 20, z], P));

// Parts in front of the cards: tray walls, front posts, and everything overhead.
function front(): Layer {
  const out = layer();
  out.solids.push({ paths: slab({ x: 249, y: -21, w: 3, d: 42, r: 1 }, TRAY_FLOOR, 14, 2, 0.3), tone: "mid" });
  out.solids.push({ paths: slab({ x: 206, y: 21, w: 46, d: 3, r: 1 }, TRAY_FLOOR, 10, 2, 0.3), tone: "mid" });
  out.solids.push({ paths: slab({ x: 142, y: -34, w: 16, d: 58, r: 2 }, 74, 8, 3, 0.6), tone: "mid" });
  out.dots.push({ points: [at([150, -28, 82]), at([150, 18, 82])], size: 0.45 });
  return out;
}

// Gantry carriage, beam and Z motor; drawn after the moving head so they hide its spindle.
function gantry(): Layer {
  const out = layer();
  out.solids.push({ paths: slab({ x: -94, y: -12, w: 28, d: 24, r: 2 }, 100, 12, 3, 0.6), tone: "mid" });
  const beam: Plan = { x: -92, y: -48, w: 24, d: 64, r: 2 };
  out.solids.push({ paths: slab(beam, 112, 10, 4, 0.8), tone: "mid" });
  out.lines.push({ d: k.lineOnTop([-87, -44], [-87, 12], 122, P), tone: "faint" });
  out.dots.push({ points: [-40, -20, 10].map((y) => at([-73, y, 122])), size: 0.4, tone: "lo" });
  out.solids.push({ paths: slab({ x: -91, y: -11, w: 22, d: 22, r: 2 }, 122, 20, 3, 0.8), tone: "mid" });
  out.lines.push({ d: k.planOutline({ x: -87, y: -7, w: 14, d: 14, r: 1 }, BEAM_TOP, P, 3), tone: "faint" });
  return out;
}

export const LED = at([-80, 12, 106]);

// The head at rest; the live code translates it in z.
export const HEAD = {
  spindle: k.cylinder(-80, 0, 2.4, HEAD_REST + 9, 64, P, 18),
  body: k.cylinder(-80, 0, 7, HEAD_REST, 9, P, 32, 0.5),
  knurl: k.knurl(-80, 0, 7, HEAD_REST + 2, HEAD_REST + 7, 32, P),
  collar: k.cylinder(-80, 0, 4.2, HEAD_REST - 1.5, 1.5, P, 24),
  tip: k.cylinder(-80, 0, 2, HEAD_REST - 4, 2.5, P, 18),
};

// Checks arm with the probe boss and a dial gauge on top.
export const DIAL = { x: 40, y: -18, r: 11, top: 104 };
export const PROBE = {
  rod: k.cylinder(40, 0, 1.6, PROBE_REST + 2, 52, P, 14),
  tip: k.cylinder(40, 0, 2.6, PROBE_REST, 2, P, 18),
};
function checksArm(): Layer {
  const out = layer();
  out.solids.push({ paths: k.cylinder(40, 0, 5, 76, 10, P, 28), tone: "mid" });
  out.solids.push({ paths: slab({ x: 30, y: -52, w: 20, d: 58, r: 2 }, 86, 10, 3, 0.6), tone: "mid" });
  out.dots.push({ points: [at([34, -48, 96]), at([46, -48, 96]), at([34, 2, 96]), at([46, 2, 96])], size: 0.4, tone: "lo" });
  const { x, y, r, top } = DIAL;
  out.solids.push({ paths: k.cylinder(x, y, r, 96, top - 96, P, 56, 0.6), tone: "hi", crease: "lo" });
  out.lines.push({ d: k.knurl(x, y, r, top - 3, top, 64, P, 0.3), tone: "lo" });
  out.lines.push({ d: k.ring(x, y, r - 2, top, P, 56), tone: "lo" });
  const ticks = k.radialTicks(x, y, r - 2.6, 40, 5, top, [1.1, 2.4], P);
  out.lines.push({ d: ticks.minor, tone: "lo" }, { d: ticks.major, tone: "mid" });
  out.lines.push({ d: k.ring(x, y, 1.4, top, P, 14), tone: "mid" });
  return out;
}

export const needleAt = (turn: number) => {
  const angle = turn * Math.PI * 2;
  const { x, y, r, top } = DIAL;
  return k.lineOnTop([x - Math.sin(angle) * 3, y + Math.cos(angle) * 3], [x + Math.sin(angle) * (r - 3.4), y - Math.cos(angle) * (r - 3.4)], top + 0.2, P);
};

// Backlog hopper over the belt start; cards drop out of its mouth.
function hopper(): Layer {
  const out = layer();
  out.solids.push({ paths: slab({ x: -196, y: -38, w: 12, d: 14, r: 1 }, 78, 8, 2, 0.4), tone: "mid" });
  out.solids.push({ paths: slab({ x: -210, y: -17, w: 40, d: 34, r: 2 }, 44, 8, 3, 0.5), tone: "mid" });
  const bin: Plan = { x: -214, y: -24, w: 48, d: 48, r: 3 };
  out.solids.push({ paths: slab(bin, 52, 36, 4, 0.8), tone: "mid", inner: k.lineSvg(k.sideSeam(bin, 58, P, 4), { tone: "faint" }) });
  out.lines.push({ d: k.planOutline(k.insetPlan(bin, 4), 88, P, 3), tone: "lo" });
  out.solids.push({ paths: slab({ ...CARD_PLAN, x: -207, y: -14 }, 87.4, 0.6, 3), tone: "hi", crease: "none" });
  out.lines.push({ d: k.lineOnTop([-203, -9], [-193, -9], 88, P), tone: "lo", free: true });
  return out;
}

export const LAYERS = {
  base: base(),
  machine: machine(),
  back: backColumns(),
  belt: belt(),
  front: front(),
  gantry: gantry(),
  checksArm: checksArm(),
  hopper: hopper(),
};

export const BACKLOG_LABEL = k.sideMatrix([-208, 24], 80, P, "left");

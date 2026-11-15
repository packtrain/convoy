import * as k from "../software-factory/kit/iso-kit";
import type { Flat, Plan, Point3, SolidPaths } from "../software-factory/kit/iso-kit";
import { fillet, pathLength, resample, scaleOf, tubePieces, type TubePiece } from "./tube";

// A wall-mounted pneumatic post: x runs along the wall, +y toward the viewer, z up.
export const WIDTH = 560;
export const HEIGHT = 700;

const RAIL_X = [-48, 48];
const RAIL_Y = -6;
const TOP = 236;
const SHELF_Z = 192;
export const STATION_H = 30;
export const HUB: { x: number; y: number; r: number; z0: number; z1: number } = { x: 0, y: 12, r: 24, z0: 92, z1: 128 };
export const LID_TOP = HUB.z1 + 3;
export const TUBE_R = 2.6;
export const CAPSULE_R = 1.9;
export const CAPSULE_LEN = 5;

export const P = k.fitProjection(
  [[-50, RAIL_Y, 0], [68, 47, 0], [-50, 47, 0], [RAIL_X[0]! - 4, RAIL_Y, TOP + 3], [RAIL_X[1]! + 4, RAIL_Y, TOP + 3], [-56, 34, SHELF_Z + 4], [56, 34, SHELF_Z + 4], [14, 6, SHELF_Z + 4 + STATION_H + 5], [52, 34, 118]],
  WIDTH,
  HEIGHT,
  { pad: 22, azimuth: 50, elevation: 45 },
);
export const SCALE = scaleOf(P);
export const at = (point: Point3) => k.iso(point, P);
const slab = (plan: Plan, z: number, h: number, steps = 3, bevel = 0) => k.slabOf(plan, z, h, P, steps, bevel);
const faceRect = (x0: number, x1: number, y: number, z0: number, z1: number) => k.pathOf([at([x0, y, z0]), at([x1, y, z0]), at([x1, y, z1]), at([x0, y, z1])], true);

export interface SolidPart { paths: SolidPaths; tone?: k.Tone; crease?: k.Tone | "none"; lit?: boolean; inner?: string; className?: string }
export interface LinePart { d: string; tone?: k.LineTone; free?: boolean }
export interface Layer { solids: SolidPart[]; lines: LinePart[]; dots: { points: k.Flat[]; size?: number; tone?: k.Tone }[] }
const layer = (): Layer => ({ solids: [], lines: [], dots: [] });

// The rack: two rails on floor flanges, a brace at the top and one behind the hub.
function rails(): Layer {
  const out = layer();
  for (const x of RAIL_X) {
    out.solids.push({ paths: slab({ x: x - 6, y: RAIL_Y - 3, w: 12, d: 12, r: 1 }, 0, 1.6, 3, 0.3), tone: "lo" });
    out.solids.push({ paths: slab({ x: x - 2.5, y: RAIL_Y - 2.5, w: 5, d: 5, r: 0.8 }, 1.6, TOP - 1.6, 2, 0.4), tone: "mid", inner: k.lineSvg([60, 150].map((z) => k.sideSeam({ x: x - 2.5, y: RAIL_Y - 2.5, w: 5, d: 5, r: 0.8 }, z, P, 2)).join(""), { tone: "faint" }) });
    out.dots.push({ points: [at([x - 4, RAIL_Y - 1, 1.6]), at([x + 4, RAIL_Y + 1, 1.6])], size: 0.45 });
  }
  out.solids.push({ paths: slab({ x: RAIL_X[0]! - 3, y: RAIL_Y - 1.5, w: RAIL_X[1]! - RAIL_X[0]! + 6, d: 3, r: 0.6 }, TOP, 3, 2, 0.3), tone: "mid" });
  out.solids.push({ paths: slab({ x: RAIL_X[0]!, y: RAIL_Y - 1.5, w: RAIL_X[1]! - RAIL_X[0]!, d: 3, r: 0.6 }, 70, 3, 2, 0.3), tone: "mid" });
  return out;
}

// The browser: a desk shelf with a terminal and the brass send-and-receive station.
export const STATION: Flat = [14, 6];
const SHELF: Plan = { x: -56, y: RAIL_Y, w: 112, d: 40, r: 1.5 };
export const SCREEN_Y = 10;
export const SCREEN_LINES = [213, 210.5, 208, 205.5].map((z, index) => k.segment([-48, SCREEN_Y, SHELF_Z - 192 + z], [-48 + [18, 12, 15, 8][index]!, SCREEN_Y, SHELF_Z - 192 + z], P));
function desk(): Layer {
  const out = layer();
  for (const x of RAIL_X) out.solids.push({ paths: slab({ x: x - 4, y: RAIL_Y, w: 8, d: 22, r: 0.8 }, SHELF_Z - 8, 8, 2, 0.4), tone: "lo" });
  out.solids.push({ paths: slab(SHELF, SHELF_Z, 4, 4, 0.8), tone: "mid" });
  out.lines.push({ d: k.planOutline(k.insetPlan(SHELF, 3), SHELF_Z + 4, P, 3), tone: "faint" });
  out.solids.push({ paths: slab({ x: -52, y: 2, w: 28, d: 16, r: 1.5 }, SHELF_Z + 4, 3, 3, 0.4), tone: "lo" });
  out.solids.push({ paths: slab({ x: -51, y: 4, w: 26, d: 6, r: 1 }, SHELF_Z + 7, 20, 3, 0.6), tone: "hi", crease: "lo" });
  out.lines.push({ d: faceRect(-49, -29, SCREEN_Y, SHELF_Z + 10, SHELF_Z + 24), tone: "mid" });
  out.lines.push({ d: faceRect(-50, -28, SCREEN_Y, SHELF_Z + 9, SHELF_Z + 25), tone: "faint" });
  const keys: Plan = { x: -51, y: 14, w: 26, d: 10, r: 1 };
  out.solids.push({ paths: slab(keys, SHELF_Z + 4, 1.6, 3, 0.3), tone: "mid" });
  out.dots.push({ points: k.dotGrid(-48, 16, 8, 3, 3, SHELF_Z + 5.6, P), size: 0.55, tone: "mid" });
  const tray: Plan = { x: -22, y: 20, w: 22, d: 12, r: 1 };
  out.solids.push({ paths: slab(tray, SHELF_Z + 4, 2, 3, 0.3), tone: "mid" });
  out.lines.push({ d: k.planOutline(k.insetPlan(tray, 1.6), SHELF_Z + 6, P, 2), tone: "faint" });
  out.solids.push({ paths: slab(k.insetPlan(tray, 2.6), SHELF_Z + 6, 0.5, 2), tone: "hi", crease: "none" });
  out.lines.push({ d: [24, 26.5].map((y) => k.lineOnTop([-17, y], [-17 + (y > 25 ? 7 : 11), y], SHELF_Z + 6.5, P)).join(""), tone: "lo", free: true });
  out.solids.push({ paths: k.cylinder(STATION[0], STATION[1], 6.4, SHELF_Z + 4, 1.6, P, 32), tone: "lo" });
  return out;
}

// The Convex hub: a brass drum on side brackets, one slot and lamp per thread, a dial on the lid.
export const SLOTS = 8;
export const slotAngle = (slot: number) => (slot / SLOTS) * Math.PI * 2 - Math.PI / 2;
export const LAMPS = Array.from({ length: SLOTS }, (_, slot) => {
  const a = slotAngle(slot);
  return k.cylinder(HUB.x + Math.cos(a) * 19.5, HUB.y + Math.sin(a) * 19.5, 1.8, LID_TOP, 1.8, P, 16);
});
export const needleAt = (angle: number) => k.lineOnTop([HUB.x - Math.cos(angle) * 2.5, HUB.y - Math.sin(angle) * 2.5], [HUB.x + Math.cos(angle) * 9.5, HUB.y + Math.sin(angle) * 9.5], LID_TOP + 0.3, P);
export const NAMEPLATE = k.sideMatrix([HUB.x - 6.4, HUB.y + HUB.r + 1.4], 111.1, P, "left");
function hub(): Layer {
  const out = layer();
  for (const x of RAIL_X) out.solids.push({ paths: slab({ x: x < 0 ? x : x - 25, y: RAIL_Y, w: 25, d: 30, r: 0.8 }, 86, 6, 2, 0.4), tone: "lo" });
  out.solids.push({ paths: k.cylinder(HUB.x, HUB.y, HUB.r + 2, 88, 4, P, 48), tone: "lo" });
  out.solids.push({
    paths: k.cylinder(HUB.x, HUB.y, HUB.r, HUB.z0, HUB.z1 - HUB.z0, P, 48),
    tone: "hi",
    crease: "lo",
    inner: k.lineSvg([98, 122].map((z) => k.sideArc(HUB.x, HUB.y, HUB.r, z, P, 32)).join(""), { tone: "faint" }),
  });
  out.lines.push({ d: k.knurl(HUB.x, HUB.y, HUB.r, 102, 118, SLOTS, P, 0), tone: "lo" });
  out.solids.push({ paths: slab({ x: HUB.x - 9, y: HUB.y + HUB.r - 1, w: 18, d: 2.4, r: 0.5 }, 106, 7, 2, 0.3), tone: "mid" });
  out.dots.push({ points: [at([HUB.x - 8, HUB.y + HUB.r + 1.4, 107.6]), at([HUB.x + 8, HUB.y + HUB.r + 1.4, 107.6]), at([HUB.x - 8, HUB.y + HUB.r + 1.4, 112.4]), at([HUB.x + 8, HUB.y + HUB.r + 1.4, 112.4])], size: 0.4 });
  out.solids.push({ paths: k.cylinder(HUB.x, HUB.y, HUB.r + 1, HUB.z1, 3, P, 48, 0.8), tone: "mid" });
  out.lines.push({ d: k.ring(HUB.x, HUB.y, 11.5, LID_TOP, P, 40), tone: "lo" });
  const ticks = k.radialTicks(HUB.x, HUB.y, 10.5, SLOTS * 3, 3, LID_TOP, [1, 2.4], P, -Math.PI / 2);
  out.lines.push({ d: ticks.minor, tone: "lo" }, { d: ticks.major, tone: "mid" });
  out.lines.push({ d: k.ring(HUB.x, HUB.y, 1.4, LID_TOP, P, 12), tone: "mid" });
  return out;
}

// Your machine running `convoy connect`: a terminal box on the floor, a diverter turret beside it, four receivers in a row.
const BOX: Plan = { x: -34, y: 6, w: 38, d: 28, r: 2 };
const BOX_FACE = BOX.y + BOX.d;
export const BOX_TOP = 30;
export const COUPLING: Point3 = [-8, 12, BOX_TOP + 2];
export const BOX_LINES = [23, 20.5, 18, 15.5].map((z, index) => k.segment([-30, BOX_FACE, z], [-30 + [18, 12, 15, 8][index]!, BOX_FACE, z], P));
export const TURRET: Flat = [9, 22];
export const RECEIVER_X = [22, 35, 48, 61];
export const RECEIVER_Y = 36;
export const RECEIVER_TOP = 12;
export const RUNTIMES = ["Claude Code", "Codex", "OpenCode", "Cursor"];
function machine(): Layer {
  const out = layer();
  out.solids.push({ paths: slab(k.insetPlan(BOX, -1.5), 0, 2, 3), tone: "lo" });
  out.solids.push({ paths: slab(BOX, 2, BOX_TOP - 2, 4, 0.8), tone: "hi", crease: "lo", inner: k.lineSvg(k.sideSeam(BOX, 5, P, 4), { tone: "faint" }) });
  out.lines.push({ d: faceRect(-31, -9, BOX_FACE, 13, 25), tone: "mid" });
  out.lines.push({ d: faceRect(-32, -8, BOX_FACE, 12, 26), tone: "faint" });
  out.lines.push({ d: faceRect(-30, -12, BOX_FACE, 5, 9), tone: "faint" });
  out.lines.push({ d: [-27, -24, -21, -18, -15].map((x) => k.segment([x, BOX_FACE, 5], [x, BOX_FACE, 9], P)).join(""), tone: "lo" });
  const [tx, ty] = TURRET;
  out.solids.push({ paths: k.cylinder(tx, ty, 6, 0, 1.6, P, 28), tone: "lo" });
  out.solids.push({ paths: k.cylinder(tx, ty, 5, 1.6, 12.4, P, 28), tone: "mid", inner: k.lineSvg(k.sideArc(tx, ty, 5, 8, P, 20), { tone: "faint" }) });
  out.solids.push({ paths: k.cylinder(tx, ty, 4, 14, 4, P, 24, 0.5), tone: "hi", crease: "lo" });
  out.lines.push({ d: k.knurl(tx, ty, 4, 14.6, 17.4, 24, P), tone: "lo" });
  return out;
}
export const RUNTIME_TAGS = ["CLAUDE", "CODEX", "OPENCODE", "CURSOR"];
export const RECEIVERS = RECEIVER_X.map((x) => ({
  tag: slab({ x: x - 6, y: RECEIVER_Y + 6, w: 12, d: 4.6, r: 0.5 }, 0, 0.8, 2, 0.2),
  tagText: k.topMatrix([x, RECEIVER_Y + 9.2], 0.8, P),
  foot: k.cylinder(x, RECEIVER_Y, 5.2, 0, 1.2, P, 28),
  cup: k.cylinder(x, RECEIVER_Y, 4.2, 1.2, RECEIVER_TOP - 1.2, P, 28),
  mouth: k.ring(x, RECEIVER_Y, 3.1, RECEIVER_TOP, P, 24),
  band: k.sideArc(x, RECEIVER_Y, 4.2, 4, P, 20),
}));

// Tubes: routes as straight legs, filleted, then split into depth-sortable pieces.
export interface Route { points: Point3[]; flat: Flat[]; along: number[]; total: number; pieces: TubePiece[] }
export function routeOf(legs: Point3[], radius: number | ((t: number) => number) = TUBE_R, options: { gaps?: [number, number][]; breaks?: number[]; maxLength?: number; caps?: boolean | [boolean, boolean] } = {}): Route {
  const points = resample(fillet(legs, 9, 7, { P, tube: typeof radius === "number" ? radius : TUBE_R }), 1.5);
  const flat = points.map(at);
  const along = [0];
  for (let index = 1; index < flat.length; index++) along.push(along[index - 1]! + Math.hypot(flat[index]![0] - flat[index - 1]![0], flat[index]![1] - flat[index - 1]![1]));
  return { points, flat, along, total: along[along.length - 1]!, pieces: tubePieces(points, radius, P, { maxLength: options.maxLength ?? 24, gaps: options.gaps, breaks: options.breaks, caps: options.caps ?? true }) };
}
export const worldLength = (route: Route) => pathLength(route.points);

const pointAt = (route: Route, s: number): Flat => {
  const target = Math.max(0, Math.min(route.total, s));
  let index = 1;
  while (index < route.along.length - 1 && route.along[index]! < target) index++;
  const a = route.flat[index - 1]!;
  const b = route.flat[index]!;
  const span = route.along[index]! - route.along[index - 1]! || 1;
  const t = (target - route.along[index - 1]!) / span;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
};

// Capsules as pills along the centreline: a round-capped stroke over the screen arc that the capsule's length covers.
export function capsulesOn(route: Route, fractions: number[], length = CAPSULE_LEN * SCALE * 0.85): string {
  return fractions
    .map((fraction) => {
      const s0 = fraction * route.total - length / 2;
      const s1 = s0 + length;
      const inner = route.along.map((s, index) => (s > s0 && s < s1 ? route.flat[index]! : null)).filter((p): p is Flat => p !== null);
      return k.pathOf([pointAt(route, s0), ...inner, pointAt(route, s1)]);
    })
    .join("");
}

// The station is the glass top of the browser tube: wide above the shelf, narrow below it, split at the shelf's faces.
export const STATION_TOP = SHELF_Z + 4 + STATION_H;
const T1_LEN = STATION_TOP - LID_TOP;
export const T1 = routeOf([[STATION[0], STATION[1], STATION_TOP], [STATION[0], STATION[1], LID_TOP]], (t) => (t * T1_LEN < STATION_H + 2 ? 4.4 : TUBE_R), {
  gaps: [[STATION_H, STATION_H + 4]],
  maxLength: 400,
});
export const STATION_CAP = {
  lid: k.cylinder(STATION[0], STATION[1], 5.4, STATION_TOP, 2.4, P, 32, 0.7),
  knob: k.cylinder(STATION[0], STATION[1], 2, STATION_TOP + 2.4, 2.2, P, 20, 0.4),
};
export const STATION_SLOT = 7.2;
export const STATION_FILL = 4;
export const stationFraction = (index: number) => (STATION_H - 2.8 - index * STATION_SLOT) / T1_LEN;

// Hub base straight down to the machine box; the coupling nut sits at the pipe's foot on the box.
export const COLLAR_H = 3.6;
const T2_LEGS: Point3[] = [[-8, 12, 88], [-8, 12, BOX_TOP + COLLAR_H]];
export const T2 = routeOf(T2_LEGS, TUBE_R, { maxLength: 400 });
export const COLLAR = k.cylinder(COUPLING[0], COUPLING[1], TUBE_R + 2.2, BOX_TOP, COLLAR_H, P, 28, 0.5);
export const COLLAR_KNURL = k.knurl(COUPLING[0], COUPLING[1], TUBE_R + 2.2, BOX_TOP + 0.6, BOX_TOP + 3, 26, P);
export const DROP = 9;
export const COUPLING_HIT = at([COUPLING[0], COUPLING[1], BOX_TOP + 2]);
const port = slotAngle(1.2);
export const MAG_BOTTOM: Point3 = [46, 34, 58];
export const MAG = routeOf([[HUB.x + Math.cos(port) * (HUB.r - 1), HUB.y + Math.sin(port) * (HUB.r - 1), 112], [HUB.x + Math.cos(port) * (HUB.r + 10), HUB.y + Math.sin(port) * (HUB.r + 10), 112], [MAG_BOTTOM[0], MAG_BOTTOM[1], 112], MAG_BOTTOM], 3.2, { caps: [false, true] });
export const MAG_FOOT = {
  bracket: slab({ x: RAIL_X[1]! - 2.5, y: RAIL_Y, w: 5, d: MAG_BOTTOM[1] - RAIL_Y, r: 0.6 }, 54, 3, 2, 0.3),
  cap: k.cylinder(MAG_BOTTOM[0], MAG_BOTTOM[1], 4.2, 57, 2.4, P, 28, 0.4),
};
export const MAG_SLOT = 9.2;
export const magazineFraction = (index: number) => 1 - (3.4 + index * MAG_SLOT) / worldLength(MAG);
export const spoutOf = (x: number) => routeOf([[TURRET[0], TURRET[1], 18], [TURRET[0], TURRET[1], 30], [x, RECEIVER_Y, 30], [x, RECEIVER_Y, RECEIVER_TOP + 0.5]], TUBE_R, { maxLength: 400 });

export const HALOS = [
  k.haloOf(k.insetPlan(BOX, -4), -4, 4, P),
  k.haloOf({ x: RECEIVER_X[0]! - 8, y: RECEIVER_Y - 8, w: RECEIVER_X[3]! - RECEIVER_X[0]! + 16, d: 16, r: 8 }, -4, 4, P),
  k.haloOf({ x: TURRET[0] - 8, y: TURRET[1] - 8, w: 16, d: 16, r: 8 }, -4, 4, P),
  ...RAIL_X.map((x) => k.haloOf({ x: x - 8, y: RAIL_Y - 5, w: 16, d: 16, r: 3 }, -4, 4, P)),
];

export const BROWSER_TAG = k.sideMatrix([SHELF.x + 4, SHELF.y + SHELF.d], SHELF_Z + 3.2, P, "left");
export const MACHINE_TAG = k.topMatrix([BOX.x + 3, BOX_FACE - 3], BOX_TOP, P);

export const LAYERS = { rails: rails(), desk: desk(), hub: hub(), machine: machine() };

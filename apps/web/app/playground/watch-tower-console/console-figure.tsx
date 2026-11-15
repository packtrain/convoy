"use client";

import * as React from "react";
import { translateAlong, type Point3 } from "../software-factory/kit/iso-kit";
import { Dots, Line, Plate, Solid } from "../software-factory/kit/draw";
import { spring, useInView, useLoop, useStillness, type Spring } from "../software-factory/kit/live";
import {
  CLEAR_KEY, CLEAR_RULE, HEIGHT, LAMP_PATHS, LAYERS, P, PHI, SLOTS, STRIP_ART, SWEEP, TRAY, TRAY_LABEL, TRAY_LIP, WIDTH,
  blipAt, boardSlot, lerp3, offset, printerMouth, sweepPath, traySlot, type Layer,
} from "./geometry";

const PROJECTS = ["web", "cli", "docs", "desktop", "landing", "self-hosted", "plugins", "sandbox"];
const BAY_STATES = ["running", "waiting", "failed", "ready"] as const;
type RunState = (typeof BAY_STATES)[number] | "done";
const LABEL: Record<RunState, string> = { running: "running", waiting: "waiting for your input", failed: "failed", ready: "needs your review", done: "done" };
const COUNT_WORD: Record<(typeof BAY_STATES)[number], string> = { running: "running", waiting: "waiting", failed: "failed", ready: "ready" };
const TRAVEL = 0.9;
const FILE_TIME = 0.6;
const TOUR_AFTER = 6;
const SPAWN_EVERY = 5;

interface Motion { from: Point3; to: Point3; t: number; hop: number; settle: Spring; place: string; born: boolean; fade: boolean }
interface Run { id: number; project: number; state: RunState; t: number; until: number; since: number; motion: Motion; blip: { angle: number; r: number }; filing: number }
interface Sim { runs: Run[]; time: number; nextId: number; idle: number; sinceSpawn: number; approved: number; seed: number }

const rand = (sim: Sim) => {
  sim.seed = (sim.seed * 1664525 + 1013904223) % 4294967296;
  return sim.seed / 4294967296;
};
const between = (sim: Sim, lo: number, hi: number) => lo + rand(sim) * (hi - lo);
const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const DOWN_SLANT: Point3 = [0, Math.cos(PHI), -Math.sin(PHI)];

function makeRun(sim: Sim, id: number, project: number, state: RunState, t: number, until: number, from: Point3, born: boolean): Run {
  return {
    id,
    project,
    state,
    t,
    until,
    since: sim.time + (born ? 0 : -t),
    motion: { from, to: from, t: 1, hop: 0, settle: { at: 0, rate: 0 }, place: "", born, fade: born },
    blip: { angle: rand(sim) * Math.PI * 2, r: 8 + rand(sim) * 30 },
    filing: -1,
  };
}

// Where every strip belongs right now: by bay and arrival order, newest Done at the top of the tray.
function placeAll(sim: Sim) {
  for (const state of BAY_STATES) {
    const bay = BAY_STATES.indexOf(state);
    const inBay = sim.runs.filter((r) => r.state === state).sort((a, b) => a.since - b.since);
    inBay.forEach((r, index) => settle(r, `b${bay}:${index}`, boardSlot(bay, Math.min(index, SLOTS - 1)), 9));
  }
  const done = sim.runs.filter((r) => r.state === "done").sort((a, b) => b.since - a.since);
  done.forEach((r, index) => {
    if (index >= TRAY.slots) {
      if (r.filing < 0) r.filing = 0;
      return;
    }
    settle(r, `t:${index}`, traySlot(index), 9);
  });
}
function settle(r: Run, place: string, to: Point3, hop: number) {
  const m = r.motion;
  if (m.place === place) return;
  const sameRack = m.place.split(":")[0] === place.split(":")[0];
  m.from = m.place ? positionOf(r) : m.from;
  m.to = to;
  m.t = m.place ? 0 : 1;
  m.hop = m.place ? (sameRack ? 2.5 : hop) : 0;
  m.place = place;
  if (m.born) {
    m.t = 0;
    m.hop = hop;
    m.born = false;
  }
}
const positionOf = (r: Run): Point3 => {
  const m = r.motion;
  const base = lerp3(m.from, m.to, ease(m.t));
  return offset(base, m.hop * Math.sin(Math.PI * Math.min(1, m.t)) + m.settle.at);
};

function initialSim(): Sim {
  const sim: Sim = { runs: [], time: 0, nextId: 2322, idle: 0, sinceSpawn: 0, approved: 41, seed: 11 };
  const seed: [number, RunState, number, number][] = [
    [2314, "ready", 14, 0],
    [2315, "running", 3, 9],
    [2316, "waiting", 2, 7],
    [2317, "running", 6, 11],
    [2318, "failed", 4, 0],
    [2319, "running", 1, 8],
    [2320, "ready", 5, 0],
    [2321, "running", 0.5, 12],
    [2311, "done", 30, 0],
    [2309, "done", 60, 0],
  ];
  seed.forEach(([id, state, t, until], index) => sim.runs.push(makeRun(sim, id, index % PROJECTS.length, state, t, until, [0, 0, 0], false)));
  placeAll(sim);
  for (const r of sim.runs) {
    r.motion.from = r.motion.to;
    r.motion.t = 1;
  }
  return sim;
}

function approve(sim: Sim, ids: number[]) {
  let any = false;
  for (const r of sim.runs) {
    if (!ids.includes(r.id) || r.state !== "ready") continue;
    r.state = "done";
    r.since = sim.time;
    r.t = 0;
    sim.approved += 1;
    any = true;
  }
  if (any) placeAll(sim);
  return any;
}
const readyIds = (sim: Sim) => sim.runs.filter((r) => r.state === "ready").map((r) => r.id);

function step(sim: Sim, dt: number, calm: boolean) {
  sim.time += dt;
  sim.idle += dt;
  sim.sinceSpawn += dt;
  let changed = false;
  for (const r of sim.runs) {
    r.t += dt;
    if (r.until > 0 && r.t > r.until) {
      changed = true;
      r.t = 0;
      r.since = sim.time;
      if (r.state === "running") {
        const roll = rand(sim);
        const next: RunState = roll < 0.3 ? "waiting" : roll < 0.42 ? "failed" : "ready";
        if (sim.runs.filter((other) => other.state === next).length >= SLOTS) {
          r.until = between(sim, 3, 6);
          continue;
        }
        r.state = next;
        r.until = next === "waiting" ? between(sim, 5, 9) : next === "failed" ? between(sim, 9, 14) : 0;
      } else if (r.state === "waiting" || r.state === "failed") {
        r.state = "running";
        r.until = between(sim, 7, 13);
      }
    }
  }
  const running = sim.runs.filter((r) => r.state === "running").length;
  const live = sim.runs.filter((r) => r.state !== "done").length;
  if (sim.sinceSpawn > SPAWN_EVERY && running < SLOTS && live < 11) {
    sim.sinceSpawn = 0;
    sim.runs.push(makeRun(sim, sim.nextId, sim.nextId % PROJECTS.length, "running", 0, between(sim, 7, 13), printerMouth, true));
    sim.nextId += 1;
    changed = true;
  }
  const ready = sim.runs.filter((r) => r.state === "ready");
  if (!calm && (sim.idle > TOUR_AFTER || ready.length >= SLOTS)) {
    const oldest = ready.filter((r) => r.t > 3).sort((a, b) => a.since - b.since)[0];
    if (oldest) {
      approve(sim, [oldest.id]);
      sim.idle = TOUR_AFTER - 5;
    }
  }
  if (changed) placeAll(sim);
  for (const r of sim.runs) {
    const m = r.motion;
    if (m.t < 1) {
      m.t = calm ? 1 : Math.min(1, m.t + dt / TRAVEL);
      if (m.t === 1) {
        m.settle.rate = m.hop * 1.6;
        m.fade = false;
      }
    }
    spring(m.settle, 0, dt, 320, 16, calm);
    if (r.filing >= 0) r.filing += calm ? 1 : dt / FILE_TIME;
  }
  sim.runs = sim.runs.filter((r) => r.filing < 1);
}

const refOf = (r: Run) => `OS-${r.id}`;
const describe = (r: Run) => `${refOf(r)} · ${PROJECTS[r.project]} · ${LABEL[r.state]}`;
const countsOf = (sim: Sim) =>
  BAY_STATES.map((state) => [state, sim.runs.filter((r) => r.state === state).length] as const)
    .filter(([, n]) => n > 0)
    .map(([state, n]) => `${n} ${COUNT_WORD[state]}`)
    .join(" · ");
// Strips in reading order for the arrow keys: bay by bay, top slot first.
const ordered = (sim: Sim) =>
  BAY_STATES.flatMap((state) => sim.runs.filter((r) => r.state === state).sort((a, b) => a.since - b.since));

const snapshotOf = (sim: Sim): Sim => ({ ...sim, runs: sim.runs.map((r) => ({ ...r, motion: { ...r.motion, settle: { ...r.motion.settle } } })) });
const signatureOf = (sim: Sim) => sim.runs.map((r) => `${r.id}${r.state[0]}${r.motion.place}${r.motion.t < 1 ? "m" : ""}${r.filing >= 0 ? "f" : ""}`).join(",");

function LayerArt({ layer }: { layer: Layer }) {
  return (
    <>
      {layer.solids.map((part, index) => (
        <Solid key={`s${index}`} paths={part.paths} tone={part.tone ?? "mid"} crease={part.crease} lit={part.lit} className={part.className} inner={part.inner ? <g dangerouslySetInnerHTML={{ __html: part.inner }} /> : undefined} />
      ))}
      {layer.lines.map((line, index) => <Line key={`l${index}`} d={line.d} tone={line.tone} free={line.free} className={line.className} />)}
      {layer.dots.map((dots, index) => <Dots key={`d${index}`} points={dots.points} size={dots.size} tone={dots.tone} />)}
    </>
  );
}

interface StripProps { run: Run; pick: boolean; selected: boolean; register: (id: number, node: SVGGElement | null) => void; onHover: (id: number) => void; onClick: (id: number, shift: boolean) => void }
function StripArt({ run: r, pick, selected, register, onHover, onClick }: StripProps) {
  return (
    <g
      ref={(node) => register(r.id, node)}
      className={`wt-strip wt-p${r.project % 4}`}
      data-pick={pick ? "" : undefined}
      data-sel={selected ? "" : undefined}
      data-ready={r.state === "ready" ? "" : undefined}
      data-state={r.state}
      data-place={r.motion.place}
      transform={translateAlong(P, positionOf(r))}
      onPointerEnter={() => onHover(r.id)}
      onPointerLeave={() => onHover(-1)}
      onClick={(event) => {
        event.stopPropagation();
        onClick(r.id, event.shiftKey);
      }}
    >
      <Solid paths={STRIP_ART.body} tone="hi" crease="lo" lit={r.state === "ready"} />
      <Solid paths={STRIP_ART.tab} tone="mid" crease="none" className="wt-tab" />
      {STRIP_ART.rules.map((d, index) => <Line key={index} d={d} tone="lo" free />)}
      <Line d={STRIP_ART.hole} tone="lo" />
    </g>
  );
}

/** Watch Tower as a controller's desk: a radar scope of live runs and a four-bay strip board for triage. */
export function ConsoleFigure() {
  const [first] = React.useState(initialSim);
  const sim = React.useRef(first);
  const [s, setView] = React.useState(() => snapshotOf(first));
  const signature = React.useRef(signatureOf(first));
  const [hover, setHover] = React.useState(-1);
  const [pick, setPick] = React.useState(-1);
  const [selected, setSelected] = React.useState<number[]>([]);
  const stage = React.useRef<HTMLDivElement>(null);
  const inView = useInView(stage);
  const still = useStillness();
  const strips = React.useRef(new Map<number, SVGGElement>());
  const blips = React.useRef(new Map<number, SVGCircleElement>());
  const sweep = React.useRef<SVGPathElement>(null);
  const trails = React.useRef<(SVGPathElement | null)[]>([]);

  const register = React.useCallback((id: number, node: SVGGElement | null) => {
    if (node) strips.current.set(id, node);
    else strips.current.delete(id);
  }, []);
  const registerBlip = React.useCallback((id: number, node: SVGCircleElement | null) => {
    if (node) blips.current.set(id, node);
    else blips.current.delete(id);
  }, []);

  const tick = React.useCallback((dt: number, calm: boolean) => {
    const live = sim.current;
    step(live, dt, calm);
    const angle = ((live.time / SWEEP.period) % 1) * Math.PI * 2;
    sweep.current?.setAttribute("d", sweepPath(angle));
    trails.current.forEach((node, index) => node?.setAttribute("d", sweepPath(angle, SWEEP.trail[index]!)));
    let moving = false;
    for (const r of live.runs) {
      const node = strips.current.get(r.id);
      if (node) {
        const m = r.motion;
        const pos = positionOf(r);
        const filed = r.filing >= 0 ? Math.min(1, r.filing) : 0;
        node.setAttribute("transform", translateAlong(P, [pos[0] + DOWN_SLANT[0] * filed * 8, pos[1] + DOWN_SLANT[1] * filed * 8, pos[2] + DOWN_SLANT[2] * filed * 8]));
        const alpha = (m.fade ? Math.min(1, m.t * 3) : 1) * (1 - filed);
        node.setAttribute("opacity", alpha.toFixed(2));
        if (m.t < 1 || m.settle.rate !== 0 || r.filing >= 0) moving = true;
      }
      const blip = blips.current.get(r.id);
      if (blip) {
        const age = ((((angle - r.blip.angle) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * SWEEP.period;
        const glow = r.state === "waiting" ? (Math.sin(live.time * Math.PI * 2) > 0 ? 1 : 0.15) : 0.15 + 0.85 * Math.exp(-age / 1.1);
        blip.setAttribute("opacity", glow.toFixed(2));
      }
    }
    const next = signatureOf(live);
    if (next !== signature.current) {
      signature.current = next;
      setView(snapshotOf(live));
    }
    return !calm || moving;
  }, []);
  const kick = useLoop(tick, inView && !still);

  const act = (ids: number[]) => {
    if (approve(sim.current, ids)) {
      setSelected([]);
      sim.current.idle = -4;
      kick();
    }
  };
  const onStrip = (id: number, shift: boolean) => {
    sim.current.idle = -4;
    if (shift) {
      setSelected((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
      setPick(id);
      return;
    }
    act(selected.includes(id) ? selected : [id]);
  };
  const onKey = (event: React.KeyboardEvent) => {
    const order = ordered(sim.current).map((r) => r.id);
    const here = order.indexOf(pick);
    const moves: Record<string, number> = {
      ArrowRight: order[Math.min(order.length - 1, here + 1)] ?? -1,
      ArrowDown: order[Math.min(order.length - 1, here + 1)] ?? -1,
      ArrowLeft: order[Math.max(0, here < 0 ? order.length - 1 : here - 1)] ?? -1,
      ArrowUp: order[Math.max(0, here < 0 ? order.length - 1 : here - 1)] ?? -1,
      Home: order[0] ?? -1,
      End: order[order.length - 1] ?? -1,
    };
    if (event.key in moves) {
      event.preventDefault();
      setPick(moves[event.key]!);
      sim.current.idle = -4;
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (event.shiftKey && pick >= 0) setSelected((list) => (list.includes(pick) ? list : [...list, pick]));
      else act(selected.length ? selected : [pick]);
    }
    if (event.key === "Escape") {
      setPick(-1);
      setSelected([]);
    }
  };

  const shownId = hover >= 0 ? hover : pick;
  const shown = s.runs.find((r) => r.id === shownId);
  const readout = shown ? describe(shown) : countsOf(s);
  const ready = s.runs.filter((r) => r.state === "ready").length;
  const resting = ordered(s).filter((r) => r.motion.t >= 1);
  const inTray = s.runs.filter((r) => r.state === "done" && r.motion.t >= 1).sort((a, b) => b.since - a.since);
  const moving = s.runs.filter((r) => r.motion.t < 1);
  const counts = BAY_STATES.map((state) => s.runs.filter((r) => r.state === state).length);

  return (
    <Plate
      fig="Fig 2"
      title="Watch Tower"
      hint={ready ? (selected.length ? "Click a selected strip to clear them" : "Click a lit strip to mark it done") : "Arrows pick · Enter marks done"}
      readout={readout}
      keys={[
        { mark: "lit", label: "Lit strip: a run that needs your review" },
        { mark: "green", label: "Running" },
        { mark: "red", label: "Failed" },
        { mark: "dim", label: "Blinking blip: waiting for your input" },
      ]}
      caption="Every strip is one agent run from one of your projects, filed by what it needs from you: running, waiting for your input, failed, needs your review. The scope tracks the live ones; a blip blinks when its run stops to ask a question. Click a strip that needs review to drop it into the Done tray, Shift-click to pick several, or hit the wide key to clear them all."
    >
      <div
        ref={stage}
        className="iso-stage wt"
        tabIndex={0}
        role="group"
        aria-label="Watch Tower console. Arrow keys move between strips, Enter marks the picked strip done, Shift and Enter adds it to a batch."
        data-inview={inView ? "" : undefined}
        onKeyDown={onKey}
        onBlur={() => setPick(-1)}
        style={{ outline: "none" }}
      >
        <span className="sr-only" aria-live="polite">{shown ? readout : ""}</span>
        <svg
          className="iso-svg"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label="An isometric air-traffic controller's desk. On the left a round radar scope with a sweeping line and blips, on the right a slanted flight-strip board with four bays labelled by lamps, a strip printer behind it, a keyboard, a done tray, a handset and a mug."
          focusable="false"
        >
          <LayerArt layer={LAYERS.desk} />
          <LayerArt layer={LAYERS.board} />
          {LAMP_PATHS.map((lamp, bay) => (
            <React.Fragment key={bay}>
              <Solid paths={lamp.body} tone="mid" />
              <Solid paths={lamp.cap} tone="lo" className={`wt-lamp wt-lamp-${BAY_STATES[bay]}${counts[bay]! > 0 ? " wt-on" : ""}`} lit={bay === 3 && counts[bay]! > 0} />
            </React.Fragment>
          ))}
          <LayerArt layer={LAYERS.scope} />
          <LayerArt layer={LAYERS.printer} />
          {SWEEP.trail.map((back, index) => (
            <path key={back} ref={(node) => { trails.current[index] = node; }} className="iso-line wt-trail" data-free="" style={{ opacity: 0.32 - index * 0.07 }} d={sweepPath(0, back)} />
          ))}
          <path ref={sweep} className="iso-line wt-sweep" data-free="" d={sweepPath(0)} />
          {s.runs
            .filter((r) => r.state === "running" || r.state === "waiting")
            .map((r) => {
              const [cx, cy] = blipAt(r.blip.angle, r.blip.r);
              return <circle key={r.id} ref={(node) => registerBlip(r.id, node)} className="wt-blip" cx={cx} cy={cy} r={1.5} opacity={0.3} />;
            })}
          <LayerArt layer={LAYERS.tray} />
          {[...resting, ...inTray, ...moving].map((r) => (
            <StripArt key={r.id} run={r} pick={shownId === r.id} selected={selected.includes(r.id)} register={register} onHover={setHover} onClick={onStrip} />
          ))}
          <Solid paths={TRAY_LIP} tone="mid" />
          <Line d={TRAY_LABEL} tone="lo" free />
          <LayerArt layer={LAYERS.deskware} />
          <g
            className="wt-key"
            data-on={ready ? "" : undefined}
            onClick={(event) => {
              event.stopPropagation();
              act(readyIds(sim.current));
            }}
          >
            <Solid paths={CLEAR_KEY} tone={ready ? "hi" : "mid"} lit={ready > 0} />
            <Line d={CLEAR_RULE} tone={ready ? "hi" : "lo"} free />
          </g>
        </svg>
      </div>
    </Plate>
  );
}

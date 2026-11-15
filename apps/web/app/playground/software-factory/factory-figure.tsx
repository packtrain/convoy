"use client";

import * as React from "react";
import { translateAlong } from "./kit/iso-kit";
import { Dots, Line, Plate, Solid } from "./kit/draw";
import { useInView, useLoop, useStillness } from "./kit/live";
import {
  BACKLOG_LABEL, BASE_HALO, BELT_END, BELT_TOP, CARD, CARD_ART, FLOW, GATE_LIFT, GATE_PAST, GATE_PATHS, GATE_SLOTS, HEAD, HEAD_REST, HEAD_WORK, HEIGHT, LAMP_PATHS,
  LAYERS, LED, P, PROBE, PROBE_REST, PROBE_TOUCH, SCREEN_LINES, SPAWN_X, SPAWN_Z, STACK_MAX, STOPS, TRAY_FLOOR, WIDTH, WIRE, needleAt, screenLine, stackPaths,
  type Layer,
} from "./geometry";

const VMAX = 90;
const ACC = 160;
const GRAVITY = 900;
const GAP = CARD.w + 10;
const AGENT_TIME = 2.8;
const CHECKS_TIME = 2.2;
const AUTO_APPROVE = 2.8;
const SPAWN_EVERY = 3.4;
const EDITS = 4;
const LAMPS = LAMP_PATHS.length;
const LEG_STOP = [STOPS.agent, STOPS.checks, STOPS.gate, STOPS.tray];

interface Card { id: number; x: number; v: number; z: number; vz: number; leg: number; t: number; edits: number; checked: boolean; approved: boolean; onBelt: boolean }
interface Sim { cards: Card[]; nextId: number; stack: number; merged: number; sinceSpawn: number; lamps: number; gate: number; gateOpen: boolean; approve: boolean }

const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const refOf = (id: number) => `OS-${id}`;

// Station timelines: what the head, probe and lamps do t seconds after a card stops under them.
const headAt = (t: number) => {
  if (t < 0.45) return HEAD_REST + (HEAD_WORK - HEAD_REST) * ease(t / 0.45);
  if (t < 2.35) return HEAD_WORK + 6 * Math.sin(Math.PI * (((t - 0.45) / 0.475) % 1)) ** 2;
  return HEAD_WORK + (HEAD_REST - HEAD_WORK) * ease((t - 2.35) / 0.45);
};
const editsAt = (t: number) => Math.max(0, Math.min(EDITS, Math.floor((t - 0.45) / 0.475) + 1));
const probeAt = (t: number) => {
  if (t < 0.35) return PROBE_REST + (PROBE_TOUCH - PROBE_REST) * ease(t / 0.35);
  if (t < 1.7) return PROBE_TOUCH;
  return PROBE_TOUCH + (PROBE_REST - PROBE_TOUCH) * ease((t - 1.7) / 0.35);
};
const lampsAt = (t: number) => Math.max(0, Math.min(LAMPS, Math.floor((t - 0.6) / 0.25) + 1));

const card = (id: number, x: number, leg: number, t: number, edits: number, checked: boolean): Card => ({ id, x, v: 0, z: BELT_TOP, vz: 0, leg, t, edits, checked, approved: false, onBelt: true });

function initialSim(): Sim {
  return {
    cards: [card(2318, STOPS.gate, 2, 0, EDITS, true), card(2319, STOPS.checks, 1, 1, EDITS, false), card(2320, STOPS.agent, 0, 1.4, editsAt(1.4), false)],
    nextId: 2321,
    stack: 2,
    merged: 14,
    sinceSpawn: 0,
    lamps: lampsAt(1),
    gate: 0,
    gateOpen: false,
    approve: false,
  };
}

const atStation = (sim: Sim, leg: number) => sim.cards.find((c) => c.leg === leg && c.t >= 0);
const waitingCard = (sim: Sim) => sim.cards.find((c) => c.leg === 2 && c.t >= 0 && !c.approved);

function step(sim: Sim, dt: number) {
  sim.sinceSpawn += dt;
  if (sim.sinceSpawn > SPAWN_EVERY && sim.cards.every((c) => c.x > SPAWN_X + GAP) && sim.cards.length < 6) {
    sim.cards.push({ ...card(sim.nextId++, SPAWN_X, 0, -1, 0, false), z: SPAWN_Z, onBelt: false });
    sim.sinceSpawn = 0;
  }

  const waiting = waitingCard(sim);
  if (waiting && (sim.approve || waiting.t > AUTO_APPROVE)) {
    waiting.approved = true;
    sim.gateOpen = true;
  }
  sim.approve = false;
  sim.gate += (Math.max(0, Math.min(GATE_LIFT, sim.gate + (sim.gateOpen ? 1 : -1) * GATE_LIFT * 3 * dt)) - sim.gate);

  const byX = [...sim.cards].sort((a, b) => b.x - a.x);
  for (const [index, c] of byX.entries()) {
    if (!c.onBelt) {
      c.vz -= GRAVITY * dt;
      c.z += c.vz * dt;
      if (c.z <= BELT_TOP) {
        c.z = BELT_TOP;
        c.vz = Math.abs(c.vz) > 40 ? -c.vz * 0.22 : 0;
        c.onBelt = c.vz === 0;
      }
      continue;
    }
    if (c.t >= 0) {
      c.t += dt;
      if (c.leg === 0) c.edits = editsAt(c.t);
      if (c.leg === 1) sim.lamps = lampsAt(c.t);
      if (c.leg === 1 && c.t > 1.5) c.checked = true;
      const done = (c.leg === 0 && c.t > AGENT_TIME) || (c.leg === 1 && c.t > CHECKS_TIME) || (c.leg === 2 && c.approved && sim.gate > GATE_LIFT - 1);
      if (!done) continue;
      c.leg += 1;
      c.t = -1;
    }
    const ahead = byX[index - 1];
    const target = Math.min(LEG_STOP[c.leg], ahead && ahead.leg < 4 ? ahead.x - GAP : Infinity);
    const dx = target - c.x;
    const want = Math.sign(dx) * Math.min(VMAX, Math.sqrt(2 * ACC * Math.abs(dx)));
    c.v += Math.max(-ACC * dt, Math.min(ACC * dt, want - c.v));
    c.x += c.v * dt;
    if (Math.abs(dx) < 0.05 && Math.abs(c.v) < 2) {
      c.x = target;
      c.v = 0;
      if (c.leg < 3 && target === LEG_STOP[c.leg]) {
        c.t = 0;
        if (c.leg === 1) sim.lamps = 0;
      }
    }
    if (c.leg === 3 && c.x > GATE_PAST) sim.gateOpen = false;
    if (c.leg === 3 && c.x > BELT_END) {
      const floor = TRAY_FLOOR + Math.min(sim.stack, STACK_MAX) * CARD.h;
      c.vz -= GRAVITY * dt;
      c.z += c.vz * dt;
      if (c.z <= floor) c.leg = 4;
    }
  }
  const landed = sim.cards.filter((c) => c.leg === 4).length;
  sim.stack += landed;
  sim.merged += landed;
  sim.cards = sim.cards.filter((c) => c.leg < 4);
}

function readoutOf(sim: Sim) {
  const waiting = waitingCard(sim);
  const checking = atStation(sim, 1);
  const writing = atStation(sim, 0);
  const focus = waiting
    ? `${refOf(waiting.id)} · awaiting review`
    : checking
      ? `${refOf(checking.id)} · checks ${sim.lamps}/${LAMPS}`
      : writing
        ? `${refOf(writing.id)} · agent ${writing.edits}/${EDITS} edits`
        : "line idle";
  return `${focus} · ${sim.merged} merged`;
}

// What the render reads: a copy of the sim, taken whenever its discrete state changes.
const snapshotOf = (sim: Sim): Sim => ({ ...sim, cards: sim.cards.map((c) => ({ ...c })) });

const signatureOf = (sim: Sim) =>
  [sim.cards.map((c) => `${c.id}:${c.x > GATE_PAST ? "b" : "a"}${c.edits}${c.checked ? 1 : 0}${c.approved ? 1 : 0}`).join(","), sim.stack, sim.lamps, readoutOf(sim)].join("|");

function LayerArt({ layer }: { layer: Layer }) {
  return (
    <>
      {layer.solids.map((part, index) => (
        <Solid key={`s${index}`} paths={part.paths} tone={part.tone ?? "mid"} crease={part.crease} lit={part.lit} inner={part.inner ? <g dangerouslySetInnerHTML={{ __html: part.inner }} /> : undefined} />
      ))}
      {layer.lines.map((line, index) => <Line key={`l${index}`} d={line.d} tone={line.tone} free={line.free} />)}
      {layer.dots.map((dots, index) => <Dots key={`d${index}`} points={dots.points} size={dots.size} tone={dots.tone} />)}
    </>
  );
}

function CardArt({ card: c, register }: { card: Card; register: (id: number, node: SVGGElement | null) => void }) {
  return (
    <g ref={(node) => register(c.id, node)} transform={translateAlong(P, [c.x, 0, c.z - BELT_TOP])}>
      <Solid paths={CARD_ART.paths} tone="hi" crease="lo" lit={c.approved} />
      <Line d={CARD_ART.groove} tone="faint" />
      <Line d={CARD_ART.ref} tone="mid" free />
      {CARD_ART.code.slice(0, c.edits).map((d, index) => <Line key={index} d={d} tone="lo" free />)}
      {c.checked ? <Line d={CARD_ART.check} tone="green" free /> : null}
    </g>
  );
}

/** The software factory: tasks ride a belt past an agent, checks and a review gate. */
export function FactoryFigure() {
  const [first] = React.useState(initialSim);
  const sim = React.useRef(first);
  const [s, setView] = React.useState(() => snapshotOf(first));
  const signature = React.useRef(signatureOf(first));
  const stage = React.useRef<HTMLDivElement>(null);
  const inView = useInView(stage);
  const still = useStillness();
  const nodes = React.useRef(new Map<number, SVGGElement>());
  const head = React.useRef<SVGGElement>(null);
  const probe = React.useRef<SVGGElement>(null);
  const gate = React.useRef<SVGGElement>(null);
  const needle = React.useRef<SVGPathElement>(null);

  const register = React.useCallback((id: number, node: SVGGElement | null) => {
    if (node) nodes.current.set(id, node);
    else nodes.current.delete(id);
  }, []);

  const tick = React.useCallback((dt: number) => {
    const live = sim.current;
    step(live, dt);
    for (const c of live.cards) nodes.current.get(c.id)?.setAttribute("transform", translateAlong(P, [c.x, 0, c.z - BELT_TOP]));
    const writing = atStation(live, 0);
    const checking = atStation(live, 1);
    const tip = checking ? probeAt(checking.t) : PROBE_REST;
    head.current?.setAttribute("transform", translateAlong(P, [0, 0, (writing ? headAt(writing.t) : HEAD_REST) - HEAD_REST]));
    probe.current?.setAttribute("transform", translateAlong(P, [0, 0, tip - PROBE_REST]));
    needle.current?.setAttribute("d", needleAt(((PROBE_REST - tip) / (PROBE_REST - PROBE_TOUCH)) * 0.72));
    gate.current?.setAttribute("transform", translateAlong(P, [0, 0, live.gate]));
    const next = signatureOf(live);
    if (next !== signature.current) {
      signature.current = next;
      setView(snapshotOf(live));
    }
    return true;
  }, []);
  useLoop(tick, inView && !still);

  const approve = () => {
    if (waitingCard(sim.current)) sim.current.approve = true;
  };

  const writing = atStation(s, 0);
  const waiting = waitingCard(s);
  const ordered = [...s.cards].sort((a, b) => a.x - b.x);
  const cardsBefore = ordered.filter((c) => c.x <= GATE_PAST);
  const cardsAfter = ordered.filter((c) => c.x > GATE_PAST);

  return (
    <Plate
      fig="Fig 1"
      title="Software factory"
      hint={waiting ? "Click to approve" : "Tasks in flight"}
      readout={readoutOf(s)}
      keys={[
        { mark: "raised", label: "Task cards, dropped from the backlog" },
        { mark: "lit", label: "Approved by a human at the review gate" },
        { mark: "green", label: "Checks passed" },
      ]}
      caption="Tasks drop from the backlog onto the line. An agent on your machine writes the change, four checks run against it, and the gate holds every card until a person approves it. Click the figure to approve the waiting task."
    >
      <div
        ref={stage}
        className="iso-stage"
        tabIndex={0}
        role="button"
        aria-label="Software factory. Press Enter to approve the task waiting at the review gate."
        data-inview={inView ? "" : undefined}
        onClick={approve}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          approve();
        }}
        style={{ cursor: waiting ? "pointer" : "default", outline: "none" }}
      >
        <svg className="iso-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="An isometric conveyor line: a backlog hopper drops task cards onto a belt, a gantry head writes code onto each card, a probe and four lamps check it, and a gate holds it for review before it drops into the merged tray." focusable="false">
          <path className="iso-halo" d={BASE_HALO} />
          <LayerArt layer={LAYERS.base} />
          <LayerArt layer={LAYERS.machine} />
          {SCREEN_LINES.map((line, index) => (
            <Line key={index} d={screenLine(line.z, line.width)} tone={writing && index < writing.edits ? "lit" : "lo"} free />
          ))}
          <LayerArt layer={LAYERS.back} />
          {LAMP_PATHS.map((lamp, index) => (
            <React.Fragment key={index}>
              <Solid paths={lamp.body} tone="mid" />
              <Solid paths={lamp.cap} tone={index < s.lamps ? "hi" : "lo"} className={index < s.lamps ? "factory-lamp-on" : undefined} />
            </React.Fragment>
          ))}
          <LayerArt layer={LAYERS.belt} />
          {FLOW.map((d, index) => <Line key={index} d={d} tone="faint" flow={!still} />)}
          {Array.from({ length: Math.min(s.stack, STACK_MAX) }, (_, index) => <Solid key={index} paths={stackPaths(index)} tone="hi" crease="lo" lit />)}
          {cardsBefore.map((c) => <CardArt key={c.id} card={c} register={register} />)}
          <g ref={gate} transform={translateAlong(P, [0, 0, s.gate])}>
            <Solid paths={GATE_PATHS} tone={waiting ? "hi" : "mid"} lit={Boolean(waiting)} />
            {GATE_SLOTS.map((d, index) => <Line key={index} d={d} tone="faint" />)}
          </g>
          {cardsAfter.map((c) => <CardArt key={c.id} card={c} register={register} />)}
          <LayerArt layer={LAYERS.front} />
          <g ref={head}>
            <Solid paths={HEAD.tip} tone="hi" lit />
            <Solid paths={HEAD.collar} tone="mid" />
            <Solid paths={HEAD.body} tone="mid" />
            <Line d={HEAD.knurl} tone="lo" />
            <Solid paths={HEAD.spindle} tone="mid" crease="none" />
          </g>
          <LayerArt layer={LAYERS.gantry} />
          <g className="iso-wire" data-tone={writing ? "mid" : "lo"}>
            <Line d={`M${WIRE.from.join(" ")}L${WIRE.via.map((p) => p.join(" ")).join("L")}L${WIRE.to.join(" ")}`} tone={writing ? "mid" : "lo"} flow={Boolean(writing) && !still} />
            <circle className="iso-wire-end" cx={WIRE.from[0]} cy={WIRE.from[1]} r={1.2} />
            <circle className="iso-wire-end" cx={WIRE.to[0]} cy={WIRE.to[1]} r={1.2} />
          </g>
          <circle cx={LED[0]} cy={LED[1]} r={1.3} className="factory-led" data-on={writing ? "" : undefined} />
          <g ref={probe}>
            <Solid paths={PROBE.tip} tone="hi" lit />
            <Solid paths={PROBE.rod} tone="mid" crease="none" />
          </g>
          <LayerArt layer={LAYERS.checksArm} />
          <path ref={needle} className="iso-line" data-tone="lit" data-free="start" d={needleAt(0)} style={{ strokeWidth: 1.1 }} />
          <LayerArt layer={LAYERS.hopper} />
          <text className="iso-face-text" data-tone="lo" transform={BACKLOG_LABEL} fontSize={4}>BACKLOG</text>
        </svg>
      </div>
    </Plate>
  );
}

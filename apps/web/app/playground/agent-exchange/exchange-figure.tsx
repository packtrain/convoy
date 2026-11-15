"use client";

import * as React from "react";
import { translateAlong } from "../software-factory/kit/iso-kit";
import { Dots, FaceText, Line, Plate, Solid } from "../software-factory/kit/draw";
import { follow, useInView, useLoop, useReadout, useStillness } from "../software-factory/kit/live";
import {
  BOX_LINES, BROWSER_TAG, CAPSULE_R, COLLAR, COLLAR_KNURL, COUPLING_HIT, DROP, HALOS, HEIGHT, LAMPS, MACHINE_TAG, LAYERS, MAG, MAG_FOOT, NAMEPLATE, P, RECEIVERS, RECEIVER_X, RUNTIMES, RUNTIME_TAGS, SCALE, SCREEN_LINES, SLOTS, STATION_CAP, STATION_FILL, STATION_TOP, T1, T2, WIDTH,
  capsulesOn, magazineFraction, needleAt, slotAngle, spoutOf, stationFraction, type Layer, type Route,
} from "./geometry";
import type { TubePiece } from "./tube";

// Figure time is compressed: a heartbeat every 2.4 s stands for 30 s, expiry at 6 s for 60 s.
const SPEED = 150;
const EXPIRES_AFTER = 6;
const AUTO_RECONNECT = 18;
const MAGAZINE_SIZE = 5;
const HOST = "devbox";

type Phase = "idle" | "sending" | "pending" | "claiming" | "fetch" | "running" | "done" | "draining";
type Tube = "t1" | "t2" | "mag" | "spout";
type Kind = "message" | "fetch" | "chunk" | "park" | "drain";
interface Thread { ref: number; slot: number }
interface Capsule { kind: Kind; chain: Tube[]; back: boolean[]; index: number; pos: number; thread: Thread | null }
interface Sim {
  phase: Phase; t: number; nextRef: number; nextSlot: number; current: Thread | null; queue: Thread[]; runs: number; chunksAll: number;
  runtime: number; spoutX: number; needle: number; needleTarget: number;
  connected: boolean; outT: number; quiet: number; alive: boolean;
  capsules: Capsule[]; planned: number; emitted: number; seen: number; untilEmit: number;
}

const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const refOf = (id: number) => `OS-${id}`;
const online = (sim: Sim) => sim.connected && sim.alive;

function initialSim(): Sim {
  const current = { ref: 2321, slot: 2 };
  return {
    phase: "running", t: 0, nextRef: 2322, nextSlot: 5, current, queue: [], runs: 14, chunksAll: 2608,
    runtime: 0, spoutX: RECEIVER_X[0]!, needle: slotAngle(2), needleTarget: slotAngle(2),
    connected: true, outT: 0, quiet: 0, alive: true,
    capsules: [], planned: 52, emitted: 0, seen: 0, untilEmit: 0.3,
  };
}

const enter = (sim: Sim, phase: Phase) => {
  sim.phase = phase;
  sim.t = 0;
};
const send = (sim: Sim, kind: Kind, chain: Tube[], back: boolean[], thread: Thread | null, pos = 0) => sim.capsules.push({ kind, chain, back, index: 0, pos, thread });
const lampsOf = (sim: Sim) => {
  const lit = new Set(sim.queue.map((thread) => thread.slot));
  if (sim.current && (sim.phase === "pending" || sim.phase === "claiming")) lit.add(sim.current.slot);
  return lit;
};

// The lease is lost when the line goes: the run stops and the thread's capsule goes back up into the magazine.
function dropLease(sim: Sim) {
  const thread = sim.current;
  sim.capsules = [];
  sim.current = null;
  if (thread) send(sim, "park", ["t2", "mag"], [true, false], thread);
  enter(sim, "idle");
}

function reconnect(sim: Sim) {
  sim.connected = true;
  sim.alive = true;
  sim.quiet = 0;
}

function disconnect(sim: Sim) {
  sim.connected = false;
  sim.quiet = 0;
  if (sim.phase === "claiming" || sim.phase === "fetch" || sim.phase === "running") dropLease(sim);
}

function claim(sim: Sim, thread: Thread) {
  sim.current = thread;
  sim.needleTarget = slotAngle(thread.slot);
  enter(sim, "claiming");
}

function step(sim: Sim, dt: number, routes: Record<Tube, Route>) {
  sim.t += dt;
  sim.spoutX = follow(sim.spoutX, RECEIVER_X[sim.runtime]!, dt, 0.18);
  sim.needle = follow(sim.needle, sim.needleTarget, dt, 0.16);
  sim.outT = Math.max(0, Math.min(1, sim.outT + (Math.sign((sim.connected ? 0 : 1) - sim.outT) * dt) / 0.4));
  if (!sim.connected) {
    sim.quiet += dt;
    if (sim.quiet > EXPIRES_AFTER) sim.alive = false;
    if (sim.quiet > AUTO_RECONNECT) reconnect(sim);
  }

  switch (sim.phase) {
    case "idle":
      if (sim.t > 1.4 && online(sim) && sim.queue.length && !sim.capsules.some((c) => c.kind === "park")) {
        send(sim, "drain", ["mag"], [true], sim.queue.shift()!, 1 - magazineFraction(0));
        enter(sim, "draining");
      } else if (sim.t > (online(sim) ? 1.8 : 0.9) && (online(sim) ? !sim.current : sim.queue.length + sim.capsules.length < MAGAZINE_SIZE)) {
        send(sim, "message", ["t1"], [false], { ref: sim.nextRef++, slot: sim.nextSlot });
        sim.nextSlot = (sim.nextSlot + 3) % SLOTS;
        enter(sim, "sending");
      }
      break;
    case "pending":
      if (online(sim) && sim.t > 0.6) claim(sim, sim.current!);
      break;
    case "claiming":
      if (sim.t > 0.9 && Math.abs(sim.needle - sim.needleTarget) < 0.03) {
        send(sim, "fetch", ["t2", "spout"], [false, false], sim.current);
        enter(sim, "fetch");
      }
      break;
    case "running":
      if (sim.emitted < sim.planned) {
        sim.untilEmit -= dt;
        if (sim.untilEmit <= 0) {
          send(sim, "chunk", ["spout", "t2", "t1"], [true, true, true], sim.current);
          sim.emitted += 1;
          sim.untilEmit = 0.09 + Math.random() * 0.18;
        }
      } else if (sim.seen >= sim.planned) {
        sim.runs += 1;
        sim.current = null;
        enter(sim, "done");
      }
      break;
    case "done":
      if (sim.t > 1.6) enter(sim, "idle");
      break;
    default:
      break;
  }

  sim.capsules = sim.capsules.filter((capsule) => {
    const tube = capsule.chain[capsule.index]!;
    capsule.pos += (SPEED * dt) / Math.max(1, routes[tube].total);
    const stopAt =
      capsule.kind === "chunk" && tube === "t1" ? 1 - stationFraction(Math.min(sim.seen, STATION_FILL - 1)) : capsule.kind === "park" && tube === "mag" ? magazineFraction(sim.queue.length) : 1;
    if (capsule.pos < stopAt) return true;
    capsule.index += 1;
    capsule.pos = 0;
    if (capsule.kind === "message" && capsule.index === 1) {
      if (online(sim)) {
        sim.current = capsule.thread;
        enter(sim, "pending");
        return false;
      }
      capsule.kind = "park";
      capsule.chain = ["mag"];
      capsule.back = [false];
      capsule.index = 0;
      enter(sim, "idle");
      return true;
    }
    if (capsule.index < capsule.chain.length) return true;
    switch (capsule.kind) {
      case "park":
        sim.queue.push(capsule.thread!);
        break;
      case "drain":
        claim(sim, capsule.thread!);
        break;
      case "fetch":
        sim.planned = 28 + Math.floor(Math.random() * 44);
        sim.emitted = 0;
        sim.seen = 0;
        sim.untilEmit = 0.4;
        enter(sim, "running");
        break;
      case "chunk":
        sim.seen += 1;
        sim.chunksAll += 1;
        break;
      default:
        break;
    }
    return false;
  });
}

function liveText(sim: Sim) {
  const ref = sim.current ? refOf(sim.current.ref) : "";
  const queued = sim.queue.length ? ` · ${sim.queue.length} queued` : "";
  if (!sim.connected && sim.phase !== "running") return `${HOST} ${sim.alive ? "unplugged" : "session expired"}${queued}`;
  switch (sim.phase) {
    case "idle":
      return `quiet · ${sim.runs} runs · ${sim.chunksAll} chunks${queued}`;
    case "sending":
      return `capsule on its way${queued}`;
    case "pending":
      return `${ref} · pending${queued}`;
    case "claiming":
      return `${ref} · claimed by ${HOST}${queued}`;
    case "fetch":
      return `${ref} · going down to ${HOST}${queued}`;
    case "running":
      return `${ref} · ${RUNTIMES[sim.runtime]} on ${HOST} · ${sim.seen} chunks`;
    case "done":
      return `done · ${sim.seen} chunks${queued}`;
    case "draining":
      return `draining the magazine${queued}`;
  }
}

const partText = (part: string) => {
  if (part.startsWith("runtime:")) return `${RUNTIMES[Number(part.slice(8))]} · a runtime the CLI spawns in your checkout`;
  const texts: Record<string, string> = {
    browser: "Browser · you send a capsule and watch the chunks come back",
    hub: "Convex backend · sorts messages into thread slots, holds the lease",
    dial: "Lease dial · points at the thread a machine has claimed",
    magazine: "Holding magazine · pending messages wait here while no machine is connected",
    machine: `convoy connect · ${HOST} runs its tube up to the hub, nothing comes down uninvited`,
    coupling: "Tube coupling and heartbeat · green beats every 30 s, red when the line is down · click to disconnect",
    diverter: "Diverter · routes the capsule to the runtime you picked",
  };
  return texts[part] ?? "";
};

const signatureOf = (sim: Sim) =>
  [sim.phase, [...lampsOf(sim)].sort().join(""), sim.queue.length, sim.runtime, sim.connected ? 1 : 0, sim.alive ? 1 : 0, Math.min(4, Math.floor(sim.seen / 8))].join("|");
const snapshotOf = (sim: Sim): Sim => ({ ...sim, capsules: [], queue: [...sim.queue] });

function LayerArt({ layer }: { layer: Layer }) {
  return (
    <>
      {layer.solids.map((part, index) => (
        <Solid key={`s${index}`} paths={part.paths} tone={part.tone ?? "mid"} crease={part.crease} lit={part.lit} className={part.className} inner={part.inner ? <g dangerouslySetInnerHTML={{ __html: part.inner }} /> : undefined} />
      ))}
      {layer.lines.map((line, index) => <Line key={`l${index}`} d={line.d} tone={line.tone} free={line.free} />)}
      {layer.dots.map((dots, index) => <Dots key={`d${index}`} points={dots.points} size={dots.size} tone={dots.tone} />)}
    </>
  );
}

// A glass tube: bodies first, then whatever travels inside, then the shine and the edges over it.
function TubeUnder({ pieces }: { pieces: TubePiece[] }) {
  return (
    <>
      {pieces.map((piece, index) => (
        <g key={index} className="exch-tube">
          <path className="tb-body" d={piece.body} />
          <path className="tb-shade" d={piece.shade} />
        </g>
      ))}
    </>
  );
}
function TubeOver({ pieces, tone = "mid" }: { pieces: TubePiece[]; tone?: "mid" | "lo" }) {
  return (
    <>
      {pieces.map((piece, index) => (
        <g key={index} className="exch-tube">
          <path className="tb-shine" d={piece.shine} />
          <path className="iso-line tb-edge" data-tone={tone} d={piece.edges} />
        </g>
      ))}
    </>
  );
}

const capsuleStyle = { strokeWidth: CAPSULE_R * 2 * SCALE };

/** Convoy as a pneumatic post: browser desk on top, Convex sorting hub in the middle, your machine and its runtimes on the floor. */
export function ExchangeFigure() {
  const [first] = React.useState(initialSim);
  const sim = React.useRef(first);
  const [s, setView] = React.useState(() => snapshotOf(first));
  const signature = React.useRef(signatureOf(first));
  const hover = React.useRef<string | null>(null);
  const { anchor, say } = useReadout<HTMLDivElement>();
  const inView = useInView(anchor);
  const still = useStillness();
  const [firstSpout] = React.useState(() => spoutOf(first.spoutX));
  const routes = React.useRef<Record<Tube, Route>>({ t1: T1, t2: T2, mag: MAG, spout: firstSpout });
  const streams = React.useRef<Partial<Record<Tube, SVGPathElement>>>({});
  const pile = React.useRef<SVGPathElement>(null);
  const spoutParts = React.useRef<Partial<Record<"body" | "shade" | "shine" | "edges", SVGPathElement>>>({});
  const needle = React.useRef<SVGPathElement>(null);
  const port = React.useRef<SVGGElement>(null);
  const portOver = React.useRef<SVGGElement>(null);
  const station = React.useRef<SVGPathElement>(null);
  const streamRef = (tube: Tube) => (node: SVGPathElement | null) => {
    if (node) streams.current[tube] = node;
    else delete streams.current[tube];
  };
  const spoutRef = (part: "body" | "shade" | "shine" | "edges") => (node: SVGPathElement | null) => {
    if (node) spoutParts.current[part] = node;
    else delete spoutParts.current[part];
  };

  const tick = (dt: number) => {
    const live = sim.current;
    step(live, dt, routes.current);
    if (Math.abs(live.spoutX - RECEIVER_X[live.runtime]!) > 1e-3 || routes.current.spout === firstSpout) {
      routes.current.spout = spoutOf(live.spoutX);
      const piece = routes.current.spout.pieces[0]!;
      for (const part of ["body", "shade", "shine", "edges"] as const) spoutParts.current[part]?.setAttribute("d", piece[part]);
    }
    for (const tube of ["t1", "t2", "mag", "spout"] as const) {
      const here = live.capsules.filter((capsule) => capsule.chain[capsule.index] === tube).map((capsule) => (capsule.back[capsule.index] ? 1 - capsule.pos : capsule.pos));
      streams.current[tube]?.setAttribute("d", here.length ? capsulesOn(routes.current[tube], here) : "");
    }
    pile.current?.setAttribute("d", live.queue.length ? capsulesOn(MAG, live.queue.map((_, index) => magazineFraction(index))) : "");
    const filled = live.phase === "running" || live.phase === "done" ? Math.min(live.seen, STATION_FILL) : 0;
    station.current?.setAttribute("d", filled ? capsulesOn(T1, Array.from({ length: filled }, (_, index) => stationFraction(index))) : "");
    needle.current?.setAttribute("d", needleAt(live.needle));
    for (const node of [port.current, portOver.current]) node?.setAttribute("transform", translateAlong(P, [0, 0, DROP * ease(live.outT)]));
    say(hover.current ? partText(hover.current) : liveText(live));
    const next = signatureOf(live);
    if (next !== signature.current) {
      signature.current = next;
      setView(snapshotOf(live));
    }
    return true;
  };
  useLoop(tick, inView && !still);

  const toggleCoupling = () => {
    const live = sim.current;
    if (live.connected) disconnect(live);
    else reconnect(live);
    setView(snapshotOf(live));
  };
  const pick = (index: number) => {
    sim.current.runtime = index;
    setView(snapshotOf(sim.current));
  };
  const partOf = (target: EventTarget | null) => (target instanceof Element ? target.closest<SVGElement>("[data-part]")?.dataset.part ?? null : null);
  const onClick = (event: React.MouseEvent) => {
    const part = partOf(event.target);
    if (part === "coupling") toggleCoupling();
    else if (part?.startsWith("runtime:")) pick(Number(part.slice(8)));
  };
  const onPointerOver = (event: React.PointerEvent) => {
    hover.current = partOf(event.target);
    say(hover.current ? partText(hover.current) : liveText(sim.current));
  };
  const onPointerLeave = () => {
    hover.current = null;
    say(liveText(sim.current));
  };
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") toggleCoupling();
    else if (/^[1-4]$/.test(event.key)) pick(Number(event.key) - 1);
    else return;
    event.preventDefault();
  };

  const lamps = lampsOf(s);
  const litLines = Math.min(4, Math.floor(s.seen / 8));
  const heart = s.connected ? "beat" : "red";
  const stationPieces = T1.pieces.filter((piece) => piece.mid[2] > STATION_TOP - 32);
  const dropPieces = T1.pieces.filter((piece) => piece.mid[2] <= STATION_TOP - 32);
  const filled = s.phase === "running" || s.phase === "done" ? Math.min(s.seen, STATION_FILL) : 0;

  return (
    <Plate
      fig="Fig 2"
      title="Agent post"
      hint={s.connected ? "Click a receiver · click the coupling" : "Click the coupling to reconnect"}
      readout={liveText(first)}
      keys={[
        { mark: "lit", label: "Capsules: your message down, one chunk per capsule back up" },
        { mark: "green", label: "Lamps: a pending thread, a live heartbeat" },
        { mark: "raised", label: "Receivers: the four runtimes" },
      ]}
      caption="You drop a message capsule at the desk station. It falls to the Convex hub, which sorts it into the thread's slot and lights the slot's lamp. Your machine, running convoy connect, has run its own tube up to the hub. It claims the thread with a lease, the dial turns to the slot, and the capsule goes down to the diverter and into the runtime you picked. The agent's output comes back up as a stream of small capsules, one per chunk. The machine heartbeats every 30 seconds. After 60 seconds of silence the session expires, and new capsules pile up in the hub's magazine until the machine reconnects and they drain."
    >
      <div
        ref={anchor}
        className="iso-stage"
        tabIndex={0}
        role="group"
        aria-label="Agent post. Press Enter to disconnect or reconnect the machine, 1 to 4 to pick a runtime."
        data-inview={inView ? "" : undefined}
        onClick={onClick}
        onPointerOver={onPointerOver}
        onPointerLeave={onPointerLeave}
        onKeyDown={onKeyDown}
        style={{ outline: "none" }}
      >
        <svg className="iso-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="An isometric pneumatic post on a tall wall rack: a desk with a terminal and a brass capsule station on top, a round sorting hub with eight slot lamps and a dial in the middle, a glass magazine beside it, and on the floor a terminal box whose tube runs up to the hub, with a diverter feeding four receivers." focusable="false">
          {HALOS.map((d, index) => <path key={index} className="iso-halo" d={d} />)}
          <LayerArt layer={LAYERS.rails} />
          <g data-part="machine">
            <LayerArt layer={LAYERS.machine} />
            {BOX_LINES.map((d, index) => <Line key={index} d={d} tone={s.connected ? "mid" : "lo"} free />)}
            <FaceText transform={MACHINE_TAG} size={2.6} tone="lo">VM · convoy connect</FaceText>
          </g>
          <g data-part="machine">
            <g>
              <Solid paths={COLLAR} tone="mid" className={`exch-heart exch-heart-${heart}`} inner={<Line d={COLLAR_KNURL} tone="lo" />} />
            </g>
            <g ref={port}>
              <TubeUnder pieces={T2.pieces} />
            </g>
            <path ref={streamRef("t2")} className="iso-line exch-capsule" data-tone="lit" style={capsuleStyle} d="" />
            <g ref={portOver}>
              <TubeOver pieces={T2.pieces} />
            </g>
            <g data-part="coupling">
              <circle className="exch-hit" r={6} cx={COUPLING_HIT[0]} cy={COUPLING_HIT[1]} />
            </g>
          </g>
          <g data-part="hub">
            <LayerArt layer={LAYERS.hub} />
            <FaceText transform={NAMEPLATE} size={3.4} tone="lo">CONVEX</FaceText>
            {LAMPS.map((lamp, slot) => <Solid key={slot} paths={lamp} tone={lamps.has(slot) ? "hi" : "lo"} className={lamps.has(slot) ? "exch-lamp-on" : undefined} />)}
            <g data-part="dial">
              <path ref={needle} className="iso-line" data-tone="lit" data-free="start" d={needleAt(first.needle)} style={{ strokeWidth: 1.1 }} />
            </g>
          </g>
          <g data-part="browser">
            <TubeUnder pieces={dropPieces} />
            <path ref={streamRef("t1")} className="iso-line exch-capsule" data-tone="lit" style={capsuleStyle} d="" />
            <TubeOver pieces={dropPieces} />
            <LayerArt layer={LAYERS.desk} />
            {SCREEN_LINES.map((d, index) => <Line key={index} d={d} tone={index < litLines ? "lit" : "lo"} free />)}
            <FaceText transform={BROWSER_TAG} size={2.4} tone="lo">BROWSER</FaceText>
            <TubeUnder pieces={stationPieces} />
            <path ref={station} className="iso-line exch-capsule" data-tone="lit" style={capsuleStyle} d={filled ? capsulesOn(T1, Array.from({ length: filled }, (_, index) => stationFraction(index))) : ""} />
            <TubeOver pieces={stationPieces} />
            <Solid paths={STATION_CAP.lid} tone="mid" />
            <Solid paths={STATION_CAP.knob} tone="mid" />
          </g>
          <g data-part="magazine">
            <Solid paths={MAG_FOOT.bracket} tone="lo" />
            <Solid paths={MAG_FOOT.cap} tone="mid" />
            <TubeUnder pieces={MAG.pieces} />
            <path ref={pile} className="iso-line exch-capsule" data-tone="mid" style={capsuleStyle} d={s.queue.length ? capsulesOn(MAG, s.queue.map((_, index) => magazineFraction(index))) : ""} />
            <path ref={streamRef("mag")} className="iso-line exch-capsule" data-tone="lit" style={capsuleStyle} d="" />
            <TubeOver pieces={MAG.pieces} />
          </g>
          {RECEIVERS.map((receiver, index) => (
            <g key={index} data-part={`runtime:${index}`}>
              <Solid paths={receiver.tag} tone="mid" crease="none" />
              <FaceText transform={receiver.tagText} size={2.1} tone="lo" anchor="middle">{RUNTIME_TAGS[index]}</FaceText>
              <Solid paths={receiver.foot} tone="lo" />
              <Solid paths={receiver.cup} tone={index === s.runtime ? "hi" : "mid"} crease={index === s.runtime ? "lo" : "faint"} lit={index === s.runtime} inner={<Line d={receiver.band} tone="faint" />} />
              <path className="exch-hole" d={receiver.mouth} />
              <Line d={receiver.mouth} tone={index === s.runtime ? "hi" : "lo"} />
            </g>
          ))}
          <g data-part="diverter">
            <g className="exch-tube">
              <path ref={spoutRef("body")} className="tb-body" d={firstSpout.pieces[0]!.body} />
              <path ref={spoutRef("shade")} className="tb-shade" d={firstSpout.pieces[0]!.shade} />
            </g>
            <path ref={streamRef("spout")} className="iso-line exch-capsule" data-tone="lit" style={capsuleStyle} d="" />
            <g className="exch-tube">
              <path ref={spoutRef("shine")} className="tb-shine" d={firstSpout.pieces[0]!.shine} />
              <path ref={spoutRef("edges")} className="iso-line tb-edge" data-tone="mid" d={firstSpout.pieces[0]!.edges} />
            </g>
          </g>
        </svg>
      </div>
    </Plate>
  );
}

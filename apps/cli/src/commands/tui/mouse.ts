import { useEffect, useEffectEvent, type RefObject } from "react";
import { measureElement, useStdin, useStdout, type DOMElement } from "ink";

// Button-event tracking (1002) with SGR encoding (1006). Spec: docs/specs/cli-tui.md, "Mouse".
const trackingOn = "\u001b[?1002h\u001b[?1006h";
export const trackingOff = "\u001b[?1002l\u001b[?1006l";

type MouseEvent = { x: number; y: number } & ({ kind: "press" | "release"; button: number } | { kind: "wheel"; delta: -1 | 1 });

// eslint-disable-next-line no-control-regex -- an SGR mouse report
const report = /\u001b\[<(\d+);(\d+);(\d+)([Mm])/g;
// eslint-disable-next-line no-control-regex -- a report's head cut off at a chunk's end
const head = /\u001b(?:\[(?:<[\d;]*)?)?$/;

/** Reads SGR mouse reports out of stdin chunks; holds a split report's head until the next chunk. */
export function mouseParser() {
  let pending = "";
  return (chunk: string) => {
    const text = pending + chunk;
    pending = head.exec(text)?.[0] ?? "";
    return [...text.matchAll(report)].flatMap(([, code, column, row, final]): MouseEvent[] => {
      const button = Number(code), x = Number(column) - 1, y = Number(row) - 1;
      if (button & 32) return []; // Drag motion.
      if (button & 64) return button & 2 ? [] : [{ kind: "wheel", delta: button & 1 ? 1 : -1, x, y }];
      return [{ kind: final === "M" ? "press" : "release", button: button & 3, x, y }];
    });
  };
}

type Click = { ref: RefObject<DOMElement | null>; handle(): void };
type Router = { clicks: Click[]; wheels: ((delta: -1 | 1) => void)[]; listener(chunk: unknown): void };
const routers = new WeakMap<NodeJS.ReadableStream, Router>();

// Ink reads stdin with read(), which emits 'data' too, so this listener never takes input from Ink.
function subscribe(stdin: NodeJS.ReadableStream, add: (router: Router) => () => void) {
  let router = routers.get(stdin);
  if (!router) {
    const parse = mouseParser();
    const created: Router = { clicks: [], wheels: [], listener: chunk => { for (const event of parse(String(chunk))) dispatch(created, event); } };
    routers.set(stdin, router = created);
    stdin.on("data", created.listener);
  }
  const remove = add(router);
  return () => {
    remove();
    if (router.clicks.length || router.wheels.length) return;
    stdin.off("data", router.listener);
    routers.delete(stdin);
  };
}

// The last-mounted subscriber is on top: a dialog mounts after the panel under it.
function dispatch(router: Router, event: MouseEvent) {
  if (event.kind === "wheel") { router.wheels.at(-1)?.(event.delta); return; }
  if (event.kind !== "press" || event.button !== 0) return;
  const hit = [...router.clicks].reverse().find(({ ref }) => {
    if (!ref.current) return false;
    const box = measureElement(ref.current);
    return event.x >= box.x && event.x < box.x + box.width && event.y >= box.y && event.y < box.y + box.height;
  });
  hit?.handle();
}

const without = <T,>(list: T[], item: T) => () => { list.splice(list.indexOf(item), 1); };

/** Calls `onClick` on a left press inside the box at `ref`. */
export function useClick(ref: RefObject<DOMElement | null>, onClick: () => void) {
  const { stdin } = useStdin();
  const handle = useEffectEvent(onClick);
  useEffect(() => subscribe(stdin, router => {
    const click = { ref, handle: () => handle() };
    router.clicks.push(click);
    return without(router.clicks, click);
  }), [stdin, ref]);
}

/** Sends wheel ticks (-1 up, 1 down) to the topmost mounted handler; `undefined` leaves the wheel to the one below. */
export function useWheel(onWheel: ((delta: -1 | 1) => void) | undefined) {
  const { stdin } = useStdin();
  const active = Boolean(onWheel);
  const handle = useEffectEvent((delta: -1 | 1) => onWheel?.(delta));
  useEffect(() => {
    if (!active) return;
    return subscribe(stdin, router => {
      const wheel = (delta: -1 | 1) => handle(delta);
      router.wheels.push(wheel);
      return without(router.wheels, wheel);
    });
  }, [stdin, active]);
}

/** Turns terminal mouse reports on while `enabled` and mounted; call it after the root `useInput` so raw mode is on first. */
export function useMouseTracking(enabled: boolean) {
  const { stdout } = useStdout();
  useEffect(() => {
    if (!enabled || !(stdout as { isTTY?: boolean }).isTTY) return;
    stdout.write(trackingOn);
    return () => { stdout.write(trackingOff); };
  }, [stdout, enabled]);
}

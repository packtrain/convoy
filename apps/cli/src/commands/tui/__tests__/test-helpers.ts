import { createRequire } from "node:module";

// The Scheduler instance Ink's reconciler queues passive effects on.
const scheduler = createRequire(createRequire(import.meta.resolve("ink")).resolve("react-reconciler"))("scheduler") as {
  unstable_scheduleCallback(priority: number, callback: () => void): unknown; unstable_NormalPriority: number;
};

/**
 * Resolves after queued effects run, so `useInput` holds the latest render's handler (OS-2275). Normal priority, not
 * Idle, which starves behind a spinner on a loaded machine; three rounds cover effects that queue more (OS-2278).
 */
export const inputBound = () => new Promise<void>(resolve => {
  let rounds = 0;
  const round = () => { if (++rounds === 3) resolve(); else scheduler.unstable_scheduleCallback(scheduler.unstable_NormalPriority, round); };
  scheduler.unstable_scheduleCallback(scheduler.unstable_NormalPriority, round);
});

/** Hands Ink each PTY stdin chunk after `inputBound`, so a driver's keys never outrun `useInput` (OS-2278). */
export function gateInput(stdin: NodeJS.ReadStream = process.stdin) {
  const push = stdin.push.bind(stdin), queue: unknown[] = [];
  let busy = false;
  const next = () => {
    if (busy || !queue.length) return;
    busy = true;
    setImmediate(() => void inputBound().then(() => { busy = false; push(queue.shift()); next(); }));
  };
  stdin.push = (chunk: unknown) => { queue.push(chunk); next(); return true; };
}

/** Waits `ms` for the app's timers and promises, then for `inputBound`, so the next key is never lost (OS-2278). */
export const settle = async (ms: number) => { await new Promise(resolve => setTimeout(resolve, ms)); await inputBound(); };

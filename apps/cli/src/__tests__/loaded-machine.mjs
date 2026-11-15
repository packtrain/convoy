import { fileURLToPath } from "node:url";

// Preload that simulates a loaded machine for subprocess tests (OS-2278): tsx starts late and
// React's Scheduler ticks, which bind `useInput` handlers, run after the drivers' timers.
const startMs = Number(process.env.LOADED_START_MS ?? 0);
const tickMs = Number(process.env.LOADED_TICK_MS ?? 0);
if (startMs) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, startMs);
if (tickMs) {
  let delayed = 0;
  const immediate = globalThis.setImmediate;
  globalThis.setImmediate = Object.assign((callback, ...args) => {
    if (callback.name !== "performWorkUntilDeadline") return immediate(callback, ...args);
    delayed++; return setTimeout(callback, tickMs, ...args);
  }, immediate);
  // Fail loudly if Scheduler stops posting ticks this way, so the simulation never goes inert.
  process.on("exit", () => { if (!delayed) { console.error("loaded-machine: no Scheduler tick was delayed"); process.exitCode = 1; } });
}

/** Child env that loads this preload, e.g. `loaded({ LOADED_TICK_MS: "100" })`. */
export const loaded = (env = {}) => ({ NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import ${fileURLToPath(import.meta.url)}`.trim(), ...env });

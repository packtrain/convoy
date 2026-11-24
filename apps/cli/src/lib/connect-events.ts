/**
 * NDJSON event stream for `convoy connect --json` — the sidecar contract a supervisor
 * consumes. See docs/specs/cli-sidecar-contract.md.
 *
 * Module-level singleton: emit calls are no-ops unless enabled, so the non-`--json` path
 * and existing tests are unaffected.
 */

/** Fixed failure codes; supervisors render their own text for them. */
export type ConnectFailureReason = "runtime-missing" | "auth-rejected" | "backend-unreachable" | "project-active" | "sandbox-failed";

/** OS-779 per-profile status vocabulary. */
export type ConnectStatus = "connecting" | "online" | "retrying" | "blocked" | "failed";

export type ThreadPhase = "claimed" | "streaming" | "completed" | "failed" | "released";

export type ConnectEvent =
  | { event: "auth"; runtime: "codex"; result: import("./config/credentials/validators.js").AuthResult["result"] }
  | { event: "status"; status: ConnectStatus; message?: string; sessionId?: string; reason?: ConnectFailureReason; holder?: string; runtimes?: string[]; untrusted?: string[]; loggedOut?: string[];
      /** `online`: each detected runtime's version. */ versions?: Record<string, string>;
      /** `connecting`: each detected runtime's native login. */ logins?: Record<string, "signed-in" | "signed-out" | "unknown"> }
  | { event: "thread"; phase: ThreadPhase; threadId: string; runId?: string; error?: string };

/** Exit codes a supervisor can classify (see spec). */
export const EXIT_CLEAN = 0;
export const EXIT_FATAL = 1;
export const EXIT_SESSION_REPLACED = 3;

type EventWriter = (line: string) => void;

let writer: EventWriter | null = null;
let lastStatus: ConnectStatus | null = null;
let originalConsole: Pick<typeof console, "log" | "info" | "debug"> | null = null;

/**
 * Reserve stdout for NDJSON events. Human log lines move to stderr
 * (console.info/debug too — they also default to stdout).
 */
export function enableConnectEvents(customWriter?: EventWriter): void {
  writer = customWriter ?? ((line) => process.stdout.write(`${line}\n`));
  lastStatus = null;
  // ponytail: global console→stderr redirect instead of a central logger;
  // introduce one if anything besides connect ever needs stdout in json mode.
  if (!originalConsole) {
    originalConsole = { log: console.log, info: console.info, debug: console.debug };
    console.log = console.info = console.debug = (...args: unknown[]) =>
      console.error(...args);
  }
}

/** Test-only: restore console and silence the emitter. */
export function disableConnectEvents(): void {
  writer = null;
  lastStatus = null;
  if (originalConsole) {
    console.log = originalConsole.log;
    console.info = originalConsole.info;
    console.debug = originalConsole.debug;
    originalConsole = null;
  }
}

/**
 * Exit once stdout has drained. process.exit() does not flush pipe-buffered
 * stdout, so a terminal event emitted right before it can be lost under a
 * supervisor; queueing an empty write behind the event and exiting from its
 * callback guarantees delivery (1s fallback in case stdout never drains).
 */
export function exitAfterFlush(code: number): void {
  const fallback = setTimeout(() => process.exit(code), 1000);
  process.stdout.write("", () => {
    clearTimeout(fallback);
    process.exit(code);
  });
}

export function emitConnectEvent(event: ConnectEvent): void {
  if (!writer) return;
  if (event.event === "status") {
    // Dedupe repeats (a healthy heartbeat every 30s must not re-emit
    // "online"); transitions always emit.
    if (event.status === lastStatus) return;
    lastStatus = event.status;
  }
  writer(JSON.stringify({ v: 1, ts: Date.now(), ...event }));
}

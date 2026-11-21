import type { ChildProcess } from "node:child_process";
import { chmodSync, existsSync, unlinkSync } from "node:fs";
import { CAPABILITIES, serviceServer } from "./server.js";
import { serviceRuns } from "./runs.js";
import { authResultSchema } from "../../lib/config/credentials/validators.js";
import { launchAuth } from "../../lib/config/credentials/resolution.js";
import { spawnProjectLauncher, spawnSharedWorker } from "../project/launcher.js";
import { ServiceLogs } from "./logs.js";
import { failureWarning, runtimeNotice } from "../project/formatters.js";
import { loginRuntimeSchema } from "../project/validators.js";
import { FRAME_LIMIT, statusSchema, toServiceInspection, type WorkerState, type ServiceProfile, type ServiceManagement, type ServiceRequest } from "./validators.js";

type Snapshot = ServiceProfile[];
const RUNTIMES: readonly string[] = loginRuntimeSchema.options;

export async function runService(
  paths: { directory: string; socket: string }, snapshot: Snapshot,
  launch = (entry: Snapshot[number]) => entry.config.mode === "shared" ? spawnSharedWorker({ ...entry, config: { ...entry.config, ...launchAuth(entry.identity, entry.auth) } })
    : spawnProjectLauncher(entry.identity, { ...entry.config, ...launchAuth(entry.identity, entry.auth) }, "pipe", true),
  retryMs = 1000,
  shutdownMs = 35000,
  management?: ServiceManagement,
) {
  const logs = new ServiceLogs(paths.directory);
  type Worker = { entry: ServiceProfile; state: WorkerState; child?: ChildProcess; timer?: ReturnType<typeof setTimeout>; disabled: boolean; runs: Set<string>; notice?: string };
  const workers = new Map<string, Worker>();
  let configurationError = false;
  let queue = Promise.resolve();
  const serialize = <T>(action: () => Promise<T>): Promise<T> => {
    const result = queue.then(action);
    queue = result.then(() => {}, () => {});
    return result;
  };
  const states = () => [...workers.values()].map((worker) => worker.state);
  const warn = (state: WorkerState, message: string, log = true) => { state.warning = message.slice(0, 256); if (log) logs.add(state.profile, message); };
  const createWorker = (entry: ServiceProfile): Worker => ({ entry, state: {
    auth: entry.auth, desiredAuth: entry.auth,
    profile: entry.key, displayName: entry.displayName, identity: entry.identity, status: "connecting", attempts: 0, activeRuns: 0,
  }, disabled: false, runs: new Set() });
  const children = new Set<ChildProcess>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let stopping = false;
  let finish: (() => void) | undefined;
  const done = new Promise<void>((resolve) => { finish = resolve; });
  let stopPromise: Promise<void> | undefined;

  function start(worker: Worker) {
    if (stopping || worker.disabled) return;
    const state = worker.state;
    state.attempts++;
    delete state.exitCode; delete state.warning; delete worker.notice;
    state.status = "connecting";
    logs.add(state.profile, "connecting");
    let child: ChildProcess;
    try { child = launch(worker.entry); } catch { state.status = "failed"; warn(state, "Project launch failed. Check configuration and launcher setup, then reload."); return; }
    worker.child = child;
    children.add(child);
    let buffer = "";
    let discarding = false;
    child.stdout?.on("data", (chunk: Buffer) => {
      for (const piece of chunk.toString("utf8").split(/(?<=\n)/)) {
        if (!discarding) buffer += piece;
        if (Buffer.byteLength(buffer) > FRAME_LIMIT) { buffer = ""; discarding = true; }
        if (!piece.endsWith("\n")) continue;
        if (!discarding) {
          try {
            const event = JSON.parse(buffer);
            if (event.v === 1 && event.event === "status") {
              const status = statusSchema.safeParse(event.status);
              if (status.success && state.status !== status.data) {
                state.status = status.data;
                logs.add(state.profile, status.data);
                if (status.data === "online" && !worker.notice) delete state.warning;
              }
              const known = (value: unknown): string[] => Array.isArray(value) ? value.filter((name: unknown) => RUNTIMES.includes(name as string)) : [];
              if (Array.isArray(event.runtimes)) state.runtimes = known(event.runtimes) as WorkerState["runtimes"];
              // Worker text is never retained; known reasons get service-owned guidance.
              if (event.status === "connecting" && Array.isArray(event.runtimes)) {
                worker.notice = runtimeNotice(known(event.untrusted), known(event.loggedOut), state.profile, worker.entry.config.mode === "shared")?.slice(0, 256);
                if (worker.notice) warn(state, worker.notice);
              }
              const failure = event.status === "failed" ? failureWarning({ reason: event.reason, holder: event.holder,
                runtimes: known(event.runtimes), untrusted: known(event.untrusted) }, state.profile) : undefined;
              if (failure) warn(state, failure);
            } else if (event.v === 1 && event.event === "auth" && event.runtime === "codex") {
              const result = authResultSchema.safeParse({result:event.result,at:Date.now()});
              if (result.success) state.authResult = result.data;
            } else if (event.v === 1 && event.event === "thread" &&
                ["claimed", "streaming", "completed", "failed", "released"].includes(event.phase)) {
              if (typeof event.threadId === "string" && event.threadId.length <= 256) {
                if (["claimed", "streaming"].includes(event.phase)) { if (worker.runs.size < 50) worker.runs.add(event.threadId); }
                else worker.runs.delete(event.threadId);
                state.activeRuns = worker.runs.size;
                control.publish({ threadId: event.threadId, phase: event.phase, ...(typeof event.runId === "string" && event.runId.length <= 256 ? { runId: event.runId } : {}) }, state.profile);
              }
              logs.add(state.profile, `run ${event.phase}`);
            }
          } catch { /* Non-protocol output never enters retained logs. */ }
        }
        buffer = ""; discarding = false;
      }
    });
    // Drain diagnostics without retaining arbitrary credential-bearing output.
    child.stderr?.resume();
    let ended = false;
    const exited = (code: number | null) => {
      if (ended) return;
      ended = true;
      children.delete(child);
      worker.child = undefined;
      worker.runs.clear(); state.activeRuns = 0;
      state.exitCode = code ?? 1;
      state.status = stopping || worker.disabled || code === 0 ? "stopped" : code === 3 ? "blocked" : "failed";
      if (state.status === "stopped") delete state.warning;
      if (code === 3) warn(state, "Session taken over by another connection. Reload the project to reconnect.", false);
      logs.add(state.profile, code === 3 ? "kicked; restart explicitly to reconnect" :
        `worker exited ${code ?? "by signal"}; ${state.status}`);
      if (!stopping && !worker.disabled && !state.pending && code === 1 && state.attempts <= 3) {
        state.status = "retrying";
        const delay = retryMs * 2 ** (state.attempts - 1);
        logs.add(state.profile, `retry in ${delay}ms`);
        const timer = setTimeout(() => { timers.delete(timer); start(worker); }, delay);
        worker.timer = timer;
        timers.add(timer);
      } else if (!stopping && !worker.disabled && code !== 0) {
        logs.add(state.profile, "check project list, runtime acceptance and credentials; stop service then use connect --profile for diagnostics");
        if (!state.warning || state.warning === worker.notice) warn(state, `Connection failed after retries. Run project check ${state.profile}, or run connect --profile ${state.profile} with the service stopped for details.`, false);
      }
    };
    child.once("error", () => exited(1));
    child.once("close", exited);
  }

  async function halt(worker: Worker) {
    worker.disabled = true;
    if (worker.timer) { clearTimeout(worker.timer); timers.delete(worker.timer); worker.timer = undefined; }
    const child = worker.child;
    if (!child) return;
    await new Promise<void>((resolve, reject) => {
      const terminate = setTimeout(() => child.kill("SIGTERM"), shutdownMs * 0.9);
      const kill = setTimeout(() => child.kill("SIGKILL"), shutdownMs);
      const deadline = setTimeout(() => { clearTimeout(terminate); clearTimeout(kill); reject(new Error("Project cleanup could not be confirmed.")); }, shutdownMs + 1000);
      child.once("close", () => { clearTimeout(terminate); clearTimeout(kill); clearTimeout(deadline); resolve(); });
      child.stdin?.end();
    });
  }

  async function reconcile(interruptProfile?: string) {
    if (!management || stopping) throw new Error("Service is stopping or does not support live registration.");
    let desired: Snapshot;
    try { desired = await management.snapshot(); }
    catch {
      if (!configurationError) logs.add("service", "Invalid configuration; keeping last valid workers.");
      configurationError = true;
      throw new Error("Invalid configuration; existing connections were retained. Repair config and retry.");
    }
    if (stopping) throw new Error("Service is stopping.");
    configurationError = false;
    for (const [identity, worker] of workers) {
      const next = desired.find((entry) => entry.identity === identity);
      worker.state.desiredAuth = next?.auth;
      const sameConfig = next && JSON.stringify(next.auth) === JSON.stringify(worker.entry.auth) && next.path === worker.entry.path &&
        JSON.stringify({ ...next.config, profileKey: undefined }) === JSON.stringify({ ...worker.entry.config, profileKey: undefined });
      if ((sameConfig || (worker.state.paused && next)) && worker.state.profile !== interruptProfile) {
        worker.entry = next; worker.state.profile = next.key; worker.state.displayName = next.displayName; worker.state.pending = false;
        if (worker.state.paused) worker.state.auth = undefined;
        continue;
      }
      if (worker.child && worker.state.profile !== interruptProfile) { worker.state.pending = true; continue; }
      await halt(worker); workers.delete(identity);
    }
    for (const entry of desired) {
      if (workers.has(entry.identity) || workers.size >= 128) continue;
      const worker = createWorker(entry); workers.set(entry.identity, worker); start(worker);
    }
    return desired.every((entry) => workers.has(entry.identity)) && !states().some((state) => state.pending);
  }

  async function mutate(request: ServiceRequest) {
    if (!management || stopping) throw new Error("Service is stopping or does not support live registration.");
    if (request.op === "credentials.mutate") {
      if (!request.credentials || !management.credentials) throw new Error("Missing managed credential capability.");
      const change = request.credentials;
      // Direct workers report nothing, so only this service's live children can be vouched for.
      const accounted = change.action === "remove" ? [...workers].filter(([, worker]) => worker.child &&
        ![worker.entry.auth?.name, worker.entry.auth?.claude?.name, worker.entry.auth?.cursor?.name, worker.entry.auth?.antigravity?.name,
          ...Object.values(worker.entry.auth?.opencode ?? {}).map((slot) => slot.name)].includes(change.name)).map(([identity]) => identity) : [];
      await management.credentials(change, accounted);
      try { return { registered: true, applied: await reconcile() }; } catch { return { registered: true, applied: false }; }
    }
    if (request.op === "project.add") {
      if (!request.registration || !management.register) throw new Error("Missing registration.");
      await management.register(request.registration);
      try { return { registered: true, applied: await reconcile() }; }
      catch { return { registered: true, applied: false }; }
    }
    if (request.op === "project.remove") {
      if (!request.profile || !management.removal || !management.remove) throw new Error("Missing project profile.");
      const target = management.removal(request.profile);
      const worker = workers.get(target.identity);
      if (target.last && worker) {
        if (worker.child && !request.interrupt) throw new Error(
          `Project connection is running with ${worker.state.activeRuns ?? 0} observed active runs. Use --interrupt to stop it before removal.`);
        await halt(worker);
      }
      management.remove(request.profile, target.identity);
      if (target.last) workers.delete(target.identity);
      try { return { registered: false, applied: await reconcile() }; }
      catch { return { registered: false, applied: false }; }
    }
    if (request.profile && request.interrupt && ![...workers.values()].some((worker) => worker.state.profile === request.profile)) {
      throw new Error("No isolated service connection with that profile key. Inspect service status.");
    }
    if (request.pause) {
      if (!request.profile || !request.interrupt) throw new Error("Missing --profile or --interrupt for pause.");
      const worker = [...workers.values()].find((item) => item.state.profile === request.profile);
      if (!worker) throw new Error("No isolated service connection with that profile key. Inspect service status.");
      await halt(worker);
      worker.state.status = "stopped"; worker.state.paused = true;
      return { applied: true };
    }
    if (request.interrupt && !request.profile) throw new Error("Missing --profile for targeted interruption.");
    return { applied: await reconcile(request.interrupt ? request.profile : undefined) };
  }

  const status = () => ({ pid: process.pid, stopping, profiles: states(), configurationError, mode: management?.mode });
  const control = serviceServer(
    status,
    async request => {
      if (request.op === "inspect") return { result: toServiceInspection([...workers.values()].map(worker => worker.entry), management?.mode) };
      if (request.op === "status") return { ...status(), capabilities: CAPABILITIES };
      if (request.op === "logs") return logs.read(request.after, request.profile);
      if (request.op === "stop") { await stop(); return {}; }
      if (request.op.startsWith("runs.")) {
        const read = async () => {
          const entry = [...workers.values()].find(worker => worker.entry.key === request.profile)?.entry;
          if (!entry) throw new Error("Unknown service profile. Inspect service status.");
          if (request.op === "runs.cancel" && stopping) throw new Error("Service is stopping.");
          return { result: await serviceRuns(entry, request) };
        };
        return request.op === "runs.cancel" ? serialize(read) : read();
      }
      return serialize(() => mutate(request));
    }, () => finish?.(),
  );
  const server = control.server;

  function stop(): Promise<void> {
    if (stopPromise) return stopPromise;
    stopping = true;
    stopPromise = (async () => {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      await Promise.all([...children].map((child) => new Promise<void>((resolve, reject) => {
        const terminate = setTimeout(() => child.kill("SIGTERM"), shutdownMs * 0.9);
        const kill = setTimeout(() => child.kill("SIGKILL"), shutdownMs);
        const deadline = setTimeout(() => {
          clearTimeout(terminate); clearTimeout(kill);
          reject(new Error("Worker cleanup could not be confirmed before the shutdown deadline."));
        }, shutdownMs + 1000);
        child.once("close", () => {
          clearTimeout(terminate); clearTimeout(kill); clearTimeout(deadline);
          resolve();
        });
        child.stdin?.end();
      })));
      await queue;
      for (const state of states()) state.status = "stopped";
      logs.add("service", "stopped; project data retained");
    })();
    return stopPromise;
  }
  const signal = () => { void stop().then(() => finish?.(), () => finish?.()); };
  try {
    if (existsSync(paths.socket)) unlinkSync(paths.socket);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(paths.socket, () => { chmodSync(paths.socket, 0o600); resolve(); });
    });
    for (const name of ["SIGTERM", "SIGINT", "SIGHUP"] as const) process.on(name, signal);
    logs.add("service", "ready; live registration available");
    snapshot.forEach((entry) => { const worker = createWorker(entry); workers.set(entry.identity, worker); start(worker); });
    let polling = false;
    const poll = management ? setInterval(() => {
      if (stopping || polling) return;
      polling = true;
      void serialize(reconcile).catch(() => {}).finally(() => { polling = false; });
    }, 2000) : undefined;
    void done.then(() => { if (poll) clearInterval(poll); });
    return { done, stop: async () => { await stop(); finish?.(); }, close: async () => {
      if (poll) clearInterval(poll);
      let failure: unknown;
      try { await stop(); } catch (error) { failure = error; }
      for (const name of ["SIGTERM", "SIGINT", "SIGHUP"] as const) process.off(name, signal);
      control.dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (existsSync(paths.socket)) unlinkSync(paths.socket);
      if (failure) throw failure;
    } };
  } catch (error) {
    await stop();
    control.dispose();
    server.close();
    throw error;
  }
}

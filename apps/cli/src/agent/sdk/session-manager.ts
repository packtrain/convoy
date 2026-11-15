import { randomUUID } from "crypto";
import path from "path";
import type { ChildProcess } from "child_process";

import {
  DEFAULT_ISOLATION_CLEANUP_POLICY,
  DEFAULT_ISOLATION_ROOT,
  DEFAULT_LIMITS,
} from "./constants.js";
import type {
  CliExecutionSdk,
  EnvelopeEvent,
  HostCallbacks,
  ProviderAdapter,
  ProviderInput,
  RawFrameEnvelope,
  RunFinalState,
  RunHandle,
  RunLimits,
  RunRequest,
  RunSnapshot,
  RunStatus,
  TransportEventEnvelope,
} from "./types.js";
import { RunHandleImpl } from "./run-handle.js";
import { createDefaultProviderRegistry, ProviderRegistry } from "./adapters/provider-registry.js";
import { spawnProcess, type SpawnProcessOptions } from "./runtime/spawn-process.js";
import { killProcessGroup } from "./runtime/process-group.js";
import {
  spawnSupervisedProcess,
  type SupervisorControl,
} from "./runtime/spawn-supervised-process.js";
import { RunTimeoutController, type TimeoutKind } from "./runtime/timeouts.js";
import {
  createIsolationEnv,
  type CreateIsolationEnvOptions,
} from "./runtime/isolation-env.js";
import { startOutputPump } from "./runtime/output-pump.js";
import { decodeJsonStreamFrame } from "./transport/json-stream-decoder.js";
import { decodeLineTextFrame } from "./transport/line-text-decoder.js";
import { isRecord } from "./adapters/adapter-interface.js";

interface SessionManagerOptions {
  limits?: Partial<RunLimits>;
  hostCallbacks?: HostCallbacks;
  providerRegistry?: ProviderRegistry;
  isolationRootDir?: string;
  cleanupPolicy?: "always" | "never" | "on-success";
  denyEnvKeys?: string[];
  spawnOptions?: SpawnProcessOptions;
  disableSupervisor?: boolean;
}

interface ManagedRun {
  snapshot: RunSnapshot;
  handle: RunHandleImpl;
  terminate: (reason?: string) => Promise<void>;
}

interface RunState {
  child: ChildProcess | null;
  supervisorControl: SupervisorControl | null;
  timeoutKind: TimeoutKind | null;
  cancelled: boolean;
  cancelledReason?: string;
  sequence: number;
  finished: boolean;
  terminatePromise: Promise<void> | null;
  resultSeen: boolean;
}

function nextSequence(state: RunState): number {
  state.sequence += 1;
  return state.sequence;
}

function fireAndForget(value: void | Promise<void>): void {
  if (value && typeof (value as Promise<void>).then === "function") {
    void (value as Promise<void>).catch(() => undefined);
  }
}

function truncateRawPayload(
  payload: unknown,
  maxBytes: number
): { payload: unknown; truncated: boolean } {
  if (typeof payload === "string") {
    const bytes = Buffer.from(payload, "utf8");
    if (bytes.length <= maxBytes) {
      return { payload, truncated: false };
    }

    return {
      payload: bytes.subarray(0, maxBytes).toString("utf8"),
      truncated: true,
    };
  }

  try {
    const json = JSON.stringify(payload);
    const bytes = Buffer.from(json, "utf8");
    if (bytes.length <= maxBytes) {
      return { payload, truncated: false };
    }

    return {
      payload: bytes.subarray(0, maxBytes).toString("utf8"),
      truncated: true,
    };
  } catch {
    return { payload: String(payload), truncated: true };
  }
}

function shouldTerminateAfterFrame(frame: unknown, stream: "stdout" | "stderr"): boolean {
  if (stream !== "stdout" || !isRecord(frame)) {
    return false;
  }
  return frame.type === "result" || frame.type === "error";
}

function buildInheritedEnv(params: {
  baseEnv: Record<string, string | undefined>;
  denylist: string[];
  envOverrides?: Record<string, string>;
}): Record<string, string | undefined> {
  const base = { ...params.baseEnv };
  for (const key of params.denylist) {
    delete base[key];
  }
  return {
    ...base,
    ...params.envOverrides,
  };
}

export class CliExecutionSessionManager implements CliExecutionSdk {
  private readonly limits: RunLimits;
  private readonly callbacks: HostCallbacks;
  private readonly registry: ProviderRegistry;
  private readonly isolationRootDir: string;
  private readonly cleanupPolicy: "always" | "never" | "on-success";
  private readonly denyEnvKeys: string[];
  private readonly spawnOptions?: SpawnProcessOptions;
  private readonly disableSupervisor: boolean;

  private readonly runs = new Map<string, ManagedRun>();
  private readonly runsByCwd = new Map<string, number>();

  constructor(options: SessionManagerOptions = {}) {
    this.limits = { ...DEFAULT_LIMITS, ...options.limits };
    this.callbacks = options.hostCallbacks ?? {};
    this.registry = options.providerRegistry ?? createDefaultProviderRegistry();
    this.isolationRootDir =
      options.isolationRootDir ?? path.join(process.cwd(), DEFAULT_ISOLATION_ROOT);
    this.cleanupPolicy = options.cleanupPolicy ?? DEFAULT_ISOLATION_CLEANUP_POLICY;
    this.denyEnvKeys = options.denyEnvKeys ?? ["CONVOY_API_KEY"];
    this.spawnOptions = options.spawnOptions;
    this.disableSupervisor = options.disableSupervisor ?? false;
  }

  async startRun(request: RunRequest): Promise<RunHandle> {
    this.enforceConcurrencyLimits(request.cwd);

    const runId = randomUUID();
    const adapter = this.registry.get(request.providerId);
    const runState: RunState = {
      child: null,
      supervisorControl: null,
      timeoutKind: null,
      cancelled: false,
      sequence: 0,
      finished: false,
      terminatePromise: null,
      resultSeen: false,
    };

    let terminateRef: ((reason?: string) => Promise<void>) | null = null;

    const handle = new RunHandleImpl(
      runId,
      request.providerId,
      {
        send: async (input: ProviderInput) => {
          if (!runState.child) throw new Error("Run process is not ready");
          if (adapter.handleInput) {
            await adapter.handleInput({ child: runState.child, input });
            return;
          }
          if (!runState.child.stdin || runState.child.stdin.destroyed) return;
          if (input.type === "user_text") {
            runState.child.stdin.write(`${input.text}\n`);
            return;
          }
          if (input.type === "stdin_line") {
            runState.child.stdin.write(`${input.line}\n`);
            return;
          }
          runState.child.stdin.write(`${JSON.stringify(input.payload)}\n`);
        },
        interrupt: async () => {
          if (!runState.child) return;
          // When supervised, lifecycle control must go through the supervisor.
          if (runState.supervisorControl) {
            await runState.supervisorControl.interrupt();
            return;
          }
          if (adapter.interrupt) {
            await adapter.interrupt({ child: runState.child });
            return;
          }
          try {
            runState.child.kill("SIGINT");
          } catch {
            // ignore
          }
        },
        terminate: async (reason?: string) => {
          await terminateRef?.(reason);
        },
      },
      this.limits.maxEventQueueDepth
    );

    const snapshot: RunSnapshot = {
      runId,
      providerId: request.providerId,
      cwd: request.cwd,
      startedAt: Date.now(),
    };

    this.runs.set(runId, {
      snapshot,
      handle,
      terminate: async (reason?: string) => {
        await terminateRef?.(reason);
      },
    });
    this.trackCwd(request.cwd, +1);

    try {
      terminateRef = await this.initializeRun({ runId, request, adapter, handle, runState });
      return handle;
    } catch (error) {
      this.runs.delete(runId);
      this.trackCwd(request.cwd, -1);

      const envelope = this.createTransportEnvelope({
        runId,
        provider: request.providerId,
        providerVersion: "0.0.0",
        sequence: nextSequence(runState),
        kind: "spawn_error",
        payload: {
          error: error instanceof Error ? error.message : String(error),
        },
      });

      this.emitEvent(handle, envelope);
      handle.finish({
        runId,
        providerId: request.providerId,
        status: "failed",
        exitCode: null,
        signal: null,
        reason: "spawn_error",
      });

      throw error;
    }
  }

  listRunning(): RunSnapshot[] {
    return [...this.runs.values()].map((entry) => entry.snapshot);
  }

  async cancelRun(runId: string, reason?: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) return;
    await run.terminate(reason ?? "cancelled_by_request");
  }

  async shutdown(): Promise<void> {
    const running = [...this.runs.values()];
    await Promise.all(running.map((run) => run.terminate("shutdown")));
  }

  private enforceConcurrencyLimits(cwd: string): void {
    if (this.runs.size >= this.limits.maxConcurrentRuns) {
      throw new Error(
        `Max concurrent runs reached (${this.limits.maxConcurrentRuns})`
      );
    }

    const countForCwd = this.runsByCwd.get(cwd) ?? 0;
    if (countForCwd >= this.limits.maxRunsPerWorkingDir) {
      throw new Error(
        `Max runs reached for working directory (${this.limits.maxRunsPerWorkingDir})`
      );
    }
  }

  private trackCwd(cwd: string, delta: number): void {
    const current = this.runsByCwd.get(cwd) ?? 0;
    const next = current + delta;
    if (next <= 0) {
      this.runsByCwd.delete(cwd);
      return;
    }
    this.runsByCwd.set(cwd, next);
  }

  private async initializeRun(params: {
    runId: string;
    request: RunRequest;
    adapter: ProviderAdapter;
    handle: RunHandleImpl;
    runState: RunState;
  }): Promise<(reason?: string) => Promise<void>> {
    const { runId, request, adapter, handle, runState } = params;
    const isolation =
      request.isolationMode === "inherit"
        ? {
            rootDir: "",
            homeDir: "",
            env: buildInheritedEnv({
              baseEnv: process.env,
              denylist: this.denyEnvKeys,
              envOverrides: request.providerConfig?.envOverrides,
            }),
            cleanup: async () => undefined,
          }
        : await createIsolationEnv({
            rootDir: this.isolationRootDir,
            runId,
            baseEnv: process.env,
            denylist: this.denyEnvKeys,
            envOverrides: request.providerConfig?.envOverrides,
          } satisfies CreateIsolationEnvOptions);

    const resolvedExecutable = await adapter.resolveExecutable({
      providerId: request.providerId,
      providerConfig: request.providerConfig,
    });

    const version = await adapter.detectVersion({
      resolvedExecutable,
      cwd: request.cwd,
      env: isolation.env,
    });

    const capabilities = await adapter.detectCapabilities({
      resolvedExecutable,
      cwd: request.cwd,
      env: isolation.env,
      version,
    });

    const requestedTransport = request.transportMode ?? adapter.defaultTransportMode;

    const spawnSpec = await adapter.buildSpawnSpec({
      runId,
      cwd: request.cwd,
      prompt: request.prompt,
      transportMode: requestedTransport,
      resolvedExecutable,
      version,
      capabilities,
      providerConfig: request.providerConfig,
      providerOptions: request.providerOptions,
      env: isolation.env,
    });

    let child: ChildProcess;
    let supervisorControl: SupervisorControl | null = null;

    if (this.disableSupervisor) {
      child = spawnProcess(spawnSpec, this.spawnOptions);
    } else {
      const spawned = await spawnSupervisedProcess(spawnSpec, {
        spawnImpl: this.spawnOptions?.spawnImpl,
        terminateGraceMs: this.limits.terminateGraceMs,
        forceKillGraceMs: this.limits.forceKillGraceMs,
      });
      child = spawned.child;
      supervisorControl = spawned.control;
    }

    runState.child = child;
    runState.supervisorControl = supervisorControl;

    const emitTransport = (event: {
      kind: TransportEventEnvelope["kind"];
      stream?: "stdout" | "stderr";
      payload?: unknown;
      truncated?: boolean;
    }) => {
      const envelope = this.createTransportEnvelope({
        runId,
        provider: request.providerId,
        providerVersion: version.normalized,
        sequence: nextSequence(runState),
        ...event,
      });
      this.emitEvent(handle, envelope);
    };

    const emitRawFrame = (frame: RawFrameEnvelope): void => {
      fireAndForget(this.callbacks.onRawFrame?.(frame));
    };

    const emitTimeoutAndTerminate = async (kind: TimeoutKind): Promise<void> => {
      if (runState.timeoutKind || runState.finished) return;
      runState.timeoutKind = kind;
      emitTransport({
        kind: "timeout",
        payload: { kind },
      });
      await terminateProcess(`timeout_${kind}`);
    };

    const timeouts = new RunTimeoutController(
      {
        startupTimeoutMs: this.limits.startupTimeoutMs,
        idleTimeoutMs: this.limits.idleTimeoutMs,
        maxRunTimeoutMs: this.limits.maxRunTimeoutMs,
      },
      {
        onTimeout: (kind) => {
          void emitTimeoutAndTerminate(kind);
        },
      }
    );

    let resultTerminationTimer: NodeJS.Timeout | null = null;

    const armResultTermination = () => {
      if (resultTerminationTimer || this.limits.terminateAfterResultMs <= 0) return;
      resultTerminationTimer = setTimeout(() => {
        void terminateProcess("result_timeout");
      }, this.limits.terminateAfterResultMs);
    };

    const clearResultTermination = () => {
      if (!resultTerminationTimer) return;
      clearTimeout(resultTerminationTimer);
      resultTerminationTimer = null;
    };

    const terminateProcess = async (reason?: string): Promise<void> => {
      if (!child.pid) return;
      if (runState.terminatePromise) return runState.terminatePromise;

      if (reason && reason.startsWith("cancel")) {
        runState.cancelled = true;
        runState.cancelledReason = reason;
        emitTransport({
          kind: "cancelled",
          payload: { reason },
        });
      }

      runState.terminatePromise = (async () => {
        // When supervised, lifecycle control must go through the supervisor.
        if (runState.supervisorControl) {
          await runState.supervisorControl.terminate(reason);
          return;
        }
        if (adapter.terminate) {
          await adapter.terminate({ child, reason });
        }
        await killProcessGroup(child, {
          terminateGraceMs: this.limits.terminateGraceMs,
          forceKillGraceMs: this.limits.forceKillGraceMs,
        });
      })();

      try {
        await runState.terminatePromise;
      } finally {
        runState.terminatePromise = null;
      }
    };

    const onAbort = () => {
      void terminateProcess("cancelled_by_abort_signal");
    };

    if (request.signal) {
      if (request.signal.aborted) {
        onAbort();
      } else {
        request.signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    emitTransport({
      kind: "process_started",
      payload: {
        pid: child.pid,
        command: spawnSpec.command,
        args: spawnSpec.args,
        transportMode: spawnSpec.transportMode,
        executableSource: resolvedExecutable.source,
      },
    });

    if (spawnSpec.bootstrapInput?.length && child.stdin && !child.stdin.destroyed) {
      for (const frame of spawnSpec.bootstrapInput) {
        child.stdin.write(`${JSON.stringify(frame)}\n`);
      }
    }

    if (spawnSpec.closeStdinAfterSpawn && child.stdin && !child.stdin.destroyed) {
      child.stdin.end();
    }

    const stdout = child.stdout;
    const stderr = child.stderr;
    if (!stdout || !stderr) {
      throw new Error("Process missing stdout/stderr streams");
    }

    const outputPump = startOutputPump({
      stdout,
      stderr,
      maxLineBytesStdout: this.limits.maxLineBytesStdout,
      maxLineBytesStderr: this.limits.maxLineBytesStderr,
      maxEventQueueDepth: this.limits.maxEventQueueDepth,
      onDrop: (stream) => {
        fireAndForget(
          this.callbacks.onMetric?.({
            runId,
            name: "output_drop",
            value: 1,
            tags: { stream },
          })
        );
      },
      onLine: async (lineEvent) => {
        timeouts.satisfyStartup();
        timeouts.touchActivity();

        const decoded =
          spawnSpec.transportMode === "json-stream"
            ? decodeJsonStreamFrame(lineEvent)
            : decodeLineTextFrame(lineEvent);

        const raw = truncateRawPayload(decoded.payload, this.limits.maxRawFrameBytes);
        const rawEnvelope: RawFrameEnvelope = {
          runId,
          provider: request.providerId,
          providerVersion: version.normalized,
          sequence: nextSequence(runState),
          timestamp: Date.now(),
          transportMode: spawnSpec.transportMode,
          stream: decoded.stream,
          payload: raw.payload,
          truncated: lineEvent.truncated || raw.truncated,
        };
        emitRawFrame(rawEnvelope);

        emitTransport({
          kind: decoded.stream === "stdout" ? "stdout" : "stderr",
          stream: decoded.stream,
          payload: decoded.parsed,
          truncated: rawEnvelope.truncated,
        });

        if (shouldTerminateAfterFrame(decoded.parsed, decoded.stream)) {
          runState.resultSeen = true;
          armResultTermination();
          if (child.stdin && !child.stdin.destroyed) {
            child.stdin.end();
          }
        }
      },
    });

    const spawnErrorPromise = new Promise<string | null>((resolve) => {
      let settled = false;
      const settle = (value: string | null) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      child.once("error", (error) => {
        settle(error instanceof Error ? error.message : String(error));
      });
      child.once("spawn", () => settle(null));
      queueMicrotask(() => settle(null));
    });

    const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve) => {
        child.once("exit", (code, signal) => {
          resolve({ code, signal });
        });
      }
    );

    timeouts.start();

    void (async () => {
      const spawnError = await spawnErrorPromise;
      if (spawnError) {
        emitTransport({
          kind: "spawn_error",
          payload: { error: spawnError },
        });
      }

      const [exit] = await Promise.all([exitPromise, outputPump.done]);

      clearResultTermination();
      timeouts.stop();
      runState.finished = true;

      const finalState = this.resolveFinalState({
        runId,
        providerId: request.providerId,
        exitCode: exit.code,
        signal: exit.signal,
        runState,
      });

      emitTransport({
        kind: "exit",
        payload: {
          code: exit.code,
          signal: exit.signal,
          status: finalState.status,
          reason: finalState.reason,
        },
      });

      handle.finish(finalState);

      if (request.signal) {
        request.signal.removeEventListener("abort", onAbort);
      }

      this.runs.delete(runId);
      this.trackCwd(request.cwd, -1);

      const cleanupOnSuccess =
        this.cleanupPolicy === "always" ||
        (this.cleanupPolicy === "on-success" && finalState.status === "completed");

      if (cleanupOnSuccess) {
        await isolation.cleanup();
      }
    })();

    return terminateProcess;
  }

  private resolveFinalState(params: {
    runId: string;
    providerId: RunFinalState["providerId"];
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    runState: RunState;
  }): RunFinalState {
    let status: RunStatus;

    if (params.runState.timeoutKind) {
      status = "timeout";
    } else if (params.runState.cancelled) {
      status = "cancelled";
    } else if (params.exitCode === 0) {
      status = "completed";
    } else {
      status = "failed";
    }

    return {
      runId: params.runId,
      providerId: params.providerId,
      status,
      exitCode: params.exitCode,
      signal: params.signal,
      reason: params.runState.timeoutKind
        ? `timeout_${params.runState.timeoutKind}`
        : params.runState.cancelledReason,
    };
  }

  private createTransportEnvelope(params: {
    runId: string;
    provider: TransportEventEnvelope["provider"];
    providerVersion: string;
    sequence: number;
    kind: TransportEventEnvelope["kind"];
    stream?: "stdout" | "stderr";
    payload?: unknown;
    truncated?: boolean;
  }): TransportEventEnvelope {
    return {
      runId: params.runId,
      provider: params.provider,
      providerVersion: params.providerVersion,
      sequence: params.sequence,
      timestamp: Date.now(),
      layer: "transport",
      kind: params.kind,
      stream: params.stream,
      payload: params.payload,
      truncated: params.truncated,
    };
  }

  private emitEvent(handle: RunHandleImpl, event: EnvelopeEvent): void {
    handle.emit(event);
    if (event.layer === "transport") {
      fireAndForget(this.callbacks.onTransportEvent?.(event));
    }
  }
}

export function createCliExecutionSdk(options: SessionManagerOptions = {}): CliExecutionSdk {
  return new CliExecutionSessionManager(options);
}

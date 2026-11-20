import type { ChildProcess } from "child_process";

export type ProviderId =
  | "claude"
  | "codex"
  | "opencode"
  | "amp"
  | "cursor"
  | "droid"
  | "factory"
  | "coderabbit"
  | "gemini"
  | "antigravity"
  | "generic";

export type TransportMode = "json-stream" | "line-text" | "pty";

export type CleanupPolicy = "always" | "never" | "on-success";

export interface RunLimits {
  maxConcurrentRuns: number;
  maxRunsPerWorkingDir: number;
  startupTimeoutMs: number;
  idleTimeoutMs: number;
  maxRunTimeoutMs: number;
  terminateGraceMs: number;
  forceKillGraceMs: number;
  maxLineBytesStdout: number;
  maxLineBytesStderr: number;
  maxEventQueueDepth: number;
  maxRawFrameBytes: number;
  terminateAfterResultMs: number;
}

export interface ProviderVersionInfo {
  raw: string;
  normalized: string;
}

export interface ProviderCapabilities {
  supportsJsonStream: boolean;
  supportsResume: boolean;
  supportsInterrupt: boolean;
  supportsPty: boolean;
}

export interface ResolvedExecutable {
  command: string;
  argsPrefix?: string[];
  source: "configured" | "bundled" | "path";
}

export interface SpawnSpec {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string | undefined>;
  transportMode: TransportMode;
  detached?: boolean;
  bootstrapInput?: unknown[];
  closeStdinAfterSpawn?: boolean;
}

export type ProviderInput =
  | { type: "user_text"; text: string }
  | { type: "control"; payload: unknown }
  | { type: "stdin_line"; line: string };

export type TransportEventKind =
  | "process_started"
  | "stdout"
  | "stderr"
  | "spawn_error"
  | "exit"
  | "cancelled"
  | "timeout";

export interface EventEnvelopeBase {
  runId: string;
  provider: ProviderId;
  providerVersion: string;
  sequence: number;
  timestamp: number;
}

export interface TransportEventEnvelope extends EventEnvelopeBase {
  layer: "transport";
  kind: TransportEventKind;
  stream?: "stdout" | "stderr";
  payload?: unknown;
  truncated?: boolean;
}

export interface RawFrameEnvelope extends EventEnvelopeBase {
  transportMode: TransportMode;
  stream: "stdout" | "stderr";
  payload: unknown;
  truncated: boolean;
}

export type EnvelopeEvent = TransportEventEnvelope;

export interface RunMetric {
  runId: string;
  name: string;
  value: number;
  tags?: Record<string, string>;
}

export interface HostCallbacks {
  onTransportEvent?(event: TransportEventEnvelope): void | Promise<void>;
  onRawFrame?(frame: RawFrameEnvelope): void | Promise<void>;
  onMetric?(metric: RunMetric): void | Promise<void>;
}

export interface ProviderConfig {
  executablePath?: string;
  bundledBinaryPath?: string;
  commandCandidates?: string[];
  allowNpxFallback?: boolean;
  envOverrides?: Record<string, string>;
}

export interface RunRequest {
  providerId: ProviderId;
  cwd: string;
  prompt?: string;
  transportMode?: TransportMode;
  isolationMode?: "sandboxed" | "inherit";
  providerConfig?: ProviderConfig;
  providerOptions?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface RunSnapshot {
  runId: string;
  providerId: ProviderId;
  cwd: string;
  startedAt: number;
}

export type RunStatus = "completed" | "failed" | "cancelled" | "timeout";

export interface RunFinalState {
  runId: string;
  providerId: ProviderId;
  status: RunStatus;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  reason?: string;
}

export interface RunHandle {
  readonly runId: string;
  readonly providerId: ProviderId;
  events(): AsyncIterable<EnvelopeEvent>;
  send(input: ProviderInput): Promise<void>;
  interrupt(): Promise<void>;
  terminate(reason?: string): Promise<void>;
  wait(): Promise<RunFinalState>;
}

export interface CliExecutionSdk {
  startRun(request: RunRequest): Promise<RunHandle>;
  listRunning(): RunSnapshot[];
  cancelRun(runId: string, reason?: string): Promise<void>;
  shutdown(): Promise<void>;
}

export interface ResolveExecutableContext {
  providerId: ProviderId;
  providerConfig?: ProviderConfig;
}

export interface DetectVersionContext {
  resolvedExecutable: ResolvedExecutable;
  cwd: string;
  env: Record<string, string | undefined>;
}

export interface DetectCapabilitiesContext {
  resolvedExecutable: ResolvedExecutable;
  cwd: string;
  env: Record<string, string | undefined>;
  version: ProviderVersionInfo;
}

export interface BuildSpawnSpecContext {
  runId: string;
  cwd: string;
  prompt?: string;
  transportMode: TransportMode;
  resolvedExecutable: ResolvedExecutable;
  version: ProviderVersionInfo;
  capabilities: ProviderCapabilities;
  providerConfig?: ProviderConfig;
  providerOptions?: Record<string, unknown>;
  env: Record<string, string | undefined>;
}

export interface HandleInputContext {
  child: ChildProcess;
  input: ProviderInput;
}

export interface InterruptContext {
  child: ChildProcess;
}

export interface TerminateContext {
  child: ChildProcess;
  reason?: string;
}

export interface ProviderAdapter {
  readonly id: ProviderId;
  readonly defaultTransportMode: TransportMode;
  resolveExecutable(ctx: ResolveExecutableContext): Promise<ResolvedExecutable>;
  detectVersion(ctx: DetectVersionContext): Promise<ProviderVersionInfo>;
  detectCapabilities(ctx: DetectCapabilitiesContext): Promise<ProviderCapabilities>;
  buildSpawnSpec(ctx: BuildSpawnSpecContext): Promise<SpawnSpec>;
  handleInput?(ctx: HandleInputContext): Promise<void>;
  interrupt?(ctx: InterruptContext): Promise<void>;
  terminate?(ctx: TerminateContext): Promise<void>;
}

export interface DecodedTransportFrame {
  stream: "stdout" | "stderr";
  payload: unknown;
  parsed: unknown;
  truncated: boolean;
}

export interface IsolationContext {
  rootDir: string;
  homeDir: string;
  env: Record<string, string | undefined>;
  cleanup: () => Promise<void>;
}

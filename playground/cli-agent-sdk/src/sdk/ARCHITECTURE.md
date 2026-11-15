# Convoy CLI Execution SDK Architecture

## Purpose

`src/sdk` is a provider-agnostic subprocess runtime for terminal AI CLIs.

It handles:

- executable resolution
- run isolation
- stdout/stderr streaming
- timeout and cancellation safety
- process-group termination

It does **not** normalize provider output into a canonical semantic schema.

## Public API

- `createCliExecutionSdk(options)` in `session-manager.ts`
- `CliExecutionSdk`
  - `startRun(request)`
  - `listRunning()`
  - `cancelRun(runId)`
  - `shutdown()`
- `RunHandle`
  - `events()` async iterator of **transport events**
  - `send()`
  - `interrupt()`
  - `terminate()`
  - `wait()`

## Event Model

All emitted events are transport events:

- `process_started`
- `stdout`
- `stderr`
- `spawn_error`
- `exit`
- `cancelled`
- `timeout`

Each event includes:

- `runId`
- `provider`
- `providerVersion`
- `sequence`
- `timestamp`

Raw decoded frames are emitted through `HostCallbacks.onRawFrame`.

## Folder layout

- `types.ts`: SDK contracts
- `constants.ts`: runtime defaults
- `session-manager.ts`: orchestration and lifecycle
- `run-handle.ts`: per-run queue and control surface
- `adapters/`: provider executable + spawn spec logic
- `runtime/`: spawn, process group kill, timeouts, line parsing, output pump
- `transport/`: `json-stream` and `line-text` decoders

## Run flow

1. Validate concurrency limits.
2. Create isolation env.
3. Resolve executable and detect version/capabilities.
4. Build spawn spec from adapter.
5. Spawn subprocess.
6. Emit `process_started`.
7. Stream stdout/stderr through transport decoder.
8. Emit transport events + raw frame callbacks.
9. If a decoded stdout frame indicates terminal result (`type: "result"` / `type: "error"`), arm terminate-after-result guard.
10. On exit, compute final run status and emit `exit`.

## Reliability controls

- max concurrent runs
- max runs per working directory
- startup timeout
- idle timeout
- max run timeout
- line size limits with truncation
- event queue bounds
- terminate-after-result guard for non-exiting CLIs
- process tree termination (`SIGTERM`/`SIGKILL` escalation on POSIX; taskkill on Windows)

## Adapter responsibility

Adapters now only provide:

- executable resolution
- version/capability detection
- spawn args/env/cwd construction
- optional input/interrupt/terminate hooks

No adapter-level parse-to-semantic contract exists in this SDK.

# CLI Sidecar Contract (OS-1236)

How a supervisor (the desktop app, or any process manager) runs and observes
`convoy connect`. See `docs/specs/desktop-app.md` for the consumer side.

## Invocation

```bash
convoy connect --json [--profile <key>]
```

`--json` puts connect into machine-readable mode:

- **stdout** carries only NDJSON events (one JSON object per line).
- All human-readable log lines are redirected to **stderr** (the scattered
  `console.log`/`console.info`/`console.debug` output; ora spinners already
  write to stderr). Any future human output must go through those or stderr
  directly — raw `process.stdout.write` would corrupt the stream.
- Terminal `failed`/`blocked` events are flushed before the process exits
  (`process.exit()` alone does not flush pipe-buffered stdout), so the final
  event reliably reaches the supervisor. The exit code remains authoritative
  regardless.
- JSON mode is enabled at the very top of the connect command, before
  profile resolution — the profile-summary log lines land on stderr, never
  stdout.
- `--json` is fully non-interactive. Paths that would prompt or open the
  setup wizard (no profiles configured, no profile matching the folder)
  instead emit `failed` and exit `1`.
- On a session conflict the CLI does **not** prompt (no TTY under a
  supervisor); it emits `blocked` and automatically retries once with
  `force=true`. If the forced attempt also conflicts, it exits `1`.

## Without `--json`

Connect prints human output. It prompts only when a person can answer: stdin
is a TTY and `CONVOY_THREAD_ID` is unset. Every runtime sets that variable
for its agent's processes. Otherwise (OS-2266):

- A session conflict prints the conflict and exits `1` with
  `Retry with convoy connect --force to take it over.` It never takes over
  without `--force`.
- Bare `convoy` prints help and `Run 'convoy connect' to start a connection.`
  to stderr and exits `1`. It never opens the setup wizard, the folder
  prompt or a connection.

## Event stream

Every line: `{ "v": 1, "ts": <epoch ms>, "event": ..., ... }`. Unknown fields
and unknown `event` types must be ignored by consumers (forward
compatibility).

### `status` events

```json
{ "v": 1, "ts": 1783900000000, "event": "status", "status": "online", "sessionId": "..." }
```

`status` uses the OS-779 per-profile vocabulary so multi-profile events slot
in later without a schema break:

| Status       | Meaning                                                                  |
| ------------ | ------------------------------------------------------------------------ |
| `connecting` | Startup: registering with the backend                                    |
| `online`     | Registered, heartbeat healthy (`sessionId` included)                     |
| `retrying`   | Heartbeat failed (network); will retry on the next 30s interval          |
| `blocked`    | Session conflict — another CLI session is active (auto-force follows)    |
| `failed`     | Fatal: registration error, session kicked/expired, or unhandled error (`message` included) |

An isolated worker's `failed` event may carry a fixed `reason` code instead of
text. The service keeps only known codes and runtime keys, logs its own guidance
for each code and never retains worker text.

| Reason | Written by | Meaning |
| --- | --- | --- |
| `runtime-missing` | worker | No runtime started in the project |
| `auth-rejected` | worker | Registration or heartbeat got HTTP 401/403 for the project key |
| `backend-unreachable` | worker | The registration request failed or timed out before any response |
| `project-active` | launcher | The project lease is held; `holder` names by whom |
| `sandbox-failed` | launcher | bubblewrap exited before the worker command started |

`holder` is one of `service`, `connect`, `shell`, `login`, `registration` or
`unknown` ([cli-project-isolation.md](cli-project-isolation.md#failure-reasons-and-project-check-cli-01110-os-2161-os-2162)).
The launcher writes its two codes on the same stdout as the worker, and only for a
service-started connection.

`runtime-missing` lists the runtimes the launcher detected
([cli-project-isolation.md](cli-project-isolation.md#runtime-detection-and-login-cli-01100))
as `runtimes: ["codex"]`, usually empty. An isolated worker's `connecting` event
carries three lists: `runtimes` (detected), `untrusted` (on the sandbox `PATH`
but not root-owned, or group/world-writable) and `loggedOut` (detected, using
native login, with no login file in the project HOME). Clients use them to offer
logins and warn about a runtime that will not work.

Consecutive duplicate `status` values are deduplicated (a healthy heartbeat
every 30s does not re-emit `online`; transitions like `retrying → online` do
emit).

### `thread` events

```json
{ "v": 1, "ts": 1783900000000, "event": "thread", "phase": "claimed", "threadId": "..." }
```

| Phase       | Meaning                                            |
| ----------- | -------------------------------------------------- |
| `claimed`   | Thread claim acquired                              |
| `streaming` | Assistant run started (one per run)            |
| `completed` | Run completed                                    |
| `failed`    | Run failed (`error` included)                    |
| `released`  | Thread claim released                              |

## Exit codes

| Code | Meaning                                     | Supervisor action        |
| ---- | ------------------------------------------- | ------------------------ |
| `0`  | Clean shutdown (SIGINT/SIGTERM/SIGHUP)      | Do not respawn           |
| `1`  | Fatal error (config, registration, crash)   | Respawn with backoff     |
| `3`  | Session kicked/expired server-side          | Do not respawn — another CLI deliberately took over |

Constants live in `apps/cli/src/lib/connect-events.ts`. Note: pre-OS-1236,
a kicked session exited `0`; supervisors must rely on code `3` now.

Heartbeat responses are classified, not lumped: HTTP 404 (session missing —
the server's positive "replaced/expired" signal) → `failed` + exit `3`;
HTTP 401/403 (auth broken, e.g. revoked API key) → `failed` + exit `1`;
any other non-2xx (5xx, 429) → `retrying`, keep the session and try again
next interval.

## Graceful stop

`SIGTERM` (also SIGINT/SIGHUP) triggers the shutdown path: abort active
runners, drain workers (20s cap), release thread claims, `POST
/api/agent/disconnect`, exit `0`. A 30s force-exit timer bounds the whole
shutdown.

Server-side invariants hold on every stop path (verified, no CLI changes
needed):

- `releaseClaim` and `reconcileClaimsForSessionDisconnect` route through
  `resetThreadClaim` (`convex/cli/threads/lib/cliThreadsRepo.ts`), which clears
  `activeAssistantMessageId`, the lease fields, and the watchdog.
- A hard kill (no disconnect POST) is reconciled by the heartbeat expiry +
  streaming watchdog: streaming threads are failed, claimed idle threads are
  requeued.

So a supervisor may SIGKILL as a last resort after SIGTERM times out without
leaving threads stuck.

## Health

The event stream itself is the health signal: `online` at least every
heartbeat interval boundary after a `retrying`, plus process liveness. There
is no separate health endpoint. If stdout goes silent, the process state +
exit code are authoritative.

## Implementation

- Emitter: `apps/cli/src/lib/connect-events.ts` — module-level singleton;
  no-op unless `--json` enabled, so non-connect code paths and tests are
  unaffected.
- Emission points: `commands/connect/workflow.ts` (connecting / blocked /
  failed), `agent/app/runner.ts` (online / retrying / session-terminated),
  `agent/app/thread-processor.ts` (thread phases).
- Packaging as a self-contained binary is OS-1241.

## Persistent Linux service, OS-1959

The [project service](cli-service.md) launches one isolated JSON worker per
registered project identity through the phase 1a launcher. Each worker has its
own event emitter, provider environment and signal handlers. The service consumes
structured status and thread events, discards raw diagnostics and preserves exit
codes 0/1/3. Only exit 1 receives bounded retries. Isolated workers retain the
existing explicit-force policy; they never automatically take over a conflicting
backend session. Legacy desktop and ordinary connect JSON behavior is unchanged.

## Service activity counts

OS-1960 counts distinct thread IDs from claimed/streaming events and removes them
on completed/failed/released. The count is bounded and informational. Removing a
live project connection requires explicit interruption even when the count is zero.
Service status and lifecycle semantics are defined in [cli-service](cli-service.md).

## Managed Codex auth results

OS-2015 adds optional `auth` events with runtime `codex` and an allowlisted result:
configured, setup-failed, request-succeeded, authentication-failed,
quota-or-rate-limit, network-failed or request-failed. No provider message or secret
is carried. The service retains only the enum and its own receipt timestamp.
Unknown events remain ignorable by older consumers. Setup is not provider
validation; quota/network/auth categories describe observed failures.

## Run identity, OS-1994

Streaming and completed thread events now include the backend `runId`. It remains
optional for phases that do not identify a specific run, and older consumers may
ignore it. The service forwards only allowlisted IDs and lifecycle phases to its
private subscribers. Errors and raw worker output never become retained events.

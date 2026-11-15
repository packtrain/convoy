# Persistent project service

The CLI provides `convoy service start [-b|--background]` and `convoy service status|logs|stop`
inside an administrator-configured Linux execution environment. Run these as the
control account. Host container provisioning is documented in [managed environments](cli-environments.md).

Start runs in the foreground by default. `-b` and `--background` both detach
after readiness. The old `serve` command is removed; use `service start`.

The service reads a validated startup snapshot of config.toml and the privileged
launcher's registry. In an isolated environment only registered isolated profiles
are eligible; a shared environment runs only shared registrations and never
ordinary `connect` profiles ([shared environments](cli-shared-environments.md#registrations-and-profiles)). Each identity
has one worker; aliases select the first profile in sorted order. Workspace and
identity mismatches fail startup. Pending or disabled registrations fail startup.
An empty snapshot is valid. Bound the snapshot to 128 identities, profile keys to
80 characters and serialized profile configuration to 32 KiB. Live reconciliation is described below.

Since CLI 0.127.0 a shared environment runs registered projects without the
launcher, on macOS and Linux; see [shared environments](cli-shared-environments.md).
On macOS, `service enable` starts it at each login; see
[start at login](cli-shared-environments.md#start-at-login-on-macos).

The service is unprivileged. It invokes the existing launcher separately for each
worker, sends that profile's credentials only over its private stdin pipe and
requests JSON sidecar events. The launcher enforces the project lease and clears
inherited environment before executing under the project identity. No service
credentials, provider environment or management socket enter the project mount.

The service owns a lock for its entire lifetime. A duplicate start fails;
process death releases the lock and the next owner replaces a stale socket.
Since CLI 0.127.0 the lock is the CLI lock described in
[shared environments](cli-shared-environments.md#locks), in both modes, so
`service start` no longer needs `/usr/bin/flock`. A service from an older CLI
holds a kernel flock that the new lock cannot see, so start also fails while
the control socket answers.
State lives in the control account's private `~/.convoy/service` directory, outside
repositories. Directories/files must be owned by the control account and private;
symlink state is rejected. The socket is mode 0600. No TCP listener exists.

Local control uses bounded NDJSON, version 1, a request ID and an operation:
status, logs, stop, reconcile, project.add or project.remove. The original one-request contract is superseded by the negotiated persistent
contract below in 0.74.0. Unknown versions,
operations or malformed frames fail closed. Requests time out and slow clients
cannot block workers. Future attachment extends this protocol. Logs support a
cursor and profile filter; polling follow explicitly reports retention gaps.

Retain only normalized operational events, never raw stdout/stderr, transcripts,
backend messages or credential-bearing configuration. Logs have profile prefixes,
a monotonic cursor, and two bounded files. Unknown worker fields are discarded.
Status reports connecting, online, retrying, blocked, failed and stopped states.
Readiness acknowledges the owner and control socket, not backend connectivity;
inspect profile status for connection failures.

Workers retain exit semantics: 0 stops, 3 means kicked and stops, 1 retries three
times with 1/2/4 second backoff, then remains failed. Other exits fail without
retry. Attempts reset on explicit targeted reload, relevant configuration changes or service restart. Explicit stop and foreground
Ctrl+C close all launcher pipes, allowing their existing 30-second drain/kill.
Supervisor death also closes those pipes; the launcher retains parent-death cleanup
for its sandbox. Background startup terminal loss and closing a log viewer detach
only. Service stop retains all project files and private state.

Tests use real subprocesses for control/lifetime/locking and fixture workers for
retry/status. They do not replace real A/B agent, VM and rebuilt-container acceptance.
See [project isolation](cli-project-isolation.md) and
[sidecar contract](cli-sidecar-contract.md).

## Reliability and upgrade contract, 0.67.2

The privileged launcher polls its registry lock for at most 10 seconds. A pending
connect observes control-pipe EOF while waiting and returns without starting work.
Other operations report a busy-registry error when the wait expires. The service
allows the launcher's normal 30-second drain, then signals its own children at
31.5 seconds and kills them at 35 seconds. It reports failure rather than claiming
cleanup if close is still unconfirmed one second later. A control client waits
40 seconds. Administrators must refresh the installed launcher when upgrading.

Backoff reports retrying; each new attempt clears the previous exitCode. A kicked
worker reports blocked and does not respawn. A terminal exhausted retry reports
failed. Project registration, the worker schema and service protocol share the
80-character profile-key rule. Shared worker launch configuration and parsed
responses live in validators modules.

Startup sends a bounded structured failure frame containing only an intentional,
credential-free diagnostic. Unknown exceptions become a generic setup error.
Raw stderr is never relayed to the caller or retained. Closed output readers do
not kill the daemon. CLI action rejections flush their JSON failure event and
exit within a bounded interval even when handles remain open.

Stop acknowledgements finish writing before owner teardown, with a one-second
bound for a disconnected/slow caller. Concurrent stop callers share shutdown;
losing a client never cancels it. Request errors retain a valid bounded request
ID and clients distinguish rejection/malformed responses from unavailability.

On writer startup, an incomplete active-log tail is truncated to its last newline
before another record is appended. Readers consume complete lines only. Offline
log inspection neither creates state directories nor creates/repairs log files.


## Live registration, OS-1960

CLI 0.68.0 adds serialized service registration mutations and a two-second polling
fallback. Prepare folders/clones in the calling CLI, outside the service queue;
commit the validated profile through project.add when the service is reachable.
The service rechecks registry/path/identity and config conflicts before saving.
Offline add uses the same validation and atomic writer, reports offline and never
starts the service. Preparation failures retain private files without saving a
profile. A prepared reservation can remain if config commit fails.

The service tracks workers by project identity. Repeated identical registration
and alias changes preserve the existing worker. Changed or externally removed
live connections report pending and remain running until explicit interruption.
Use service reload --profile <key> --interrupt to replace that connection or apply
its removal. The same command retries a failed/kicked registration explicitly.
Unchanged siblings continue. Exited connections and additions reconcile without
interruption; obsolete retries are cancelled. Retained live identities count
against the 128-worker limit, so replacement additions may wait for removal.

project remove --yes confirms unregistration. Removing the last alias with a live
service worker additionally requires --interrupt, even if observed activeRuns is
zero. Sidecar activity can race with new claims; the count is informational, not a
safe-to-kill guarantee. Stop only the selected worker through its existing bounded
EOF cleanup, then disable its registration and remove its profile/default. Files,
private runtime state and remote history remain. Removing a nonfinal alias leaves
the worker running. Offline removal still refuses an active direct connection or
shell; --interrupt never kills an arbitrary external owner.

Service mutations share a queue; status and logs remain separately readable.
Registry polling uses bounded asynchronous launcher inspection so registry lock
contention cannot block socket handling. Validate a complete snapshot before any
worker changes. A bad/partial snapshot sets configurationError and retains the
last valid workers. An empty valid snapshot requests removals under the same
explicit interruption policy. service reload retries inspection immediately.

A mutation reply distinguishes registered from applied; applied does not mean
online. project list --json combines current registrations with observed worker
status, pending changes and activeRuns. service status also reports configuration
errors and workers retained from earlier snapshots. Read-only registry/config
observations are not an atomic global transaction.

Only a pre-connect ENOENT/ECONNREFUSED permits offline fallback. A lost reply after
connecting has an unknown outcome and must not replay the mutation offline.
Queued operations continue if the caller disconnects. Version 0.74.0 adds the
bounded request outcome contract below; results are not durable across restart.
Inspect state before retrying. stop rejects
new mutations and prevents new workers after shutdown begins.

Config writes still use the CLI config lock and atomic replacement. Desktop and
external editors must not write concurrently with project operations; they do not
participate in service serialization. Config and root registry are separate stores:
if a failure occurs between their updates, inspect project list, preserve private
files and repeat registration to recover. No cross-store transaction is claimed.

This version does not change the privileged launcher or add provider credentials.
Stop the old service once when upgrading, install matching CLI code, and restart.
A launcher older than 0.67.2 still needs the previously documented refresh.


service pause <profile> --interrupt stops one connection while retaining its
registration. Status reports paused and stopped; polling does not restart it,
even after configuration changes. This releases the execution lease for project
shell runtime setup. Exit the shell, then targeted reload reconnects it. Pause is
local to this service lifetime; service restart resumes registered projects.

## Managed credentials, OS-2015

Service status advertises `credentials-v1`. Clients check this before sending
`credentials.mutate`; an old or rejecting service never triggers offline replay.
Only a pre-connect unavailable status permits offline mutation. The credential
writer uses config-lock then credential-lock ordering and does not hold locks
while stopping workers. Store persistence and worker application are separate
acknowledgements; inspect status after an uncertain mutation result.

Service snapshots include non-secret desired auth descriptors. Secret material is
resolved again at launch and the revision must still match; stale launches fail.
Live auth changes follow OS-1960 pending/reload semantics. Status includes applied
and desired descriptors and a typed last auth outcome with service timestamp.
`configured` means local setup; only `request-succeeded` records a completed
managed model run. No secret is retained in operational logs.

Control request and worker-event frames remain bounded to 64 KiB. Client responses
allow 256 KiB to accommodate 128 workers with desired/applied auth descriptors.
The provider-key spec defines storage, compatibility and removal limits.

## Multiple terminal clients, OS-1994

CLI 0.74.0 extends the same private socket with persistent bounded NDJSON.
A connection begins with `hello`, version 1. The reply advertises capabilities
and a random service epoch. Mutations require that epoch and negotiated hello.
Request IDs identify outcomes for ten minutes, at most 1024 completed requests;
in-flight mutations are bounded to 64 and are never evicted. Identical retries
within retention share the original result; a changed payload under the same ID
is rejected. Only hashes and replies are retained, never credential payloads.
Outcome lookup reports unknown after eviction or restart. Never automatically
replay an uncertain mutation after restart or retention expiry.

`convoy attach [--profile key] [--json]` subscribes to service health and normalized
execution changes. Each subscription starts with a synchronous snapshot/cursor,
then independently receives bounded events. Cursors include the service epoch;
expired or foreign cursors explicitly require resnapshotting. Slow readers are
disconnected before they can accumulate unbounded output. Ctrl+C detaches only.
An internal `convoy service bridge` relays validated stdin/stdout frames to this
socket, with diagnostics on stderr. No TCP listener or agent MCP relay is added.

`convoy service runs list --profile key` lists execution threads with queued,
active and recent state, not project-management task status. `get <thread-id>`,
`history <thread-id>`, `logs <thread-id> --message <message-id> [--follow]` and
`cancel <thread-id> --run <run-id>` require the same explicit profile. All support
JSON output. List/history are cursor-paginated. History rows carry actual run and
assistant-message IDs. Log pages contain normalized stored events, with explicit
truncation for oversized individual events. They are transcripts, not operational
logs, and are never written to the service's retained log files. Follow fetches
new stored events; ephemeral token fragments are not part of its durable cursor.

Convex remains authoritative. Reads authorize the key's project scope and thread
visibility. Cancellation additionally requires ownership and atomically matches
the selected active run ID. A stale selection fails without affecting new work.
Local clients cannot select arbitrary backend credentials or unregistered profiles.
A backend failure is distinct from an empty history. Available run statistics come
from normalized usage events; no missing usage/cost data is invented.

### Review corrections, 0.74.1

Plain clients print run tables, scalar details, execution updates, and normalized
text/tool events. JSON mode preserves protocol and stored-event objects. Pagination
prints the next cursor; truncated events are marked and retain a bounded preview.
Terminal output queues are limited to 512 KiB and must drain within ten seconds.
A blocked viewer detaches and exits with a diagnostic; it cannot stop the service.
Log readers wait for each page's output before requesting the next page. Idle
follow polling backs off from one to two, four, then five seconds, resetting when
new rows arrive. History/log queries perform their own backend authorization,
without an additional summary read. HTTP clients are reused per live entry, use
the shared credential scrubber and a 15-second request deadline, and are replaced
when credentials or URL change. Weak references retain no removed entry.

Each socket allows one subscription. Subscribed clients require a valid frame at
least every 15 seconds; the service normally emits one heartbeat per second.
Terminal output has its own deadline, so a blocked terminal is reported separately
from a silent service. An incompatible hello stops attach with upgrade guidance.
No fallback to the old one-request service protocol is provided.

Bridge stdin EOF stops accepting requests, then waits for all admitted replies,
the initial subscription snapshot, and stdout writes before detaching. EOF does
not wait for future subscription events. Pending replies and output have a
45-second deadline; a disconnected service with pending request IDs reports an
unknown outcome. Partial frames at EOF fail in either direction. Idle transport
timeouts have a distinct diagnostic.

Stop teardown waits for every admitted stop reply, including a disconnected
caller, with a one-second acknowledgement drain deadline. The shutdown-deadline
diagnostic remains visible. Queued cancellation resolves its profile after prior
mutations finish, so removal blocks it and reload uses current credentials. Only
exact known backend rejection messages cross the service boundary; other errors
remain generic. Stored log cursors must be safe integers of -1 or greater and
invalid cursors have a dedicated error.

## Managed host transport, OS-1995

CLI 0.75.0 accepts --environment for explicit managed-container selection. The
host renders the same protocol over a Docker exec bridge. Hello includes the
service package version and host-cli-v1 capability. The existing Unix transport
remains the default. Host lifecycle, storage and recovery are defined in
[cli-environments.md](cli-environments.md).

## Remote host transport, OS-1996

CLI 0.108.0 adds `--remote <name>`. The host renders protocol commands over an SSH
bridge and forwards the rest to the remote CLI. A stopped service makes the bridge
fail with "Service unavailable". See [cli-remote.md](cli-remote.md).

## Worker failure reasons

Worker status `message` text is still discarded. Each known `reason` on a
`failed` event (see [cli-sidecar-contract.md](cli-sidecar-contract.md#status-events))
adds one service-written log line and sets the project's `warning`, naming the
cause and the fix:

- `runtime-missing`: with an untrusted runtime, it names it and says to reinstall
  it as root with `umask 022`. With none found, it says none is installed
  system-wide and gives the Codex install command. A detected runtime that did not
  start points to `project check`.
- `project-active`: who holds the lease (project service, foreground connect,
  private shell, runtime login, registration) and to stop it.
- `sandbox-failed`: the sandbox did not start; run `project check <profile>` for
  the cause.
- `auth-rejected`: the project key was rejected and may be revoked or expired;
  renew it with `project add <folder> --profile-key <key>`.
- `backend-unreachable`: check the host's network, DNS and proxy.

Each ends with the `service reload --profile <key>` retry. A failure after the
last retry with no known reason points to `project check <profile>`. Runtime names are
kept only for known keys (`codex`, `claude-code`, `opencode`, `cursor`). The
wording lives next to the `project check` fixes so both say the same thing.

Each project's status also carries that guidance as an optional `warning` (at most
256 characters). The service sets it for the reasons above, a launch failure, a
takeover by another session (`blocked`) and a failure after the last retry. A new
attempt or `stopped` clears it. `online` clears it too, except for a runtime
notice: when the `connecting` event lists `untrusted` or `loggedOut` runtimes,
the warning says so and stays while the project is online. `service status` prints
a `Warnings:` block under the table. Status also carries `runtimes`, the known
runtime keys from the worker's latest status event that listed them. It survives
a pause, so the TUI can offer only installed runtimes' logins. The TUI shows the
same warnings ([cli-tui.md](cli-tui.md#project-warnings-cli-01090)). Old clients
ignore the field.

## Terminal browsing, OS-2059

CLI 0.95.1 adds optional `inspect-v1` and a read-only `inspect` operation. The
response projects configuration already held by the service, without credentials
or backend reads. Existing clients and commands keep their behavior. The
[terminal browser spec](cli-tui.md) defines fields, paging, refresh costs and cleanup.


### Raw log inspection, 0.96.0

`raw-logs-v1` adds an optional raw mode to `runs.logs` for the TUI. `rawLogs`,
`chunkBefore`, `eventOrder` and `eventOffset` route to the existing authorized
`getServiceRunLogs` query. Raw mode returns compact stored JSON or bounded
fragments, without normalized preview substitution. Version 0.96.1 preserves
exact JSON tokens when compacting stored data. The existing one-shot command
format remains unchanged. See [raw run detail and export](cli-tui.md#raw-run-detail-and-export-os-2060)
for the protocol limits, historical fidelity caveats and database costs.

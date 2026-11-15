# Service terminal browser

The [CLI 0.103.2 interaction contract](#unified-interactions-cli-01032) supersedes earlier popup, action grouping and shortcut descriptions below. [CLI 0.105.0](#design-palette-cli-01050) defines the visual layout. [CLI 0.115.0](#sidebar-views-cli-01150) moves environment views into the sidebar and drops All projects. Earlier version sections preserve implementation history.

OS-2059 adds `convoy tui` in CLI 0.95.1. It attaches to an existing service. CLI 0.98.0 adds explicit confirmed
service and run controls through Actions. `--environment <name>` initially selects a saved
managed Docker environment. The local Unix socket and saved environments remain
in a persistent sidebar. Connections are observed only when selected. Leaving a
connection closes its transport and changes its health to unknown. SSH is deferred
until the existing environment transport supports it.

The renderer lives in `apps/cli/src/commands/tui`, whose only public export is
`tuiCommand`. `cli.ts` registers that command. Ink loads on invocation. Service
inspection belongs to the existing service module; Docker cancellation belongs
to its existing transport. Existing commands, JSON output and follow flags retain
their behavior.

## Navigation and data

Up/Down or j/k select rows. Left/Right or Tab changes panes without changing
selection. Space or Enter on a connection toggles its disclosure independently
of selection. Since CLI 0.124.2 the sidebar also follows tree arrows: Right
expands a collapsed environment, Left collapses an expanded one, and Left on a
child row selects its environment. Otherwise Left/Right change panes. Enter on a project or All projects focuses the main pane, retaining
the current selection without opening a thread. d opens connection Details; r opens Runs; a opens contextual Actions.
Selected rows fill the available width and dim when their pane is inactive.
All projects and individual projects align at the same indentation beneath their connection.

Runs shows execution threads, including unlinked threads and separate threads
for the same task. Enter opens the selected thread's paginated execution history,
where repeated runs have distinct message/run IDs. Escape returns to the thread
list or focuses the sidebar. Rows place the task label before the title: [no task] for an unlinked thread or
[PROJECT-123] for a linked task. Linked tasks whose references are unavailable,
including older backends, use [task unavailable]. History retains its selected
thread's task label. Enter on an execution opens raw JSON detail. The UI does not parse transcripts or compute usage.

The page limit is 20. All projects traverses registered projects in service order,
one project's page at a time; it does not claim a globally sorted aggregate.
n/PageDown advances, p/PageUp returns and Home starts over. At most one page and
100 previous page positions are retained. Older navigation positions are discarded;
Home remains available. Pages refresh five seconds after the preceding read
finishes. No page requests overlap. Empty pages can still have a next cursor.

Details separates the actual service transport endpoint, client version, service
version, process/epoch and backend endpoint origins. `inspect-v1` is an optional
service capability. Its `inspect` operation projects only profile key, project ID,
endpoint origin, configured concurrency/isolation/streaming, the environment
mode and the service Node version. URL userinfo, paths, query and fragments are omitted. API keys and auth
objects are never projected. Project configuration is labeled as captured when
attached; reconnect to refresh it after changing configuration. Unreported workspace paths, agent runtime versions,
skill installation and global queued counts are explicitly unknown.

Each client has independent navigation and one service subscription. A fresh
snapshot replaces status after reconnect. Heartbeats do not trigger React renders
or backend reads. The five-second visible-page refresh discovers queued work as
well as active/recent work. Responses after a scope or connection switch are
ignored. Closing a client aborts a pending handshake, requests and Docker checks.
Failed reads retain the last page with a stale/error label. Reconnecting keeps
retained pages stale until their backend refresh succeeds, even after a fresh
worker snapshot. f retries; transient connection failures retry every three seconds.
Optional inspection rejection or invalid metadata leaves a healthy connection
usable; transport failures still reconnect. Inspection is not retried in the background.

Browsing requires attach-v1 and runs-v1, not host-cli-v1. Known protocol or browsing
capability incompatibility stops automatic retries and shows update instructions
in Details. Managed targets use the environment update command with the client
version and explicit --interrupt. Local instructions stop the old service, install
the matching CLI and restart it. The user performs the update outside the TUI,
since it interrupts connections and active work, then presses f to reconnect.
Raw transport/backend errors are not displayed. Mutations require explicit Actions selection and are never automatically replayed.

Discovery validates saved directory permissions without creating state. A bad
entry emits a safe diagnostic and does not block other connections. Explicitly
selecting an invalid entry fails rather than falling back to Local. Opening a
target rereads its state using the same validated home as discovery.

The UI clips rows to terminal dimensions and keeps the selected row visible in
thread and history lists. Unicode joiners are preserved. Below 45 columns or
10 rows, the UI asks for a resize. q, Ctrl+C, SIGINT, SIGTERM and SIGHUP detach and restore
terminal input/cursor state. Since CLI 0.124.1 the UI draws in the terminal's
alternate screen, so it has no scrollback and leaves no frame behind after exit.
Shell handoffs return to the normal screen, so their output stays in scrollback,
and the UI switches back when it remounts. Both stdin and stdout must be TTYs; otherwise the
command exits 1 with a plain diagnostic and one-shot command alternatives, before
loading Ink or opening a connection.

## Request and database cost

Opening a connection sends hello, subscribe and, when supported, inspect. These
read service memory and make no Convex calls. The service sends its existing
one-second heartbeat and changed worker snapshots. Details makes no backend reads.

Opening/changing a run page sends one `runs.list` request, which calls the existing
`listServiceSummaries` query once. A history page instead sends one `runs.history`
request and calls `listServiceRuns` once. There is no per-thread history fan-out,
no transcript fetching, and no new backend schema or query. All projects visits
only the visible project's page, even with 128 registered projects.

With a continuously visible page, the upper steady-state rate is 12 backend
queries/minute/client, plus navigation and explicit retries. Two clients make up
to 24/minute; 100 make up to 1,200/minute. Requests take time, so actual intervals
are five seconds plus request duration. Independent clients do not share a cache.

A thread page uses the existing user/project/deleted/kind/activity index and reads
up to 20 returned thread documents, then enriches distinct runtime profiles with
profile document reads and latest-active-session indexed lookups. Authorization
also reads its existing key/user/project/membership records. A history page uses
the thread/role/createdAt index for up to 20 assistant messages plus existing
authorization/thread-visibility reads. Pagination may read additional bytes to
resolve cursors; these are not hard document-read ceilings. Service list pages resolve task references using one task-document read per
distinct linked task, deduplicated across the page. The project alias comes from
the existing authorization result. Deleted/missing tasks and tasks outside the
selected project expose no reference. Other summary endpoints do not load tasks.
No extra API request, writes, migrations or Convex subscriptions are added.
For a TUI page with K distinct linked tasks, this adds K document reads per refresh,
where 0 <= K <= 20, up to 240 task reads/minute/client at the existing refresh rate.
Task documents are read in full, so bytes depend on task sizes. History reuses the
selected thread metadata and adds no task reads.

Service requests allow eight outstanding operations, but this UI serializes its
page reads. Frame limits remain 256 KiB per response. Memory holds a page, bounded
cursor history and at most 128 workers per observed connection. Subscription
cleanup releases the old socket and bridge; agents remain owned by the service.

The review fixes add zero backend queries and retain the page size and polling
interval. A healthy connection no longer reattaches every three seconds when
optional inspection fails. This removes repeated hello/subscribe/inspect traffic
and, for Docker, repeated daemon/container validation and bridge processes.
Known incompatible services also stop retrying. Client version reads happen once
when the renderer loads instead of twice per render.

## Verification

Socket tests cover two clients, paging, repeated executions, reconnect, stale
responses and failed reads. Renderer tests exercise keys, full-row fills, narrow
resize, colliding profile names, scrolling all 20 threads and history entries, and raw-mode cleanup. Discovery tests cover malformed records, symlink directories and custom-home opening. The terminal fixture under `tui/__tests__/terminal.tsx`
calls the production render/signal/cleanup loop and provides a real socket and deterministic projects for a recorded PTY demo. This
fixture does not substitute for acceptance against two real registered projects,
web-triggered agent work or a managed Docker target.


## Raw run detail and export, OS-2060

CLI 0.96.0 adds stored JSON detail under the existing tui module.
`logs/index.ts` exports its sole view. The host app mounts it; the existing
Browser suspends list polling and routes reads through its current service client.
Existing service validators/runs handler and Convex messages/chunk repository own
the protocol and storage changes. No service code imports the renderer.

Enter on a history run opens detail; Escape restores that history page and
selection. Up/Down and PageUp/PageDown scroll the wrapped compact JSON. p retrieves
older events, n newer events, Space pauses/follows, f or End jumps to latest, and r
retries. In 0.96.1 the left connection sidebar remains visible while detail fills
the main panel. Escape returns to the history page with its selection intact.
The sidebar is inactive during inspection. Below the minimum terminal size,
detail shows a resize notice while retaining its controller, paused position and
export; Escape and detach still work. Each event is compact JSON on
one logical line, wrapping at the main panel width. Version 0.97.2 adds one
empty display line between events; wrapped rows within an event stay adjacent.
JSON Lines export retains one event per line without blank separators. On MacBook
keyboards, Fn+Up and Fn+Down send Page Up and Page Down. The viewport shows part of long
events; scrolling reveals the rest. No pretty printing, clipboard integration,
mouse capture or terminal copy-key handler is installed. Pause while selecting.
Terminal controls and bidi controls are escaped using JSON escapes, preserving
the parsed value. Native selection behavior across wrapped rows needs verification
in each supported real terminal; the automated renderer cannot verify clipboard
contents.

The window retains at most 100 events and 128 KiB of UTF-8 JSON plus a 256-byte
per-event accounting allowance. Paging retains the contiguous portion nearest
the current window, dropping old events first. It stops assembling a fetched
page before exceeding the byte budget, so skipped descriptors remain reachable
on the next page and do not trigger wasted fragment reads. Every
navigation page holds at most ten events; older evicted pages are read again by
stored chunk order. An event over 64 KiB is represented by an explicit size/order
notice in the window. Export retrieves its complete stored JSON in fragments.
This prevents a single event from defeating the display memory cap. Rendered
lines are derived only when the window or terminal width changes; ASCII wrapping
uses slices, Unicode wrapping uses grapheme widths with an ASCII fast path. The memory cap is a retained
payload budget, not a claim about total Node heap/RSS. Transport buffers, temporary
strings and React output remain bounded separately.

`raw-logs-v1` advertises service support. The TUI requests raw mode on
`getServiceRunLogs` through the existing `runs.logs` operation. This bypasses the
legacy normalized-event 2,000-character preview substitution. Existing one-shot
commands keep their normalized format, flags and explicit follow behavior.
Raw mode reads the stored CLI `data` field and preserves nested JSON. It validates
the JSON separately and removes only whitespace outside strings, preserving
number tokens, duplicate keys and escape spelling. It does not round-trip values
through JavaScript numbers. Non-JSON
stored data becomes `{type, data}` so export remains valid JSON Lines and retains
the exact stored string. Original completeness is unknown: ingestion has
historically split, scrubbed or truncated oversized input, sometimes without a
marker. Known truncation notices and data at the old storage cap are labeled
possibly shortened, including the cap minus one UTF-16 unit for surrogate safety.
Per-event warnings appear on separate lines from JSON, including oversized
descriptors; ordinary events retain the general completeness caveat. No reader can restore already-removed content, and this
change does not redesign ingestion. Empty history is labeled unavailable rather
than reconstructed from normalized text. Durable history excludes replaceable
ephemeral token deltas; live follow shows stored events as they arrive.

Raw pages inline JSON up to 4,096 UTF-16 units per event; larger rows return an
order/length/byte descriptor. An event read retrieves at most 16,384 UTF-16 units,
without splitting surrogate pairs. All pages/fragments fit the existing 256 KiB
service response frame. Both directions use the existing stored-chunk index.
No schema migration is required. The backend and service must both be updated;
an older backend or service produces an actionable unavailable/update notice.
Missing service capability, disconnection and invalid log responses have distinct
controlled diagnostics. Arbitrary backend exception text is not displayed.
Read errors stop background log reads until explicit retry or navigation.
Transport reconnection remains independent. Paging newer advances the read
position; background paused probes do not.

Each view owns one serialized read loop. Generation checks discard late replies
on pause/navigation, and disposal clears its timer, listeners and retained events.
The transport may finish one already-issued read after exit; it cannot repopulate
the old view. Target switching or detach closes that connection. Reconnect reads
the same durable order range; overlap is deduplicated by order. Slow readers only
request the next page after finishing the current one and never backpressure
agent execution.

e opens a client-local destination input, then explicit create/overwrite
confirmation. Pasted trailing tabs/newlines are removed without submitting;
embedded controls are rejected with an explanation. Invalid destination errors
remain visible beside the editable prompt and clear on edit. Export writes a unique sibling `.partial` file with mode 0600,
awaiting every fragment write before reading more. It captures the latest stored
order on its first page and exports through that boundary, so an active run cannot
keep export open indefinitely. Success fsyncs/closes the file and publishes it to
the destination. Without overwrite approval, publishing fails if the destination
appeared meanwhile. An approved overwrite replaces the destination only after a
successful export. Escape cancels export; failures/cancellation retain the partial
file and report its path. Close the result dialog, then e retries from the beginning with a new partial file.
Leaving detail or detaching aborts export; resizing does not. Partial files remain on disk.
No run-sized or event-sized export buffer is retained. The user's OS permissions
and available disk space govern local destinations.

### Raw-log request costs

List/history polling stops while detail is open. Active detail polls three seconds
after the previous read, at most 20 idle queries/minute/client. Paused active views
use the same interval but request an empty forward range plus the latest order,
so they do not transfer a payload page. Completed/failed runs stop background
polling once caught up. Explicit paging/retries and immediate catch-up pages are
additional reads. Independent clients do not share a cache.

Each raw page is one service request and one Convex query. It repeats existing
authorization/thread/message reads, then performs one indexed latest-row read and
one indexed range read of up to eleven chunk documents, returning ten descriptors
or events. Thus a busy page reads up to twelve chunk documents plus authorization;
a paused probe reads one latest chunk plus an empty range. Convex reads whole
chunk documents, including normalized fields, even when only metadata is returned.
Document bytes depend on payload sizes; these are requested-row bounds, not a
promise about Convex index accounting.

Each large-event fragment is one additional service request/Convex query and one
indexed chunk-document read plus the same authorization/thread/message reads. It
skips the latest-row lookup. For a JSON event of L UTF-16 units, above the inline
threshold, expect about ceil(L / 16,384) fragment queries, occasionally one more
at a surrogate boundary. The display fetches those only up to 64 KiB; export
fetches every fragment. No writes or Convex subscriptions are added.

An export of N events costs approximately ceil(N / 10) page queries, plus the
fragment queries for events above the inline threshold. Every fragment rereads
its stored document. This trades extra read traffic for bounded transport/client
memory and avoids a new blob-storage/migration system. At idle, two active clients
make at most 40 queries/minute; 100 make at most 2,000, plus navigation, catch-up
and export. Settled detail makes none after loading. Backend work and elapsed
request times lower these nominal rates. There is no measured production latency
or traffic claim; tests validate bounds and backpressure.

### Review correction costs, 0.96.1

The sidebar, fidelity labels, input fixes and resize preservation add no database
queries. Stopping on read errors removes up to 20 failed queries per minute per
open detail. Normal active polling remains at most 20 queries/minute/client;
completed, caught-up views and failed views do not poll.

Every fragment still reads the whole stored chunk and repeats JSON validation,
token-preserving compaction and UTF-8 sizing. This remains CPU work proportional
to the whole event per fragment. Byte accounting and the existing transport
limits are retained; no shared cache or storage redesign was added.

A local review benchmark with ten 60 KB events reduced initial detail loading
from 41 queries and 610,998 response bytes to 9 queries and 123,182 bytes while
displaying the same two events. The skipped fragment reads account for the
difference. Navigating all history can require more pages because formerly
unreachable events are now accessible. Export query counts are unchanged.
A 60 KB mixed-Unicode rendering fixture fell from 156.5 ms to 12.1 ms per wrap
after the ASCII grapheme fast path. These are synthetic Node measurements, not
production Convex latency or traffic claims.

## Contextual actions and saved service logs, OS-2061

CLI 0.98.0 adds Details/Actions for connection scope and Runs/Actions for project
scope. The sidebar remains visible. Actions stays selected across target changes;
d and r return to browsing. The selected history execution is preserved while
opening Actions. Controls are grouped by connection, project and selected run,
with s status, l saved logs, b start, x stop and c cancel. Up/Down and Enter also
select controls. Unsupported controls report why they are unavailable.

Cancel requires a fresh selected history row with streaming status and exact run
ID. Confirmation names the connection, thread and run and describes shared impact.
It sends the existing runs.cancel operation with that ID; the backend atomically
rejects a newer replacement run. Stop confirms that every connection and active
run in the shared service is affected. Start confirms that registered projects
resume. Pending confirmation and execution lock target/tab navigation. Escape or
n cancels confirmation, including below minimum terminal dimensions. Confirmation
cannot be accepted unless every wrapped line of the target, impact and confirmation
hint fits the visible dialog, even above those minimum dimensions. Confirmations
float in the center of the terminal over the visible Actions screen, with a rounded
accent border, opaque background, padding and a maximum width of 72 columns. The
target, impact and keys are separated by blank lines. Dialogs have selectable
Cancel and Confirm buttons, with Cancel selected on open. Tab cycles the buttons,
Left/Up selects Cancel, Right/Down selects Confirm, and Enter activates the selected
button. y confirms and n/Escape cancels. An undersized dialog shows only Cancel and a
resize notice and still accepts Escape. q/Ctrl+C always detach the client.

The confirmation captures the current service client. A disconnected or replaced
client cannot execute a pending stop/cancel. Rejected requests display their
controlled service error. A lost reply reports an unknown outcome with available
request/epoch identity; no mutation is automatically replayed. Inspect current
state before retrying. Cancellation is reflected through existing worker events
and the run page refresh on return. Other clients retain independent navigation.

Service status and stop use the attached service protocol. Local startup reuses
startService in quiet background mode and is offered only to a control account
inside a configured project environment. Managed Docker startup validates the
saved environment and running container under the existing environment lock, then invokes the existing host helper's
start operation. It never creates or starts a container from this screen. A
missing/stopped container or unavailable host requires environment recovery
outside the TUI. Shared stop leaves the container running, so saved logs and
service restart remain accessible.

Saved logs are operational JSON, separate from run transcripts. They do not follow.
A connected client reads one logs page. With no live service client, Local reads
retained files in reader mode without creating or repairing files; Docker validates
the host/container and invokes the existing service logs --json command inside
it, which supports offline file fallback. Docker failures distinguish host or
container unavailability from failure to read service logs. The view retains at
most 100 entries, supports scrolling, n next and Home first. Existing retention
limits apply; available gap information is shown. Docker reads at most the existing
1,000-entry retained set with a 1 MiB subprocess-output limit, then selects the
100-entry page. Each Docker page repeats that bounded host read. No new daemon,
log store or protocol is introduced. Leaving Actions, changing target or detaching
releases the retained log page; late responses cannot restore a detached view.

Actions suspends list/history polling. Status, saved logs, start and stop add no
Convex calls of their own. One cancel uses the existing service handler's one
thread-summary query and one cancelProcessing mutation. Opening Actions creates
no extra subscriptions. Returning to Runs resumes its existing five-second
polling, and starting a service reconnects the existing subscription. Worker
restart can resume normal backend work; that is shared service lifecycle behavior.
No schema migration, new backend function or query invalidation is added.

Verification includes real Unix socket clients and Ink keyboard/resize tests with
simulated run data, plus retained-file and Docker-unavailable tests. A PTY fixture
records the terminal flow. These fixtures do not prove cancellation of a real
backend agent or live managed Docker startup; those require the acceptance host.


### Review corrections, 0.98.1

Action results and unavailable reasons occupy their own wrapped, scrollable view.
Up/Down and PageUp/PageDown reveal the entire message, including request ID and
service epoch. Escape dismisses this view from either pane; another Escape leaves
Actions without clearing the selected history. The menu scrolls to the selected
control and Enter shows its full unavailable reason. Busy reads name the operation.
Run and operational logs reuse the same grapheme-aware terminal wrapping core.

Status and operational-log paging use the current attached client after reconnect.
Stop/cancel retain the client captured at confirmation. Docker saved logs share the
existing operational-log command/parser with diagnostics suppressed for Ink; both
command and parse failures map to controlled recovery guidance.

These corrections add zero DB queries, mutations or subscriptions. A valid cancel
still costs one thread-summary query and one cancellation mutation. Rejecting
pending/running rows locally avoids those two backend calls for invalid attempts.
Scrolling, resizing and dismissing feedback make no transport or backend calls.
Actions continues to suspend run-page polling, with no change to polling on return.

For each log page after reconnect, using the current socket avoids the previous
Docker fallback's four subprocesses: daemon info, container list, container inspect
and log-reader exec. It sends one existing service logs request instead, with zero
Convex calls. Offline Docker paging keeps those four subprocesses and the existing
1 MiB output/100-entry display bounds. Local offline paging still reads retained
files. Startup adds only local lock filesystem operations and waits in 200 ms
intervals if another environment command holds the lock; it does not add Docker
or DB calls. Contention can delay startup by the existing lock's ten-minute limit.
No production latency measurement is claimed.


## Project maintenance and private shells, OS-2062

CLI 0.100.1 uses the shared `tui/dialog` renderer for action confirmations,
unavailable reasons, progress and completion messages, and log export prompts.
Action dialogs overlay the terminal; export dialogs overlay the log pane. Export
path entry has Cancel/Continue buttons; Tab moves from the text field through the
buttons. Enter in the text field checks the destination but never writes a file.
Create/Overwrite confirmation defaults to Cancel and refuses y/affirmative Enter
unless its complete path and message fit. Export progress has Cancel; export
results and action feedback have Close. Long feedback scrolls with arrows or
PgUp/PgDn. Action shortcut keys remain available from completed feedback.

Connection health and log-fetch errors remain inline with their existing retry
controls, so background failures do not repeatedly interrupt browsing. Standalone
one-shot command prompts retain their existing terminal behavior and flags.
These presentation changes add no service or database requests.

CLI 0.99.0 adds p Pause project, u Reload project, h Private project shell and
v Remove project from environment to Actions. These controls require one selected
registered project and a live service with host-cli-v1. All projects and connection
scope report why a project control is unavailable. Opening Actions or returning
to Runs does not stop work.

The action controller and its state types live in actions/workflow.ts and
validators.ts. Browser owns connections, subscriptions and pages. Its action host
provides current state/client, lifecycle identity and callbacks for status,
reconnect and shell handoff. Existing cancellation identity checks, navigation
locks, unknown-outcome messages and bounded operational logs are preserved.

Pause and reload use reconcile with the selected profile and interrupt enabled.
Pause also sets pause true. Confirmation describes active work and shared impact.
Pause releases that connection for a shell; explicit reload or service restart
resumes it. Reload and removal reuse existing reconciliation, which can also
apply pending registration changes elsewhere. Unchanged projects stay connected.
Removal uses project.remove with interrupt after confirmation, retains private
files and does not delete the remote project. Canceling confirmation does nothing.

Confirmation locks target and tabs. Before project execution, one status request
checks that the profile and observed isolation identity still match. A changed
service client rejects confirmation. The service remains authoritative for
registration mutations and the launcher remains authoritative for activity locks.
The status preflight is not an atomic registration compare-and-swap. Existing
operations resolve the profile again when they execute. No mutation is replayed
after a lost response. A successful action refreshes service status once; failure
of that refresh is reported separately from the completed action.

Removed profiles disappear through status/subscription updates. Once no action
is pending or executing, an absent selected profile resets to All projects and
clears its rows, history, detail and page cursors. Other clients keep their own
selection unless their selected registration also disappears.

CLI 0.100.0 offers Pause and enter shell in the confirmation dialog when the project
is active. The dialog explains that pausing stops active work for every client.
Cancellation does no work. Confirmation checks identity, sends the existing pause
operation if still needed, then checks status again for the same paused project.
A rejected or uncertain pause, changed identity, disconnected client or resumed
project prevents shell entry. If the project was already paused when the dialog
opened, resuming it requires a new confirmation with the pause impact. Shell entry
still requires a paused project, rechecked immediately before handoff.
Local entry rereads the profile identity and calls projectShell. Managed Docker
entry validates the saved environment and running container, then uses the existing
environment-locked target shell. The existing launcher owns the private HOME,
workspace, isolated session, controlling PTY and activity lease. Runtime login
runs natively inside that HOME. No credential material passes through TUI state.

The render host unmounts Ink, releases raw input and pauses its stdin reader before
inheriting the terminal into the shell. It remounts after exit or launch failure,
retaining Browser's project, Actions tab and history. Focus returns to Actions;
menu selection and scroll offsets reset. Ctrl+C belongs to the shell during
handoff. Shell exit, including a nonzero status, provides explicit Reload guidance;
there is no automatic resume. SIGTERM/SIGHUP detach rather than remount.

These controls add no backend functions, schema, subscriptions or polling. Each
confirmed project action makes one preflight status request. Pause/reload/remove
then send one existing mutation request and one status refresh; shell instead
runs the existing launcher and then refreshes status. Combined pause/shell uses
four service requests: preflight status, pause, verification status and post-shell
status. Compared with separate Pause then Shell, it saves one status request.
Status reads service memory
and adds no Convex calls. Worker stop/start and reconciliation retain their existing
backend effects. Returning to Runs resumes the existing five-second page polling.

Verification includes socket tests and a real PTY fixture with two simulated
projects, cooked/raw-mode assertions, a shell with temporary HOME/workspace,
job-control diagnostics, failed launch and nonzero exit, resize, cancel/remove and
retained files. The fixture does not prove a real isolation boundary, Docker host
operation or provider login. Verify those on a configured acceptance environment.


### Review corrections, 0.99.1

SIGTERM/SIGHUP abort the shell handoff, including a pending environment lock or
container check. The render host checks cancellation again after deferred stdin
cleanup and before launch. Local and Docker shell adapters forward cancellation
to their child and await close before the handoff ends. The local launcher also
forwards terminating signals when invoked by a one-shot command. Ctrl+C remains
owned by the interactive shell. Terminal restoration does not remount after detach.
Live Docker cleanup still needs acceptance on the configured host; tests exercise
the signal path and child close contract without a Docker daemon.

Managed shell entry acquires the environment lock before rereading saved state and
validating the running container. It rejects a changed environment owner or daemon.
The confirmed isolation identity travels as the optional project shell
--expected-identity argument. Inside the target, that command resolves the profile
once, compares the expected identity, and passes that same checked identity to the
launcher. An older target CLI that lacks the option fails without opening a shell.
Existing invocations without the option retain their behavior. The local launcher
still owns registration and activity-lease validation.

Actions now groups connection controls, project controls, and run cancellation
under their respective headings. Selection scrolling derives positions from those
sections. Confirmation wording uses an exhaustive action switch. Selection
reconciliation runs on profile updates, connection readiness, confirmation dismissal
and action completion, rather than inside the generic state setter. Revision and
disposal invalidate action results; a changed connection separately invalidates
pending confirmations. No generic token or additional state store is introduced.

A failed project preflight reports that no project action was sent. Explicit
service rejections remain known failures even if the socket closes. Only an
attempted mutation whose response is lost gets unknown-outcome guidance. Shell
exit remains known across service reconnection; success and failure refresh status
through the current client. Docker diagnostics include the exit status without
unconditionally asking the user to pause an already paused project.

The PTY fixtures resolve their paths relative to their own file and run from any
working directory. Linux verification requires Python 3, Node with the workspace
dependencies installed, util-linux /usr/bin/script, and /bin/bash. The fixture
covers normal/nonzero exit, failed launch, SIGTERM/SIGHUP during a shell and during
lock preparation, narrow resize and restoration. Generated __pycache__ directories
are ignored and must not be shipped.

#### Review correction request costs

No Convex functions, subscriptions, scheduled work or database calls are added by
these fixes. A successful pause/reload/removal still sends two service-memory
status requests and one existing mutation request. Successful shell entry still
sends two status requests. A failed shell launch or nonzero exit now attempts one
post-exit status refresh as well, adding at most one service-memory request per
failed attempt. Reconnection uses the Browser's existing subscription and retry
policy; the refresh does not open another connection.

For a TUI Docker shell, moving validation under the lock retains the existing three
Docker checks: daemon info, container list and container inspect. There is still
one interactive exec. The expected identity is an argv value, checked during the
existing target config lookup; it adds no process or DB request. Saved environment
metadata is reread under the lock. One-shot managed project shell commands now
repeat those three Docker checks under the lock after their existing pre-action
validation, to detect changes while waiting. No repeated checks run during the
shell session.

Abortable lock waits retain the existing 200 ms filesystem retry interval and
10-minute limit. Cancellation clears the wait instead of continuing to poll.
Action menus, formatting and selection reconciliation are local CPU work over
bounded state. No polling frequency, backend read set or write contention changes.
Stopping/restarting workers retains existing backend teardown/startup traffic;
these changes add no new worker lifecycle operation. Live traffic/latency is not
measured by the fixture tests.

## Guided project registration, OS-2063

CLI 0.101.0 adds `+ Add project` for the selected existing connection. Since
CLI 0.101.3 the form opens in a centered popup over the browser. Navigation,
actions and run polling are locked until the form closes. Other clients keep
independent navigation. Local registration requires the configured Linux project
environment; managed Docker registration uses the saved environment lock and
rechecks owner, daemon and running container. SSH and environment creation remain
outside this slice.

CLI 0.101.2 adds a selectable `+ Add project` row under every expanded connection,
after All projects and before existing profiles. Enter or Space opens the form
for that connection. Moving onto the row shows an entry prompt without loading
choices or registering anything. The `+` shortcut still opens the selected
connection's form from either pane. Sidebar navigation remains available after
canceling. Unsupported targets show the existing availability explanation.

CLI 0.102.0 adds a Saved deployment dropdown when inspected connections have
HTTPS deployment URLs. The selected connection's URLs appear first; duplicates
are removed. Enter or Space opens the dropdown, Up/Down selects, Enter fills the
editable URL input, and Escape or Tab dismisses the dropdown. Enter a new URL
clears the URL and focuses its input. Changing the URL clears the entered API key;
keys are never copied from saved profiles. Suggestions use a snapshot of already
inspected connections when the popup opens, with no additional requests. If no
URLs are available, the popup keeps the two manual inputs. Unvisited or
unavailable connections may have no inspected URLs. Long lists scroll with the
selection and narrow terminals retain the focused field.

Enter an HTTPS deployment URL and masked API key, then load the actual accessible
projects and organizations. Choose Link existing or Create new. Creation uses the
existing generated alias; linking derives a profile key from the project's alias.
Edit the profile display name, key and workspace child path in the target, then
choose empty, reuse or clone. The guided clone field accepts credential-free HTTPS
URLs. Existing one-shot clone options remain unchanged. Labeled inputs show
placeholders, a focused background and a visible caret; the API key stays masked.
Typing edits the focused input. Enter on a text field keeps focus there.
Tab/Shift+Tab or Up/Down move between inputs and the Cancel/Load choices or
Review registration buttons. Enter activates a focused button. Left/Right and
Home/End move the caret; Backspace edits text. Since CLI 0.102.1, Left/Right on
form buttons focuses Cancel/the primary action, and on confirmation focuses
Back/Register without wrapping. Text inputs retain caret movement. Projects sort
by organization name, then project name within each organization; organization
choices sort by name. Selection keeps the matching project ID after sorting.
Workspace mode is a dropdown opened with Enter or Space. Up/Down highlights
Empty directory, Reuse existing directory or Clone repository and shows its
explanation. Enter applies the choice; Escape or Tab dismisses without changing
it. Clone reveals the required HTTPS URL input. Small terminals must show the
explanation or require resize before selection.
CLI 0.102.2 labels the clone input Git repository URL (HTTPS), with a
https://github.com/owner/repo.git placeholder and a sentence explaining that
clone copies the Git repository into the workspace. Details popups size to the
number of fields and use compact spacing when needed, showing all five link
fields or seven create fields together at 100x30. Smaller terminals show a field
range with PgUp/PgDn scroll instructions. PageUp/PageDown moves focus by a visible
page of inputs, clamped to the first/last input; arrows and Tab still move focus.
Resizing and paging preserve input values. The form no longer says Tab for more.
Blank credentials stay in the popup with an explanation, without discovery calls.
Review defaults to Back. A clipped confirmation requires resize before submission.
Escape goes back or closes without submitting. During submission, wait for its
result; detaching can leave remote data, keys and prepared files behind.

CLI 0.102.3 checks managed target setup compatibility before allow-domain or
registration. A read-only Docker exec starts Node and asks the installed request
schema whether it accepts guided setup and profile names, using dummy inputs.
No credentials or backend request are involved. Unsupported targets return
`target-incompatible`, explain that the environment CLI needs updating, and keep
inputs for retry. Probe errors/timeouts return environment unavailable. The probe
has a 15-second timeout. Failures after registration starts still retain unknown
outcome handling. Local targets use the host package and need no probe.

The existing setup resolver and project-add workflow own access checks, remote
creation, launcher preparation, source-linked worker-key reuse and service
registration. The guided path saves the validated worker registration before
reconciliation, so reconciliation failures retain a reusable key. One-shot output
and flags retain their behavior. Profile display-name overrides now flow through
project add. Local preparation runs in a child process so its synchronous launcher
does not block Ink. Both local and Docker children receive credentials on stdin,
never argv. Docker helper output and backend logging are suppressed in this flow.

The structured result contains success, phase, confirmed project ID, saved
registration, application and retry-safety flags, plus an optional fixed diagnostic
reason. Raw errors and credentials never
enter its JSON. Validation and preparation failures retain editable fields. Once
creation is confirmed, retries link that ID rather than repeating creation.
Uncertain creation, key issuance or transport outcomes disable retry and require
inspection of Convoy projects, API Keys and target registrations. Closing the form
discards the input credential. Applied success selects the profile's Runs and
reconnects to refresh service state. Pending application opens connection Actions
for Start or reconciliation without selecting an unavailable profile.

### Runtime access after registration, CLI 0.122.0, OS-2167

CLI 0.123.1 also exposes the same screen from project Actions as `t Runtime access`.
Opening it reads the existing project; it never registers or adds a project.
Back/Escape discards unsaved choices and returns to that project's Actions. A
successful Save and reload also returns to Actions, where Runtime access can be
opened again to read the saved bindings and account status. Native-login terminal
handoff retains this origin and its draft, then returns to Runtime access. The
sidebar remains locked during editing. The existing `c Assign or unassign
credentials` editor remains available for its broader runtime support.

Applied registration on a target with a credentials adapter opens Runtime access
before the result. Register remains one action. The step reads fresh service
status and credential status once, and lists detected Codex and Claude Code
runtimes. Applied registration can precede runtime detection. The step watches
Browser's existing service observations and shows choices as detection arrives,
without polling or another credential read. Connecting or retrying workers with
no warning show a waiting message and keep Skip available. Unknown runtimes are
not guessed; failed or unsupported observations retain reload guidance. Other
runtimes are out of scope.
Each runtime defaults to Native account and offers enabled compatible entries: OpenAI
for Codex, AWS Bedrock or Mantle for either runtime. Adding keys stays in Credentials.
Managed assignment requires a service with credentials-v1 and valid configuration.

Save and reload sends each changed binding through credentials.mutate, then
reloads this project through the existing reconcile operation. The step states
that this interrupts work started since registration. Partial saves retain the
draft and remember successful rows, so retries send only remaining changes and
retry the reload. Skip and Escape discard unsaved choices and show the result;
completed assignments and native logins are not undone.

CLI 0.123.2 groups the summary under bold Codex and Claude Code headings, each
with separate Authentication and Account rows. Account states use semantic
colors as well as text. Shared recovery guidance appears once below the groups.
The Actions heading separates controls from status. Remove generic explanatory
paragraphs from this summary; sign-in impact remains in its confirmation. Show
the fixed save/reload warning only when a draft or pending reload exists. Details
scroll with PageUp/PageDown when needed; hide the scroll counter when all fit.
Errors have their own Attention heading and do not recolor the runtime groups.

Native choices show the runtime's account report on opening, after returning from
login and on Refresh. Show Checking account, Signed in, Signed in with ChatGPT/API
key, Signed in as an account address when provided, Not signed in, or Couldn't
check account. Unknown commands, timeouts and failures never imply signed out.
These reports describe runtime authentication, not subscription validity or quota.
The check runs inside the registered project's private environment, never the host.
No polling, secret-file parsing or new service subscription is used.

Authentication selection is labeled separately from Sign in to Codex/Claude Code.
Hide a native selector when there are no enabled compatible alternatives. Keep a
selector for saved or drafted managed assignments so the user can return to native.
Signed-in runtimes offer Sign in again. The existing action confirms pause, runs
login in the private shell, reloads, and waits for online. Its result returns to
the retained access draft. Browser owns the completed registration and access
state across terminal unmount/remount. Login is not offered for a saved managed
binding. No API keys are collected in this step.

If registration was not applied, show "Start the service, then assign credentials
from project Actions" instead. Access read failures offer Refresh and Skip without
repeating registration. The sidebar stays locked until the form completes. Target and save impact stay
visible; PageUp/PageDown scroll wrapped help and errors. Small panels require
resize if the target, impact and controls cannot fit.

Cost: one service status request and one credential-status adapter read when this
step opens, remounts after login, or Refresh runs. CLI 0.123.0 adds one target account request with at most two bounded sandbox processes, one per installed supported runtime. No new Convex queries or subscriptions. Save sends up
to two credential mutations and one reconcile plus status request. Login reuses
the existing status checks, pause/reload and bounded online polling. Reconnection
uses the Browser's existing subscription if its service connection was lost.

UI implementation lives in `tui/onboarding`, exported through its index. Its wiring
is the Connection adapter, Browser lock/completion and App shortcut/mount. Project
and setup operations remain in their owning modules; the headless service has no
Ink dependency. Managed targets need the updated CLI for guided-result support.
The host mounts the popup above the browser and disables background input handlers.
Result dialogs retain scrolling. Popup widths are bounded; small terminals show a
resize notice and block submission while preserving form state.

### Verification and request cost

Tests cover creation identity retention, uncertain mutation outcomes, saved-key
reuse after reconciliation failure, discovery/access errors, masked input,
linking with overrides, cancel/back, confirmation resize and Docker stdin/result
handling. A real PTY fixture records create, failed preparation, retry using the
same ID, narrow resize and terminal restoration. The fixture uses simulated
backend/registration responses. Actual Docker isolation, remote creation and
real run observation still require the acceptance environment.

Opening the form makes no backend call. Loading choices makes two one-shot
HTTP queries, listAccessible and listForUser. Submission repeats
the existing authoritative project-add checks on the target. It adds no backend
function, schema, subscription, scheduled work or background polling. The guided
path adds a local config save before the existing service request. Closing after
success reconnects the existing service subscription and resumes ordinary Runs
paging. Full registration costs depend on link versus create and whether a saved
worker key is reusable; no per-field or per-keystroke queries run.

### Review corrections, CLI 0.101.1

Choice discovery has a 15-second HTTP deadline. Escape, unmount and failure of
either query abort pending discovery requests. A failed link stays editable and
allows returning to project selection; only confirmed creation retains an ID.
Failures before launching registration are safe to retry. Errors after starting
registration remain uncertain unless the target returns a structured result.

Clone mode requires a nonblank URL. Renaming a new project updates untouched alias,
profile name/key and directory defaults; explicit overrides persist. Fields put
values on separate wrapped rows and keep the focused value visible. Results reuse
the scrollable dialog so retained IDs and recovery instructions remain reachable.
Static diagnostic reasons explain path, profile conflict, workspace overlap,
unavailable project, key scope, clone mismatch and unavailable environment errors.
Shared path validation preserves absolute direct-child paths; strict JSON output
parsing remains unchanged. No extra diagnostic log is introduced.

### Registration traffic and database reads

These are source-level counts for a successful attempt, excluding worker startup,
transport retries and normal Runs polling. Q means one Convex query request; M
means one mutation request. Each request can read multiple database documents.

| Flow | Registration | Including one choice load |
| --- | --- | --- |
| Link with a project-scoped key | 2 Q, 0 M | 4 Q, 0 M |
| Link with a broad setup key | 4 + k Q, 0–1 M | 6 + k Q, 0–1 M |
| Fresh creation | 6 Q, 2 M | 8 Q, 2 M |

k is the number of saved matching keys checked for reuse. Broad-key linking
mints a key only if none is reusable. Fresh creation normally has no reuse
candidates. Relative to local one-shot project add, the form adds two catalog
queries; the existing interactive managed flow already loads projects and, for
creation, organizations. Review corrections add no requests. Within-form retries
reuse loaded choices, and confirmed creation retries use the link path.

100 choice loads make 200 query requests, with no continuing subscription or
per-keystroke traffic. Both catalog queries repeat authentication and organization
membership/organization reads. listAccessible also reads project memberships and
active projects in the searched organizations before filtering permissions. These
use existing membership and organization/deleted-project indexes, but collect
whole result sets: cost grows with memberships and projects, not visible rows.
Large accounts can therefore make discovery expensive despite its fixed request
count. No pagination or storage redesign is included without runtime evidence.

Registration repeats authoritative catalog and key-scope checks. Key reuse probes
read the candidate key and authorization records. Creation writes the project,
default Inbox list and project-admin membership and updates the default-list link.
Key issuance reads existing user keys, may prune expired automated keys, and
inserts a worker key. Existing authentication bookkeeping may also write. These
are existing mutations, with their existing subscriber invalidations and
contention; no new shared counters, subscriptions or writes are added by the fixes.
Saving configuration before reconciliation writes locally, not to Convex.

Pending application now opens Actions without reconnecting or starting Runs reads.
Applied success resumes existing Runs polling, up to 12 queries/minute/client.
No production latency measurement was available; query counts do not predict
elapsed time or exact billed document reads.

The compatibility check adds one Docker exec and Node startup per managed guided
registration attempt, including retries. It adds zero DB reads/writes or backend
HTTP calls. Compatible attempts still perform their existing allow-domain and
registration commands afterward; incompatible attempts stop before either.
No production startup-latency measurement is available. Updating the host does
not update installed container packages. For a local checkout, pack the CLI and
run environment update with --package and --interrupt when interruption is safe.

### Saved profile names in the sidebar

CLI 0.102.4 shows saved display names as Name (key), such as Isolation Project B
(ipb). The target service reads the name from its saved TOML profile and includes
optional displayName metadata in existing status/snapshot responses. The name is
bounded to 50 Unicode code points. It is separate from worker launch configuration,
so changing only the saved name and reconciling updates status without restarting
the worker. Navigation and mutations continue to use the profile key. Missing,
blank or key-identical names render as the key alone, including older targets.
Names are sanitized for terminal output and long rows retain existing truncation.
This uses no extra requests or database reads. Host and target must support the
new metadata to show names. Renaming a project in Convoy does not automatically
rename an existing TOML profile.

CLI 0.102.5 separates All projects and + Add project from the profile list with
a dim horizontal divider. It appears only when expanded profiles exist, takes
one row in sidebar scrolling, and cannot receive keyboard focus.

## Environment creation and maintenance, CLI 0.103.0

OS-2064 adds E for Add environment and e for Environment Actions. Actions also
includes Environment lifecycle / update. The centered popup retains the browser
behind it and locks target navigation. Creation asks for a managed environment
name, optional Convex deployment slug and comma-separated allowed domains. Review
shows the exact name, host release and network settings. Cancel performs no
provisioning. Confirm reuses runEnvironment, including saved ownership, volumes,
network configuration checks, locking and recovery. Successful creation selects
that environment and connects; + opens the existing project onboarding flow.
Failures retain the form for retry. Existing one-shot commands keep their behavior.

Environment Actions provides status, start/recover, stop, restart service and Update
remote. CLI 0.110.0 removes the Codex/Claude Code boundary verification actions:
runtimes are detected at launch
([cli-project-isolation.md](cli-project-isolation.md#runtime-detection-and-login-cli-01100)).
Mutations require a full,
visible confirmation, defaulting to Cancel. The confirmation names the target and
impact on shared connections and active work. Small terminals require resize;
Escape can cancel before execution. Execution cannot be dismissed until its result;
Ctrl+C still detaches, which does not undo work already sent. Progress retains only
eight recent chunks of at most 2,048 characters each. Results are scrollable.
Failures explain status inspection and Start recovery; no success is inferred from
an interrupted request. Since CLI 0.123.6 a failed result leads with a red `✗ <operation>
failed: <reason>` line and drops the Working line; progress and recovery guidance
follow. A failed creation points to Back and Create / Resume instead of Start. Saved service logs remain accessible through Actions when
the container is running.

The host checks the installed target setup schema when opening Add project, before
asking for credentials or making discovery calls. Unsupported targets show Remote
update required and Update remote when the transport supports maintenance. Probe
errors show support as unknown. A compatible target with a different version can
continue. The existing registration-time probe remains authoritative if the target
changes while the form is open.

Update remote resolves the exact running host release from npm with a 15-second
lookup deadline. Only stable published host releases are offered. It rejects
newer targets rather than downgrading them; unpublished releases and network errors
show retry guidance without an install button. After confirmation it checks the
installed version and npm availability again under the environment lock, then uses
the existing exact-version installation, restart, readiness and rollback controller.
No local archive is used by the TUI. Success requires a running service reporting
the proposed release. Saved version metadata and displayed service version come
from actual target results and the reconnect hello.

The project form stays mounted while the update dialog runs. Fields, selected
project and credential remain only in client memory. Updating never registers a
project or persists the form's credential. Closing the update result rechecks target
support and restores the form; registration requires an explicit submission.
Closing the project form discards its credential.

Only saved managed Docker targets expose environment maintenance. The local Unix
connection retains its existing service controls. Saved SSH remotes
([cli-remote.md](cli-remote.md)) browse through the same client and offer start,
saved logs and project shell, without maintenance. No Docker operation is applied
to an arbitrary remote host.

The UI module is tui/environments, with its index as the entry point. Thin wiring
is the App shortcut/mount, Actions entry, Browser lock/selection/reconnect methods,
Connection adapter and Onboarding compatibility notice. Docker, schema probes,
npm resolution and lifecycle operations stay in commands/environment. No service
module imports Ink.

Automated coverage uses simulated controller/npm responses and rendered terminal
input for release failure, cancellation, exact updates, retained forms, unsupported
transports and resize. Real Docker creation, failure recovery, runtime acceptance,
project registration and actual work observation require an external Docker host.

### Review fixes, CLI 0.103.1

Add environment resolves create versus resume before confirmation. Blank optional
network fields keep saved settings; conflicting nonblank settings still fail.
An existing target shows its inspected installed release, or the saved selected
release when stopped or not yet created. Resuming a retained container makes no
npm lookup and never upgrades it. Creating or rebuilding checks the release that
will be installed. The host rechecks ownership, selected version and whether an
installation is required inside the existing lifecycle lock; changes require a
new confirmation.

Update confirmation carries the installed and proposed versions from the existing
status check, even if browsing was incompatible and its cached version is unknown.
Failed support checks offer Retry and, on managed targets, Start. Both retain the
mounted project form; Start uses the existing confirmation and recovery path.
Successful retry never submits registration automatically.

Failed operations retain the bounded recent diagnostic progress alongside the
final error and recovery instructions. Ctrl+C still restores the terminal; if an
environment operation is pending, the host prints that it is finishing before exit.
It does not create a detached job or interrupt the installation. Unsupported
transports show an unavailable hint and cannot open the environment operation menu.
Switching to a created or resumed environment resets the old connection to unknown.

Terminal shortcuts remain in the CLI UI and CLI documentation only. The web
shortcuts dialog does not describe keys for independently versioned CLI releases.

## Unified interactions, CLI 0.103.2

OS-2064's accepted [TUI guidelines](../../apps/cli/TUI-UX-GUIDELINES.md) also apply to older project, shell and log flows. The sidebar is Environments with a permanent + Add environment entry. Enter/Space activates it; selecting it does not create resources. Each environment retains All projects, + Add project and registered projects. At narrow widths the focused pane uses the screen; forms use the content pane and the header retains the target.

Environment selection offers Details/Actions, project selection Runs/Actions, and All projects Runs. Environment Actions directly lists service start/stop and saved logs; managed targets also offer restart, exact npm update, boundary probes and container start/stop. There is no separate e menu. Project Actions only lists pause/reload, shell and registration removal. Run cancellation is beside the selected execution in history and retains its existing target/client preflight checks. Action results stay in the panel; short interruption confirmations remain bounded popups with named affirmative buttons and Cancel selected.

E accelerates the visible Add environment row. a opens the applicable Actions tab. Environment actions use l saved logs, b start service, x stop service, t restart, u update, v/w boundary probes, g start/recover container and z stop container. Project action keys remain p/u/h/v. c cancels the selected execution in history. e remains export only inside run logs. s inspects status in environment Details; f retries connection or refreshes the current run page. Terminal keys are not listed in the web shortcuts dialog.

Details separates connection health from inspected service/container state. Missing observations show one explanation rather than invented zero activity and repeated unknown diagnostic fields. Errors and retry guidance appear in the main panel. Unmanaged targets explain their lifecycle limits there. Unavailable action rows expose a reason on focus without attempting the operation. A known stopped container points to Start environment, and a failed management check points to Inspect status. All existing ownership, locking and execution-time validation remain authoritative.

Multi-field environment and project setup render in the right panel. Review has one explicit Create/Resume, Register or Update button. Progress, diagnostics, results and retry remain in that panel. Back retains fields; canceling a nonempty draft requires discard confirmation. Credentials remain masked and are cleared on discard or successful registration. Compatibility repair retains the mounted project form, returns after a support probe and never auto-submits registration. Narrow forms page their inputs and retain focus through resize. Confirmation requires the full target and impact to fit.

Saved service logs and run logs remain panel viewers. Export asks for a path in a compact dialog. Submitting a new destination exports immediately; an existing destination requires overwrite confirmation. Export progress and outcomes stay in the panel, including retained partial-file information. Shell input and terminal restoration retain the existing handoff implementation; reload after exit remains explicit.

### Request cost

Layout, scope filtering, drafts and shortcuts add no DB queries, subscriptions or polling. Explicit s inspection reuses one service status RPC for local targets, or one existing managed status adapter call. Managed status executes Docker info/list/inspect and, for a running container, the target status helper: four Docker commands for a running container, three for a stopped retained container, two for an absent container. This is the same work as the former environment status menu action. It is never triggered by rendering or switching tabs.

Creation, update, project registration and shell execution retain their existing controllers and preflight calls. Stopping a container records the returned stopped state without adding an immediate reconnect call. The existing connection retry timer still operates after disconnection. New-file export removes a UI confirmation, not a data read; bounded log pagination and export requests are unchanged. Opening Add project still probes setup support; returning from repair probes again. Project choice loading remains two explicit catalog queries.

### Verification

Regression coverage checks sidebar activation, scoped action lists, inline errors, managed status inspection, stopped-target gating, retained drafts, post-creation selection and unknown activity. Renderer and real PTY suites cover resize, exact update confirmation, shell handoff, detach, export and retained onboarding repair. Use the manual walkthrough in the TUI guidelines for connected, local/unmanaged, disconnected, setup and failure states. Simulated PTY tests do not replace real Docker/provider acceptance.

## Explicit Internet access, CLI 0.104.0

Environment setup now offers Unrestricted and Restricted Internet access, shows
allowlist fields only for Restricted, and repeats the policy in review.
Cancel and Review share a horizontal row with Left/Right navigation.
The persistence, legacy compatibility and traffic contract is in
[CLI environments](cli-environments.md#explicit-internet-access-cli-01040).

## Design palette, CLI 0.105.0

The production terminal now uses the visual design from the
[playground prototype](playground-convoy-tui.md). Interaction rules above are unchanged.

Colour depends on what the terminal reports through chalk (`COLORTERM`, `TERM`,
`FORCE_COLOR`). Truecolor terminals get the prototype palette: base `#151719`,
chrome `#1b1f22`, footer `#20262a`, accent `#9cc9db`, active selection `#34515f`,
inactive selection `#202a2f`, plus the prototype's state colours. 256-colour terminals
get hand-picked xterm equivalents. Automatic down-sampling would turn the dark greys
into `#5f5f5f`. 16-colour terminals keep named ANSI colours and the terminal's own
background.

Panes are separated by background fills, not box-drawing borders. Many terminals draw
`─` and `│` from the font, with gaps between cells, so a border reads as a dotted line.
The sidebar and header share the chrome colour, the content pane uses the base colour,
and group dividers are blank rows. Only floating confirmation popups keep a rounded
border.

The header has two rows. The first shows `convoy`, the target and transport, and the
client and service versions. The second shows the service endpoint and, once observed,
the registered project count. The sidebar is headed ENVIRONMENTS. The content pane opens
with a tab strip, where the selected tab is filled, and ends with one row of context
keys. A one-row footer shows connection health, target and activity.

The runs table has THREAD / TASK (RUN · NEWEST FIRST in history), PROJECT, STATE and
UPDATED (ELAPSED in history) columns. Each row takes two lines. In the thread list the first
column shows the task label and thread ID, then the title. Execution history lists the runs
of one thread, one per assistant reply. Repeating the thread title on every run made two
replies look like a duplicated thread, so history shows the task label and title once in
its toolbar. Each run row shows its start time, then its run ID. PROJECT shows the project key and runtime. STATE shows
a symbol and the raw status: ● running, ? waiting for input or review, ○ pending or
claimed, ✓ completed, ! failed, ■ cancelled, · anything else. UPDATED is the time since
the thread's last activity. ELAPSED is a run's duration, counted to now while it streams.
Below 76 content columns the PROJECT and time columns are hidden. Below 10 content rows
the headings and spacing between rows are dropped.

### Request cost

Presentation only. Requests, polling, subscriptions and page sizes are unchanged. Row ages
are recomputed when the page re-renders, with no extra timer.

### Verification

The main renderer test runs in both 16-colour and truecolor modes. In truecolor it checks
the painted background, that browse views contain no box-drawing characters, and that the
selection fills the whole sidebar row. Other renderer and PTY suites assert columns by
position instead of splitting on borders.

## Lifecycle recovery, CLI 0.106.0

Failed provisioning synchronizes retained environments into the sidebar immediately.
An unpublished release fails before a record is saved. Stop progress/results remain
in its confirmation popup. Delete environment is a managed Actions control with an
explicit permanent-data confirmation, popup progress/result, and immediate sidebar
removal on success. See [lifecycle behavior](cli-environments.md#failed-creation-stopping-and-deletion-cli-01060).

## Runtime credentials, CLI 0.107.0

OS-2065 adds a Credentials tab to environment selection, opened with c. The playground
uses k, but k is the vim up key in this terminal. The tab manages the environment's
[managed credential store](cli-provider-keys.md#managed-openai-keys-for-isolated-codex-os-2015)
through the existing `credentials.mutate` service operation. Ordinary profile keys
(`[keys.*]`, `provider_key`) are not shown or changed here; `convoy keys` and the
desktop settings keep managing them.

Managed Docker targets and, since CLI 0.113.0, SSH remotes offer it
([cli-remote.md](cli-remote.md#guided-add-project-and-credentials-cli-01130-os-2158)).
Local offers it when the TUI runs in a Linux project environment; another user there sees the status read fail, with f Retry. Other Local
hosts explain why and point to `convoy keys`. Changes need a live connection whose service advertises
`credentials-v1`; otherwise the panel names Update CLI.

The entry list shows each name, enabled state, saved assignment count, current
revision, provider (OpenAI, Anthropic, AWS Bedrock / Mantle with its Region, or
Cursor account key) and API key auth. A Cursor entry omits "API key"; it bills
its Cursor account (OS-2017). The selected entry lists its assignments with their delivery. Key values are
never rendered, and the status read carries none.

Operations on the selected entry:

- n or + Add credential opens a form in the panel: name, provider, Region for AWS
  (empty means us-east-1) and a masked API key, then a review with Add credential.
  The provider row lists every choice when they fit the panel; otherwise it shows
  only the selected one as `◂ (●) <label> ▸  N of M`, so no choice is cut off. On Docker, an AWS key
  first opens its Region endpoint with the existing allow-domain helper. On Local the
  review reminds the operator to allowlist that host.
- o Rotate is a compact popup with a masked field. It names the affected assignments
  and says rotation re-enables a disabled entry.
- b Roll back selects the newest retained revision older than the current one;
  repeat to go further back. Enabled state is unchanged.
- x Disable names the affected assignments and says keys already delivered are not
  revoked at the provider.
- Delete removes an entry with every revision after a confirmation. An assigned
  entry is refused in the panel with the projects to unassign first. The service
  refuses while a lease it cannot account for is active (cli-provider-keys.md).

Enter opens a checklist with one row per registered project and supported runtime:
Codex for OpenAI keys, Claude Code for Anthropic keys, Codex and Claude Code for
Mantle/Bedrock keys, Cursor for Cursor keys. Space toggles
the draft. A row whose runtime uses another key shows `replaces <name>`. Unchecking
a saved row unassigns it, which disables that runtime as `keys unassign` does. A
disabled entry cannot gain assignments. Save changes sends one bind per changed
row, in order. On a failure it stops, reports how many rows were saved and keeps the
rest in the draft. Discard restores the saved bindings.

Project Actions adds c Assign or unassign credentials. It opens the selected project's
editor with one row per runtime. Enter or Space opens a dropdown, as in onboarding,
listing native login, each compatible enabled entry, then unassigned (runtime
disabled). ↑/↓ moves, Enter chooses into the draft and Esc or Tab closes it. It shares the draft, save and leave prompt
with the checklist. The editor has a Codex, a Claude Code and a Cursor row. Saving
native login opens that runtime's login action
([Runtime login](#runtime-login-cli-01100)). Cursor has no TUI login action, so
saving its native login shows "Native login: run convoy project login <profile>
--runtime cursor in a terminal." instead. Native subscription login is never copied
between projects. OpenCode keys (OS-2018) bind one key per provider slot, which
these single-binding rows cannot show, so the panel lists no OpenCode rows;
`convoy keys` manages them.

While a checklist, editor, form or popup is open, the sidebar, tabs and q are locked.
Esc on a dirty draft asks Keep editing (selected), Discard and continue, or Save and
continue. Below 45×12 the panel asks for a resize. The draft, the add form and popups
keep their input, and only Esc works until the terminal is large enough again.

Delivery comes from `keys status`, per runtime. A failed or blocked worker shows its
connection state and an unobserved worker shows applied unknown. Otherwise a row is
applied when the worker's applied descriptor for that runtime equals the desired one,
or pending reconnect: u Reload project applies it, and running agents are not
restarted. u works in the list, the checklist and the project editor: it asks to
reload the pending projects of the selected key or editor, or asks to save or discard
a dirty draft first. Every save that does not hand over to a native login ends in the
same popup, `Saved N changes for <projects>.`, with Close (selected) and Reload
project (`Reload N projects` for several). Reload sends an interrupting reconcile per
project, keeps the panel open, rereads status and reports the request; Close leaves
the rows pending. The service records authentication results for Codex only, so only Codex
rows show `failed: <result>` or request succeeded. A save never claims application.

The list panel stacks a header, notices, keys, the selected key's assignments and key
hints, one blank line apart. Notices sit under the header: errors marked ✗ in the danger
color, results ✓ in the success color, refusals ! in the warning color, progress in the
accent color.

A failed status read stays in the panel with f Retry; on this tab f rereads status
and does not touch the service connection, which reconnects by itself. A service rejection keeps the
draft and shows its reason as the dialog's first line, marked ✗ in the danger color. The
service passes credential refusals (`Managed …`, `Claude Code needs …`, `Codex needs …`, `Cursor needs …`) and
key-store or registry failures (`Unsafe credential directory: <path> …`) through verbatim; other exception text stays generic. A lost response reports an unknown outcome and asks for a refresh before
retrying.

The module is `tui/credentials`; its index exports `Credentials`. Wiring is
`BrowseState.credentials`, the Browser's show/edit/mutate methods, the App tab, key
and mount, one project Actions row and the `Connection.credentials` adapter. Status
reuses `localManagedStatus` from `keys` and `targetCommands.credentialStatus`; SSH
remotes run `convoy keys status --json` through `remoteTarget`.

### Request cost

This adds no Convex calls, subscriptions or polling. One status read happens when the
tab or editor opens, on f, and after each change or save batch. Local reads the store
and config files and sends one status request to the local service. Docker runs the
three existing container checks (daemon info, list, inspect), then one `docker exec`
of `convoy keys status --json`, which does the Local work inside the container. An
SSH remote opens one SSH connection for the same command.

Each saved row and each entry operation sends one `credentials.mutate` on the existing
connection. The service writes the store under its config and credential locks, then
runs its in-memory reconciliation, which marks changed workers pending. A Docker AWS
add first runs the allow-domain helper under the environment lock. Run-page polling
stays paused while the panel is open, as it does for Actions.

### Verification

Unit tests cover row derivation, choices, bind requests, replacement notes, rollback
and delivery, and the Browser's tab rules, mutation errors, project removal and paused
paging. Renderer scenarios cover an unsupported host, a status failure with retry,
checklist save and replacement, the leave prompt, rejection, resize with a draft and
with open forms, an entry that disappears while edited, masked add with the AWS allowlist, rotation, rollback and disable, and the project
editor's native login. The PTY recording drives the production render loop through a
checklist save, resize, masked rotation and terminal restoration, and checks that the
key never reaches the terminal. Real provider keys, agent runs and the Docker allowlist
need a configured environment.

## Project warnings, CLI 0.109.0

Each project in service status may carry a service-written `warning` for its latest
failed attempt (see [cli-service.md](cli-service.md#worker-failure-reasons)). A
project is unhealthy when it has a warning or is `failed`, `blocked` or `retrying`.

- The sidebar shows `! <status>` after an unhealthy project's name. CLI 0.132.0
  replaces it with a status dot, see [Environment row layout](#environment-row-layout-cli-01320).
- A project's own view lists only that project.
- CLI 0.123.3 uses one shared Project notices section on Runs, project Actions,
  environment Details/Actions and the environment Credentials list. Each project
  has a bold name, a muted worker status and a short warning row. Pure native-login
  notices group runtime names under Needs sign-in; unknown or mixed warnings keep
  their first sentence as a preview. These remain service notices, not fresh
  account checks.
- At most two projects appear in the summary, or one below 28 terminal rows.
  Additional projects have an explicit count. Long preview rows use an ellipsis.
  The `w` shortcut opens Warning details with every scoped warning and recovery
  command, split into readable paragraphs. Up/Down and PageUp/PageDown scroll;
  Back/Escape returns to the same view without changing selection or taking action.
- The details view owns input while open. Creation workflows and credential editing
  hide the shared banner so `w` remains ordinary text input. Environment toolbars
  and unrelated context lines are hidden while reading warning details.

This uses the status the TUI already receives, with no request, poll or SSH
connection. An older service sends no warning, so the worker status remains visible
with no additional service details. Unknown warning text is retained in full in
the details view even when its preview or the project list cannot fit.

## Runtime login, CLI 0.110.0

Project Actions adds [i] Log in to Codex and [o] Log in to Claude Code, next to
[h] Private project shell. An action is unavailable when the project's status
lists the runtimes detected at its last start and that runtime is not among them.
The reason names the fix: install it root-owned, then reload. Without that list
(an older service, or a project that never started) both are offered, and the
launcher refuses an undetected runtime. The flow is the
shell's: a confirmation with the pause impact (Pause and log in when the project
is live), the same preflight, pause and verification requests, then a terminal
handoff. The handoff runs only that runtime's login (`project shell --login`)
instead of bash. After it exits, the TUI reloads the project and polls status
once a second for up to 60 seconds. It shows `Logged in to Codex. a is online.`
or the status and warning it stopped on. A failed login or launch keeps the
shell's failure guidance.

Saving "Native login" for a runtime in a project's credential editor closes the
editor and opens that runtime's login confirmation, if the action is available.
Cancel returns to the project's Actions. Otherwise, and in the key-wide editor,
the saved message names the login actions.

## Project check, CLI 0.111.0

Project Actions adds [e] Check project. It runs `project check` for the selected
project on its target: directly for the local Linux environment,
`docker exec … project check --json` for a managed environment and one SSH
command for a remote. A shared Local target runs it in-process without the
launcher (OS-2247). It is read-only, so it has no confirmation. It sends no
service request, so it still works while the service is down. The result dialog
lists one line per check, `✓`, `✗` or `-`, with the fix after a failed check.
Each run starts the launcher's boundary probes once, a few seconds of work on the
target. The backend sees one key validation (a heartbeat without a session). There
is no polling.

## Sidebar views, CLI 0.115.0

An expanded environment lists Actions, Credentials, + Add project, then its
registered projects. The environment row itself shows Details. All projects is
gone, and an absent selected project falls back to the environment's Details.
Moving the sidebar selection opens the row's view: Actions and Credentials rows
open those panels, project rows open Runs. Enter or Space on a view row focuses the
panel; Esc there returns focus to the sidebar and keeps the view. The panel title
names the view instead of tabs. d, a and c still open Details, Actions and
Credentials, also from + Add project. Project scope keeps its Runs/Actions tabs.

A project row in the selected, connected environment shows a braille spinner while
its worker reports active runs. The spinner sits in the column before the name, under
the environment's disclosure arrow, and uses frames one dot row lower so it centers on
lowercase text. Busy comes from the `activeRuns` field the service
already pushes in each changed snapshot. It adds no query, subscription or polling.
The spinner's 120 ms timer runs only while a busy row is mounted, so an idle sidebar
causes no redraws. Other environments show no spinner, because the TUI holds no
connection to them and the last value would be stale.

### Request cost

Opening the Credentials row reads credential status once, as the c tab did. Other
rows add no reads beyond the existing scope selection.

### Verification

`navigation.tsx sidebar-views` checks the row order, the animating spinner, view
selection by arrow keys, Esc back to the sidebar and Details on the environment row.

### Project loading row, CLI 0.116.0, OS-2197

Until the selected environment's first service snapshot arrives, the sidebar shows
a spinner and "Loading projects…" where its projects go. The row cannot be selected.
It goes away when the snapshot arrives or the attach fails, and the attach failure
shows its error instead.
It reuses the busy spinner and the existing snapshot, so it adds no reads.
`navigation.tsx sidebar-loading` checks the loading row before the first snapshot,
that arrow keys skip it, and that it is gone after a failed attach or a snapshot.

### Environment row layout, CLI 0.132.0

The environment row puts the transport and health dot at the sidebar's right edge,
in that order. A long name truncates before them. `app.ts` checks the alignment.

Each project row ends with a status dot in the same column. Online is success,
connecting and retrying are warning, blocked and failed are danger, stopped is muted.
An online project with a notice shows warning. Projects in an environment that is not
connected show a muted dot, since their status is stale. `navigation.tsx warnings`
checks the dot's column. Both dots keep one column of padding inside the row's fill.

At start, the TUI runs one environment status check for each managed environment it
did not select, the same check as [s] Inspect status. Each check runs `docker
inspect` and, when the container runs, one short helper exec. No bridge stays open.
The unselected environment's dot then shows green when its service runs, warning when
the check failed and muted when it is stopped or not created. Live health replaces it
once the environment is selected. SSH and the local socket have no such check, so
their dots stay unknown until selected. The checks run once per TUI start and never
poll. `workflow.test.ts` and `formatters.test.ts` cover the probe and the dot colour.

## Agent runtimes, CLI 0.124.0, OS-2236

A managed Docker environment's Actions list Agent runtimes (r) in its Maintenance
section. It opens in the Actions panel, titled Agent runtimes, while the sidebar keeps
Actions selected. Esc returns to the Actions list. A stopped container makes the
action unavailable, like the other maintenance actions. The panel shows each agent
runtime that projects can use: Claude Code, Codex, OpenCode and Cursor. While the
versions load, a blank line and then an accent-coloured line with the sidebar's
animated spinner say "Checking installed runtimes in <environment>…", followed by
what is being read. A refresh with rows already shown says "Refreshing runtime
versions…" in the same place. The selected row's background covers every cell,
including the status.
Each row shows the installed version or "not installed", the version on offer and a
status: Up to date, Update available, Not installed, Newer than offered or Version
check failed. Local and SSH targets have no Agent runtimes action, because the TUI
does not manage their host.

The offered version depends on the runtime:

| Runtime | Offered version |
| --- | --- |
| Claude Code | npm `latest` of `@anthropic-ai/claude-code` |
| Codex | npm `latest` of `@openai/codex` |
| OpenCode | The tested build, `TESTED_OPENCODE_PACKAGE` |
| Cursor | The tested build the project-isolation Dockerfile installs |

OpenCode and Cursor stay on their tested builds because managed keys depend on
them ([cli-project-isolation.md](cli-project-isolation.md)). The Runtimes panel never
offers a downgrade. A runtime newer than the offered version shows Newer than
offered and cannot be checked.

Space or Enter checks a row that is not installed or has an update. Rows without an
action have no checkbox, and checking one explains why. ↑/↓ also reach the Install /
update and Refresh buttons, because Tab switches panes. ←/→ move between the two
buttons; ← on the list returns focus to the sidebar. The Install / update button
names how many runtimes are checked; f or Refresh reads the versions again.

The button opens a compact popup that defaults to Cancel. It names the environment
and lists each checked runtime with installed → offered version. It also states the
impact: runs already using a runtime may fail while its files are replaced, and a
project starts using a newly installed runtime after Reload project or Restart
service. Cancel changes nothing.

Install runs the checked runtimes one at a time in the same popup. Each line shows
a mark: · waiting, ● installing, ✓ installed with its version, ✗ failed. The popup
shows the last eight lines of installer output under the list. A failure does not
stop the batch. When it finishes, any failure leads the popup as a red
`✗ <n> of <m> runtimes failed` line, and each failed row keeps its reason. Close
returns to the list, which reads the versions again and keeps failed runtimes
checked so you can retry them. Navigation is locked while the popup is open. Ctrl+C
still detaches, and an install already running in the container may complete.

Each install runs as root in the environment's container under the environment
lock, with umask 022, so projects trust the binary. npm runtimes install the exact
offered version with `npm install -g --prefix /usr/local`. Cursor installs the
tested tarball the project-isolation Dockerfile uses. After an install the host
reads that runtime's version again; a version that differs from the offered one is
a failure. A stopped container fails the version check with a Start environment
hint.

Versions are read with `--version` under a throwaway HOME and XDG folders. The
image's `/home/node/.config` belongs to root, and OpenCode creates its config folder
even for `--version`. Without the throwaway HOME it fails with EACCES and shows as
unknown.

The UI module is `tui/runtimes`, with its index as the only entry point. Version
reads, npm lookups and installs stay in `commands/environment`, behind two optional
methods on the environment maintenance adapter. The Browser gains the
`runtimes` state and its editing lock, like Credentials, and environment Actions
gains one control.

### Request cost

Opening Agent runtimes, f and Close after a batch each make one version read: the
container ownership check (Docker info, list and inspect), one `docker exec` that runs
each runtime's `--version`, and two npm registry lookups for the `latest` tags. The
tested builds need no lookup. Each checked runtime adds one install `docker exec` and
one `docker exec` that reads its version. Rendering, selection and checks make no
calls. No Convex query, subscription or polling is added.

### Verification

`environment/resolution.test.ts` covers version parsing, status for each runtime and
the offered versions, and runs the probe against a runtime that cannot write its HOME.
`environment/workflow.test.ts` covers the version read, a failed
npm lookup, the exact root install command and the post-install version check. `runtimes.tsx` renders the panel against a fixture
adapter, opened from Actions: `batch` checks two runtimes, moves between the
buttons with ←/→, installs both and returns to Actions with Esc. `failure` continues
past a failed install and shows the red summary and reason. `status-error` shows
the read failure and retries with f. `loading` checks that the spinner animates on
its own line. `highlight` runs in truecolor and checks that the status cell keeps the
selection background. `local` shows that a target without runtime
maintenance has no Agent runtimes action and no sidebar row. Real installs need a managed Docker environment with network access.

## Environment mode, CLI 0.127.0, OS-2242

See [shared environments](cli-shared-environments.md). Details shows `Mode:
shared (one account for all projects)` or `Mode: isolated (a Linux account per
project)` under Connection (CLI 0.134.0, OS-2249). The mode comes from the
service's status, else the target's record: Local's `environment.json`, or a
managed Docker record, where a missing mode reads as isolated. An SSH target
whose service has not reported a mode shows no line. The per-profile
`Isolation` cell is renamed `OS sandbox`, because it reports the legacy
`isolated` flag.

On a shared Local target the sidebar offers `+ Add project`, and project Actions
offer Pause, Reload, Shell, Log in to Codex/Claude Code, Check project and
Remove. Shell and the logins run without a pause or confirmation. After a
login, a notice says it applies to every project and offers [u] Reload project;
nothing restarts automatically (CLI 0.133.0, OS-2248). Credentials and Runtime
access manage the environment's own store, as on an isolated target; the native
choice reads "Native login (this account)" and restoring it offers Reload
instead of a login ([shared credentials](cli-shared-environments.md#credentials)).
Runtime login status reads `unknown` when the runtime cannot report it.

On a Linux Local target, the first Add project asks for the mode (CLI 0.140.0,
OS-2252); macOS targets are always shared and show no choice. SSH targets get
the question from `convoy remote add`, since the TUI has no Add remote (see
[shared environments](cli-shared-environments.md#choosing-the-mode-on-local-and-ssh-targets)).
The question is a Project separation panel with the same copy as below and the
buttons Shared (selected) and Isolated. Shared saves the mode and continues to
Connect to Convoy. Isolated shows the prerequisite results with Back selected;
when all pass, Install with sudo hands the terminal to the sudo prompt and the
installer, otherwise Check again reruns the checks. After the handoff, a result
panel shows the installer's output and Continue opens Connect to Convoy, or the
question again when the install failed. Add environment creates
managed Docker environments only. Since CLI 0.139.0 (OS-2251) it shows a
Project separation radio between the name and Internet access, with Shared
selected by default: "Shared: one account
and home folder for every project. Log in to GitHub, git and each runtime once.
Projects can read each other's files." and "Isolated: a separate Linux account,
sandbox and home per project. Log in per project. Needed when projects must not
see each other." Review repeats "Projects: shared account" or "Projects:
isolated accounts". Resume keeps the saved mode and refuses a different one.
While Shared is selected, a Mount folders field sits below the radio and takes
comma-separated host folders; Review lists them. Rules:
[shared Docker environments](cli-shared-environments.md#host-folder-mounts).

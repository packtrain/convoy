# Convoy terminal UI prototype

OS-1997 design review lives at `/playground/convoy-tui`, linked from `/playground`.
Ink is the chosen production renderer. This prototype is browser-only and uses
local fixtures. It neither attaches to a service nor changes real runs.
Production slice A is defined separately in [terminal browser](cli-tui.md).

Production interaction rules now follow [the accepted TUI guidelines](../../apps/cli/TUI-UX-GUIDELINES.md) and [CLI 0.103.2](cli-tui.md#unified-interactions-cli-01032). CLI 0.105.0 adopts this prototype's palette and layout ([design palette](cli-tui.md#design-palette-cli-01050)). Font sizes and 1px rules have no terminal equivalent, so production uses muted colour and background fills instead. Earlier iterations below remain prototype history; they do not override contextual scope, panel workflows or inline recovery.

## Proposed interaction

A full-width run list shows task, run identity, title, latest activity, profile,
runtime, status and elapsed time. Multiple runs for one task and unlinked runs
remain distinct. Arrow keys or j/k select; Enter opens the selected transcript;
Escape returns to the list. Selection survives returning. A click selects and a
double-click opens. Buttons provide pointer equivalents for actions.

Transcript detail replaces the list. Older history is explicit. Scrolling up
pauses follow; new sample updates show a count until f or Jump to latest resumes.
Arrow keys, PageUp/PageDown, Home/End work while the preview has focus. Sample
updates are manually triggered for repeatable design review, not timed streams.
Waiting runs direct users to the web app. No chat composer or approval flow is
proposed in this slice.

The footer shows environment, connection state, running and queued counts,
slot capacity and isolation. Token and cost displays are excluded. The TUI does
not parse or aggregate runtime usage or calculate pricing; that processing stays
on the server. Any future usage display must consume server-computed values.
Raw JSON debugging payloads remain intact, including any usage fields. All data is sample data. Reconnecting/disconnected
scenarios retain the snapshot and disable cancellation. Cancel requires explicit
confirmation naming the run and shared effect. Ctrl+C detaches only the preview;
the detached screen explains that agents continue. These keys are scoped to the
focused preview, never global browser shortcuts.

Profile cycling, empty state, narrow terminal, reset, and connection scenarios
are available for review. Narrow layout drops profile/runtime and elapsed columns;
detail retains that context. Terminal palette is deliberately fixed, independent
of the surrounding app theme, to approximate ANSI terminal rendering.

## Boundary and validation

The route mounts one export from its `prototype/index.ts`. Internal fixtures,
styles and UI stay in that folder. The only other wiring is the playground index
link. No CLI, backend, dependency or production keyboard-shortcut changes.

Validate navigation, cancellation, reconnect guards and detach by clicking
through the prototype. Run web lint and TypeScript checks. Review visually on the existing server
when available. Production terminal rendering, event subscriptions, pagination,
scroll preservation across reconnect, and multi-client acceptance remain work
for the later Ink implementation after design approval.

## Connection context and environment switching

Iteration 2 proposes one active environment. The header identifies the target,
transport and client/service versions separately. Service address and Convex
endpoints are different concepts: a Docker or SSH target hosts the service;
each registered profile points to a Convex deployment. All profiles is scoped
to the active environment. Its endpoint summary reports the number of endpoints;
a selected profile shows its URL.

The i key opens connection details: service instance, health, concurrency,
execution mode, isolation, runtime versions, profile keys/names, project IDs,
workspaces, credential presence and optional task skill installation. Credential
values and fragments are omitted. Health data in this prototype is static sample
data, marked stale during disconnection. Unknown production metrics must remain
unavailable until the service actually exposes them.

The e key opens an environment picker. Arrow keys/Enter or numbered shortcuts
switch between local Docker and remote SSH fixtures. Switching clears the old
view and pending action, changes runs/config/counts to the chosen environment,
and preserves each environment's sample run state. Work in the previous target
continues. Unselected targets are described as unattached, not assumed online.
All-environment aggregation is deferred for design discussion; this prototype
does not establish a multi-service subscription contract. Remote actions are
simulated, including connection success. No network connections are attempted.

## Raw JSON logs

Iteration 3 replaces the parsed transcript presentation with pretty-printed JSON
arrays. The view displays complete loaded sample event payloads, including nested
runtime fields, rather than extracting prose or tool summaries. Copy loaded JSON
copies exactly the displayed valid JSON array, including loaded history and new
sample events. It does not claim to export unloaded history. Select JSON supports
manual copying when the clipboard API is unavailable. Clipboard failure is shown
inline; Ctrl+C with selected preview text preserves native copy instead of
detaching. With no selection, Ctrl+C still detaches. Native Cmd+C is unchanged.

The prototype's payloads are fixtures, not a promised production event schema.
Production rendering should retain the raw event fields supplied by the service.

## Connections sidebar

Iteration 5 supersedes profile cycling and the separate environment picker.
A persistent left column groups projects under environments. Expand/collapse
reveals saved projects without connecting. Selecting All projects or a named
project changes the active target and scope. Project names are primary; connection
details retain profile keys. Left moves focus from runs to connections; Right moves it back to runs.
Up/Down moves within the focused column and Enter activates the selection.
Tab remains an alternative for switching panes. Horizontal arrows do not
change the selected project or run, and do not switch panes in setup forms,
confirmation, help, connection details, or full-width logs. The e/p keys focus connections.

Raw log detail uses the full terminal width; Escape restores the sidebar/list.
Below 850px the sidebar becomes a drawer opened by the connections control.
Selecting a project, Tab to runs, or Escape closes the drawer.

Add project offers Connect existing project and Create new project. Add environment
offers Local Docker and Remote SSH. Short sample forms add local preview entries
and select them, showing an empty run list. These are navigation demonstrations,
not authentication, provisioning, or registration. Real command-backed setup and
validation remain deferred. No API credentials are requested or stored.

## Selected-project focus

Iteration 7 makes project selection the sidebar navigation anchor. Left returns
to the selected scope, expanding its environment if necessary. Up/Down selects
the adjacent visible project scope immediately and updates the run list while
keeping focus in the sidebar. All projects participates in this navigation;
expand/add buttons remain pointer and Tab-accessible controls. Right moves to
runs without changing either selection.

Selected project fill is bright while the sidebar is active, dimmer while runs
are active. The selected run uses the inverse emphasis. Project rows and the
terminal container have no focus rectangle; their selection fill indicates
focus. Other controls retain focus outlines. Clicking a project keeps the sidebar
active. Returning to it restores the selected project rather than the first button.

## Contextual actions, iteration 9

The a shortcut and Actions button open a full-width contextual action panel.
Environment, service, selected project, selected run and credentials have separate
sections. Up/Down navigates actions, Enter activates, Escape returns one level.
Closing restores the previous pane and run selection. Existing one-shot commands
and flags remain unchanged; the proposed production entry point is convoy tui.

The browser simulates environment lifecycle/verification, service lifecycle and
past JSON logs, project pause/reload/removal/private shell, run logs/cancellation,
and credential add/assignment/rotation/disabling. Disruptive actions require an
impact confirmation. Docker maintenance is unavailable on the SSH fixture.
Service logs remain readable after simulated service stop. Shell is a static
preview with an explicit return control, never a real terminal. Credential forms
accept a sample name only, never a secret. No network or command execution occurs.
Sample results persist while the panel is open; switching context resets the
panel. Reset restores fixtures. Production delivery remains split into browsable
connections/runs, bounded raw logs, then guided management flows.

## Selectable connections, iteration 10

Connection names in the left column are selectable. Selecting one shows its
connection information in the right column with the sidebar still visible.
Separate disclosure buttons expand/collapse project lists without changing the
selection. Up/Down includes connection rows alongside All projects and individual
projects. Project selection restores the run list. Left/Right changes pane focus
without changing the selected connection; bright/dim fills apply to connection
rows too. Actions defaults to Environment for a selected connection. This replaces
the requirement to open a separate connection panel to inspect an environment.

## Connection row appearance, iteration 11

Connection selection paints the shared row, including the disclosure chevron.
Reserve the same left border width in every state. Name and transport stay inline
on one line, with overflow truncated; selecting or changing pane focus must not
change row height or shift its contents. Disclosure remains independently clickable.

Connection rows show name and transport only. Omit the redundant "active" text;
selection highlighting identifies the selected scope without implying service health.

## Connection status dots, iteration 13

A fixed-size dot follows each connection name, before its transport: green connected, amber
reconnecting, red unavailable, gray unknown. The row exposes its status in an
accessible description and hover title. The selected environment uses the current
simulated connection scenario; unobserved environments remain unknown. Empty runs
still means connected. Selection highlighting is independent of status. No real
health polling is added by this browser prototype.

## Contextual tabs, iteration 15

Keep the sidebar visible in Actions. Connection selection offers Details/Actions;
project and All projects scopes offer Runs/Actions. The a shortcut selects Actions.
Remove header Connection and Actions buttons and the separate connection overlay.
Switching targets preserves the active tab. Group actions by scope instead of
showing category tabs: connection maintenance/service controls and credentials;
project controls/credentials and selected-run controls; All projects service and
selected-run controls. Confirmation, key forms and shell preview freeze sidebar
and tab switching until completed or canceled. Left/Right moves between columns;
Up/Down navigates actions in the right column. Escape backs out of an action step
before returning to Details/Runs. Narrow layout retains the existing drawer.
All operations remain browser simulations.

## Tab shortcuts, iteration 16

Use r for Runs, d for connection Details, and a for Actions. Show the applicable
letter beside each tab label and expose it as aria-keyshortcuts. These shortcuts
work from either column and from action controls. Ignore modified keys and text
inputs, hidden tabs, confirmations, forms and shell previews. Keep Left/Right for
pane focus. This is scoped to the terminal playground, not global app shortcuts.

## Sidebar indentation, iteration 17

Keep the chevron close to its environment name: a 14px disclosure slot and 2px
label inset. Project rows have a 20px group inset and a constant transparent
selection border, placing their text slightly to the right of the environment
name without shifting when selected. Full connection-row highlight is retained.

## Row disclosure, iteration 19

Clicking the environment name, transport, status dot or chevron toggles its
children. Name-area activation also selects connection details. Up/Down selects
connection rows without toggling them; returning focus must not reopen a collapsed
selected connection. Project-list padding-left is 10px, superseding iteration 17.
Pending actions continue to disable disclosure and selection.

## Complete workflow previews, iteration 20

These decisions supersede earlier clipboard and setup mockups. Keep raw event
JSON compact, one complete event per line, without pretty printing or summaries.
Use native terminal text selection and the terminal's copy shortcut. Do not build
a clipboard integration. Selection only covers available text; complete-history
export remains separate, streams pages with bounded memory in production, and
uses JSON Lines. Its preview covers local destination, overwrite confirmation,
progress, failure, retained partial file, cancellation and retry.

Setup stays in the right panel beside a locked sidebar. Project setup includes
Convex endpoint, sample authentication, organization, existing project selection
or creation, profile name/key, generated editable project name/key defaults,
workspace reuse and optional HTTPS clone. Review precedes preparation. Failure
retains identifiers and files; retry resumes the failed step without repeating
creation. Validate names, paths, keys and duplicate registrations before review.

Environment setup previews Docker provisioning or SSH connection, runtime choice,
review and readiness checks. Update previews the target version, affected projects,
preserved volumes, replacement, reconnect and verification. Failed readiness
keeps recovery pending and offers retry or returning to inspect saved service logs.
No destructive rollback or volume deletion is implied.

Credential controls select a named entry rather than implicitly taking the newest.
Show provider/authentication, assignment, revision and disabled state. API keys
have a disabled masked placeholder in this browser prototype. Subscription login
shows a sample device URL/code, waiting, expired and denied states; runtimes without
an assumed device flow use native login in the project's private shell. These are
capability-dependent designs, not claims that all providers support every method.
Do not copy native subscription credentials between homes. API credential actions
include assignment, unassignment, rotation, supported previous-revision rollback
and disabling, with explicit target/impact confirmation.

Shell preview covers worker pause, terminal handoff, active shell, launch failure,
retry, exit, restoration and return to the same project. Reload is explicit.
In production the shell owns the terminal until exit; no TUI hotkeys may intercept
its input. Browser buttons simulate those transitions.

All operations use clearly labeled, deterministic demo controls to advance a step
or inject failure. The playground writes no files, calls no providers and runs no
commands. Mockup review precedes production work. Actual Ink selection, wrapping,
scrollback and terminal restoration still require real-terminal acceptance.

## Review corrections, iteration 21

Export is a bordered action in a labeled log toolbar, separate from the copy hint.
Adjacent terminal actions have visible spacing, including shell return/reload.

Generate each project's workspace path from the selected environment's configured
workspace root and profile key. Defaults track the key until the path is edited;
clearing the override restores generation. Explain that this is inside the target
container/VM. Fixture roots are /workspace for Docker and /srv/convoy-workspaces
for the sample VM. Environment setup selects one or more runtimes with checkboxes,
reviews the full selection and retains it in the resulting environment details.

Credentials is a top-level sidebar destination. Choose the storage environment
there and add, rotate, roll back or disable named entries. State survives switching
projects and views within this browser session. Each environment has its own sample
store; navigation does not transfer secrets between machines. Project Actions only
selects and assigns/unassigns credentials from that environment. One credential
can serve multiple projects and unassigning one preserves the others. Native login
still belongs to a project's private HOME. Production capability gates remain.

Setup takes keyboard focus on entry and each step transition. Escape moves review
to form, form to mode choice, then closes setup. During simulated operations Escape
cancels, then goes back to configuration; on completion it performs Done. Log form
and shell restoration also restore focus when controls unmount. Failed/restored
shell Escape returns to Actions; active shell input belongs to the shell, so exit
is required there. Native select Escape keeps its standard browser behavior.

## Environment credential assignments, iteration 22

Supersedes iteration 21's global Credentials destination. Select a connection in
the sidebar to see Details, Actions and Credentials tabs. Credentials belongs to
that environment; there is no second storage-environment selector. The k shortcut
opens Credentials for a selected connection. Projects retain assignment shortcuts.

Select a managed API credential to edit a checklist of this environment's projects.
Checkboxes change a draft only. Save changes commits the desired assignment set;
Discard restores saved assignments. Show which same-provider/runtime credential
will be replaced before save. Replacement removes only conflicting assignments,
preserving other projects and credentials for other providers. Context tabs and
sidebar stay locked while a draft is dirty. Back or choosing another credential
prompts Save and continue, Discard and continue, or Keep editing.

Saved desired assignments are distinct from runtime application. The preview marks
changed assignments pending reconnect and provides explicit demo controls for
applied, failed and retry. Unassignment has the same pending state. It never claims
active agents were restarted. Production must derive these states from the service.
Native subscription credentials do not offer the sharing checklist; login stays
project-local. Disabled entries cannot gain assignments, but existing assignments
can be removed. No real keys or backend mutations are introduced by the prototype.

## Assignment action alignment, iteration 23

Save changes and Discard share a horizontal flex row with centered alignment and
a 16px gap. Reset adjacent-button indentation in this group; vertical command
lists retain their existing layout.

## Button spacing scope, iteration 24

Do not apply margins to every adjacent terminal button. Vertical command lists and
stacked environment/project choices must share a left edge. Their containers own
spacing. Only inline shell controls and assignment-status controls use an explicit
adjacent-button margin; toolbars and Save/Discard use their existing flex gaps.

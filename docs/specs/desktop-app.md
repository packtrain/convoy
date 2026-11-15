# Convoy Desktop (apps/desktop)

Status: MVP scaffold (OS-1235). Parent vision: OS-1145.
UI/UX proposal: https://claude.ai/code/artifact/130ef72a-7c8e-4bdb-bc80-5d168659946c

## What it is

A tray-only desktop app (Tauri 2: Rust core + React/TS webview) that wraps the
Convoy CLI. The CLI remains the engine — connect, claim, stream, profiles.
The desktop app adds what a terminal can't: visible status, a settings GUI,
and terminal-free onboarding.

## Architecture

```
┌─ apps/desktop ────────────────────────────────┐
│  React webview (tray engine, onboarding,       │
│  settings) ── Convex subscription ─────────────┼──▶ Convex backend
│                                                │
│  Rust core: tray icon/menu, child-process      │
│  supervisor, config.toml read/write            │
└───────┬────────────────────────────────────────┘
        │ spawns / SIGTERM
        ▼
  convoy connect   (apps/cli — unchanged protocol)
```

Division of labor:

- **Webview** subscribes to Convex directly with the profile API key for all
  live state (threads, streaming status, who's driving) — the same queries the
  web app uses. Generated API types come via the `src/convex/_generated`
  symlink into `apps/web/convex/_generated` (same pattern as `apps/cli`).
- **Rust core** only supervises the `convoy connect` child processes —
  one per profile, keyed by profile key (OS-1274) — and reads/writes the shared
  `~/.config/convoy/config.toml`. No stdout parsing for UI data; structured
  status events for the tray state machine are defined by the sidecar
  contract (`docs/specs/cli-sidecar-contract.md`, OS-1236) using the OS-779
  per-profile vocabulary (`connecting / online / retrying / blocked / failed`):
  spawn `convoy connect --json`, read NDJSON from stdout, classify exit
  codes (0 = clean, 1 = respawn with backoff, 3 = replaced — do not respawn).
- **Kill switch** = graceful SIGTERM (the CLI already handles clean
  disconnect); resume = respawn.
- **Crash recovery** = the supervisor persists the PID, process-group ID,
  profile key, and process start identity for every desktop-launched
  connection in `~/.config/convoy/desktop-processes.json`. On startup it
  discards stale or PID-reused records and resumes supervising live records.
  A recovered connection is included in the normal profile and tray status
  and can be stopped without spawning a duplicate. Normal Quit still stops
  every desktop-managed connection and clears the registry; an app crash
  leaves both the process and registry available for recovery.
- **Local discovery** is independent of the registry. The supervisor scans
  the local process table for `convoy connect`, groups a wrapper and worker
  in the same process group into one logical connection, and exposes the
  result to Settings → Advanced. This includes connections started from a
  terminal or an older desktop build and never queries server session state.
  Docker/VM/remote processes are outside this local view.

`config.toml` stays the single source of truth; the CLI and the desktop app
are interchangeable front-ends over the same profile config.

## App behavior

- Tray icon plus Dock icon by default (crowded menu bars can hide the tray
  icon). The "Show Dock icon" toggle in Settings → General turns the Dock icon
  off (tray-only via `ActivationPolicy::Accessory` on macOS, applied live; the
  webview persists the preference in localStorage and re-applies it on
  startup). Note: Accessory mode also removes the app's menu-bar menu — the
  tray menu is the only entry point then.
- Clicking the Dock icon reopens the settings window (`RunEvent::Reopen`).
- Closing the settings window hides it; Quit lives in the tray menu and the
  app menu.
- Clicking the tray icon (either button) opens the **native tray menu**
  (OS-1237, below).
- The macOS app menu mirrors the tray menu actions (plus a standard Edit
  menu for copy/paste in webview inputs), so the app stays operable when the
  menu bar is too crowded to show the tray icon. Settings shortcut: Cmd+,.

## Tray menu (OS-1237)

The tray uses a NATIVE menu (NSMenu on macOS — no custom popover window).
Content is owned by the webview: `TrayEngine` (`src/tray/tray-engine.tsx`) is
a headless component in the hidden main window that holds the Convex
subscriptions and rebuilds the menu on every data change through the
`set_tray_menu` command (entry model: `item` | disabled `header` |
`separator`). Rust translates the model into a real menu; clicks on static
ids (`open-web`, `settings`, `quit`) are handled in Rust, any other id
(`toggle-agent`, `thread:<id>`) is emitted back to the webview via the
`tray-menu-action` event. A static baseline menu (Open/Settings/Quit) exists
before the webview loads.

Data comes from two authorities, matching the architecture split:

- **Server → menu**: `cli.threads.lists.listActiveForUser` (see below) with one
  `ConvexClient` per unique deployment — profiles deduped by `(url,
  api_key)`, so multiple profiles on one server cost a single websocket.
  Results merge newest-first, deduped by thread id. Config is re-read on
  window focus plus a slow 30s poll (external config.toml edits).
- **Supervisor → menu**: `running_agents` poll (15s) returns the profile keys
  with a live child; Pause Agent = graceful `stop_agent(profileKey)`, Start
  Agent = `start_agent(profileKey)` — per profile. Toggling an agent refreshes
  immediately, so the poll interval only bounds detection of a child that died
  on its own.

**Idle cost (OS-1360).** The tray engine outlives the window, so every repeating
cost here runs for the app's whole lifetime and must stay bounded:

- `running_agents`/`list_local_agents` fork `/bin/ps` and parse the entire
  system process table (plus one `lsof` per connection for the working
  directory). Scans are cached for 2.5s so concurrent polls share one fork;
  lifecycle transitions (spawn/stop/quit/startup recovery) always take a fresh
  scan, since a stale snapshot there could target the wrong PID.
- `set_tray_menu` allocates a new `NSMenu`, one `NSMenuItem` per row and a
  native `NSString` per subtitle, and the replaced tree is released through
  Tauri's deferred main-thread drop. The webview therefore only calls it when
  the rendered entry model actually differs: `loadConfig` results are compared
  structurally (it always returns a fresh object), derived thread lists are
  memoized, and the elapsed-time ticker runs only while a thread is streaming.
  A failed `set_tray_menu` clears the cached model so the next change retries.

Menu structure (ChatGPT-menubar style — no section headers; each row is one
enabled item with a gray native subtitle, `NSMenuItem.subtitle`, macOS
14.4+): one Pause/Start Agent item per config profile with
`<profile> — Connected/Stopped` as its subtitle (▶︎/⏸︎ as text glyphs with
U+FE0E — native `NativeIcon` images render too large and can't be resized;
click ids are `toggle-agent:<profileKey>`); one item per
claimed/streaming/attention thread (`REF · title — elapsed` / "starting" /
"needs attention"; clicking opens the thread at
`/o/<org>/<alias>/threads/<id>`) with the meta line as its subtitle (agent
name, folder (branch) — kept short so AppKit doesn't reserve a second,
empty wrapped line under the row); queued threads collapse into a
"N more threads queued" note ("— agents stopped" when no agent runs at all —
threads carry no local profile key, so down-detection is coarse); then
Open Convoy, Settings…; Quit. The `subtext` entry field carries the
subtitle; muda has no subtitle API, so Rust reaches through
`ns_status_item()` to the real NSMenu after `set_menu` (off macOS, or on
macOS < 14.4, the subtext folds into / drops from the label).

**Tray icon state** is driven by the same webview through the
`set_tray_status` command: title text next to the icon — `!` when a thread
needs attention or work is queued with no agent running, the running-thread
count while active, empty when idle — plus a hover tooltip
(running/idle/stopped).

**Backend**: `cli/threads/lists.listActiveForUser` (query, Clerk or API key auth)
returns the user's active threads across all projects: processingState
`streaming` + `claimed` (index
`by_user_processing_deleted_lastActivity`), queued threads
(`hasPendingUserMessages`, index `by_user_pending_deleted_lastActivity`),
plus attention threads — watch-tower status `failed` / `waiting_input`
(index `by_user_deleted_kind_watchTowerStatus_lastActivity`; container
threads are excluded by the `kind` discriminator, OS-1475) — which are idle with
no pending messages but stay in the feed until acknowledged (a quick model
error would otherwise vanish from the tray within a second); attention is
time-boxed to the last 24 h so old unacknowledged failures stay in the
Watch Tower but leave the tray,
merged newest-first, capped at 20, enriched with `location` (org slug +
project name/alias + `appUrl` — the deployment's own web-app base from
`NEXT_PUBLIC_APP_URL`, so thread deep links open the right installation when
the desktop app is connected to several servers). Threads whose project or
organization is gone or inaccessible are dropped fail-soft.

N-agent scope (OS-1274): the supervisor runs one `convoy connect` child
per profile, started/stopped individually (no "enabled" flag — with no agent
auto-start, per-profile Start/Stop *is* the enablement). Quit SIGTERMs every
desktop-managed process group in parallel under one shared grace window,
including live children recovered from a previous app crash. The normal
profile and tray controls also recognize a discovered local connection whose
`--profile` matches the configured profile, preventing duplicate starts. When
stopping by profile, one matching local connection can be stopped directly;
if several match, the user must choose the exact connection in Advanced.
Children are not auto-respawned on exit — the OS-1236 exit-code/NDJSON state
machine is still future work; each child appends to the shared daily debug log
with its profile key in the start header.

**Debug log (OS-1360).** One file per local day under
`~/.config/convoy/logs/`, appended to by every child, pruned after 7 days.
`CONVOY_CLI_DEBUG=1` — a log line per agent stream chunk — is **opt-in** via
Settings → Advanced → "Verbose agent logging" (`start_agent`'s
`verboseLogging` argument), because leaving it on unconditionally is what let
the file reach gigabytes; the start header and child stderr are written either
way. Today's file is truncated and restarted past 64 MiB, and
`read_agent_log` seeks to the last 16 KiB rather than reading the file into
memory (dropping the partial first line left by the seek). The in-app viewer
polls it every 2s while open, with one read in flight at a time.

## Notifications (OS-1240)

Native notifications (`tauri-plugin-notification`) fired by the same
`TrayEngine` that feeds the tray menu — no extra subscription. The engine
diffs each thread snapshot against the previous one; the first post-ready
snapshot only seeds the baseline so pre-existing waiting/failed threads
don't fire a burst on app start (`ready` = at least one deployment delivered
a subscription result).

Events:

- **Needs your input** — `requiresAttention` turned on with status
  `waiting_input` (also fires for threads that appear already-waiting after
  baseline, e.g. a message sent from the phone).
- **Agent run failed** — `requiresAttention` turned on with status `failed`.
- **Thread finished** — processingState left claimed/streaming without
  needing attention, including the common case where the thread drops out of
  the active list entirely.
- **Agent disconnected** — a profile key vanished from `running_agents`
  without a user-initiated stop (`stopAgent` marks expected stops in a
  module-level set; anything else means the `convoy connect` child died).
  No "restored" counterpart: agents never start themselves, so every start
  is user-visible already.

Preference: Settings → General toggle, app-local (localStorage, default on —
config.toml stays CLI-schema only); the macOS notification permission prompt
is surfaced at opt-in, and delivery is additionally gated by
`isPermissionGranted` per notification. Notification failures are swallowed —
they must never break the tray engine.

Known limitation: clicking a notification does NOT open the thread — Tauri's
notification plugin has no desktop click callback (actions are mobile-only).
Revisit if the plugin grows one.

## Settings window (OS-1239)

Shown whenever config.toml has ≥ 1 profile (first run shows onboarding
instead — see `desktop-onboarding.md`). Layout: a left sidebar nav (vertical
line-variant tabs) with four sections:

- **General** (default tab) — the **agent list** on top: one row per
  config.toml profile (name/key, "default" marker, running status chip,
  Start/Stop — one supervisor child per profile, OS-1274; the tray menu in
  OS-1237 is the persistent status surface), then "Launch at login"
  (`tauri-plugin-autostart`, LaunchAgent on macOS); "Show Dock icon" (see App
  behavior above); "Thread notifications" (default on, app-local localStorage
  pref; the macOS permission prompt fires at opt-in — see Notifications
  above, OS-1240).
- **Profiles** — one card per config.toml profile, a 1:1 GUI over the CLI
  profile schema. Editable, saved immediately on change (config.toml is the
  source of truth; the CLI reads it fresh per start): name (blur to save),
  folders add/remove (native picker; the last folder can't be removed —
  the CLI schema requires ≥ 1), `streaming` toggle, `isolated` toggle
  ("Isolate agents" — OS-sandbox to the profile's folders; the desktop
  launches `connect` without CLI flags so this profile setting is the only
  way to enable isolation for desktop-managed connections), maximum parallel
  workers (`concurrency`, integer `1-50`, effective default `5`), "Make default"
  (`settings.default_profile`; button hidden when only one profile).
  Concurrency is saved on blur/Enter after validation. Invalid input is not
  persisted. Like folders and the runtime toggles, a successful concurrency
  change restarts that profile when it is running; a stopped profile stays
  stopped.
  Read-only: server URL, project ID, API key (masked, eye-reveal). Changing
  server/project/key is a re-login: the **New profile** button re-enters the
  onboarding wizard (which gets a Cancel button on step 1 in that mode).
  `save_profile` edits existing profile tables in place so comments and
  keys the app doesn't know about survive round-trips.
  Each card also has a **Claude Code provider** select (`provider_key` —
  see `cli-provider-keys.md`), rendered with the app's styled Radix Select
  (never a native `<select>`): "This machine's Claude config" (clears the
  field — follow whatever the machine's Claude sign-in/settings say) or one
  of the entries from the API keys tab, whose option values carry a `key:`
  prefix so an entry named like the sentinel cannot collide with it; a
  hand-edited reference to a missing key renders as
  "<name> — missing key" so the fix is visible. Changing it restarts a
  running agent like the other runtime toggles.
  A second **Codex provider** select (`codex_provider_key`, OS-2105) works the
  same way, with "This machine's Codex config" as the unset option, and lists
  only Bedrock/Mantle keys that have a region. The two selects are
  independent. `set_profile_provider_key` takes a `runtime` argument
  (`claude-code` default, or `codex`), validates the key for Codex, and refuses
  isolated project profiles.
- **API keys** — one shared **Claude Code and Codex** card of model
  providers (Bedrock, Mantle, or a credential-free "Claude.ai subscription"
  entry that pins the machine's Claude sign-in over a global Bedrock/Mantle
  config; Codex can use Bedrock/Mantle entries with a region). The card lists
  `[keys.<name>]` entries (provider badge, region, masked token — "no key" for
  credential-free ones, used-by profiles with Codex users labeled
  `profile (Codex)`), has an
  inline add/edit form (name, provider select, token as a password field,
  region, required for Codex — token/region hidden for the credential-free
  provider), and delete (disabled while either runtime of any profile
  references the key — matching the CLI's `keys remove` guard). Saving an edit
  that would leave a Codex-assigned key without a region or with a non-AWS
  provider fails. Editing (pencil icon)
  replaces the row with the same form pre-filled; the name is fixed while
  editing because `save_provider_key` overwrites by name and renaming
  would orphan `provider_key` references.
- **Advanced** — a **Running local connections** inventory discovered from
  the OS process table (profile or auto-resolved status, working directory
  when available, start time, representative PID, and desktop-managed vs
  locally discovered origin), with per-connection Stop and manual Refresh;
  agent-CLI detect/install rows (`AgentsManager`, shared with onboarding step
  2); the **Verbose agent logging** toggle and the agent log tail;
  "Open config.toml" escape hatch (default editor via the opener plugin); and
  the dev-only CLI binary selector (`convoy` / `convoy-dev`). Stop
  revalidates the process identity before signalling it so stale UI data or PID
  reuse cannot target an unrelated process. The connection inventory polls every
  15s (it forks `ps` + `lsof`) and has a manual Refresh.

Rust commands added for this window: `set_default_profile`,
`set_dock_icon_visible`, `open_config_file`, `save_provider_key`,
`delete_provider_key`, `set_profile_provider_key`; `save_profile` gained
`streaming`, `isolated`, `concurrency`, and in-place editing; `load_config`
returns `keys` plus each profile's `provider_key` and `concurrency`.

## Roadmap (tickets)

| Ticket  | Scope                                                                              |
| ------- | ---------------------------------------------------------------------------------- |
| OS-1235 | Scaffold (this document's baseline)                                                |
| OS-1236 | CLI sidecar contract: `--json` status events, exit codes, graceful stop            |
| OS-1237 | Tray icon states + native tray menu (threads, driven-by, pause/resume)            |
| OS-1238 | Onboarding: browser-approve sign-in (OS-1137), project, folders                    |
| OS-1239 | Settings window: profiles GUI over config.toml                                     |
| OS-1240 | Native notifications                                                               |
| OS-1241 | Packaging, signing/notarization, auto-update, self-contained CLI sidecar binary    |
| OS-1242 | (CLI, independent) sandbox generated from profile `paths[]`                        |
| OS-1274 | N-agent supervision: one `convoy connect` child per profile                      |
| OS-1376 | Per-profile maximum parallel worker control                                        |
| OS-1360 | Idle memory/allocation churn: process-table cache, menu-rebuild gating, log tail   |

## Measuring memory (OS-1360)

A desktop session is three heaps that behave differently and must never be
summed blindly: the Rust/Tauri main process, the hidden WebView plus its WebKit
helpers (kept alive after the window closes), and one Node `convoy connect`
child per profile. Any growth claim has to name a PID.

```bash
apps/desktop/scripts/mac-memory-triage.sh [name]      # one-shot: what is actually huge, ranked
apps/desktop/scripts/desktop-memory-sample.sh 60      # CSV of this app's processes, every 60s
apps/desktop/scripts/desktop-memory-report.sh ~/convoy-memory-<stamp>.csv
```

Start with the triage script when a specific process is accused — it ranks
every process on the machine and assumes nothing about parentage, so it catches
a culprit the scoped sampler would miss.

**Scoping is the subtle part.** macOS WebKit helpers are XPC services
reparented to `launchd`, so they are *never* descendants of the app that uses
them: scoping by process tree silently drops the WebView heaps, while matching
helpers by name alone sweeps in every other WebKit app (Safari, Slack,
Electron). The sampler therefore takes the app's own tree plus helpers whose
command line carries the bundle hint (`CONVOY_BUNDLE_HINT` to override), and
reports how many helpers it could not attribute instead of guessing.

The report's first job is deciding whether there is a leak at all, because
macOS exposes three numbers that mean different things:

- **VSZ** is reserved address space. A JS engine reserves enormous ranges it
  never touches, so a huge VSZ — and the huge Activity Monitor figure that
  usually comes from it — is not by itself retention. Summing VSZ across a
  process tree compounds this: shared and reserved ranges get counted once per
  process, which is how a UI arrives at a TB-scale number for an app whose
  resident set is tens of MiB.
- **RSS** is resident pages, but it undercounts compressed ones.
- **phys_footprint** (`footprint <pid>`) is dirty + compressed pages and is the
  number a leak claim should rest on.

Only once one PID's footprint is growing is it worth attaching a profiler, and
which one depends on the PID: Instruments Allocations for the Rust process
(watch `NSMenu`/`NSMenuItem`/`NSString` persistent counts against tray
rebuilds), Web Inspector heap snapshots for `webkit-content`, and
`--heapsnapshot-signal=SIGUSR2` for a `cli-node` child. Isolate before
profiling — run with all agents stopped to separate the shell from the CLI, and
leave Advanced closed unless the log path is what's under test.

## Dev commands

```bash
pnpm desktop:dev          # tauri dev (starts vite on :1430 + Rust build)
pnpm desktop:build        # production bundle
pnpm desktop:types:check  # frontend typecheck
```

Requires the Rust toolchain. Icons under `src-tauri/icons/` are placeholders
until branded ones land with OS-1241.

# Desktop Onboarding (OS-1238)

First-launch wizard in the desktop app (`apps/desktop`). Shows when
`~/.config/convoy/config.toml` has no profiles; otherwise the window opens
on the settings window (see `desktop-app.md`, OS-1239). Settings' "New
profile" button re-enters this wizard with a Cancel button on step 1. Visual
direction: dark-first charcoal, hairline borders, quiet buttons (approved
mockup).

## Steps

### 1. Connect

- Input: **Server URL** (Convex deployment URL, same value the CLI setup asks
  for; last value remembered in localStorage).
- Primary: **Continue with browser** — the OS-1137 browser-approve flow,
  identical to `convoy login`: POST `{site}/api/cli/login/start` with a
  SHA-256 verifier hash, open `loginUrl` via the opener plugin, poll
  `{site}/api/cli/login/poll` every 2s until approved/denied/expired (15 min
  local cap). HTTP goes through `tauri-plugin-http` because these routes have
  no CORS headers; the webview cannot call them directly.
- While waiting, the device-code fallback is shown (`deviceUrl` + `userCode`
  from the start response — the code only exists after start, so it cannot be
  offered earlier).
- Secondary (behind "OR"): **Paste an API key**. Accepted as-is; validated
  implicitly when step 3 fetches projects.
- `hostname` sent to login/start is the constant `"Convoy Desktop"` (labels
  the minted key in the web app).

### 2. Install coding agents

Row per agent from the shared catalog (Claude Code `claude`, Codex `codex`,
OpenCode `opencode`, Cursor `cursor-agent`). Detection and installs run in
Rust **through the user's login shell** (`$SHELL -lc`, fallback `/bin/zsh`) —
GUI apps get a minimal PATH without homebrew/nvm otherwise.

Row lifecycle: `missing → installing → (sign-in required | failed) → ready`.

- **Install** runs the real installer (`npm install -g …` / `curl … | bash`)
  as a child process, 5-minute timeout.
- On failure: inline panel with the manual command (copyable) + numbered
  steps (Terminal → paste → sign in → Scan again). Button becomes Retry.
- On success: amber **Sign-in required** panel with the per-CLI login command
  (`codex login`, `opencode auth login`, `cursor-agent login`, `claude` first
  run). "Check again" marks the row ready — most CLIs have no reliable
  auth-status probe, so the first run surfaces auth errors instead.
- Continue requires ≥ 1 ready agent; already-detected agents count.

### 3. Project & folders

- Projects via `api.projects.core.listAccessible` (Convex WebSocket client
  with the API key — websockets are not CORS-restricted).
- Folders via the native directory picker (`tauri-plugin-dialog`), ≥ 1
  required.

### 4. Save & launch

- `save_profile` writes the standard CLI profile to config.toml via
  `toml_edit` (read-modify-write: preserves other profiles/comments; key
  slugified from the project name, `-2` suffix on collisions with a different
  project; `settings.default_profile` set if absent; 0600 perms).
- `start_agent` spawns `<bin> connect --json --profile <key>` in its own
  process group (the shell wrapper forks the CLI, so signals must target the
  group). Stop is graceful: SIGTERM to the group, 25s grace for the CLI's
  own shutdown (release claims, POST /api/agent/disconnect), then SIGKILL;
  app Quit uses the same path with a 2s grace. The real supervision state
  machine is OS-1237. If the binary is missing → "CLI missing" state with
  fix instructions and Retry. Finish hides the window (tray/Dock hint
  shown).
- **Dev CLI switch**: dev builds can pick what the supervisor spawns —
  `convoy` (published npm CLI, resolved on the login-shell PATH) or
  `convoy-dev` (runs `tsx apps/cli/bin/convoy.ts` directly from the
  source checkout the app was compiled in, via `CARGO_MANIFEST_DIR`) — via a
  selector on the connected panel (persisted in localStorage). Release
  builds always spawn `convoy`. Never spawn through an interactive shell
  (`-i`): without a controlling TTY the kernel stops it (SIGTTIN, state
  `T`), which also rules out resolving `.zshrc` aliases.
- **Debug log**: the child's stdout (NDJSON) + stderr (human logs, with
  `CONVOY_CLI_DEBUG=1`) are captured to
  `~/.config/convoy/logs/desktop-agent-YYYY-MM-DD.log` (one file per local
  day, appended with a per-start header; files older than 7 days are pruned
  on start). The connected panel has a live "Show agent log" tail of today's
  file.

## Rust commands (src-tauri)

`load_config`, `save_profile`, `detect_agents`, `install_agent`,
`start_agent`, `stop_agent`, `running_agents` — see `src-tauri/src/{config,agents,supervisor}.rs`.
Shell safety: only fixed catalog strings and the pattern-validated
(`^[a-z][a-z0-9_-]*$`) profile key are interpolated into shell commands.

## Frontend

Real shadcn setup on the **base-rhea** preset (`shadcn init --preset b27GcrRo`;
radix-ui primitives, Inter Variable via fontsource, `tw-animate-css`). The app
is dark-only: `index.html` sets `class="dark"` and the approved charcoal
tokens live on `:root` in `src/index.css` (plus custom tokens `border-strong`,
`success`, `warning`, `faint`, `code`; `--radius: 0.5625rem`).

- `src/components/ui/` — shadcn-owned components. `button`, `input`, `label`,
  `switch` carry local edits for the approved design (charcoal `default`,
  added `quiet` variant + `pill`/`block` sizes, hairline bordered input,
  stacked label, success-green checked switch — `bg-primary` is a surface
  color here); re-adding them via `shadcn add` will clobber those edits —
  re-apply.
- `src/components/` — extracted app-level building blocks shared by
  onboarding, the connected panel, and future settings surfaces:
  `drag-strip` (window drag region — every screen needs one at the top),
  `section-header` (Glyph + title + description), `status-chip` (dot+label,
  tones success/warning/destructive/muted), `status-circle` (✓/!/✕ tinted
  circle), `command-line` (copyable monospace command box), `inset-panel`
  (recessed bg-code detail panel), `agents-manager` (agent CLI
  detect/install/sign-in rows — used by onboarding step 2 and settings
  Advanced), `glyph`.
- Wizard under `src/onboarding/`; settings window under `src/settings/`; the
  headless tray engine under `src/tray/` (see `desktop-app.md`, OS-1237).

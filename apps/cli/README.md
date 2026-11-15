# Convoy CLI

CLI agent for Convoy - connects your local repository to the web app.

## Linux project environments

`convoy project add/list/remove` manages local isolated registrations. Use
`convoy project login <profile> --runtime codex` for private runtime authentication,
`convoy project check <profile>` to list failed preconditions with their fixes,
`convoy project shell <profile>` for diagnostics and
`convoy connect --profile <profile>` for foreground execution. The separate
`convoy devcontainer <parent-folder> --projects` template mounts a parent
workspace and persists per-project identities and state. The existing commands
and single-repository template remain available.

CLI 0.68.0 applies registrations to a running `convoy service start` service without
restarting other projects. `project list --json` includes live status and active
run counts. Use `project remove <profile> --yes --interrupt` to stop and unregister
one service connection. For runtime setup, `service pause <profile> --interrupt`
releases its private shell; exit the shell and use `service reload --profile
<profile> --interrupt` to reconnect. See the [service guide](../docs/content/docs/cli/project-service.mdx).

This workflow is pending real runtime and container/VM acceptance. Execution
starts disabled. See the [environment setup and acceptance guide](../../templates/project-isolation/README.md).

## Quick Start

```bash
# First time setup (interactive wizard)
convoy

# Or if already configured
convoy          # Starts agent connection directly
```

## Installation

```bash
npx @useconvoy/cli --help
```

Run once without installing:

```bash
npx @useconvoy/cli connect
```

Install globally so `convoy` is available in your terminal:

```bash
npm install -g @useconvoy/cli
convoy --help
```

Convoy is developed and tested on macOS. Linux and Windows should work but get
less testing. If something breaks on your platform, issues and pull requests are
welcome.

Windows notes:

```powershell
npx @useconvoy/cli --help
npm install -g @useconvoy/cli
convoy --help
```

`npm`/`npx` will create the platform-specific launcher automatically:
- macOS/Linux: `convoy`
- Windows: `convoy.cmd` and `convoy.ps1` (invoked as `convoy`)

Publishing is automated: bump `version` in `apps/cli/package.json` and merge to
`main`. See [docs/agents/publishing-the-cli.md](../../docs/agents/publishing-the-cli.md).

## Global Options

All commands support these global options:

```bash
--url <url>       Convex backend URL (overrides profile)
--api-key <key>   API key (overrides profile)
--profile <key>   Profile key for lookup
--project <id>    Project ID (overrides profile)
```

Options can be placed before or after the command:
```bash
convoy --profile work connect
convoy connect --profile work      # Same result
```

## Commands

### Default (no command)

Running `convoy` without a command:
- If a profile matches the current directory: starts the agent connection
- If no profile matches but profiles exist: prompts with three choices (create new, add folder to existing, connect once)
- If no profiles exist: runs the setup wizard

### `setup`

Interactive setup wizard. Guides you through:
1. Convex URL
2. API key (validated against server)
3. Project selection
4. Profile name and key
5. Workspace folder
6. Starts agent connection

```bash
convoy setup
convoy setup --url https://xxx.convex.cloud --api-key sk_user_xxx  # Prefill URL and key
convoy setup --profile work                                         # Prefill profile name
convoy setup --project proj_abc123                                  # Skip project selection
convoy setup --url https://xxx.convex.cloud --api-key sk_user_xxx --project proj_abc123 --profile-key work --profile "Work" --path .  # Fully non-interactive create-only
convoy setup --url https://xxx.convex.cloud --api-key sk_user_xxx --project proj_abc123 --profile-key work --force           # Overwrite existing key
```

`setup` becomes fully non-interactive when `--url`, `--api-key`, `--project`, and `--profile-key` are all provided. In that mode it validates inputs, writes the profile, and exits without starting `connect`.
Use `--path .` to explicitly save the current directory; if omitted in non-interactive mode, the current directory is still saved for backward compatibility.

### `connect`

Start agent connection (long-running process).

```bash
convoy connect
convoy connect --profile work
convoy connect --name "My Laptop"     # Custom connection name (defaults to hostname)
convoy connect -c 8                   # Allow up to 8 concurrent chat subprocesses
convoy connect --buffered             # Turn off live token streaming (on by default)
convoy connect --codex-exec           # Run Codex through `codex exec` instead of app-server
```

`connect` serves the runtimes detected on this machine (Claude Code, Codex, OpenCode). If none is installed, startup fails with a clear error.
Use `-c` / `--concurrency` to control max simultaneous chat subprocesses per `convoy connect` process (valid range: `1-50`). Without the flag, the resolved profile's optional `concurrency` value is used, then the default `5`.
Partial (delta) agent event streaming is on by default, so responses render token-by-token in the web app. Use `--buffered` to send whole events only (a profile can default this with `streaming = false` in `config.toml`; the flag wins).
Codex threads are served over the `codex app-server` protocol by default — this enables mid-run approval prompts and questions, read-only Plan mode, steering queued messages into a running turn, live deltas, and the context-window meter. Use `--codex-exec` to fall back to non-interactive `codex exec`. The app-server transport needs codex-cli ≥ 0.142; an older binary is detected at connect time and downgraded to `codex exec` with a warning.

#### Debug logging

Use SDK debug logs to inspect spawned command args, resume/fork behavior, and streamed frames:

```bash
CONVOY_CLI_DEBUG=1 convoy connect   # Debug logs, truncated at 400 chars
CONVOY_CLI_DEBUG=2 convoy connect   # Debug logs, full JSON output (no truncation)
```

With level `1`, you can fine-tune truncation length via `CONVOY_CLI_DEBUG_MAX_CHARS` (default: `400` chars, `0` = no truncation):

```bash
CONVOY_CLI_DEBUG=1 CONVOY_CLI_DEBUG_MAX_CHARS=0 convoy connect
```

#### Simulation mode

Use `-s` / `--stream` to replay a JSONL fixture file instead of spawning a real agent. Each line is sent to the backend with a delay, simulating a live agent session. This is useful for developing and testing the web UI without running an actual AI agent.

Record a session to replay with `claude -p "<prompt>" --output-format stream-json --verbose > session.jsonl`.

```bash
convoy connect -s session.jsonl          # Stream fixture with default 1500ms delay
convoy connect -s session.jsonl -d 500   # Custom delay (500ms between lines)
convoy connect -s session.jsonl -c 4     # Fixture mode with bounded parallel chat workers
```

During development you can use the `pnpm dev` shorthand:

```bash
pnpm dev connect -s session.jsonl -d 200
```

### `config`

Manage stored profiles.

```bash
convoy config                       # Show profile summary
convoy config list                  # List all profiles
convoy config show                  # Show resolved profile for current directory
convoy config delete <key>          # Delete a profile
convoy config default <key>         # Set default profile
```

### `paths`

Manage paths within a profile. The profile is resolved from the current directory or `--profile` flag.

```bash
convoy paths list                   # List paths for the resolved profile
convoy paths add                    # Add current directory to profile
convoy paths add /path/to/repo      # Add a specific path to profile
convoy paths remove /path/to/repo   # Remove a path from profile
```

A profile must always have at least one path. Removing the last path is not allowed.

### `status`

Show current configuration and connection status.

```bash
convoy status
convoy status --profile work
```

### `update`

Update the CLI to the latest npm version (`npm install -g @useconvoy/cli@latest`).

```bash
convoy update
```

### `projects list`

List accessible projects.

```bash
convoy projects list
convoy projects list --profile work
convoy projects list --org org_abc123
```

### `orgs list`

List accessible organizations (derived from accessible projects).

```bash
convoy orgs list
convoy orgs list --profile work
convoy orgs list --output json
```

### `task-types list`

List the task types available in the resolved project.

```bash
convoy task-types list --project WEB
convoy task-types list --project WEB --output json
```

### `profiles list`

List your CLI profiles in the resolved project, with online state, CLI version,
available runtimes, and each working path's ID. This is the server's view of your
connected machines — `paths` and `status` read local config instead.

```bash
convoy profiles list
convoy profiles list --project WEB
convoy profiles list --output json
```

### `threads`

Read and drive CLI threads. A thread group lists as one row with a child count;
pass its container ID to list the members.

```bash
convoy threads list --project WEB
convoy threads list --project WEB --include-done --limit 5
convoy threads list <containerId>

convoy threads get <threadId>
convoy threads messages <threadId> --limit 3

convoy threads create --profile-id <profileId> --path-id <pathId> \
  --cli-type claude-code --content "Review the invoice rounding"
convoy threads create --source <threadId> --content "Review my work"
convoy threads send <threadId> "Ship it"
convoy threads send <threadId> --attach ./screenshot.png
convoy threads done <threadId>
convoy threads done <threadId> --json
```

`threads messages` takes `--limit` 1-20 (default 10) and prints oldest first.
Message text is the agent's prose only — no tool calls, tool output, or
reasoning.

`threads create --source` spawns beside an existing thread — inheriting its
profile, path, and runtime — which groups the two. Pass a container ID to join an
existing group or workflow container. An empty workflow container requires
`--profile-id`, `--path-id`, and `--cli-type`. Added threads run independently
of the workflow and survive its cancellation. `--attach` takes up to 10 files per message and uploads them
before the send; a failed send discards the uploads.

`threads done` marks a thread and its group members done and read, acknowledging
current attention. It rejects running threads or groups with running members;
wait for them to finish. New activity makes the thread not done again.
JSON output is `{ "threadId": "..." }`.


### `project-agents`

Manage Project agents through direct Convex one-shot commands.

```bash
convoy project-agents list --project WEB
convoy project-agents create --project WEB --name "Reviewer" --color "#3b82f6"
convoy project-agents create --project WEB --name "Planner" --color "#8b5cf6" --automation enabled --automation-cli-type codex --automation-workspace worktree
convoy project-agents update <projectAgentId> --description "Reviews pull requests"
convoy project-agents update <projectAgentId> --clear-automation
```

### `tasks`

One-shot task commands (non-interactive, run once and exit).

Manual command catalog for this workspace:
- See `/src/docs/specs/cli-one-shot-manual-tests.md`

```bash
convoy tasks list
convoy tasks list --project WEB --org acme
convoy tasks list --status "Triage" "Plan Review"
convoy tasks list --archived --output json

convoy tasks search "billing bug"
convoy tasks search "billing bug" --project WEB --org acme --limit 5
convoy tasks search "billing bug" --archive-mode archived --status "Plan Review"
convoy tasks search "billing bug" --assignee-id user_123 --output json

convoy tasks get task_abc123
convoy tasks get task_abc123 --comments 5
convoy tasks refs WEB-12 WEB-42 --project WEB --org acme
convoy tasks refs WEB-12 WEB-42 --project WEB --comments 5

convoy tasks attach WEB-12 ./spec.pdf ./screenshot.png --project WEB
convoy tasks attachments list WEB-12 --project WEB
convoy tasks attachments download WEB-12 attachment_abc123 --output ./spec.pdf --json
convoy tasks attachments delete WEB-12 attachment_abc123 --yes
convoy task attachment list WEB-12 --project WEB            # singular aliases also work

convoy tasks artifacts list task_abc123
convoy tasks artifacts get artifact_abc123
convoy tasks artifacts create task_abc123 --name "Implementation plan" --content-file ./tmp/plan.md
convoy tasks artifacts update artifact_abc123 --name "Revised plan" --clear-run-id
convoy tasks artifacts delete artifact_abc123

convoy tasks create --name "Fix login bug" --project WEB --org acme --priority High --task-type-key bug
convoy tasks update task_abc123 --status "Plan Review" --task-type-key feature --assignee-id user_123
convoy tasks update task_abc123 --clear-due-date --unassign
convoy tasks move WEB-12 --parent WEB-42 --project WEB --org acme
convoy tasks move task_abc123 --top-level
convoy tasks move-to-list WEB-12 WEB-42 --list SPRINT-1 --project WEB
convoy tasks move-to-list task_abc123 --list BACKLOG --project WEB --json
convoy tasks comments add WEB-12 --message "Ready for review" --project WEB
convoy tasks comments add task_abc123 --message-file ./tmp/comment.md --json
convoy tasks delete task_abc123 --cascade keep_children
```

Notes:

- `--project` accepts project ID or alias.
- `--org` accepts organization ID or slug, and is used to disambiguate alias lookups.
- If `--project` is omitted, task commands use the resolved profile `project_id`.
- Status values are normalized locally but validated by the backend/project configuration.
- `--task-type-key` is passed through to the backend and validated there.
- `tasks search` uses cursor pagination with `--limit` and `--cursor`.
- `tasks move` accepts raw task IDs, bare refs, or scoped refs like `acme/WEB-12`, and computes rank server-side.
- `tasks move-to-list` resolves up to 25 task IDs/refs and moves them in one atomic backend mutation; targets accept List IDs, bare refs, or `BACKLOG`.
- `tasks comments add` creates ordinary task comments from `--message` or `--message-file`; artifact comments remain under `tasks artifacts comments`.
- `tasks attach` uploads one or more local files to a task; `tasks attachments list/download/delete` manages task file attachments.
- Multi-file `tasks attach` is best-effort: it prints uploaded attachments and failed files, then exits nonzero if any file failed.
- `task` and `attachment` are aliases for `tasks` and `attachments`.
- `tasks attachments download` uses `--output <path>` for the local file path; use `--json` for JSON output on that command.
- `tasks artifacts create` and `tasks artifacts update` support `--content` or `--content-file`; `update` also supports `--clear-content` and `--clear-run-id`.
- `tasks get` and `tasks refs` text output now includes artifact summary sections without embedding artifact markdown content.
- `tasks get` and `tasks refs` omit comments by default; pass `--comments <n>` to include the latest 1-50 comments.

### One-shot output mode

All one-shot commands support:

```bash
--output <text|json>
--json
```

Default output mode is `text`.

### `init`

Initialize MCP config and/or install Convoy skills for supported CLIs.

```bash
convoy init                                 # MCP + skill setup
convoy init mcp                             # MCP config for selected targets
convoy init skill                           # prompt target(s): claude/codex (default both)
convoy init skill --cli claude --scope user
convoy init skill --cli codex --scope project
convoy init --cli claude,codex --scope user
convoy init mcp --cli codex                 # writes only .codex/config.toml
convoy init mcp --cli claude                # writes only .mcp.json
```

`init skill` options:

- `--cli <target...>`: `claude`, `codex` (repeat or comma-separated)
- `--scope <scope>`: Skill scope (`user`, `project`)
- `--force`: overwrite existing skill files or links without prompts

`init mcp` options:

- `--cli <target...>`: MCP target(s): `claude`, `codex` (repeat/comma-separated; default both)
- `--output-dir <path>`: write config files under this directory
- `--force`: overwrite existing convoy entries without prompts

Behavior notes:

- If `--cli` is omitted, target selection is prompted with both selected by default.
- `init` uses one `--cli` selection for both MCP setup and skill setup.
- MCP file mapping: `claude` -> `.mcp.json`, `codex` -> `.codex/config.toml`.
- If Claude is selected but `claude` is unavailable, Claude is skipped and other targets continue.
- Project-scoped raw skills are stored once in `.agents/skills/convoy`.
- Project-scoped Claude raw installs link `.claude/skills/convoy` to that `.agents` copy.
- Existing skill files or links prompt before overwrite unless `--force` is passed.
- Codex install does not require a detected `codex` binary.
- If no selected target installs successfully, the command exits non-zero.

#### skills.sh alternative

`convoy init skill` uses the bundled Convoy skill files and keeps installation deterministic. If you prefer the external `skills.sh` manager, install the same skill directly:

```bash
npx skills add https://github.com/packtrain/convoy/tree/main/plugins/convoy/skills --skill convoy
```

Use `--agent claude-code` or `--agent codex` to target one client, `--global` for user-wide installation, and `--copy` if you do not want skills.sh to use its default symlink-based install.

## Configuration

### Unified Config File

All configuration is stored in a single TOML file at `~/.config/convoy/config.toml`:

```toml
[settings]
default_profile = "my-project"  # Optional fallback when no profile matches

[profiles.my-project]
name = "My Project"
url = "https://xxx.convex.cloud"
api_key = "sk_user_xxx"
project_id = "proj_abc123"
paths = ["/Users/me/my-project"]
concurrency = 8

[profiles.work]
name = "Work"
url = "https://work.convex.cloud"
api_key = "sk_user_yyy"
project_id = "proj_def456"
paths = ["/Users/me/work/frontend", "/Users/me/work/backend"]
```

### Profile Resolution

When you run the CLI, it resolves a profile in this order (highest priority first):

1. `--profile` CLI flag
2. `CONVOY_PROFILE` environment variable
3. Path match (any entry in profile's `paths` matches current directory or is ancestor)
4. `settings.default_profile` from config
5. No match (prompts to create, add folder, or connect once)

When multiple profiles match, the most specific path (longest match) wins.

### Environment Variables

```bash
CONVOY_URL         # Override Convex URL (also pre-fills `convoy setup` prompt)
CONVOY_API_KEY     # Override API key
CONVOY_PROFILE     # Specify profile key
```

Set *on* the spawned coding runtime (not read by the CLI):

```bash
CONVOY_THREAD_ID   # Convoy thread the run belongs to (all runtimes except opencode)
```

### Multiple Paths

A single profile can manage multiple directories. This is useful when you have several repos or worktrees that all belong to the same project:

```toml
[profiles.my-project]
name = "My Project"
url = "https://xxx.convex.cloud"
api_key = "sk_user_xxx"
project_id = "proj_abc123"
paths = [
  "/Users/me/my-project",
  "/Users/me/my-project-worktree",
  "/Users/me/other-repo"
]
```

All paths are synced to the backend when the agent connects. The web UI lets you select which path to use when creating a new chat.

Add or remove paths with the `paths` command:
```bash
cd /Users/me/other-repo
convoy paths add              # Adds current directory to the resolved profile
convoy paths remove /old/path # Removes a path
```

### Running from Any Directory

The CLI can run from any directory:
- If a profile matches the directory (via any path in `paths`), it uses that profile
- If no profile matches but profiles exist, you're prompted with three choices:
  - **Create new profile** — runs the setup wizard
  - **Add folder to existing profile** — adds the current directory to the selected profile's `paths`, then connects
  - **Connect once** — connects using the selected profile without saving the directory

## Development

```bash
pnpm dev                  # Run CLI (no args = setup wizard or connect)
pnpm dev setup            # Run setup command
pnpm dev config list      # Run with args
pnpm dev:watch            # Run with file watching (not for interactive prompts)
pnpm test                 # Run tests
pnpm test:once            # Run tests once
pnpm build                # Build for production
```

## Browser automation

The image preinstalls a pinned upstream `@playwright/cli` release (the Dockerfile's
`PLAYWRIGHT_CLI_VERSION` build arg), matching Chromium and OS libraries. Use
`playwright-cli` on PATH, independently of the Convoy CLI.
The configuration below selects image-installed headless Chromium and explicitly
disables its inner sandbox inside this dedicated container. Container/project
isolation and the firewall remain in force. Do not copy this sandbox setting to
an ordinary host.

```bash
playwright-cli -s=ui open --config=/usr/local/share/playwright-cli/config.json
playwright-cli -s=ui goto <url>
playwright-cli -s=ui set-color-scheme light
playwright-cli -s=ui screenshot --filename=/tmp/page-light.png
playwright-cli -s=ui set-color-scheme dark
playwright-cli -s=ui screenshot --filename=/tmp/page-dark.png
playwright-cli -s=ui close
```

Run inside the private project shell or agent when using project isolation.
Use a unique session name for concurrent work and close that session when done.
Profiles and session state belong to the invoking project; no host profile is
imported. Color preference does not override a site's saved theme. Use upstream
click and scripting commands for application-specific controls.

Browser updates require an image rebuild. Updating Convoy does not install or
update browsers. CLI 0.128.0 removes all `convoy browser` commands; rewrite old
scripts to use the upstream CLI. Existing profiles are left untouched, without
automatic migration. A managed environment's legacy browser cache volume is no
longer mounted and goes away with `environment delete`.


## Persistent project service

Inside a configured Linux project environment, run `convoy service start --background`
as the control account to start registered projects. Inspect `convoy service
status`, follow `convoy service logs --follow`, and stop with `convoy service stop`.
Closing a log viewer leaves the background service running. Foreground `convoy
service start` stops on Ctrl+C. Registration changes reconcile automatically. Logs contain normalized
operational events, not agent transcripts. See the [service walkthrough](https://docs.convoy.build/docs/cli/project-service).

Managed OpenAI keys for isolated Codex projects are available through `convoy keys`
in CLI 0.71.1. See the [provider-key guide](https://docs.convoy.build/docs/cli/provider-keys)
for assignment, rotation and the required launcher upgrade.


### Create a project from the CLI

See the [project creation and recovery guide](https://docs.convoy.build/docs/cli/isolated-projects)
for creating or attaching projects, manual setup keys, and service commands.

### Attach to a running project service

Inside the configured Linux VM or devcontainer, run `convoy attach --profile a`.
Ctrl+C detaches the viewer; agents continue. Other terminals can attach independently.
Use `convoy service runs list --profile a --json` to find execution threads, then
`service runs history <thread-id> --profile a` to find run and assistant-message IDs.
`service runs logs <thread-id> --profile a --message <message-id> --follow` follows
stored normalized events. `service runs cancel <thread-id> --profile a --run <run-id>`
stops only that selected active run. These commands require CLI 0.74.1 and matching
backend code. See the [service guide](https://docs.convoy.build/docs/cli/project-service)
for pagination, reconnect behavior and the A/B acceptance exercise.

### Managed local containers

Run these on your host with Docker running:

```bash
convoy run --environment dev --no-attach
convoy project add a --environment dev --profile-key a
convoy project login a --environment dev --runtime codex
convoy attach --environment dev
```

The host CLI provisions the environment and renders attachment output. Closing the
viewer leaves agents running. Linux volumes retain projects, credentials, logs and
CLI installations across restarts and rebuilds. Host profiles remain separate.

`convoy service stop --environment dev` stops only the service.
`convoy environment stop --environment dev` also stops its owned container.
Use `environment restart`, `environment update --version <exact-version>` or
`environment rebuild` with `--environment dev --interrupt` for those operations.
No manual Docker commands are needed. Runtime login, standalone browser checks, A/B acceptance
and recovery are covered in the [managed environment guide](https://docs.convoy.build/docs/cli/managed-environments).

Managed OpenAI keys also accept `--environment dev`. Use `keys add` with
`--provider openai --auth api-key`, then `keys use` with `--runtime codex` and
`--profile a`. The service stores the key; ordinary host profiles are untouched.

`convoy env` is an alias for `convoy environment`. Every command accepting
`--environment` also accepts `--env`, with the same defaults and requirements.

## Interactive service browser

CLI 0.95.1 adds `convoy tui` to browse an existing service. Use
`convoy tui --environment <name>` to select a saved managed Docker target.
The sidebar lists connections and projects; `d` opens Details, `r` opens Runs,
Enter opens a thread's execution history, and `q` detaches without stopping agents.

Both stdin and stdout must be interactive terminals. For scripts or redirected
output, use `convoy service status --json` or
`convoy service runs list --profile <key> --json` instead. The TUI exits with code 1
and a plain diagnostic outside a terminal. It does not start a service or update
one automatically. Incompatible services show update instructions in Details.

### Guided Add project

In `convoy tui`, select `+ Add project` below All projects and press Enter or
Space. You can also press `+` from either pane, using Shift+= on keyboards where
those characters share a key. Enter the environment's backend
HTTPS URL and a masked API key, then choose an accessible project or create one
in an accessible organization. Edit the generated alias, profile name/key and
workspace child path inside the target. The Saved deployment dropdown offers
unique URLs from connections already inspected in this browser. Press Enter or
Space to open it, use arrows and Enter to choose, or choose Enter a new URL.
The URL stays editable; changing it clears the entered API key. The dropdown
makes no extra requests and does not copy saved API keys. When no inspected URLs
are available, enter the URL manually. The centered popup has labeled inputs,
placeholders and a visible cursor. Type directly into the focused input; Tab and
Shift+Tab move between inputs and buttons. Enter activates a focused button and
does not advance from a text input. Enter or Space opens the workspace dropdown; arrows highlight an option and its explanation, Enter selects, and Escape cancels. Select
Review registration, then Register to submit.

Preparation failures keep inputs and the confirmed remote project ID for retry.
An uncertain creation or key issuance requires inspection before retrying. Remote
data and prepared files are retained when the form closes. Successful registration
opens the saved profile in Runs. Pending service application opens Actions
to start or reconcile it. Use CLI 0.101.1 or newer on both host and managed target
for the review corrections. Escape cancels choice loading; result dialogs scroll
with Up/Down to show retained IDs and recovery instructions.

Project choices are sorted by organization and then project name. Left/Right
moves between Cancel and the primary button when a button has focus. Workspace
mode uses an explained dropdown: Empty directory starts without repository
files, Reuse existing directory keeps prepared files, and Clone repository
fetches a Git repository using the HTTPS URL entered next. The Git repository
URL input shows an example such as https://github.com/owner/repo.git. The form
shows all inputs when space permits, compacts spacing before hiding fields, and
offers PageUp/PageDown scrolling with a visible field range on smaller terminals.

Managed targets must also run a CLI that supports guided setup. Updating the host
alone leaves the container's installed CLI unchanged. From `apps/cli`, update a
local development target with:

```bash
pnpm pack --out /tmp/convoy-cli.tgz
pnpm run dev environment update --environment test --package /tmp/convoy-cli.tgz --interrupt
pnpm run dev environment status --environment test
```

Replace `test` with the target name. The update interrupts that environment's
connections and active work. Reopen the TUI after updating. CLI 0.102.3 checks
compatibility before registration and retains inputs if the target needs updating.

CLI 0.102.4 displays sidebar profiles as `Name (key)`, for example
`Isolation Project B (ipb)`, using the name saved in the target's TOML profile.
Update both host and target to show names; older services retain key-only rows.
The key remains the command/navigation identifier. Convoy project renames do not
automatically change saved profile names.

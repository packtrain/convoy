# AI Agent Sandbox Dev Container

A sandboxed dev container for running AI coding agents (Claude Code, Codex, OpenCode, Cursor CLI, Antigravity CLI) against any project, with an optional outbound-network firewall.

This is the distributable version of the [Convoy](https://convoy.build) dev container. It is generic: nothing in it requires Convoy, but Convoy users get their CLI profiles and Convex backend wired in automatically when the corresponding env vars are set.

## What you get

- **Claude Code, Codex CLI, OpenCode CLI, Cursor CLI, and Antigravity CLI** installed globally from `latest` on container create (via `postCreateCommand`, so rebuilds are never stuck on a cached image layer's versions)
- **Agent auth shared with the host** — log in once on the host, the container reuses `~/.codex`, `~/.cursor`, `~/.local/share/opencode` and `~/.config/opencode`
- **Its own Convoy environment** — Convoy profiles, keys and the project service live in container volumes, not in the host's `~/.config/convoy`
- **Two network modes** — `strict` blocks all outbound traffic except a curated allowlist; `open` skips the firewall
- **Persistent shell history, Claude Code config and Antigravity sign-in** across container rebuilds (Docker volumes)
- zsh + powerlevel10k, fzf, git-delta, gh, jq, corepack (pnpm/yarn via project pin)

## Install

### With the Convoy CLI

```bash
cd your-project
npx @useconvoy/cli devcontainer
```

This writes the template into `./.devcontainer/`. It fetches the latest version from GitHub when reachable and otherwise uses the copy bundled with the CLI. Use `--force` to overwrite an existing `.devcontainer/`.

### Manually

Copy the four files from this directory (`devcontainer.json`, `Dockerfile`, `init-firewall.sh`, `README.md`) into a `.devcontainer/` folder at the root of your project.

## Quick start

1. Set any env vars you need on your **host** (see below)
2. Open the project in VS Code (or Cursor) with the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)
3. Run **Dev Containers: Reopen in Container** from the command palette
4. Inside the container, run `claude`, `codex`, `opencode`, `cursor-agent`, or `agy`

## Environment variables

Everything is optional. The container pulls values from your host environment via `${localEnv:...}`; nothing is committed to the repo.

| Variable | Default | Description |
|---|---|---|
| `DEVCONTAINER_NETWORK_MODE` | `strict` | `strict` enables the outbound firewall, `open` skips it |
| `DEVCONTAINER_EXTRA_ALLOWED_DOMAINS` | (unset) | Extra domains for the strict-mode allowlist, comma or space separated (e.g. `api.myservice.com, cdn.myservice.com`) |
| `AWS_BEARER_TOKEN_BEDROCK` | (unset) | Set to use Claude Code via AWS Bedrock |
| `CLAUDE_CODE_USE_BEDROCK` | (unset) | Set to `1` to route Claude Code through Bedrock |
| `AWS_REGION` | `us-east-1` | AWS region for the Bedrock firewall allowlist entry |
| `CONVEX_DEPLOYMENT` | (unset) | Convoy/Convex deployment slug — adds `$CONVEX_DEPLOYMENT.convex.site` and `.convex.cloud` to the allowlist. In strict mode, set it before the first `convoy setup` in a new container |

Export them in your shell profile (`~/.zshrc` / `~/.bashrc`) **before** the container starts, then rebuild.

## Network modes

### `strict` (default)

Runs `init-firewall.sh` on container startup. All outbound traffic is blocked except:

- **GitHub** — git operations and API (GitHub meta API ranges, with a DNS fallback)
- **npm registry** — `registry.npmjs.org`
- **Anthropic** — `api.anthropic.com`, `claude.ai`, `claude.com`, `platform.claude.com` (sign-in plus OAuth token exchange, refresh, and revocation — required for both claude.ai and Console accounts), `sentry.io`, `statsig.com`
- **OpenAI / Codex** — `api.openai.com`, `auth.openai.com`, `auth.api.openai.org`, `chatgpt.com`, `chat.openai.com`, `ab.chatgpt.com`, `persistent.oaistatic.com`
- **OpenCode** — `opencode.ai`, `api.opencode.ai`, `models.dev`
- **Cursor** — `cursor.com`, `api2.cursor.sh`, `api3.cursor.sh`, `api4.cursor.sh`, `downloads.cursor.com`
- **Antigravity** — `antigravity.google` (installer, sign-in page), `antigravity-cli-auto-updater-974169037036.us-central1.run.app` and `storage.googleapis.com` (install and updates), `accounts.google.com`, `oauth2.googleapis.com`, `www.googleapis.com` (Google sign-in), `cloudcode-pa.googleapis.com`, `daily-cloudcode-pa.googleapis.com` (model API), `generativelanguage.googleapis.com` (Gemini API key)
- **VS Code** — marketplace, updates, blob storage
- **AWS Bedrock** — `bedrock-runtime.$AWS_REGION.amazonaws.com`, `bedrock-mantle.$AWS_REGION.api.aws` (Mantle)
- **Convex** — `$CONVEX_DEPLOYMENT.convex.site` / `.convex.cloud` (only when `CONVEX_DEPLOYMENT` is set)
- **Your extras** — anything in `DEVCONTAINER_EXTRA_ALLOWED_DOMAINS`
- **Localhost and the host network** — local dev servers, Docker DNS

A host that no longer resolves (or a DNS flake) is skipped with a `WARN:` line and listed again at the end of the setup log — the firewall is still applied without it. That is deliberate: aborting would leave the container with *no* firewall while still reporting `strict` mode. If an agent can only reach some services, read the setup log for those warnings first.

### `open`

Skips the firewall entirely. Use it when you want fewer networking surprises or broader tool compatibility.

### Switching modes

```bash
export DEVCONTAINER_NETWORK_MODE=open   # or strict
```

Then rebuild the container (not just reopen) so the mode is picked up.

## Allowing more domains

Preferably, set `DEVCONTAINER_EXTRA_ALLOWED_DOMAINS` on the host and rebuild. For a running container, you can also edit `init-firewall.sh` and re-apply without a rebuild:

```bash
sudo /usr/local/bin/init-firewall.sh
```

The script is safe to re-run — it temporarily opens HTTPS to fetch external data before rebuilding the firewall.

## Stale allowlist IPs

The firewall resolves allowed domains to IPs once at startup. Providers rotate IPs behind DNS, so after a long-running session an agent may start failing with network/retry errors that have no HTTP status. Re-running `sudo /usr/local/bin/init-firewall.sh` (or restarting the container) refreshes the allowlist. If errors disappear in `open` mode, the stale allowlist was the cause.

Google rotates addresses faster than the other providers, so Antigravity is the first to hit this: a session that worked and later stalls in strict mode needs the same re-run.

## Agent auth

- **Claude Code** — config lives in a container-local volume (`/home/node/.claude`). Log in inside the container, or set the Bedrock env vars above.
- **Codex** — shared with the host via `~/.codex`. Run `codex login` on the host; the container reuses `~/.codex/auth.json`.
- **OpenCode** — shared with the host via `~/.local/share/opencode` (auth) and `~/.config/opencode` (config). Run `opencode auth login` on the host. Providers other than Anthropic/OpenAI need their API endpoints added to the allowlist in strict mode.
- **Cursor CLI** — shared with the host via `~/.cursor`. Run `cursor-agent login` on the host; the container reuses the stored credentials.
- **Antigravity CLI** — sign-in lives in a container-local volume (`/home/node/.gemini`), because on macOS agy keeps the host's sign-in in the keychain. Run `agy acp --login` inside the container once. The volume also holds agy's MCP config, so run `convoy init --cli antigravity` inside the container too.
- **Convoy CLI** — profiles and API keys live in a container volume. Run `convoy setup` inside the container once; see [Convoy connection setup](#convoy-connection-setup).

## Mounted volumes

| Host path | Container path | Purpose |
|---|---|---|
| (Docker volume) | `/commandhistory` | Persistent bash/zsh history across rebuilds |
| (Docker volume) | `/home/node/.claude` | Claude Code config and session data |
| (Docker volume) | `/home/node/.gemini` | Antigravity sign-in, MCP config and conversations |
| `~/.codex/` | `/home/node/.codex/` | Codex CLI auth, config, sessions (shared with host) |
| `~/.cursor/` | `/home/node/.cursor/` | Cursor CLI auth and config (shared with host) |
| `~/.local/share/opencode/` | `/home/node/.local/share/opencode/` | OpenCode auth and sessions (shared with host) |
| `~/.config/opencode/` | `/home/node/.config/opencode/` | OpenCode configuration (shared with host) |
| (Docker volume) | `/home/node/.config/convoy` | Convoy CLI profiles, API keys and managed credentials |
| (Docker volume) | `/home/node/.convoy` | Convoy project service: socket, leases, logs, environment mode |

The container's `initializeCommand` creates the host directories automatically if they are missing.

## Node projects with native dependencies

The workspace is bind-mounted from the host, so `node_modules` is shared with the host by default. If your project has dependencies with platform-native binaries (e.g. `esbuild`, `lightningcss`), isolate `node_modules` in a container-only volume by adding a mount:

```jsonc
"mounts": [
  // ...existing mounts...
  "source=my-project-node-modules-${devcontainerId},target=/workspace/node_modules,type=volume"
]
```

and run your package manager's install inside the container after the first start (you may need to `sudo chown -R node:node /workspace/node_modules` first).

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

## Convoy connection setup

The container installs the Convoy CLI and is its own Convoy environment. It does
not read the host's `~/.config/convoy`: profiles, keys and project service state
stay in two container volumes and survive rebuilds. The environment is
**shared**: every project runs as `node`, with the agent logins above, and
projects can read each other's files. The container itself is the boundary that
keeps agents away from your host.

Connect this checkout once, inside the container, in one of two ways:

```bash
# Background: the project service connects it right away and after every restart
convoy project add /workspace     # prompts for backend, key and project

# Or foreground: an ordinary profile, connected while `convoy setup` runs
convoy setup
```

Use one or the other: `project add` refuses a folder that an ordinary profile
already covers. Then run `convoy devcontainer --configure` to configure MCP.

In strict mode, the firewall must already allow your backend, so export
`CONVEX_DEPLOYMENT` (or `DEVCONTAINER_EXTRA_ALLOWED_DOMAINS` for a self-hosted
backend) on the host before the first start. `npx @useconvoy/cli devcontainer`
prints the value for your profile. After setup, restart the container so the
firewall also picks up the hosts of the selected profile.

Startup configures Convoy MCP in the container's private Codex config and
allowlists the selected backend. Host Codex settings remain unchanged. Start a
new agent after changing the profile. Export `CONVOY_PROFILE` on the host only
when you want to select a profile explicitly. Missing explicit profiles produce
an actionable error. With no Convoy account, startup prints a hint and the
container remains usable.

### The project service

The project service starts with every container start, after the firewall, even
before any project is registered. `convoy project add` hands a new project to it,
so no manual start is needed. If it cannot start, startup prints a `WARN:` line
and the container still comes up; fix the error and run `convoy service start -b`.
`convoy service status` and `convoy tui` (under Local) show the registered
projects. They use the agent logins from [Agent auth](#agent-auth): Codex,
Cursor and OpenCode reuse the host's, Claude Code and Antigravity log in inside
the container.
A login applies to every project. The service keeps the container's
`CODEX_HOME` and `CLAUDE_CONFIG_DIR` but not the Bedrock variables, so for Claude
Code on Bedrock under the service, store the token as a managed key:
`convoy keys add work-bedrock --provider bedrock --auth api-key --region us-east-1`,
then `convoy keys use work-bedrock --profile <profile> --runtime claude-code`. See [Persistent project service](https://docs.convoy.build/docs/cli/project-service)
for pause, reload, logs and checks. A service that crashes is not restarted until
the next container start.

### Migrating from the host config mount

Containers created from an older template bind-mount the host's `~/.config/convoy`
and keep it until you install the new template and rebuild:

```bash
npx @useconvoy/cli devcontainer --force
```

`--force` overwrites `.devcontainer/`, so reapply your own edits afterwards.
Then run **Dev Containers: Rebuild Container** and connect the checkout as above. The
host config and its profiles are untouched; the container no longer sees them.
Do not add the bind mount back: a container service would then register
container paths such as `/workspace` in the host's `config.toml`.

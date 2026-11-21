# Dev Container Setup

For the main project setup and local development flow, see [`../README.md`](../README.md).

https://codewithandrea.com/articles/run-ai-agents-inside-devcontainer/

This Dev Container provides a sandboxed environment for running Claude Code, pre-configured tooling, and optional Convoy CLI integration. A generic, distributable version of this setup lives in [`../templates/devcontainer/`](../templates/devcontainer/) and can be installed into any project with `convoy devcontainer` — when changing shared behavior here (firewall, agent installs, mounts), update the template too.

It supports two network modes:

- `strict` - blocks outbound traffic by default and only allows a curated whitelist
- `open` - skips the firewall setup and allows normal outbound traffic

## Prerequisites

1. **Docker Desktop** (or compatible container runtime)
2. **VS Code** with the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)

## Quick Start

1. Set required environment variables on your **host machine** (see below)
2. Open this repo in VS Code (the container's `initializeCommand` creates `~/.config/convoy/`, `~/.codex/`, `~/.cursor/`, `~/.local/share/opencode/`, and `~/.config/opencode/` on the host automatically if missing)
3. Run **Dev Containers: Reopen in Container** from the command palette (`Cmd+Shift+P`)
4. Once inside the container, open a terminal and run `claude` to start Claude Code

### From the terminal (no VS Code)

With the [devcontainer CLI](https://github.com/devcontainers/cli) (`npm i -g @devcontainers/cli`), from the repo root:

```bash
pnpm devcontainer                             # build + start + shell inside
# or by hand:
devcontainer up --workspace-folder .          # build + start (idempotent)
devcontainer exec --workspace-folder . zsh    # shell inside
```

Add `--remove-existing-container` to `up` to force a rebuild (plus `--build-no-cache` if the Dockerfile changed). Env passthrough reads the shell you run these from, so changing `CONVEX_DEPLOYMENT` needs a rebuild.

### Running the CLI bridge inside

Run these in the container shell (the prompt shows `/workspace`), not on the host:

```bash
pnpm install    # once per fresh node_modules volume
convoy connect
```

Convoy uses your host's profile for this checkout, translating its paths to
`/workspace`. Profile names can differ between machines. To select one explicitly,
export `CONVOY_PROFILE` on the host before starting the container. If you have no
profile yet, run `convoy setup` in the container, then
`convoy devcontainer --configure`. Setup generates a private Codex MCP config;
it does not change your host's Codex settings.

## Environment Variables

The container pulls sensitive values from your host environment via `${localEnv:...}` so nothing is committed to the repo. Add these to your shell profile (`~/.zshrc` or `~/.bashrc`):

### Optional

```bash
export AWS_BEARER_TOKEN_BEDROCK=<your-aws-bearer-token>
export CONVEX_DEPLOYMENT=<your-convex-deployment-name>  # name only, e.g. happy-otter-123 for https://happy-otter-123.convex.cloud
```

### Optional (have defaults)

| Variable | Default | Description |
|---|---|---|
| `AWS_REGION` | `us-east-1` | AWS region for Bedrock API |
| `CLAUDE_CODE_USE_BEDROCK` | (host value) | Enable Bedrock as Claude Code backend |
| `CLAUDE_CODE_USE_MANTLE` | (host value) | Enable Mantle as Claude Code backend |
| `CLAUDE_CODE_ENABLE_AUTO_MODE` | (host value) | Enable Claude Code auto mode |
| `ENABLE_PROMPT_CACHING_1H` | (host value) | Enable 1h prompt caching |
| `CLAUDE_CODE_MAX_OUTPUT_TOKENS` | `32768` | Max output tokens per response |
| `MAX_THINKING_TOKENS` | `1024` | Max thinking/reasoning tokens |
| `DEVCONTAINER_NETWORK_MODE` | `strict` | `strict` enables the outbound firewall, `open` skips it |

Override any of these by exporting them on your host. If unset, the defaults above are used.

## Network Modes

The dev container supports two network modes selected by the host env var `DEVCONTAINER_NETWORK_MODE`.

### `strict`

- default mode
- runs `init-firewall.sh` on container startup
- blocks outbound traffic by default and only allows approved destinations
- best when you want a tighter sandbox for agent runs

### `open`

- skips `init-firewall.sh` on startup
- leaves outbound traffic unrestricted by this repo's firewall setup
- best when you want fewer networking surprises or broader tool compatibility

### Switching modes

Set the mode in your host shell before reopening or rebuilding the dev container:

```bash
export DEVCONTAINER_NETWORK_MODE=strict
# or
export DEVCONTAINER_NETWORK_MODE=open
```

Then reopen the repo in the container again. The selected mode is read at container startup.

## Running Claude Code

Claude Code is pre-installed globally in the container. Once inside:

```bash
# Start Claude Code in the terminal
claude

# Or start it in a specific directory
cd /workspace/apps/web && claude
```

Claude Code will automatically use Bedrock as its backend (via the `CLAUDE_CODE_USE_BEDROCK` env var). If you see authentication errors, verify that `AWS_BEARER_TOKEN_BEDROCK` is set:

```bash
echo $AWS_BEARER_TOKEN_BEDROCK
```

If it's empty, the variable wasn't exported on your host before the container started. See [Troubleshooting](#environment-variables-not-available-in-container).

### Using Claude Code via VS Code extension

The container also includes the `anthropic.claude-code` VS Code extension. You can use it from the sidebar or command palette — it shares the same Bedrock environment variables.

## Running Codex

Codex CLI is pre-installed globally in the container. Auth is shared with the host through the `~/.codex` bind mount, so if you are logged in on the host (`codex login`), the container is logged in too. ChatGPT-plan login flows are easiest to complete on the host; the container then reuses the stored credentials from `~/.codex/auth.json`.

```bash
codex            # interactive
codex exec "..." # non-interactive (what the Convoy agent uses)
```

In `strict` network mode the firewall allows `api.openai.com`, `auth.openai.com`, and `chatgpt.com`. If Codex reports network errors, re-run `sudo /usr/local/bin/init-firewall.sh` (resolved IPs can go stale, same as Bedrock).

## Running OpenCode

OpenCode CLI is installed globally in the container at create time from `latest` (the Convoy runtime requires ≥ 1.14.19). Auth and config are shared with the host through the `~/.local/share/opencode` (auth) and `~/.config/opencode` (config) bind mounts, so providers connected on the host (`opencode auth login`) work in the container too.

```bash
opencode          # interactive TUI
opencode serve    # HTTP server (what the Convoy agent uses under the hood)
```

In `strict` network mode the firewall allows `opencode.ai`, `api.opencode.ai`, and `models.dev` (model catalog), plus the Anthropic/OpenAI endpoints above for the actual model calls. Providers other than Anthropic/OpenAI need their API endpoints added to `init-firewall.sh`.

## Running Cursor CLI

Cursor CLI (`cursor-agent`) is pre-installed in the container (via the `cursor.com/install` script, into `~/.local/bin`). Auth is shared with the host through the `~/.cursor` bind mount, so run `cursor-agent login` on the host and the container reuses the stored credentials.

```bash
cursor-agent            # interactive
cursor-agent -p "..."   # non-interactive
```

In `strict` network mode the firewall allows `cursor.com`, `api2.cursor.sh`, `api3.cursor.sh`, `api4.cursor.sh`, and `downloads.cursor.com`. If Cursor reports network errors, re-run `sudo /usr/local/bin/init-firewall.sh` (resolved IPs can go stale) and keep this list in sync with what the CLI actually calls.

## Running Antigravity

Antigravity CLI (`agy`) is installed at create time from the `antigravity.google/cli/install.sh` script, into `~/.local/bin`. On macOS agy keeps its sign-in in the keychain, so the host's cannot be mounted. The sign-in lives in the `/home/node/.gemini` volume instead. Sign in once inside the container, and it survives rebuilds:

```bash
agy acp --login                 # prints a Google URL, then reads the pasted code
convoy init --cli antigravity   # agy reads MCP servers only from ~/.gemini/config, which is in the volume
```

In `strict` network mode the firewall allows the Antigravity hosts listed under [Network Firewall](#network-firewall). Google rotates addresses often, so if a session that worked stalls later, re-run `sudo /usr/local/bin/init-firewall.sh`.

## Mounted Volumes

| Host Path | Container Path | Purpose |
|---|---|---|
| (Docker volume) | `/commandhistory` | Persistent bash/zsh history across rebuilds |
| (Docker volume) | `/home/node/.claude` | Claude Code config and session data |
| (Docker volume) | `/home/node/.gemini` | Antigravity sign-in, MCP config and conversations |
| (Docker volume) | `/workspace/node_modules` | Container-only dependencies so Linux native packages do not overwrite host installs |
| `~/.config/convoy/` | `/home/node/.config/convoy/` | Convoy CLI profiles and API keys |
| `~/.codex/` | `/home/node/.codex/` | Codex CLI auth, config, and sessions (shared with the host) |
| `~/.cursor/` | `/home/node/.cursor/` | Cursor CLI auth and config (shared with the host) |
| `~/.local/share/opencode/` | `/home/node/.local/share/opencode/` | OpenCode auth and session storage (shared with the host) |
| `~/.config/opencode/` | `/home/node/.config/opencode/` | OpenCode configuration (shared with the host) |

The workspace source code is bind-mounted from the host, but `/workspace/node_modules` is intentionally isolated in a Docker volume. This keeps the container's Linux-native packages separate from the host machine's packages, which is required for dependencies with native binaries such as `esbuild` and `lightningcss`.

After rebuilding the container or creating a fresh volume, run `pnpm install` inside the container to populate `/workspace/node_modules`.

On container startup, a privileged init step ensures `/workspace/node_modules` exists and is owned by the `node` user so package managers can write to the isolated volume.

The `~/.config/convoy/` directory must exist on your host before starting the container:

```bash
mkdir -p ~/.config/convoy
```

If you haven't configured Convoy CLI yet, you can skip this — the directory just needs to exist. Run `convoy setup` inside the container to create a profile later.

## Network Firewall

In `strict` mode, the container runs a restrictive iptables firewall (`init-firewall.sh`) that **blocks all outbound traffic by default** and only allows connections to:

- **GitHub** — git operations, API access (prefers GitHub meta API ranges; falls back to DNS-resolved GitHub hosts if the meta response is unavailable or malformed)
- **npm registry** — `registry.npmjs.org`
- **Anthropic** — `api.anthropic.com`, `claude.ai`, `claude.com`, `platform.claude.com` (sign-in plus OAuth token exchange, refresh, and revocation — required for both claude.ai and Console accounts), `sentry.io`, `statsig.com`
- **OpenAI / Codex** — `api.openai.com`, `auth.openai.com`, `auth.api.openai.org`, `chatgpt.com`, `chat.openai.com`, `ab.chatgpt.com`, `persistent.oaistatic.com` (Codex releases may add endpoints; keep this list in sync when Codex reports network errors in strict mode)
- **OpenCode** — `opencode.ai`, `api.opencode.ai`, `models.dev` (model catalog); provider model calls reuse the Anthropic/OpenAI entries above — other providers need their endpoints added here
- **Cursor** — `cursor.com`, `api2.cursor.sh`, `api3.cursor.sh`, `api4.cursor.sh`, `downloads.cursor.com`
- **Antigravity** — `antigravity.google` (installer, sign-in page), `antigravity-cli-auto-updater-974169037036.us-central1.run.app` and `storage.googleapis.com` (install and updates), `accounts.google.com`, `oauth2.googleapis.com`, `www.googleapis.com` (Google sign-in), `cloudcode-pa.googleapis.com`, `daily-cloudcode-pa.googleapis.com` (model API), `generativelanguage.googleapis.com` (Gemini API key)
- **VS Code** — marketplace, updates, blob storage
- **Convex** — `$CONVEX_DEPLOYMENT.convex.site`, `$CONVEX_DEPLOYMENT.convex.cloud`
- **AWS Bedrock** — `bedrock-runtime.$AWS_REGION.amazonaws.com`, `bedrock-mantle.$AWS_REGION.api.aws` (Mantle)
- **Localhost and host network** — local dev servers, Docker DNS

A host that no longer resolves (or a DNS flake) is skipped with a `WARN:` line and listed again at the end of the setup log — the firewall is still applied without it. That is deliberate: aborting would leave the container with *no* firewall while still reporting `strict` mode. If an agent can only reach some services, read the setup log for those warnings first.

### Changing the Convex deployment

This container resolves your selected Convoy profile and allowlists its backend. An explicit host `CONVOY_PROFILE` overrides workspace matching; `CONVEX_DEPLOYMENT` can allowlist an additional deployment. For testing the CLI agent against a dev deployment, use a disposable sandbox devcontainer in `sandbox/` (gitignored) instead.

Set the deployment slug (the part before `.convex.cloud`) on your host before reopening or rebuilding:

```bash
export CONVEX_DEPLOYMENT=your-deployment-name
```

### Changing the AWS region

Set `AWS_REGION` on your host before reopening or rebuilding the container. The firewall script now derives the Bedrock allowlist host from that variable automatically:

```bash
export AWS_REGION=us-west-2
```

### Adding new allowed domains

Append the domain to the `ALLOWED_DOMAINS` array in `init-firewall.sh`, then re-apply:

```bash
sudo /usr/local/bin/init-firewall.sh
```

The script is safe to re-run — it temporarily opens HTTPS to fetch external data before rebuilding the firewall. No container rebuild needed. Note that editing `/usr/local/bin/init-firewall.sh` in a running container only lasts until the next rebuild; make the change in `.devcontainer/init-firewall.sh` too.

If GitHub's meta endpoint is temporarily unavailable, the script falls back to a smaller DNS-derived allowlist for common GitHub hosts so container startup can still complete.

In `open` mode, this firewall step is skipped entirely.

## Troubleshooting

### MCP server can't connect

If you see connection errors from the Convoy MCP server, check that `CONVEX_DEPLOYMENT` is set correctly on your host and matches your Convex deployment name. Re-run `sudo /usr/local/bin/init-firewall.sh` after updating.

### Claude Code can't reach Bedrock

Verify that:
1. `AWS_BEARER_TOKEN_BEDROCK` is set in your host shell (`echo $AWS_BEARER_TOKEN_BEDROCK`)
2. `AWS_REGION` is set correctly on your host before the container starts
3. `DEVCONTAINER_NETWORK_MODE` is `strict` if you expect the firewall to be active
4. The container was rebuilt after any firewall changes

### Intermittent `api_retry` errors with `error_status: null`

If Claude Code in the dev container starts emitting repeated retry events like:

```json
{"type":"system","subtype":"api_retry","attempt":1,"error_status":null,"error":"unknown"}
```

but the same setup works normally on the host machine, the most likely cause is the dev container firewall allowlist getting stale.

Why this happens:
- `init-firewall.sh` resolves allowed domains to IPs once when the container starts
- AWS Bedrock endpoints can rotate behind DNS/load balancing
- after the IPs change, the container may still allow only the older resolved addresses
- Claude Code then retries because it cannot complete the network request, so no HTTP status is returned (`error_status: null`)

What usually fixes it:
- restart or rebuild the dev container so `init-firewall.sh` runs again
- or re-run the firewall script manually:

```bash
sudo /usr/local/bin/init-firewall.sh
```

Useful checks from inside the container:

```bash
echo $AWS_REGION
dig +short bedrock-runtime.$AWS_REGION.amazonaws.com
sudo ipset list allowed-domains
```

If restarting the container makes the problem disappear temporarily and it later comes back, that is a strong signal that the firewall's cached Bedrock IPs have gone stale rather than Claude Code auth being misconfigured.

Version staleness is no longer a likely cause: the agent CLIs install from `postCreateCommand` (see [`devcontainer.json`](devcontainer.json)), which Docker does not cache, so every container create resolves the real `latest`. They used to install in a `Dockerfile` `RUN` layer, where a rebuild silently reinstated the first build's versions — that is how a `claude` too old for `--permission-mode auto` survived a rebuild. If you suspect a version problem anyway, compare `claude --version` against the host and rerun the install by hand.

If you want to rule the firewall out entirely, switch to `DEVCONTAINER_NETWORK_MODE=open` and reopen the container. If the retries disappear in `open` mode, the firewall is the likely cause.

### Container fails to start with mount error

The `~/.config/convoy/` bind mount requires the directory to exist on the host. Create it with:

```bash
mkdir -p ~/.config/convoy
```

### Environment variables not available in container

Variables must be exported in your shell profile **before** the container starts. After adding them to `~/.zshrc`/`~/.bashrc`, either:
- Open a new terminal and rebuild the container, or
- Run `source ~/.zshrc` then rebuild

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

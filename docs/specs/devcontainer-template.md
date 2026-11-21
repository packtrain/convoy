# Devcontainer Template Distribution

Related task: OS-778. Related specs: [cli-init-command.md](cli-init-command.md).

## Purpose

The Convoy repo's `.devcontainer/` is a sandboxed environment for running AI coding agents (Claude Code, Codex, OpenCode, Cursor, Antigravity) with an optional outbound firewall. This spec covers the **distributable** version of that setup so users can install it into any project instead of copying files out of our repo.

## Source of truth

- `templates/devcontainer/` (repo root) holds the distributable template: `devcontainer.json`, `Dockerfile`, `init-firewall.sh`, `README.md`.
- The repo's own `.devcontainer/` remains the Convoy-flavored instance (Convex env required, isolated `node_modules` volume + `init-workspace.sh`, Bedrock defaults, ESLint/Prettier extensions). It is intentionally a separate copy; changes to shared behavior (firewall logic, agent installs, mounts) must be applied to both. Both READMEs cross-link each other.

## Template requirements (generic + Convoy opt-in)

- Must work in any project with no Convoy account and no env vars set.
- Agents installed by `postCreateCommand` (not in the image — a cached `RUN npm install -g` layer would freeze versions at the first build): Convoy CLI, Claude Code and Codex CLI (npm, all from `latest`), OpenCode CLI (via the `opencode.ai/install` script: npm's `opencode-ai` postinstall picks the musl binary on arm64 glibc), Cursor CLI (`cursor-agent`, via the `cursor.com/install` script), and Antigravity CLI (`agy`, via the `antigravity.google/cli/install.sh` script, into `~/.local/bin`). The image is `node:22`, as Claude Code requires, and `~/.local/bin` and `~/.opencode/bin` are on the image `PATH` so a service started by `postStartCommand` finds them. Each container create resolves the current `latest`; the image itself carries no agent versions.
- Agent auth shared with the host via bind mounts: `~/.codex`, `~/.cursor`, `~/.local/share/opencode`, `~/.config/opencode`. `initializeCommand` creates these host dirs if missing.
- Claude Code and Antigravity sign in inside the container, each into a named volume: `~/.claude` and `~/.gemini` (OS-2477). agy keeps the host sign-in in the macOS keychain, so a bind mount would carry nothing. In the container agy writes `~/.gemini/antigravity-cli/antigravity-oauth-token`. The same volume holds agy's only MCP config, `~/.gemini/config/mcp_config.json`, so `convoy init --cli antigravity` runs inside the container. The Dockerfile pre-creates `~/.gemini` node-owned so the volume is not root's.
- Convoy state is container-private (OS-2250): named volumes hold `~/.config/convoy` and `~/.convoy`, so the container is its own [shared environment](cli-shared-environments.md#devcontainer-template). The Dockerfile creates both folders node-owned with mode 0700, which the volumes copy on first mount. The repository's own `.devcontainer/` keeps its host `~/.config/convoy` mount.
- `postStartCommand` ends with `convoy service start -b`, after the firewall, with or without registered projects. A failure prints a `WARN:` and does not block startup.
- Network modes via `DEVCONTAINER_NETWORK_MODE` (`strict` default, `open` skips firewall), same as the repo devcontainer.
- The firewall runs under `sudo`, whose `env_reset` strips every var it reads. Both copies' `Dockerfile` must therefore list those vars in a `Defaults env_keep +=` line in `/etc/sudoers.d/node-devcontainer` — adding a new env var to `init-firewall.sh` means adding it there too, or it silently arrives empty.
- **The firewall must fail closed.** `init-firewall.sh` only starts blocking at the `iptables -P ... DROP` policies in Phase 2f, and Phase 1c opens outbound 443 outright so the script can fetch GitHub ranges when re-run inside an already-locked-down container. Any `exit` before 2f therefore leaves the container *unfirewalled* while `DEVCONTAINER_NETWORK_MODE=strict` claims otherwise — a re-run that aborts turns a strict container wide open. So nothing before 2f exits: an unresolvable domain, an unset `CONVEX_DEPLOYMENT`, an unavailable GitHub allowlist, and a malformed CIDR/IP are each skipped with a `WARN:`, with unresolved domains re-listed after "Firewall configuration complete". Phase 3's verification `exit 1`s are fine — the firewall is already applied by then. Both copies share this behavior.
- Allowlisted hosts track [Anthropic's network requirements](https://code.claude.com/docs/en/network-config): `api.anthropic.com`, `claude.ai`, `claude.com`, `platform.claude.com` (OAuth exchange/refresh/revocation, needed by claude.ai *and* Console sign-in). `console.anthropic.com` and `statsig.anthropic.com` are not on that list — the latter has no A records at all, which is what exposed the fail-open bug above.
- Antigravity's hosts (OS-2477) come from t3code and happier source, not from a capture: `antigravity.google` (installer, OAuth page), the auto-updater manifest host and `storage.googleapis.com` (install only, since runs set `AGY_CLI_DISABLE_AUTO_UPDATE=1`), `accounts.google.com`, `oauth2.googleapis.com`, `www.googleapis.com` (sign-in), `cloudcode-pa.googleapis.com` and `daily-cloudcode-pa.googleapis.com` (model API and model inventory), `generativelanguage.googleapis.com` (managed Gemini key). Google front ends rotate addresses faster than the other hosts, so a strict session that later stalls needs a firewall re-run. There is no re-resolve mechanism.
- Firewall differences from the repo copy:
  - `DEVCONTAINER_EXTRA_ALLOWED_DOMAINS` (comma or space separated) appends user domains to the allowlist.
  - No Convoy-specific defaults (no `CONVOY_PROFILE`, no Bedrock env).
- No project-specific mounts: the `node_modules` volume and `init-workspace.sh` are not part of the template (the template README documents how to add an isolated `node_modules` volume for native deps).
- Bedrock is opt-in: `CLAUDE_CODE_USE_BEDROCK` has no default.

## CLI command

`--projects` selects the separate `templates/project-isolation` template and
installs it into the chosen parent workspace. It has no host authentication
mounts, uses persistent control/project state volumes and reuses the generic
firewall script. Both GitHub fetch and bundled fallback deliver the same files.
See [Local project isolation](cli-project-isolation.md) for the boundary and
pending acceptance requirements. The default template below is unchanged.

`convoy devcontainer [dir] [--force]` (in `apps/cli/src/commands/devcontainer/`):

1. Target is `<dir>/.devcontainer` (default `cwd`). Refuses to overwrite an existing directory unless `--force`.
2. Fetches the four template files from GitHub raw (`TEMPLATE_RAW_BASE_URL`, currently `raw.githubusercontent.com/packtrain/convoy/main/templates/devcontainer`) with a 10s timeout so users get the latest version.
3. Falls back to the copy bundled in the npm package when GitHub is unreachable (repo is private today, so the fallback is the effective path until it goes public). The build copies `templates/` → `dist/templates`, same mechanism as the plugin marketplace.
4. Writes the files, marks `init-firewall.sh` executable, prints the source used (GitHub vs bundled) and next steps.
5. Resolves the Convoy profile for the target directory (standard resolution; `--profile` supported) and, when one exists, prints the exact strict-mode firewall value to export: `CONVEX_DEPLOYMENT=<slug>` for `*.convex.cloud`/`*.convex.site` backend URLs, or `DEVCONTAINER_EXTRA_ALLOWED_DOMAINS=<host>` for self-hosted backends. Localhost backends and missing profiles print nothing.

## Docs

- `apps/docs/content/docs/cli/dev-container/use-in-your-project.mdx` documents installation into arbitrary projects.
- The template's own `README.md` ships with the generated `.devcontainer/` and is the user-facing reference for env vars, network modes, and mounts.

## Browser tooling and stale images

All images preinstall standalone browser tooling, independently of the Convoy
package. See [Environment-owned browser automation](cli-browser-automation.md)
for the installation, configuration and migration contract. The repository image
carries one Chromium; landing tests and README screenshots launch it through the
same config file via `apps/landing/lib/browser.mjs`.

An image built before a Dockerfile change gives no sign of it. Each image therefore
keeps a copy of its Dockerfile at `/usr/local/share/convoy-devcontainer/Dockerfile`.
`postStartCommand` compares it, and the installed `init-firewall.sh`, with the
checkout's `.devcontainer/` and prints a `WARN:` asking for a rebuild when they differ.
The warning never blocks startup.


## Portable Convoy setup

Both single-workspace containers install `@useconvoy/cli@latest`. They forward
optional host `CONVOY_PROFILE` without a default name, plus `CONVOY_HOST_WORKSPACE`
and `CONVOY_CONTAINER_WORKSPACE`. Resolution keeps explicit flag/env selection
first, then container path matching, then the corresponding host workspace path,
then the configured default. An explicit nonexistent profile is an error that
names the selector; it never switches to a different backend. Resolved profile
paths are projected onto the mounted checkout without rewriting host config.
Host paths outside that checkout are excluded.

At each start, `convoy devcontainer --configure` configures Convoy MCP in the
container-private `CODEX_HOME`. It preserves unrelated Codex settings and replaces
a config symlink atomically instead of writing through it to the host. The new
file has mode 0600. The MCP URL uses the selected profile's backend and project
ID; credentials never appear in command arguments or logs. No matching profile
prints setup guidance and leaves a no-account container usable. Setup errors do
not prevent the firewall from running. A new agent runtime loads the config.

The command also writes only the selected backend's API and HTTP hostnames to
`CODEX_HOME/convoy-domains`. Both firewalls read this as hostname data, never shell
code, and preserve CODEX_HOME through sudo. Explicit CONVEX_DEPLOYMENT entries
remain additive. This avoids requiring the same deployment/profile exports on
every machine. Firewall changes require an image rebuild.

The isolated multi-project template keeps its existing launcher-owned auth and
profile boundary. The single-workspace bootstrap does not configure that template.

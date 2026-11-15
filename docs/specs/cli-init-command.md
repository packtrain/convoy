# CLI Init Command

## Overview

The `convoy init` command initializes Convoy integrations in a project. It has two subcommands that can be run individually or together.

### Internal Architecture (Driver-Based)

The implementation is structured around target drivers (`claude`, `codex`, `opencode`) under `apps/cli/src/commands/init/targets/`.

- Orchestration (`commands/init.ts` + `commands/init/index.ts`) resolves flow, prompts, and shared context.
- Drivers own target-specific MCP/skill destinations and file formats.
- Services (`mcp-service.ts`, `skill-service.ts`) loop selected drivers via a registry.
- `baseDir` is the only directory context passed from orchestration to drivers.
- Project-scope raw skill installation uses `.agents/skills/convoy` as the canonical copy.
- Project-scope Claude raw installation creates `.claude/skills/convoy` as a symlink to the `.agents` copy.
- Existing raw skill destinations prompt before replacement; `--force` skips the prompt and overwrites.
- skills.sh is documented as a manual alternative, not the internal implementation for this command.

## Commands

```
convoy init            # Run both MCP + skill setup
convoy init mcp        # Create/update MCP config for selected CLI targets
convoy init skill      # Install Convoy skills for Claude Code, Codex, and/or OpenCode
```

## `convoy init mcp`

Creates or updates project MCP config for selected CLI targets at the project root (or specified directory):

- `claude` -> `.mcp.json`
- `codex` -> `.codex/config.toml`
- `opencode` -> `opencode.json` (`mcp.convoy` remote entry with a Bearer `Authorization` header and `oauth: false`)
- both -> writes both files

### Credential Resolution

Uses the standard profile resolution chain:
1. `--profile` CLI flag
2. `CONVOY_PROFILE` environment variable
3. Path match (cwd against profile paths)
4. `settings.default_profile`

Falls back to `--url`, `--api-key`, `--project` global flags.

### MCP URL Construction

The MCP endpoint URL is constructed as:

```
https://<deployment>.convex.site/api/mcp?project=<org-slug>/<PROJECT_ALIAS>
```

Where:
- `<deployment>` is derived from the Convex cloud URL (`.convex.cloud` → `.convex.site`)
- `<org-slug>` and `<PROJECT_ALIAS>` are resolved from the backend via `projects.listAccessible`

### Output Formats

```json
{
  "mcpServers": {
    "convoy": {
      "type": "http",
      "url": "https://your-deployment.convex.site/api/mcp?project=acme/WEB",
      "headers": {
        "Authorization": "Bearer sk_user_..."
      }
    }
  }
}
```

```toml
[mcp_servers.convoy]
url = "https://your-deployment.convex.site/api/mcp?project=acme/WEB"
http_headers = { Authorization = "Bearer sk_user_..." }
```

### Merge Behavior

- For each selected target file:
  - If file doesn't exist: creates it
  - If file exists without `convoy`: adds entry, preserves other servers
  - If file exists with `convoy`: prompts to overwrite (or `--force` skips prompt)

### Gitignore Warning

If a written file is not ignored, displays a warning with the command to add it to `.gitignore` (these files contain API keys).

### Flags

| Flag | Description |
|------|-------------|
| `-o, --output-dir <path>` | Directory to write MCP config files (default: cwd) |
| `-f, --force` | Overwrite existing config without prompting |
| `--cli <target...>` | MCP target(s): `claude`, `codex`, `opencode` (repeat or comma-separate; default: all) |

## `convoy init skill`

Installs Convoy skills for one or more CLI targets (`claude`, `codex`, `opencode`).

### CLI Target Selection

- If `--cli` is omitted, user is prompted with a checkbox list.
- Default checked targets are `claude`, `codex`, and `opencode`.
- OpenCode skill destinations: project scope `.opencode/skills/<name>`, user scope `~/.config/opencode/skills/<name>` (respects `XDG_CONFIG_HOME`).
- `--cli` accepts:
  - repeated values: `--cli claude --cli codex`
  - comma-separated values: `--cli claude,codex`

If a selected target cannot be installed:
- Claude missing on PATH: target is skipped with warning (does not hard-fail other targets)
- Existing raw skill destination and overwrite denied: target is skipped with warning
- Overall command fails (non-zero) only when no selected target installs successfully.

### Claude Installation Scope

| Scope | Settings File | Description |
|-------|---------------|-------------|
| `user` | `~/.claude/settings.json` | Available in all projects |
| `project` | `.claude/settings.json` | Shared with team via git |

If Claude is selected and `--scope` is omitted, the user is prompted to choose.

### Codex Installation Scope

Codex skill destinations:
- `project` scope -> `<projectDir>/.agents/skills/convoy`
- `user` scope -> `${CODEX_HOME:-~/.codex}/skills/convoy`

### Prerequisites

- Claude Code CLI (`claude`) must be installed and available on PATH
- Codex install does **not** require `codex` binary detection (copy-based install)

### Claude Installation Mechanism

Plugin method:
1. Registers the bundled marketplace directory via `claude plugin marketplace add <dir>`
2. Installs the plugin via `claude plugin install convoy@convoy --scope <scope>`

Raw project method:
1. Resolve source skill directory from bundled marketplace: `convoy/skills/convoy`
2. Copy the source directory to `<projectDir>/.agents/skills/convoy`
3. Create a symlink at `<projectDir>/.claude/skills/convoy` pointing to the `.agents` copy
4. If either destination already exists, prompt before replacing it; `--force` replaces without prompting

Raw user method:
1. Resolve source skill directory from bundled marketplace: `convoy/skills/convoy`
2. Copy the source directory to `~/.claude/skills/convoy`
3. If the destination already exists, prompt before replacing it; `--force` replaces without prompting

### Codex Installation Mechanism

1. Resolve source skill directory from bundled marketplace: `convoy/skills/convoy`
2. Resolve destination from codex scope (`project` or `user`)
3. Copy skill directory recursively to destination
4. If destination already exists, prompt before replacing it; `--force` replaces without prompting

### skills.sh Audit and Manual Alternative

The current destinations align with skills.sh's agent paths:

- Claude Code raw skill project scope -> `.claude/skills/convoy` symlink to `.agents/skills/convoy`
- Claude Code raw skill user scope -> `~/.claude/skills/convoy`
- Codex project scope -> `.agents/skills/convoy`
- Codex user scope -> `${CODEX_HOME:-~/.codex}/skills/convoy`

Convoy's CLI deliberately installs from the bundled skill instead of invoking skills.sh. This keeps `convoy init skill` offline after package installation and avoids adding `npx`/network behavior to initialization. skills.sh remains useful for users who want its registry and multi-agent skill management commands.

Manual install command:

```bash
npx skills add https://github.com/packtrain/convoy/tree/main/plugins/convoy/skills --skill convoy
```

The `/tree/main/plugins/convoy/skills` segment is required for the documented GitHub subdirectory URL shape. `https://github.com/packtrain/convoy/plugins/convoy/skills` is not the documented direct-path form.

Useful skills.sh command surface:

- `add` installs skills from a registry entry, GitHub URL, git URL, or local path.
- `list` / `ls` lists installed skills.
- `find` searches for skills.
- `update` updates installed skills.
- `remove` / `rm` removes installed skills.
- `init` creates a new `SKILL.md` template.

Key `add` options:

- `--global` installs to the user-level skill directory.
- `--agent <agent>` targets specific agents such as `claude-code` or `codex`.
- `--skill <skill>` installs specific skills by name.
- `--list` lists available skills without installing.
- `--copy` copies files instead of using symlinks.
- `--yes` skips prompts.
- `--all` installs all discovered skills to all agents.

References: [skills.sh CLI docs](https://skills.sh/docs/cli), [vercel-labs/skills README](https://github.com/vercel-labs/skills).

### Repository Layout Recommendation

Keep `plugins/convoy/skills/convoy` as the source for OS-762. It is visible to the Claude plugin marketplace and is already packaged into `apps/cli/dist/marketplace`.

A future cleanup can make `skills/convoy` the canonical source and generate or copy it into `plugins/convoy/skills/convoy` during packaging. Do not make that structural change inside OS-762 because it affects packaging, Claude plugin behavior, and skill discovery tests.

### Plugin Source

The plugin ships as a Claude Code marketplace. The `plugins/` directory contains:
- `.claude-plugin/marketplace.json` — marketplace manifest listing available plugins
- `convoy/` — the plugin itself (with `.claude-plugin/plugin.json`, skills, etc.)

At build time, the entire `plugins/` directory is copied to `dist/marketplace/`. At runtime, the marketplace directory is resolved relative to the CLI's installation path.

### How Claude Code Resolves `convoy@convoy`

The `plugin@marketplace` format identifies a plugin by its name and the marketplace it came from.

**Step 1: Marketplace registration** (`claude plugin marketplace add <dir>`)

Adds an entry to `~/.claude/plugins/known_marketplaces.json`:

```json
{
  "convoy": {
    "source": { "source": "directory", "path": "/path/to/plugins" },
    "installLocation": "/path/to/plugins"
  }
}
```

For directory-based marketplaces (local path), the `installLocation` points directly to the directory on disk. For GitHub-based marketplaces, it points to a clone in `~/.claude/plugins/marketplaces/`.

The `marketplace add` step is idempotent — if the marketplace is already registered, the error is silently ignored.

**Step 2: Plugin installation** (`claude plugin install convoy@convoy --scope <scope>`)

Claude Code reads the marketplace's `marketplace.json`, finds the plugin entry named `convoy` with `"source": "./convoy"`, resolves the full path (`installLocation + source`), and writes `"convoy@convoy": true` into the scoped settings file (e.g., `.claude/settings.local.json`).

**At runtime**, Claude Code loads the plugin files directly from the marketplace's `installLocation`. For directory-based marketplaces this means reading live from disk — changes to `plugins/convoy/` take effect immediately during development without reinstalling.

### Flags

| Flag | Description |
|------|-------------|
| `--cli <target...>` | CLI targets: `claude`, `codex` (repeat or comma-separate) |
| `-s, --scope <scope>` | Skill scope: `user` or `project` |
| `-f, --force` | Overwrite existing skill files or links without prompting |

## `convoy init` (bare)

Runs both steps in sequence:

1. **MCP Configuration** — Skips gracefully if no profile is configured (suggests `convoy setup`)
2. **Skill Installation** — Runs multi-target installer (`claude`, `codex`) with per-target summary

### Flags

Combines flags from both subcommands: `--output-dir`, `--force`, `--cli`, `--scope`.

## Error Cases

| Scenario | Behavior |
|----------|----------|
| No profile configured | Error with hint to run `convoy setup` |
| Profile missing project_id | Error: missing required configuration |
| Backend unreachable | Spinner fail with network error |
| Project not found in listAccessible | Error: project not accessible |
| `.mcp.json` malformed JSON | Error: failed to parse |
| `.codex/config.toml` malformed TOML | Error: failed to parse |
| Claude CLI not installed and Claude selected | Target skipped with install hint |
| Marketplace already registered | Silently ignored, continues to install |
| Claude plugin install fails | Summary marks Claude target as failed with manual command hint |
| Raw skill destination exists and overwrite denied | Target skipped with destination path |
| Invalid `--scope` value | Error with valid scopes listed |
| Invalid `--cli` target | Error with valid targets listed |
| All selected targets skipped/failed | Error (non-zero exit) |

## Examples

```bash
# Full init with profile auto-detection
convoy init

# Just MCP config, using a specific profile
convoy init mcp --profile my-project

# Just skill, installed globally
convoy init skill --scope user

# Just Codex skill (project scope default)
convoy init skill --cli codex

# Install both targets non-interactively
convoy init skill --cli claude,codex --scope project

# Non-interactive: skip all prompts
convoy init --force --cli claude --scope project

# Write MCP configs to a specific directory
convoy init mcp --output-dir ./packages/web
```

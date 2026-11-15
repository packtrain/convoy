# Convoy Skill (Claude Code + Codex)

Manage your Convoy projects and tasks directly from Claude Code or Codex, via MCP (Model Context Protocol) or the `convoy` CLI.

## What it does

This skill provides workflows that help you:

- **Set up Convoy access** — API key creation, `.mcp.json` configuration (manual or via `convoy init mcp`), verification
- **Manage tasks from the terminal** — create, update, search, delete, and organize tasks
- **Look up tasks by reference** — use Jira-style refs like `WEB-42` to quickly find tasks
- **Work without MCP** — fall back to `convoy` one-shot commands with JSON output when no MCP connection is configured
- **Integrate with your dev workflow** — update task status as you code, create tasks for discovered bugs, track sprint progress

## Installation

### Recommended (Convoy CLI)

```bash
convoy init skill
```

Choose target CLI(s) interactively (`claude`, `codex`) or use flags:

```bash
convoy init skill --cli claude --scope project
convoy init skill --cli codex --codex-scope project
convoy init skill --cli claude,codex --scope local --codex-scope user
```

Codex destinations:

- `project` scope: `.agents/skills/convoy`
- `user` scope: `${CODEX_HOME:-~/.codex}/skills/convoy`

### Claude plugin install (manual)

### From local path

```bash
claude plugins install --plugin-dir /path/to/plugins/convoy
```

### From GitHub (after pushing)

```bash
claude plugins install <github-url>/plugins/convoy
```

## Prerequisites

1. A Convoy account with at least one project
2. An API key from **Settings > API Keys** in the Convoy web UI, or a `convoy login`

## Quick start

After installing the skill, ask your agent to set up Convoy MCP:

```
set up Convoy MCP
```

Claude will walk you through configuring `.mcp.json` with your deployment URL and API key.

Once connected, you can use natural language:

```
list my tasks
create a task "Fix login redirect" with high priority
mark WEB-42 as done
what tasks are in progress?
search tasks for "authentication"
```

## Package structure

```
convoy/
├── .claude-plugin/
│   └── plugin.json
├── skills/
│   └── convoy/
│       ├── SKILL.md                      # Core skill (process contract for task work)
│       └── references/
│           └── mcp-setup.md              # Detailed setup & API key management
└── README.md
```

## Available MCP tools

The Convoy MCP server exposes tools for projects, task CRUD and search, comments, external links (commits/branches/PRs), labels, Lists, document artifacts with review comments, skills, prompts, project agents, and agent threads. Agents discover the exact tool names and parameters from the MCP connection itself; the skill intentionally documents the working process rather than the API surface. The `convoy` CLI exposes the same tools as one-shot commands with `--json` output.

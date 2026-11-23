# MCP Server Specification

This document describes the Model Context Protocol (MCP) server exposed by Convoy, including its architecture, authentication, configuration, tools, and extension points.

## Overview

Convoy exposes a JSON-RPC 2.0 MCP endpoint that allows AI code agents (Claude Code, Codex, etc.) to manage tasks programmatically. The server runs as a Convex HTTP action and supports project-scoped or multi-project access via user-scoped API keys.

## Architecture

```
MCP Client (Claude Code, etc.)
    │
    │  HTTP POST (JSON-RPC 2.0)
    │  Authorization: Bearer sk_user_...
    ▼
Convex HTTP Action (/api/mcp)
    │
    ├─ Authentication (API key → userId)
    ├─ URL parameter extraction (?project=<id>)
    ├─ JSON-RPC dispatch (initialize, tools/list, tools/call)
    │
    ▼
MCP Handler (convex/mcp/handler.ts)
    │
    ├─ Tool parameter validation
    ├─ Project ID resolution (tool arg → URL default → error)
    │
    ▼
Convex Queries/Mutations (api.tasks.*, api.projects.*)
    │
    └─ Permission enforcement via existing auth system
```

### Key Files

| File | Purpose |
|------|---------|
| `convex/http.ts` | HTTP route registration, auth extraction, URL passthrough |
| `convex/mcp/handler.ts` | JSON-RPC dispatch, tool execution, parameter validation |
| `convex/mcp/tools.ts` | Tool definitions (JSON Schema for MCP `tools/list`) |
| `convex/mcp/jsonrpc.ts` | JSON-RPC 2.0 response builders |
| `convex/mcp/jsonhttp.ts` | HTTP response wrappers for JSON-RPC payloads |

### Test Files

| File | Purpose |
|------|---------|
| `convex/mcp/handler.test.ts` | Handler logic, tool execution, URL-based project defaults |
| `convex/mcp/tools.test.ts` | Tool definition schema validation |

## Endpoint

- **URL**: `POST https://<DEPLOYMENT>.convex.site/api/mcp`
- **CORS**: Supported via `OPTIONS /api/mcp` preflight handler
- **Protocol**: JSON-RPC 2.0

URL derivation: users give one URL, the Convex client URL. The HTTP actions
origin comes from the backend: the public query `appVersion.core.siteUrl`
returns the deployment's `CONVEX_SITE_URL`. Self-hosted Convex sets that from
`CONVEX_SITE_ORIGIN`, so any port pair or reverse proxy works. The CLI asks
over the client URL (`resolveConvexSiteUrl` in `apps/cli/src/lib/url.ts`) at
login, on each agent registration, in `convoy init mcp`, in the project
backend check and in `convoy devcontainer --configure`. The web popups read
the same query.

A backend too old to have the query, or one that cannot be reached, falls
back to a guess (`toConvexSiteUrl`): `*.convex.cloud` → `*.convex.site`, and
self-hosted `:3210` → `:3211`. Any other URL is used as-is. The web shows the
guess while the query loads; on managed Convex it already equals the answer.

The API Keys settings popup displays copyable CLI / Convex and MCP endpoint
URLs below the key list and above the MCP setup instructions, without expanding them. The CLI URL
comes from the current deployment configuration. The MCP endpoint uses the
shared URL builder, including `/api/mcp` and the current organization/project
scope when available. Neither URL contains an API key. If deployment
configuration is missing, show an unavailable message instead of copyable
placeholder URLs. Managed and self-hosted deployments use the same derivation
rules described above.

### Supported Methods

| Method | Description |
|--------|-------------|
| `initialize` | Protocol handshake, returns server capabilities |
| `notifications/initialized` | Client acknowledgment (no response) |
| `tools/list` | Returns all available tool definitions |
| `tools/call` | Executes a tool with given arguments |

## Authentication

Two front doors, same underlying auth:

- **OAuth (recommended for MCP clients that support it, e.g. Claude Code's
  `/mcp`)** — add the server with no headers; the client discovers the OAuth
  metadata from the 401 `WWW-Authenticate` header and runs a browser-approve
  flow. The issued access token is an `sk_user_…` API key with
  `kind: "mcp-oauth"`: accepted here like any key, rejected by the
  agent-bridge endpoints. See `mcp-oauth.md`.
- **API key in headers** — manual configuration, and the path for clients
  without OAuth support (e.g. Codex).

### API Keys

Authentication uses user-scoped API keys passed as Bearer tokens.

- **Format**: `sk_user_{32 random base64 characters}`
- **Scope**: Personal user credential, optionally constrained to one organization and an optional project allowlist
- **Maximum**: none; expired automated keys are swept by cron (see `permissions-system.md#api-key-lifecycle`)
- **Expiry**: Configurable, up to 1 year
- **Storage**: SHA-256 hashed server-side (not recoverable after creation)
- **Tracking**: `lastUsedAt` is a best-effort, throttled recency signal for successful MCP and CLI usage

### Auth Flow

1. Client sends `Authorization: Bearer sk_user_...` header
2. HTTP handler extracts the key and calls `internal.apiKeys.core.validateByKey`
3. If missing, malformed, invalid, or expired → `401 Unauthorized` (validated
   up front, before dispatch). All 401s carry
   `WWW-Authenticate: Bearer resource_metadata="…"` so OAuth-capable clients
   can start discovery / re-auth (see `mcp-oauth.md`); every `/api/mcp`
   response carries CORS headers and exposes `WWW-Authenticate`
4. On success, user ID, API key ID, and current API key scope are threaded to downstream permission checks
5. API key usage is recorded via throttled internal helpers; updates are best-effort and not guaranteed on every request

### Permission Enforcement

API keys authenticate a user but do not grant any special permissions. All tool calls go through the standard Convex permission system:

- `api.tasks.core.listByProject` checks the user has project access
- `api.tasks.core.create` checks `ProjectPermission.TASK_CREATE`
- `api.tasks.core.update` checks `ProjectPermission.TASK_UPDATE`
- `api.tasks.core.remove` checks `ProjectPermission.TASK_DELETE`
- Org owners/admins have no project access without a `projectMembers` row; `listAccessible` reports their project role, never `org-owner`/`org-admin` (OS-1536)
- Scoped API keys additionally limit project discovery and project operations
  to the key's organization/project boundary.

## Configuration

### Project-Scoped (Recommended)

Scope the MCP connection to a single project by appending `?project=` to the URL. All tools that accept `projectId` will use this as the default — no need to pass `projectId` on every call.

The `?project=` parameter accepts two formats:

- **`org-slug/ALIAS`** (recommended) — e.g., `?project=acme/WEB`. Uses the organization slug and project alias from the web UI URL.
- **Convex document ID** — e.g., `?project=k57abc123...`. The raw project ID.

```json
{
  "mcpServers": {
    "convoy": {
      "type": "http",
      "url": "https://<DEPLOYMENT>.convex.site/api/mcp?project=<ORG_SLUG>/<PROJECT_ALIAS>",
      "headers": {
        "Authorization": "Bearer sk_user_<API_KEY>"
      }
    }
  }
}
```

Place this in `.mcp.json` at the project root for per-project configuration. The `?project=` parameter is extracted by `handleMcpRequest` and used as a fallback when tool arguments don't include `projectId`.

For Codex, place the equivalent HTTP MCP configuration in
`.codex/config.toml` at the project root:

Minimal configuration:

```toml
[mcp_servers.convoy]
url = "https://<DEPLOYMENT>.convex.site/api/mcp?project=<ORG_SLUG>/<PROJECT_ALIAS>"

[mcp_servers.convoy.http_headers]
Authorization = "Bearer sk_user_<API_KEY>"
```

For OpenCode, place the equivalent remote MCP configuration in
`opencode.json` at the project root (or run
`convoy init mcp --cli opencode`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "convoy": {
      "type": "remote",
      "url": "https://<DEPLOYMENT>.convex.site/api/mcp?project=<ORG_SLUG>/<PROJECT_ALIAS>",
      "headers": { "Authorization": "Bearer sk_user_<API_KEY>" },
      "oauth": false
    }
  }
}
```

For Antigravity, run `agy mcp add` (or `convoy init mcp --cli antigravity`).
agy reads MCP servers only from the user file
`~/.gemini/config/mcp_config.json`, so the server applies to every agy
session on the machine. The URL is quoted because `?` is a zsh glob:

```bash
agy mcp add --header "Authorization: Bearer sk_user_<API_KEY>" convoy "https://<DEPLOYMENT>.convex.site/api/mcp?project=<ORG_SLUG>/<PROJECT_ALIAS>"
```

The API key settings popup and project header `Configure MCP` dialog should
render the Codex, OpenCode and Antigravity snippets with the runtime Convex backend URL
filled in. When the current route contains an organization slug and project
alias, the snippet should include the scoped
`?project=<ORG_SLUG>/<PROJECT_ALIAS>` parameter.
The project header dialog presents `.mcp.json` first, then
`.codex/config.toml` with the minimal Codex configuration followed by the full
per-tool approval version, then `opencode.json`, then the `agy mcp add`
command.

Codex per-tool approval blocks are optional. They may be included to let Codex
run specific Convoy tools without asking each time:

```toml
[mcp_servers.convoy.tools.get_tasks]
approval_mode = "approve"

[mcp_servers.convoy.tools.update_task]
approval_mode = "approve"

[mcp_servers.convoy.tools.move_tasks_to_list]
approval_mode = "approve"

[mcp_servers.convoy.tools.list_project_agents]
approval_mode = "approve"

[mcp_servers.convoy.tools.create_project_agent]
approval_mode = "approve"

[mcp_servers.convoy.tools.update_project_agent]
approval_mode = "approve"

[mcp_servers.convoy.tools.list_prompts]
approval_mode = "approve"

[mcp_servers.convoy.tools.create_prompt]
approval_mode = "approve"

[mcp_servers.convoy.tools.update_prompt]
approval_mode = "approve"

[mcp_servers.convoy.tools.update_task_artifact]
approval_mode = "approve"

[mcp_servers.convoy.tools.replace_in_task_artifact]
approval_mode = "approve"

[mcp_servers.convoy.tools.list_cli_profiles]
approval_mode = "approve"

[mcp_servers.convoy.tools.get_thread]
approval_mode = "approve"

[mcp_servers.convoy.tools.list_threads]
approval_mode = "approve"

[mcp_servers.convoy.tools.list_thread_messages]
approval_mode = "approve"

[mcp_servers.convoy.tools.create_thread]
approval_mode = "approve"

[mcp_servers.convoy.tools.send_thread_message]
approval_mode = "approve"

[mcp_servers.convoy.tools.mark_thread_done]
approval_mode = "approve"

[mcp_servers.convoy.tools.attach_task_to_thread]
approval_mode = "approve"

[mcp_servers.convoy.tools.attach_pull_request_to_thread]
approval_mode = "approve"

[mcp_servers.convoy.tools.submit_pull_request_guide]
approval_mode = "approve"

[mcp_servers.convoy.tools.read_pull_request_guide]
approval_mode = "approve"
```

The full popup/dialog/docs approval list must stay aligned with
`convex/mcp/tools.ts`; when adding or renaming an MCP tool, update the Codex
approval snippets in the API key settings popup and user docs in the same
change.

### Multi-Project (Global)

Omit `?project=` to access all projects. You must pass `projectId` explicitly to every tool call, or call `list_projects` first to discover project IDs.

```json
{
  "mcpServers": {
    "convoy": {
      "type": "http",
      "url": "https://<DEPLOYMENT>.convex.site/api/mcp",
      "headers": {
        "Authorization": "Bearer sk_user_<API_KEY>"
      }
    }
  }
}
```

Place this in `~/.claude/mcp.json` for global access across all projects.

### Project ID Resolution

Tools that accept `projectId` resolve it in this order:

1. **Explicit tool argument** — `projectId` passed in the tool call (always takes priority)
2. **URL default** — `?project=` query parameter from the MCP endpoint URL
3. **Error** — if neither is provided, the tool returns `-32602 Invalid params`

This means an explicit `projectId` in tool arguments always overrides the URL default, enabling cross-project operations even with project-scoped configuration.

For MCP request handling, raw project-id defaults are resolved through the public `projects.getById` query using the same API-key auth path as the other MCP project lookup queries. This is an intentional part of the public MCP-facing query surface.
If `?project=` resolves to a project outside the API key scope, project-scoped
MCP initialization and tool discovery must fail closed instead of silently
advertising that project context. Tool calls using an out-of-scope explicit or
default project must be denied with the same project authorization boundary.

#### URL Project Format Detection

The `?project=` parameter is auto-detected:

- Contains `/` → treated as `org-slug/ALIAS`, resolved via `organizations.core.getBySlug` then `projects.getByAlias`
- No `/` → treated as a raw Convex document ID (passed directly)

### Scoped Status Metadata

When the MCP connection is scoped with `?project=`, `initialize` should include a `projectContext` payload with:

- `projectId`
- `allowedTaskStatuses`
- `disabledTaskStatuses`
- `taskTypeKeys`

Unscoped MCP connections should keep `initialize` generic and omit project-scoped status metadata.

With `?project=org-slug/ALIAS`, the `initialize` instructions also tell agents
how to link tasks and artifacts in replies, using the project's task URL
prefix. See [cli-thread-message-links.md](cli-thread-message-links.md).

## Tools

### Overview

| Tool | Description | Needs projectId |
|------|-------------|-----------------|
| `list_projects` | List accessible projects that are not archived | No |
| `list_task_types` | List built-in task types | No |
| `list_task_lists` | List project Lists for discovery | Yes* |
| `create_task_list` | Create a project List | Yes* |
| `update_task_list` | Rename/re-ref/recolor/set default view of a project List | Yes* |
| `list_task_labels` | List project labels (id, name, color) in board order | Yes* |
| `create_task_label` | Create a project label | Yes* |
| `update_task_label` | Rename/recolor a project label | Yes* |
| `delete_task_label` | Delete a label, resolving referencing tasks | Yes* |
| `list_checks` | List the project's check catalog | Yes* |
| `get_checks` | The Checks that apply to a task or a thread, with status | Yes* |
| `create_check` | Add a Check to the catalog | Yes* |
| `update_check` | Change a Check's label or instruction | Yes* |
| `delete_check` | Delete a Check from the catalog and every Checklist | Yes* |
| `list_checklists` | List the project's Checklists | Yes* |
| `create_checklist` | Create a Checklist | Yes* |
| `update_checklist` | Rename a Checklist or replace its checks or task type defaults | Yes* |
| `delete_checklist` | Delete a Checklist | Yes* |
| `list_project_agents` | List active Project agents for assignment discovery | Yes* |
| `create_project_agent` | Create a Project agent for assignment | Yes* |
| `update_project_agent` | Edit a Project agent | No*** |
| `list_prompts` | List active prompts for a project or organization | Yes*, project scope |
| `create_prompt` | Create a prompt in a project or organization | Yes*, project scope |
| `update_prompt` | Edit a prompt | No*** |
| `list_skills` | List a project's or an organization's Skills (metadata only) | Yes*, project scope |
| `get_skill` | Get one Skill with SKILL.md and every other file's content | No |
| `create_skill` | Create a Skill in a project or an organization | Yes*, project scope |
| `update_skill` | Edit a Skill's columns, its SKILL.md, and/or its files | No |
| `delete_skill` | Delete a Skill | No |
| `install_skill` | Install an organization Skill into a project, as a copy | Yes* |
| `load_skill` | Load a project Skill by name: its SKILL.md plus its other file paths | Yes* |
| `read_skill_file` | Read one file inside a project Skill | Yes* |
| `list_tasks` | List tasks in a project | Yes* |
| `list_closed_tasks` | List recently closed tasks, newest closed first | Yes* |
| `search_tasks` | Full-text search with filters and pagination | Yes* |
| `get_task` | Get a single task by ID or ref | Sometimes** |
| `get_tasks` | Look up tasks by task IDs or refs | Sometimes** |
| `create_task` | Create a new task | Yes* |
| `create_task_comment` | Create a new comment on a task | Sometimes** |
| `update_task` | Update task fields | Sometimes** |
| `update_task_link` | Upsert or delete one external link (commit/branch/PR/URL) on a task | Sometimes** |
| `move_task` | Move a task to a new parent or to top-level | Sometimes** |
| `move_tasks_to_list` | Move one or more existing tasks into an active project List | Yes* |
| `delete_task` | Soft-delete a task | Sometimes** |
| `list_task_artifacts` | List document artifacts (markdown or html) for a task | Sometimes** |
| `get_task_artifact` | Get one artifact by ID, optionally with comment threads | No |
| `create_task_artifact` | Create a document artifact (markdown or html) on a task | Sometimes** |
| `update_task_artifact` | Update artifact name/content metadata | No |
| `replace_in_task_artifact` | Replace an exact string in artifact content | No |
| `move_task_artifact` | Move an artifact to another task in the same project | Sometimes** |
| `delete_task_artifact` | Delete an artifact | No |
| `list_artifact_comments` | List an artifact's comment threads | No |
| `create_artifact_comment` | Comment on a text snippet in a markdown artifact | No |
| `reply_to_artifact_comment` | Reply to a root artifact comment | No |
| `set_artifact_comment_status` | Resolve/un-resolve root artifact comments (batch) | No |
| `list_cli_profiles` | List the caller's CLI profiles (connected machines) for thread spawn-target discovery | Yes* |
| `get_thread` | Get one CLI thread (or thread-group container) with its runtime target | No |
| `list_threads` | List CLI threads in a project, or one thread group's members | Yes* |
| `list_thread_messages` | Read a CLI thread's most recent messages with composed text | No |
| `create_thread` | Start a CLI thread, optionally adding it to a Thread group | No |
| `send_thread_message` | Queue a user message in another CLI thread, never its own | No |
| `mark_thread_done` | Mark an owned thread or container done and read, or not done | No |
| `attach_task_to_thread` | Attach a task to an owned thread started without one | No |
| `attach_pull_request_to_thread` | Attach a GitHub PR to an owned thread that has none | No |
| `submit_pull_request_guide` | Submit the pull request Guide a thread was started to write, or why it could not be written | No |
| `read_pull_request_guide` | Read a PR's Guides with run state and `outdated`, and one Guide's steps | Yes* |

**\*** Required unless configured via `?project=` URL parameter.

**\*\*** `projectId` is only needed when a tool resolves a task ref (e.g. `ABC-5`). Raw task document IDs do not need it. Scoped-format refs like `org-slug/ABC-5` are accepted but the org prefix is stripped — they resolve as bare refs and still require project context.

**\*\*\*** Project scope is derived from `projectAgentId` and still enforced
against the caller's API-key scope.

`list_projects` returns only projects allowed by both the user's permissions and
the API key scope. For an organization-scoped key with no project allowlist, it
returns every user-accessible project in that organization. For an
organization-scoped key with a project allowlist, it returns only those
allowlisted projects that are still user-accessible and still belong to the
scoped organization.

API key scope applies even when a tool starts from a raw resource ID and does
not require `projectId` in its input. After resolving a task, comment, artifact,
thread, or other project-owned resource, the handler must authorize the owning
project against the key scope and the user's normal permissions before returning
or mutating it.

API key scope edits take effect on the next MCP request using that key. Clients
do not need a regenerated token, but requests outside the updated scope must be
denied immediately after the scope change is stored.

### Enum Values

**Status**: `To Do` | `Triage` | `Planning` | `Plan Review` | `In Progress` | `In Review` | `Blocked` | `Done` | `Canceled`

Backlog is the system List ref `BACKLOG`, not a status enum value.

For project-scoped MCP connections:

- `list_tasks.status` and `search_tasks.filters.status` continue to expose the full real status catalog.
- `create_task.status` and `update_task.status` should expose only the project's allowed statuses.

**Priority**: `None` | `Low` | `Medium` | `High` | `Critical`

**Archive Mode**: `active` | `archived`

**Cascade Mode**: `delete_all` | `keep_children`

### Task Type Keys

- Task create/update operations accept `taskTypeKey`, not raw task-type IDs.
- For project-scoped MCP connections, `initialize.projectContext.taskTypeKeys` and `tools/list` should expose only the active keys for that project.
- Invalid `taskTypeKey` inputs must return `-32602 Invalid params` and list the allowed active keys.
- Task payloads returned by MCP task tools include a resolved `taskType` summary.

Task payload `taskType` shape:

```json
{
  "key": "task",
  "name": "Task"
}
```

`list_task_types` returns the fuller catalog shape:

```json
{
  "key": "task",
  "name": "Task",
  "icon": "SquareCheckBig",
  "color": "#64748b",
  "isSystem": true,
  "isArchived": false
}
```

#### list_task_types

No parameters required. Returns the built-in task types (task, bug, feature, epic, investigation, chore, idea) with their name, icon, color, and order.

### Tool Details

#### list_projects

No parameters. Returns the projects the authenticated user can access across
all organizations, minus archived ones
([project-archive.md](project-archive.md)). Tools that take a `projectId` still
work on an archived project.
Results are sorted using natural, case-insensitive project-name ordering, with deterministic tie-breakers by alias then project ID.

#### list_task_lists

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `projectId` | string | No* | — | Project ID |
| `archived` | boolean | No | `false` | Return archived Lists instead of active Lists |
| `query` | string | No | — | Optional List name/ref search query |
| `limit` | integer | No | `20` | Page size (1–50) |
| `cursor` | string \| null | No | `null` | Pagination cursor |

Returns project Lists for discovery by agents. The first active page includes
the Backlog system List and Backlog counts against the requested `limit`. When
`limit` is `1`, clients should follow the returned cursor to continue into
persisted Lists. List identifiers accepted by task tools are raw List IDs, bare
project-scoped List refs such as `SPRINT-1`, or the reserved system List ref
`BACKLOG`. Unfiltered persisted Lists are returned in project List rank order;
server-side List search may return full-text search relevance order. Rows carry
`defaultViewMode`, `defaultListGroupBy`, `defaultBoardGroupBy` and
`defaultBoardRowGroupBy` only when that List stores them; the synthetic Backlog
row never carries them.

#### create_task_list

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `projectId` | string | No* | — | Project ID |
| `name` | string | Yes | — | List name (unique per project, max 80 chars) |
| `ref` | string | No | derived from name | List ref (uppercase; `BACKLOG`/`ARCHIVED` reserved) |
| `color` | string | No | — | Color from the List palette (enum in the schema) |
| `defaultViewMode` | `"list"` \| `"board"` | No | inherit | Per-List default view; omit to inherit the project default |
| `defaultBoardGroupBy` | string | No | `status` | Board grouping when `defaultViewMode` is `board`; ignored otherwise |

Requires `list:manage`. Enforces the 20-active-Lists-per-project cap. Returns
`{ listId }`.

#### update_task_list

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `projectId` | string | No* | — | Project ID (used to resolve List refs) |
| `listId` | string | Yes | — | Raw List ID or bare project-scoped List ref |
| `name` | string | No | — | New name |
| `ref` | string | No | — | New ref |
| `color` | string \| null | No | — | New color from the List palette; `null` clears |
| `defaultViewMode` | `"list"` \| `"board"` \| null | No | — | Per-List default view; `null` clears the override so the List inherits the project default |
| `defaultBoardGroupBy` | string | No | `status` | Board grouping when `defaultViewMode` is `board`; ignored otherwise |

Requires `list:manage` and at least one of `name`/`ref`/`color`/`defaultViewMode`.
All fields land in one `tasks.lists.update` transaction, so a rename can never
commit without its view change. System Lists
(`BACKLOG`) and scoped refs containing `/` are rejected. Archive, unarchive,
delete, and default-List changes remain UI-only (OS-896). Returns `{ listId }`.

#### list_task_labels

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `projectId` | string | No* | — | Project ID |

Returns `{ labels: [{ _id, name, color }] }` in rank (board-column) order.
Requires `task:view`. Label identifiers accepted by other tools are raw label
IDs or exact label names, matched case- and whitespace-insensitively.

#### create_task_label

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `projectId` | string | No* | — | Project ID |
| `name` | string | Yes | — | Label name (unique per project, max 50 chars) |
| `color` | string | No | blue `#3b82f6` | Color from the extended palette (enum in the schema) |

Requires `project:update`. Enforces the 20-labels-per-project cap. Returns
`{ labelId }`.

#### update_task_label

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `projectId` | string | No* | — | Project ID (used to resolve label names) |
| `labelId` | string | Yes | — | Label ID or exact name |
| `name` | string | No | — | New name |
| `color` | string | No | — | New color from the extended palette |

Requires `project:update`. Tasks keep the label (referenced by id).

#### delete_task_label

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `projectId` | string | No* | — | Project ID (used to resolve label names) |
| `labelId` | string | Yes | — | Label ID or exact name |
| `resolution` | string | No | `"clear"` | `clear`, `reassign`, or `archiveTasks` (see task-labels spec) |
| `reassignTo` | string | For reassign | — | Target label ID or exact name |

Requires `project:update`. Hard-deletes the label and resolves every
referencing task in the same mutation (see `docs/specs/task-labels.md`).
Returns `{ affectedTaskIds }`. Label reordering is not exposed over MCP
(board-order is a UI concern).

#### Checks and Checklists

Thin wrappers over `checks.definitions.*` and `checks.checklists.*` (see
[task-checks.md](task-checks.md)). Reads need `task:view`, writes
`project:update`. Every tool takes an optional `projectId` (No*).

| Tool | Params | Returns |
|------|--------|---------|
| `list_checks` | — | `{ checks: [{ _id, key, label, instruction }] }` |
| `get_checks` | exactly one of `taskId` (ID or ref) or `threadId` | `{ taskId, checklist: { _id, name } \| null, checks: [{ key, label, instruction?, status, note?, value?, artifactId?, reportedAt?, added? }] }`; `status` is `pending` until reported. A thread with no task returns its own Checks with `taskId: null` |
| `create_check` | `key`, `label` (required), `instruction` (default `""`) | `{ checkId }` |
| `update_check` | `checkId` (required), `label`, `instruction` | `{ checkId }` |
| `delete_check` | `checkId` (required) | `{ checkId }` |
| `list_checklists` | — | `{ checklists: [{ _id, name, checkKeys, taskTypeKeys }] }` |
| `create_checklist` | `name` (required), `checkKeys`, `taskTypeKeys` (both default `[]`) | `{ checklistId }` |
| `update_checklist` | `checklistId` (required), `name`, `checkKeys`, `taskTypeKeys` | `{ checklistId }` |
| `delete_checklist` | `checklistId` (required) | `{ checklistId }` |

- `checkId` is a check ID or key. `checklistId` is a Checklist ID or exact
  name, matched case- and whitespace-insensitively. No match is an
  invalid-params error naming the list tool.
- The key is immutable; `update_check` rejects a `key` argument instead of
  dropping it. `checkKeys` and `taskTypeKeys` replace the whole
  list; `checkKeys` order is the Checklist order.
- Deleting a Check removes its key from every Checklist. Deleting a
  Checklist sends tasks that picked it back to their type default.

#### list_tasks

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `projectId` | string | No* | — | Project ID |
| `includeArchived` | boolean | No | `false` | List archived tasks instead of active tasks |
| `status` | string | No | — | Optional real workflow status value to include (e.g. `"Done"`) |
| `listId` | string | No | — | Raw List ID, bare project-scoped List ref, or reserved system List ref `BACKLOG` |
| `includeLinks` | boolean | No | `false` | Include each task's `externalLinks` array in the summaries |

Returns tasks in LexoRank order (same as the UI).
If `status` is omitted, no status filter is applied (all statuses in the selected archive mode are returned).
Legacy `statuses` is not accepted; use `status` and pass one status.
Each task row is an MCP summary with only:
- `_id`, `refId`, `parentId`, `name`
- `status`, `priority`, `dueDate`
- `assignee` (hydrated human owner) and `delegatedToAgent` (hydrated executing agent) — see the split assignment model under `create_task`
- `tags`
- `labelId` (resolve names/colors via `list_task_labels`)
- `closedAt` when set ([task-closed-at.md](task-closed-at.md))
- `taskType: { key, name }`
- `externalLinks` only when `includeLinks: true`

The list response intentionally omits backend and UI-only fields such as raw rank, deletion/archive internals, creation metadata, avatars, task type icon/color metadata, and full descriptions. Use `get_task` or `get_tasks` for detailed task context.

#### list_project_agents

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `projectId` | string | No* | — | Project ID |

Returns active Project agents available for delegation in the project, including
`projectAgentId`, `name`, optional `description`, optional `prompt`, optional
`category`, `appearance.color`, and optional `automation`.

#### create_project_agent

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `projectId` | string | No* | — | Project ID |
| `name` | string | Yes | — | Project-agent name |
| `description` | string | No | — | Optional short description |
| `prompt` | string | No | — | Optional working prompt |
| `category` | string | No | — | Optional category label |
| `appearance` | object | Yes | — | `{ color }`, where `color` is one of the supported Agent palette colors |
| `automation` | object | No | — | `{ enabled, prompt?, cliType?, cliModel?, cliEffort?, mode?, workspace? }` assignment-automation config (see below) |

Creates a project-local Project agent and returns:

```json
{ "projectAgentId": "<projectAgentId>" }
```

#### update_project_agent

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `projectAgentId` | string | Yes | — | Project agent ID |
| `name` | string | No | — | New Project-agent name |
| `description` | string \| null | No | — | New short description, or null to clear |
| `prompt` | string \| null | No | — | New working prompt, or null to clear |
| `category` | string \| null | No | — | New category label, or null to clear |
| `appearance` | object | No | — | `{ color }`, where `color` is one of the supported Agent palette colors |
| `automation` | object \| null | No | — | New assignment-automation config, or null to clear (see below) |

Only specified fields are updated. Returns `null`.

Assignment-automation config shape (see `docs/specs/agent-automation.md`):

- `enabled` (boolean, required): whether assigning a task to this agent in the
  web UI offers to start a thread.
- `prompt` (string, optional): plain-text automation prompt used to prefill the
  thread composer. Slash-command refs can only be inserted through the web UI
  composer; providing `automation` over MCP replaces the whole config, so a
  web-authored prompt with slash-command refs is replaced by the plain text
  supplied here.
- `cliType` (string, optional): preferred CLI runtime slug preselected in the
  composer; validated against the supported runtime slugs.
- `cliModel` (string, optional): preferred model preselected in the composer.
- `cliEffort` (string, optional): preferred reasoning-effort level preselected
  in the composer.
- `mode` (string, optional): preferred CLI mode preselected in the composer.
- `workspace` (string, optional): `"local"` or `"worktree"` — whether the
  automation thread prefers the selected checkout as-is or a new worktree
  (branch derived from the attached task, based on the repo's default branch;
  see `docs/specs/agent-automation.md`).

Automation itself only triggers for delegations made in the Convoy web UI.
Delegating a task to an agent via MCP (`create_task`/`update_task`
`delegatedToAgentId`) never opens a composer or starts a thread.

#### Prompt Scope Arguments

`list_prompts` and `create_prompt` target one of the two prompt scopes
(`docs/specs/slash-commands.md`) through the same arguments:

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `scope` | string | No | `project` | `project` or `organization` |
| `projectId` | string | No* | — | Project scope only |
| `organization` | string | No | — | Organization scope only: slug or organization ID |

Organization resolution order:

1. **Explicit `organization` argument** — a slug or an organization ID, both
   resolved through `organizations.core.getByRef` within the key's scope. An
   unresolvable ref fails with `Organization '<ref>' not found or outside API
   key scope` rather than reaching a mutation as a raw ID
2. **Organization of the resolved project** — the `projectId` argument, else the
   `?project=` default. When neither is available the error names both the
   `organization` and the project arguments

An MCP API key is only organization-scoped when the key carries a scope, so the
organization is never inferred from the key itself. Slash-command queries and
mutations enforce the key's organization scope directly, so a key scoped to one
organization cannot read or write another organization's prompts — and a key
narrowed to specific projects cannot reach organization prompts at all
(`docs/specs/slash-commands.md`, Headless Access).

`update_prompt` takes no scope arguments: the stored prompt carries its scope
and the backend derives permissions from it. Deleting prompts is not exposed
over MCP.

#### list_prompts

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| Scope arguments | — | No | project scope | See "Prompt Scope Arguments" |

Returns active prompts for the scope, each with `promptId`, `scope`, `key`,
optional `description`, optional `category`, `content`, `autoExpand`, and
`autoSubmit`.

#### create_prompt

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| Scope arguments | — | No | project scope | See "Prompt Scope Arguments" |
| `key` | string | Yes | — | Prompt key without the leading slash |
| `content` | string | Yes | — | Prompt content |
| `description` | string | No | — | Optional short description |
| `category` | string | No | — | Optional category label |
| `autoExpand` | boolean | No | `false` | Expand into the composer on selection |
| `autoSubmit` | boolean | No | `false` | Submit the message on selection |

Returns:

```json
{ "promptId": "<promptId>" }
```

#### update_prompt

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `promptId` | string | Yes | — | Prompt ID |
| `key` | string | No | — | New prompt key without the leading slash |
| `content` | string | No | — | New prompt content |
| `description` | string \| null | No | — | New short description, or null to clear |
| `category` | string \| null | No | — | New category label, or null to clear |
| `autoExpand` | boolean | No | — | New auto-expand setting |
| `autoSubmit` | boolean | No | — | New auto-submit setting |

Only specified fields are updated. Returns `null`.

#### Skill tools

`list_skills` and `create_skill` take a `scope` of `project` or `organization`,
defaulting to `project`, and resolve their target exactly as the prompt tools do
(`docs/specs/skills.md`, Headless Access). An `organization` argument in project
scope is invalid params, not a silently ignored argument. The rest take a
`skillId`, which carries its own scope. A key narrowed to specific projects cannot
reach organization Skills at all.

| Tool | Params | Returns |
|------|--------|---------|
| `list_skills` | `scope`, `organization`, `projectId` | Array of `skillId`, `scope`, `name`, `description`, `category`, `version` — no file content |
| `get_skill` | `skillId` | The list fields plus `skillMd` and `files: [{ path, content }]`, or `null` |
| `create_skill` | `scope`, `organization`, `projectId`, `name`, `content`, `description`, `category` | `{ "skillId": "<skillId>" }` |
| `update_skill` | `skillId`, `name`, `content`, `description` \| `null`, `category` \| `null`, `edits` | `{ "ok": true, "version": 4 }`, or an error result (below) |
| `delete_skill` | `skillId` | `null` |
| `install_skill` | `skillId`, `projectId` | `{ "skillId": "<copy>" }` |
| `load_skill` | `name`, `projectId` | `{ name, description, skillMd, paths }`, or `null` |
| `read_skill_file` | `name`, `path`, `projectId` | `{ path, content }`, or `null` |

`install_skill` copies an organization Skill into the project, which is what makes
it loadable at all: `skillId` is a template's, from `list_skills` at organization
scope, and the returned ID is the project copy's (`docs/specs/skills.md`, Scope And
Install Model). A key narrowed to specific projects can install a template it cannot
list, since the install is authorized by the project permission — see that spec's
Permissions section. Refresh has no tool: overwriting a project's work is a decision for
a person, so it stays in the settings UI.

`load_skill` and `read_skill_file` are the agent's read surface: they resolve a
**name** among the project's Skills only, never an organization template, and
answer `null` for a name or a path that is not there — a malformed one included,
rather than the write path's validation error. `load_skill`'s own description
enumerates the project's Skills, one flattened line each, which is how an agent
discovers them; on a connection with no project it says so instead — see
`docs/specs/skills.md`, Agent Delivery.

`name` and `content` are required on `create_skill`; every other argument is
optional, and `update_skill` changes only what it is passed. `content` is
`SKILL.md`, stored verbatim: it never feeds `name` or `description`.

There are no per-file tools. `update_skill`'s `edits` is an ordered batch, each
entry an object whose `op` selects the rest of its fields:

| `op` | Fields | Effect |
|------|--------|--------|
| `write` | `path`, `content` | Create `path`, or overwrite it if it exists. `content` may be empty. |
| `replace` | `path`, `oldString`, `newString`, `replaceAll` | Swap an exact string inside `path`. |
| `move` | `path`, `newPath` | Rename `path`. |
| `delete` | `path` | Remove `path`. |

The batch is a read-modify-write of the Skill's whole file set in the same
mutation as the column patch, so: edits apply in order and each sees the previous
ones' results; the path rules and the caps (50 files, 256 KB per file, 1 MB per
Skill) are checked against the whole set; the Skill's `version` moves at most
once; and a rejected edit writes nothing at all, columns included. `SKILL.md` is
writable through `write` and `replace` but cannot be renamed or deleted.

A `replace` reports a miss as a value rather than failing, so an agent can retry
with a better `oldString`. Failures come back as an MCP error result carrying:

```json
{
  "ok": false,
  "index": 1,
  "code": "multiple_matches",
  "message": "oldString matches 2 locations in SKILL.md; pass replaceAll to replace every occurrence",
  "occurrences": 2
}
```

`index` is the position in `edits` of the edit that stopped the save. `code` is
`old_string_not_found` (with `occurrences: 0`) or `multiple_matches`.
`replaceAll` defaults to `false`, which requires exactly one match. Anything else
— a missing file, a bad path, a cap breach — fails the call instead.

#### list_closed_tasks

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `projectId` | string | No* | — | Project ID |
| `status` | string | No | `"Done"` | `Done` or `Canceled` |
| `limit` | integer | No | `50` | 1–200 |
| `since` | string | No | — | Inclusive ISO-8601 lower bound on `closedAt` |
| `until` | string | No | — | Exclusive ISO-8601 upper bound on `closedAt` |

Calls `tasks.core.listClosed` and returns the `list_tasks` summary shape, newest
`closedAt` first. Covers every List, archived tasks and subtasks. Tasks closed
before `closedAt` tracking shipped are not returned. Unparseable dates, open
statuses and out-of-range limits return `-32602 Invalid params`. Full rules:
[task-closed-at.md](task-closed-at.md).

#### search_tasks

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `projectId` | string | No* | — | Project ID |
| `query` | string | Yes | — | Search text (name, description, tags, ref) |
| `archiveMode` | string | No | `"active"` | `"active"` or `"archived"` |
| `filters` | object | No | — | `{ status?, assigneeId?, delegatedToAgentId? }`; `assigneeId` is a user ID (owner filter), `"me"` for the caller's own tasks, or `null` for tasks with no owner; `delegatedToAgentId` is a project agent ID (delegation filter) or `null` for non-delegated tasks. `filters.assignee` is removed and rejected (see `create_task`). |
| `limit` | integer | No | `20` | Page size (1–50) |
| `cursor` | string | No | `null` | Pagination cursor |
| `listId` | string | No | — | Raw List ID or bare project-scoped List ref |

#### get_task

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `taskId` | string | Yes | Task ID or ref (e.g. `ABC-5`) |
| `projectId` | string | No | Required when resolving refs. Optional if configured via `?project=` URL parameter |

Returns the task plus:
- `externalLinks`: the task's external links (see `update_task_link`); defaults to `[]`
- `artifacts`: artifact summaries (no content; include `contentType`)
- `files`: attachment summaries with `url` download links
- `comments`: latest 50 comments (newest first), each with attachment metadata and download URLs
- `commentsHasMore`: boolean indicating whether older comments exist beyond the returned 50
- `subtasks`: direct child tasks with basic fields (`_id`, `refId`, `name`, `status`, `priority`, `assignee`, `delegatedToAgent`, `dueDate`, `subtaskCount`). Use `get_task` on a subtask's `_id` to retrieve its full details and nested subtasks.
- resolved `taskType: { key, name }`
- `checklist` and `checks`, when the project has Checklists or the task
  has Check results: the Checklist in effect as `{ _id, name }` (`null` for
  no checks) and the derived rows as `[{ key, label, status, note?,
  reportedAt?, added? }]`. `status` is the current result, or `pending`;
  `added` marks a Check reported outside the Checklist
  (`docs/specs/task-checks.md`). The raw `checklistId` field is stripped.

Detailed task responses keep user-relevant fields such as `description`, `createdAt`, `updatedAt`, and `tags`, and include both `assignee` (hydrated human owner) and `delegatedToAgent` (hydrated executing agent) projections, but omit backend and UI-only fields such as raw rank, client IDs, deletion internals, creator IDs, avatars, and task type icon/color metadata.
Artifact and file summaries omit redundant `taskId`; artifact summaries also omit storage-oriented `fileName`. Comment summaries omit redundant `taskId`, author avatar URLs, and UI permissions such as `canEdit` / `canDelete`.

Identifier rules for `get_task`, `get_tasks`, `create_task.parentId`, `create_task_comment.taskId`, `update_task.taskId`, `update_task_link.taskId`, `move_task.taskId`, `move_task.parentId`, `delete_task.taskId`, `list_task_artifacts.taskId`, and `create_task_artifact.taskId`:

- Raw task document IDs are accepted directly.
- Bare refs like `ABC-5` require project context from either:
  - `projectId`, or
  - the MCP server URL `?project=` scope.
- Scoped-format refs like `org-slug/ABC-5` are accepted for convenience but the org prefix is ignored — the ref part (`ABC-5`) is resolved against the current project context, same as a bare ref.

#### get_tasks

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `identifiers` | string[] | Yes | Array of task document IDs or refs, max 25 |
| `projectId` | string | No | Required when resolving refs. Optional if configured via `?project=` URL parameter |

Returns results in input order. Falls back to archived tasks if not found among active.
Each result item includes the original `identifier`, plus either:
- `task` with the detailed task payload, or
- `task: null` and an `error` string when that identifier could not be resolved

For matched tasks, includes:
- `externalLinks`: the task's external links (see `update_task_link`); defaults to `[]`
- `artifacts`: artifact summaries (no content; include `contentType`)
- `files`: attachment summaries with `url` download links
- `comments`: latest 50 comments (newest first), each with attachment metadata and download URLs
- `commentsHasMore`: boolean indicating whether older comments exist beyond the returned 50
- `subtasks`: direct child tasks with basic fields (`_id`, `refId`, `name`, `status`, `priority`, `assignee`, `delegatedToAgent`, `dueDate`, `subtaskCount`). Use `get_task` on a subtask's `_id` to retrieve its full details and nested subtasks.
- resolved `taskType: { key, name }`

The task detail shape matches `get_task`, except `isArchived` is retained so callers can tell when a task was resolved through the archived fallback.

#### create_task

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `projectId` | string | No* | — | Project ID |
| `name` | string | Yes | — | Task title |
| `description` | string | No | — | Markdown/plain text or serialized ProseMirror JSON doc |
| `taskTypeKey` | string | No | `"task"` | Stable task type key |
| `parentId` | string | No | — | Parent task document ID or ref (for subtasks) |
| `listId` | string | No | — | Raw List ID or bare project-scoped List ref |
| `priority` | string | No | `"None"` | Priority level |
| `status` | string | No | `"To Do"` | Initial status |
| `dueDate` | number | No | — | Unix timestamp |
| `assigneeId` | string \| null | No | — | User ID of the human owner, `"me"` for the caller; `null` leaves the task unassigned |
| `delegatedToAgentId` | string \| null | No | — | Project agent ID executing the task; `null` clears delegation |
| `tags` | string[] | No | `[]` | Tag strings |
| `label` | string | No | — | Label ID or exact label name |

Split assignment model (OS-1335): `assigneeId` is the human owner accountable
for the task; `delegatedToAgentId` is the agent executing it. The legacy typed
`assignee` object param is removed and rejected with
`assignee is no longer supported; use assigneeId (user) and/or delegatedToAgentId (agent)`.
Delegating a task that would have no owner auto-sets the caller as owner,
unless the same call explicitly passes `assigneeId` (including
`assigneeId: null`, which keeps the task ownerless).

Auto-assigns `refNumber` (next sequential for the project) and LexoRank.
For project-scoped MCP connections, the advertised `status` enum is narrowed to the project's allowed statuses, and disabled statuses must be rejected server-side.
For project-scoped MCP connections, the advertised `taskTypeKey` enum is narrowed to the project's active task type keys.
`description` normalization rules:
- If the string is a serialized ProseMirror doc JSON (`{"type":"doc", ...}`), it is stored unchanged.
- Otherwise, it is treated as markdown/plain text and normalized to ProseMirror JSON before persistence.
- Server implementation note: backend normalization uses `prosemirror-markdown` token mapping rather than Tiptap markdown beta APIs.

Returns a structured object:

```json
{
  "taskId": "<taskId>",
  "refId": "ABC-123",
  "taskPath": "/o/<orgSlug>/<projectAlias>?task=ABC-123",
  "taskUrl": "https://<app-base>/o/<orgSlug>/<projectAlias>?task=ABC-123"
}
```

URL behavior:
- `taskPath` is always a relative app path when metadata resolution succeeds.
- `taskUrl` uses `NEXT_PUBLIC_APP_URL` (with trailing slash trimmed) as base.
- If `NEXT_PUBLIC_APP_URL` is not set, fallback base is `https://app.convoy.localhost`.
- URL enrichment must use the mutation-returned project/org metadata plus a
  narrow internal organization lookup by ID. It must not call broad project
  discovery (`list_projects` / `projects.listAccessible`) after task creation
  just to build the URL.
- The created task's organization is an invariant in this path. Missing
  organization metadata is treated as an internal consistency failure, not a
  normal nullable URL response.

#### create_task_comment

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `taskId` | string | Yes | Task ID or ref (e.g. `ABC-5`) |
| `projectId` | string | No | Required when resolving refs. Optional if configured via `?project=` URL parameter |
| `content` | string | Yes | Comment markdown content (trimmed; must be non-empty) |

Creates a task comment and returns the new comment ID.

#### update_task

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `taskId` | string | Yes | Task ID or ref (e.g. `ABC-5`) |
| `projectId` | string | No | Required when resolving refs. Optional if configured via `?project=` URL parameter |
| `name` | string | No | New title |
| `description` | string \| null | No | Markdown/plain text or serialized ProseMirror JSON doc; null clears |
| `taskTypeKey` | string \| null | No | New task type key; `null` resets to the default `task` type |
| `priority` | string | No | New priority |
| `status` | string | No | New status |
| `dueDate` | number \| null | No | Unix timestamp or null to clear |
| `assigneeId` | string \| null | No | User ID of the human owner, `"me"` for the caller; `null` unassigns |
| `delegatedToAgentId` | string \| null | No | Project agent ID executing the task; `null` clears delegation |
| `tags` | string[] | No | Replaces all tags |
| `label` | string \| null | No | Label ID or exact label name; `null` clears |
| `checklist` | string \| null | No | Checklist ID or exact name; `null` means no checks. Calls `tasks.core.setChecklist` (`task:update`) before the other fields |

Only specified fields are updated. Each change is logged in the activity trail.
Assignment follows the split model documented under `create_task`: the legacy
`assignee` object param is rejected, clearing delegation keeps the owner,
changing the owner keeps the delegation, and delegating a task with no owner
auto-sets the caller as owner unless `assigneeId` is explicitly passed
(`assigneeId: null` keeps it ownerless).
For project-scoped MCP connections, the advertised `status` enum is narrowed to the project's allowed statuses, and disabled statuses must be rejected server-side.
For project-scoped MCP connections, the advertised `taskTypeKey` enum is narrowed to the project's active task type keys.
`description` normalization rules:
- `null` clears description.
- A serialized ProseMirror doc JSON string is stored unchanged.
- Any other string is treated as markdown/plain text and normalized to ProseMirror JSON before persistence.
- Server implementation note: backend normalization uses `prosemirror-markdown` token mapping rather than Tiptap markdown beta APIs.

#### update_task_link

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `taskId` | string | Yes | Task ID or ref (e.g. `ABC-5`) |
| `projectId` | string | No | Required when resolving refs. Optional if configured via `?project=` URL parameter |
| `op` | string | Yes | `"upsert"` or `"delete"` |
| `id` | string | Yes | Stable link ID, 1–160 chars of `a-zA-Z0-9._:-` |
| `link` | object | For upsert | Kind-discriminated link payload (see below) |

Manipulates a single entry of the task's embedded `externalLinks` array (see
`docs/specs/task-external-links.md` for the data model and validation rules).

Link payload kinds and fields:

| `kind` | Required | Optional |
|--------|----------|----------|
| `commit` | `sha` (7–64 hex chars) | `title`, `repo`, `branch`, `url` |
| `branch` | `name` | `repo`, `url` |
| `pull_request` | `url` | `title`, `identifier`, `repo`, `branch` |
| `url` | `url` | `title` |

Semantics:

- Link IDs are caller-generated and unique within the task. Agents should use deterministic IDs (e.g. `github-pr-owner-repo-123`, `commit-<sha>`) so repeated upserts update instead of duplicating.
- `upsert` replaces the whole link with the provided payload when `id` exists (preserving the original `createdAt`, in place — stable insertion order), otherwise appends.
- `delete` is idempotent: deleting a missing `id` succeeds with no change.
- `url` fields must be http(s) URLs. Tasks hold at most 20 links.
- Returns `{ taskId, externalLinks }` with the full updated array.
- Requires task update permission; invalid payloads surface as invalid params.

#### move_task

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `taskId` | string | Yes | Task ID or ref (e.g. `ABC-5`) |
| `parentId` | string \| null | Yes | Target parent document ID/ref, or `null` to move the task to top-level |
| `projectId` | string | No | Required when resolving refs. Optional if configured via `?project=` URL parameter |

Rank behavior:

- `move_task` does **not** accept external LexoRank input.
- The server computes the destination rank internally.
- Default placement appends the moved task to the end of the destination sibling list.
- Existing internal web UI callers may still use `tasks.updateParent` with an explicit rank for precise placement semantics.

#### move_tasks_to_list

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `taskIds` | string[] | Yes | Task IDs or refs to move, max 25 |
| `listId` | string | Yes | Raw List ID or bare project-scoped List ref |
| `projectId` | string | No | Required when resolving refs. Optional if configured via `?project=` URL parameter |

Moves one or more existing tasks into an active project List. Parent/child overlap is rejected by the backend.

#### delete_task

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `taskId` | string | Yes | — | Task ID or ref (e.g. `ABC-5`) |
| `projectId` | string | No | — | Required when resolving refs. Optional if configured via `?project=` URL parameter |
| `cascadeMode` | string | No | `"delete_all"` | How to handle subtasks |

Soft-delete only. Permanent deletion is scheduled after 30 days.

#### list_task_artifacts

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `taskId` | string | Yes | Task ID or ref (e.g. `ABC-5`) |
| `projectId` | string | No | Required when resolving refs. Optional if configured via `?project=` URL parameter |

Returns artifact summaries sorted by `updatedAt` descending.

#### get_task_artifact

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `artifactId` | string | Yes | Artifact document ID |
| `includeComments` | boolean | No | Include the artifact's comment threads (default `false`) |
| `commentsStatus` | string | No | With `includeComments`, only threads whose root is `open` or `resolved` (default: all) |

Returns full artifact document including `content` and `contentType` (`markdown` | `html`; absent means `markdown` on legacy rows). With `includeComments`, a `comments` array is added using the same thread shape as `list_artifact_comments`.

#### create_task_artifact

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `taskId` | string | Yes | — | Task ID or ref (e.g. `ABC-5`) |
| `projectId` | string | No | — | Required when resolving refs. Optional if configured via `?project=` URL parameter |
| `name` | string | Yes | — | Artifact title |
| `content` | string | No | `""` | Artifact content |
| `contentType` | string | No | `markdown` | `markdown` or `html`. Immutable after creation |
| `runId` | string | No | — | Optional agent run identifier |

`source` is automatically set to `"agent"` for MCP calls.

#### update_task_artifact

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `artifactId` | string | Yes | Artifact document ID |
| `name` | string | No | New title |
| `content` | string | No | New content (content type cannot be changed) |
| `runId` | string \| null | No | Optional run identifier (pass `null` to clear) |

Only provided fields are updated.

#### replace_in_task_artifact

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `artifactId` | string | Yes | — | Artifact document ID |
| `oldString` | string | Yes | — | Exact existing string to replace |
| `newString` | string | Yes | — | Replacement string |
| `replaceAll` | boolean | No | `false` | Replace every occurrence instead of requiring exactly one match |

Semantics mirror targeted editor replacement:

- Matching is an exact string match. Whitespace, newlines, and casing must match stored artifact content.
- Empty `oldString` is rejected with `-32602 Invalid params` at the MCP boundary.
- With `replaceAll: false`, zero matches and multiple matches both fail; exactly one match is replaced.
- With `replaceAll: true`, every occurrence is replaced; zero matches still fails.
- Zero-match and multiple-match failures are MCP tool errors in a successful JSON-RPC response (`isError: true`), not JSON-RPC internal errors.
- Result content must fit the artifact content cap.
- The operation reuses the existing `artifact_updated` activity event.

#### move_task_artifact

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `artifactId` | string | Yes | Artifact document ID |
| `taskId` | string | Yes | Target task ID or ref (e.g. `ABC-5`) |
| `projectId` | string | No | Required when resolving refs. Optional if configured via `?project=` URL parameter |

Moves the artifact — it leaves the source task, taking its comments. The target
task must be in the same project. See "Moving Artifacts Between Tasks" in
`docs/specs/task-artifacts.md`.

#### delete_task_artifact

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `artifactId` | string | Yes | Artifact document ID |

#### list_artifact_comments

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `artifactId` | string | Yes | Artifact document ID |
| `status` | string | No | Only threads whose root is `open` or `resolved` (default: all) |

Returns `{ threads: [...] }` where each thread is the root comment
(`commentId`, `status`, `anchorText` — the quoted snippet, `authorName`,
`content`, `createdAt`, `isEdited`) plus flat `replies` (same shape minus
`status`/`anchorText`). See `docs/specs/artifact-comments.md` for comment
semantics.

#### create_artifact_comment

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `artifactId` | string | Yes | — | Artifact document ID |
| `content` | string | Yes | — | Comment body (markdown) |
| `anchorText` | string | Yes | — | Exact snippet from the artifact content; whitespace, newlines, and casing must match |
| `occurrence` | number | No | `1` | Which match of `anchorText` to anchor to when it appears multiple times (1-based) |

The server locates `anchorText` in the artifact's markdown source and derives
the full anchor (surrounding context + offset hints) itself. Fails with a
`ConvexError` if the text is not found, if the artifact is not markdown
(comments are markdown-only), or if `content` is blank after trimming.
Returns `{ commentId }`.

#### reply_to_artifact_comment

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `commentId` | string | Yes | Root comment ID to reply to |
| `content` | string | Yes | Reply body (markdown) |

Replies are flat — replying to a reply fails. Returns `{ commentId }`.

#### set_artifact_comment_status

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `commentIds` | string[] | Yes | Root comment IDs (1–100) |
| `status` | string | Yes | `open` or `resolved` |

Atomic: the whole batch fails (and nothing changes) if any id is missing or
not a root comment. Idempotent per comment.

### CLI thread tools

Tools an agent uses to discover and drive CLI threads (OS-1162). They are the
MCP face of the `cli` domain: each one delegates to a public `api.cli.*`
function that takes `apiKey`, so ownership, container, and group-cap rules are
the domain's, not the MCP layer's. A key resolves to its owning user and grants
nothing that user does not already have — there is no service identity, so an
agent sees only its own profiles and threads (see
[permissions-system.md](permissions-system.md)).

#### The summary tier

Thread read tools return a **summary**: a narrow, external-facing projection
that is deliberately *not* one of the shapes the web uses. This is one rule with
one home — here — rather than a comment repeated in each module:

- **Never reuse a web validator.** The thread view's `cliThreadDetailValidator`,
  the sidebar's `cliThreadItemValidator`, and messages'
  `cliMessageItemValidator` / `cliMessageEnvelopeValidator` are shaped by what
  the UI renders (plan `metadata`, read/attention state, diff stats, resolved
  task and agent bindings, per-part chunk streams) and several are subscribed for
  as long as a view is open. An external contract must not move with the
  sidebar's next redesign, and must not pay a renderer's costs either.
- **One validator per entity, single read and list alike** — never a narrower
  list variant. A forked tier buys an external contract where an absent field
  means "not applicable" from one tool and "we didn't look" from the other
  (`targetOnline` is the concrete case). Widen or reuse; fork only when the
  payloads genuinely disagree rather than merely differ in what was convenient
  to compute. So a field is absent for exactly one, documented reason.
- **Ids are named for the arguments the tools take** — `threadId`, `messageId`,
  `profileId`, `pathId` — not `_id`, so a value copies straight from one tool's
  output into the next one's input with no mapping step.
- **Shaping is separate from loading.** The `to*Summary` functions take their
  resolved dependencies as arguments (a profile, a session, composed text) rather
  than reading them, because how those are loaded is a cost decision that differs
  between a single read and a page — one lookup versus one batched load per
  distinct key. The `enrich*` functions own that decision.

The shapes and their `to*Summary` projections live in `convex/cli/lib/validators.ts`,
the domain's own validator module rather than `convex/lib/contracts/` — nothing
outside the `cli` domain imports them, including the MCP handlers, which pass query
results through untouched. The `enrich*` loaders sit beside the queries they serve,
in `convex/cli/lib/threadSummaries.ts` and `convex/cli/lib/messageSummaries.ts`, so
importing a summary type drags in no repo. This spec is authoritative for the
contract; each module documents only what a reader of its functions needs.

#### list_cli_profiles

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `projectId` | string | No* | — | Project ID |

Target discovery: which machines are connected, which CLI runtimes they
advertise, and which checkouts they expose. An agent calls this before spawning
a thread and feeds the result into the thread-creation arguments.

Wraps `api.cli.profiles.listByProject`, plus `api.cli.profiles.listRuntimeCatalogs`
for the model catalogs — those live off the profile row since OS-1721. Returns one
entry per profile the caller owns in the project:

- `profileId` (the `profileId` argument for thread creation), `name`,
  `hostname`
- `isOnline`, `lastConnectedAt`, `appVersion` (the `@useconvoy/cli` version the
  online session reported)
- `availableClis` — `{ type, version, provider?, cliModels? }` per runtime the
  connected CLI advertises; `type` is the `cliType` argument for thread creation.
  `cliModels` is `{ model, efforts? }[]`: the `cliModel` values that runtime accepts
  on that machine (OpenCode slugs, Antigravity model ids, Claude slots), each with the
  `cliEffort` values valid for it. OpenCode efforts are per-model variants and
  Antigravity's are per-model thinking levels, so this is the only place an agent can
  discover them. Display labels are omitted (an opencode catalog is
  tens of KB — OS-1721). Omitting `cliModel`/`cliEffort` runs the runtime's defaults
- `paths` — `{ pathId, path, label, gitRemoteUrl?, kind?, parentPathId?,
  branch? }`; `pathId` is the `pathId` argument, and `kind: "worktree"`
  distinguishes a worktree from a repo checkout

Ids are renamed from the query's shape (`_id` → `profileId`, `paths[].id` →
`pathId`) to match the argument names the write tools take, so an agent can
copy a value across without a mapping step. CLI-local bookkeeping is omitted:
`profileKey` (how a CLI matches its local config to a profile), `createdAt`,
and `sessionStartedAt` — `isOnline` is the question being asked.

`isOnline: false` is informational, not a blocker: a thread created against an
offline profile stays pending until that CLI connects and claims it.

#### get_thread

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `threadId` | string | Yes | — | CLI thread ID, or a thread-group / workflow-run container ID |

"What is this thread?" for any thread ID the agent holds — its own (from
`CONVOY_THREAD_ID`, see [cli-thread-agents.md](cli-thread-agents.md)), one it
spawned, or a container it found. The primary use is target discovery from the
inside: an agent reads its own thread to learn where it is running, then adds
another thread on the same profile and path without being told.

No `projectId` parameter. A thread ID is globally unique and the backing query
authorizes through the thread's own project, so a second scope argument could
only ever disagree with the thread.

Wraps `api.cli.threads.summaries.getSummary`, the narrow external contract for a thread —
the third tier beside the thread view's `get` (`cliThreadDetailValidator`) and a
sidebar row (`cliThreadItemValidator`), which carry plan `metadata`,
read/attention state, diff stats, and resolved task/agent summaries an agent has
no use for. It is named for the shape it returns, not for its caller: the
`convoy threads get` CLI command reads the same query (OS-1633).

**An ordinary thread** returns `threadId`, `projectId`, `title`, `status`,
`isDone`, `createdAt`, `lastActivityAt`, `associatedTaskId`, the two lineage edges
(`parentThreadId`, `spawnedByThreadId`), the runtime target (`profileId`,
`pathId`, `path`, `cliType`, `profileName`), and its queue state
(`processingState`, `hasPendingUserMessages`, `hasPendingInteraction`,
`queueHeldAt`), plus `targetOnline` / `lastHeartbeatAt` for the target machine.
`targetOnline: false` is informational for the same reason as in
`list_cli_profiles`.

`projectId` is the thread's **own** project, carried by both branches (OS-1634).
It is what a caller holding only a thread id must authorize a second call on — the
attachment-upload mutations behind `threads send --attach` take a `projectId`, and
the thread's is the only correct one. Not a contradiction of "no `projectId`
parameter" above: the tools take no project *argument*, and this is the answer to
"which project is this thread in", which only the thread can give.

`path` is the live profile path when the path still exists on the profile, else
the snapshot taken at thread creation — so a thread whose path was removed from
the profile still reports where it ran.

**A container** (`kind: "group"`) returns `kind`, `childCount`,
`aggregateStatus`, `originThreadId`, and — on a workflow run's container —
`workflowRunId` (OS-1867), plus the shared fields
above, `projectId` among them — and *no* runtime target:
containers have no transcript and nothing to execute, and inventing a target for
one would invite an agent to send it a message, which the domain rejects (see
[thread-groups.md](thread-groups.md)). A container therefore costs fewer reads
than an ordinary thread — no profile or session to resolve.

**A container also omits `status`**, so `aggregateStatus` is the only status it
carries. `status` is a stored constant on a container — they are born
`"completed"` and never stream themselves — so returning it would sit a permanent
`"completed"` beside an `aggregateStatus` of `"running"`, and an agent reading the
field that means "what is this doing" on every other row would conclude the group
had finished. Same rule, and same reason, as `processingState` being thread-only.

`aggregateStatus` is emitted **raw** (`idle` / `running` / `needs_attention` /
`failed`). The sidebar's `containerItemStatus` projection maps `idle →
"completed"` so a group can render with the thread card component; an agent told
a group is `"completed"` when it is merely idle would draw the wrong conclusion.

**No `children[]`.** Group membership is `list_threads(containerId)`'s answer —
one question, one read path: `get_thread(id)` for "what is this thing",
`list_threads(id)` for "who is in this group". An ordinary thread in a group
returns `parentThreadId`, so an agent can always drill from a child up to its
container.

`parentThreadId` and `spawnedByThreadId` are different edges and neither derives
the other: the first is the container the thread renders in, the second is the
thread whose agent asked for it. Spawning from a plain thread creates a fresh
container, so the two point at different rows. `spawnedByThreadId` may name a
soft-deleted thread — readers must tolerate a dangling pointer.

A thread that does not exist, one belonging to another user, and a **well-formed
ID from another table** are all the same answer (`null` from the query), reported
as one `invalid_params` error, "Thread not found". The last case is why the query
takes `threadId: v.string()` and normalizes with `ctx.db.normalizeId` rather than
declaring `v.id("cliThreads")`: an agent holds `projectId`s, and an argument-level
`v.id` rejection happens *before* the handler runs, producing a validator error
that `isConvexIdError` does not match — which surfaces as an opaque `-32603`
internal error instead of the actionable one. Every thread tool taking an ID from
an external caller must normalize inside the query for this reason.

Sharing applies as it does on the web: a thread its owner shared is readable by
project teammates with `CLI_THREAD`, and because a group is shared as a unit
(`sharedAt` on the container), a **child of a shared group** is readable even
though the child carries no flag of its own (see
[permissions-system.md](permissions-system.md),
[thread-groups.md](thread-groups.md)).

#### list_threads

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `projectId` | string | No* | — | Project ID. Not needed when `threadId` is set |
| `threadId` | string | No | — | Container ID: list that group's members instead of the project's threads |
| `includeDone` | boolean | No | `false` | Include threads marked done |
| `limit` | integer | No | `20` | Page size, 1–50. **Ignored when `threadId` is set** |
| `cursor` | string \| null | No | `null` | Pagination cursor. Not used when `threadId` is set |

"What threads are here?" (OS-1626) — the project's threads, or one group's
members. **One tool over two queries**, chosen by whether `threadId` is present:
`api.cli.threads.summaries.listSummaries` for the paginated project list, and
`api.cli.threads.summaries.listGroupSummaries` for one container's members.
`convoy threads list` reads the same pair (OS-1633).

They are separate queries because they are separate reads, and unifying them
would have meant an argument each one ignores: the drill-down is one equality on
`by_parentThreadId` capped at `MAX_GROUP_CHILDREN`, so it needs no
`paginationOpts`, and the container ID plus the credential fully determine access,
so it needs no `projectId` either. `handleListThreads` is where the two are
presented as one tool — it wraps the drill-down's array in a page envelope so a
caller never branches its response handling on which argument it sent.

**Every row is exactly what `get_thread` returns for that ID** — one validator
(`cliThreadSummaryValidator` in `convex/cli/lib/validators.ts`), not a narrower
list variant, so an agent can act on a row without a follow-up call. The fields a
list might have dropped as "per-row
expensive" are not: the page's profiles are one batched load, and its online state
is **one indexed read per distinct profile** on the page — never a project-keyed
session scan, which would disagree with `get_thread` for a session predating
`cliSessions.projectId` (see `getLatestActiveSessionsByProfiles`). Forking the tier
would have bought an external contract where `targetOnline: undefined` means "not a
thread" from one tool and "we didn't look" from the other. A field is absent for
exactly one reason: the row is a container.

**A group is one row, not its members.** A container appears with `kind`,
`childCount`, and `aggregateStatus` (raw, and with no `status` — same rules as
`get_thread`), and its children are excluded from the flat list. So a 20-row page
is 20 distinct units of work rather than possibly five members of one group, and
`kind`'s presence is how an agent knows an ID is drillable. Passing that ID back
as `threadId` lists the members, which are ordinary threads with full targets, so
the agent can add a thread to the group without another call.

The cost of that shape: sweeping every thread in a project takes 1 + (one per
group) calls rather than one paginated pass. Each is a single indexed scan, and
the drill-down is only paid when the agent actually wants a group's members.

**The drill-down ignores `limit` and returns the whole group** (at most
`MAX_GROUP_CHILDREN` = 100 rows), so a group can come back larger than the page size
requested — which is why the `limit` description in `tools.ts` and both docs tables say
so, and a test pins it. Slicing to `limit` would be worse than ignoring it: with no
cursor to resume from, the tail would be unreachable rather than merely unrequested.
`limit` and `cursor` stay on the tool schema regardless, because the flat list needs
them; the caveat therefore lives at the MCP boundary, which is the only layer that sees
both shapes.

**`projectId` is not required for the drill-down.** A container ID is globally unique
and `getViewableThread` authorizes through the container's own project, so a project
argument could only ever be redundant with it — and requiring one would reject an
answerable call on a server with no default project configured.

`includeDone` defaults to `false`: "what threads do I have" almost never means the
finished ones. Background threads (Guide and checks runs, OS-2513) never appear;
`convoy threads list --background` lists them. There is no `includeArchived` — threads have had no archived state
since OS-1561 (see [thread-groups.md](thread-groups.md)). Soft-deleted threads and
soft-deleted members never appear.

The tool argument is `threadId`, though `listGroupSummaries` keeps the schema
field's name (`parentThreadId`). An agent holds thread IDs and every other thread
tool calls the ID it is handed `threadId`; nothing here takes two thread IDs at
once, so there is no collision to disambiguate — unlike thread creation, where
`sourceThreadId` is needed.

**An unreadable ID is an empty page, not an error** — the one place this tool
differs from `get_thread`, which reports a null as "Thread not found". Unparseable,
another table's, missing, not the caller's, and *an ordinary thread* (which has no
members) all list nothing: "this group is empty" and "that ID isn't a group you can
read" are both "nothing to list here", and an agent that just read a `childCount`
should not get an error for racing a delete. `get_thread` is where an ID gets
diagnosed. A malformed ID is still rejected before the query — `should.beOptionalId`
applies `beId`'s shape check when the argument is present, because an *absent*
optional ID is a call shape while a malformed one is a mistake, and letting it
through would answer a typo with "there is nothing here".

Authorization differs by call shape, both carrying the API key's scope:

- the flat list is `userId`-scoped like every other thread list — a teammate with
  project access sees their own threads, not the owner's;
- the drill-down authorizes through `getViewableThread` on the *container*, so a
  teammate can list the members of a **shared group** (its `sharedAt` covers the
  children), matching the web tabs view. The rows are then **filtered to the
  container's owner**. That every child belongs to that owner is a mutation-side
  invariant (`addThreadToGroup` pins the source's owner), and this is a cross-user read
  seam, so the read does not lean on one — the same reason `isSharedForViewer`
  re-checks `kind === "group"` that `share` already guaranteed. A `parentThreadId`
  arriving by backfill or manual patch would otherwise expose that row to whoever can
  read the container, and this branch is the only one without the flat list's index-level
  `userId` scoping.

#### list_thread_messages

`list_thread_messages` (OS-1628) takes `{ threadId, limit? }` and returns an array
of message summaries — `messageId`, `role`, `status`, `createdAt`, `text`,
`truncated?`, `sentBy?`, `errorMessage?` — under the summary-tier rules above. The
handler is argument parsing over `api.cli.messages.listRecentSummaries` (OS-1627),
which composes the text and owns every cap below; `convoy threads messages`
reads the same query (OS-1633).

`limit` is validated 1–20 at the boundary even though the query clamps the same
range, unlike every other numeric argument here: a caller asking for 50 gets an
error naming the ceiling rather than 20 rows it reads as the whole thread. The
query still clamps, for the CLI and any other caller that bypasses this handler.

**No `projectId`**, for `get_thread`'s reason: a thread id is globally unique and
the query authorizes through the thread's own project.

**Newest-last.** The window is taken from the newest end of the thread (recent
turns are what a reader wants) and returned in conversation order, because text
handed to a model in reverse means something different. There is no cursor:
`limit` is the whole contract, clamped 1–20 with a default of 10 rather than
rejected, since an out-of-range value has an obvious intent. Walking a long
transcript is not this read's job.

**`text` is composed server-side from `text` events, completed `proposed-plan` events, and goal notices (`goal-*` codes, read as `<title>: <message>`; they replace Claude's `/goal` reply text, see `cli-thread-goal.md`).** Draft proposals and ephemeral rows are excluded. Chunk rows
are the message body's source of truth
(`cli-message-chunks-storage.md`), and the web renders them as a stream of typed
parts; an external reader gets prose. Tool calls, tool output, reasoning, and
runtime notices are **out of scope for v1** — they are the bulk of a run's rows
and rendering them faithfully is a different feature. A message whose window holds
only tool traffic therefore composes to `""`: an empty entry, not an error. Which
rows count is `chunkAgentText`; the notification preview scans the same tail with
the same cap and repeats that test rather than importing it, because the
notifications domain may reach the cli domain's `*Repo` files but not its lib.

Both scans read through `listLatestStoredChunksByMessage`, which pins
`ephemeral` in the index so partial-streaming deltas are never in the window:
they are superseded by the whole `text` event they build up to, and including
them both wasted the scan and collided with `cleanupEphemeralChunks`
(OS-1673, see `notifications.md`).

User and assistant messages compose through **one code path**. A user message's
text is stored as a single `text` chunk by `send`, so nothing reads it off the
envelope and a user row cannot drift from an assistant row's rendering.

**Two caps, one flag.** At most `AGENT_TEXT_CHARS` = 4000 chars per message, cut
without splitting a surrogate pair (`clampChars`). The per-message chunk scan is
derived (`min(40, 400 / count)`) rather than flat: at 20 messages a flat 40 would
scan ~800 rows, double the `WINDOW_CHUNK_BUDGET` = 400 the thread window works
within. `count` is the page **actually returned**, not the `limit` asked for —
same budget either way, but deriving from the request would penalize short threads
(one message read with `limit: 20` scanning 20 rows instead of 40). Asking for a
bigger window never returns less of each message. The scan reads the message's
**tail**, so an overflowing run reports how it ended.

`truncated: true` means a cap cut something — read it as **"rows went unread"**,
not "prose was dropped". The scan flag fires whenever rows exist beyond the
window, even pure tool traffic, so it is set often on tool-heavy runs.
Deliberately conservative: the one over-fetched row proves older rows exist but
says nothing about the rows behind it, so a narrower flag would report `false` on
a message with many unread text rows under a single tool result.

**Attachments are out of scope for v1**, alongside tool output and reasoning. An
attachments-only user message has no `text` chunk (`send` writes one only for
non-empty content), so it reads as `text: ""` with no sign a file was sent.
Surfacing them (an `attachmentCount`, say) is a contract addition to decide
alongside the tool that consumes it.

**A container is the one readable id that throws** — "Groups and workflow runs have
no messages — list the group's members instead". Everywhere else in these tools an
unreadable id lists nothing, because "there is nothing here" is true and an agent
racing a delete should not get an error. A group is different in kind: it is
readable, it has no transcript, and it never will, so an empty array would be a
permanent lie inviting the same call again. The error names the useful next move.
Unparseable ids, another table's ids, missing threads, and threads belonging to
another user all return `[]` as usual.

#### create_thread

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `content` | string | Yes | — | The initial user message — the new thread's prompt |
| `sourceThreadId` | string | No | — | Spawn beside this thread, inheriting its target. Accepts a group container ID |
| `profileId` | string | Without a source | inherited | Target machine |
| `pathId` | string | Without a source | inherited | Checkout on that profile |
| `cliType` | string | Without a source | inherited | CLI runtime; validated against `getSupportedCliTypes()` |
| `title` | string | No | derived from `content` | Thread title |
| `taskId` | string | No | — | Task ID or ref to attach |
| `projectId` | string | No* | — | Only to resolve a bare `taskId` ref; must match the target profile's project |
| `cliModel` / `cliEffort` / `cliMode` | string | No | runtime default | Runtime selection |
| `runtimeCommand` | boolean | No | — | Open the thread by running `content` as the target runtime's own slash command; must start with `/`, and only `claude-code` / `codex` targets accept it (see [cli-runtime-commands.md](cli-runtime-commands.md)) |
| `projectAgentId` | string | No | — | Project agent to run as, from `list_project_agents`; must be in the target profile's project |
| `worktree` | object | No | — | `{ parentPathId, branch, baseRef?, startFromOrigin? }` — run in a fresh git worktree instead of the checkout |

"Start a thread" (OS-1629), and the first of these tools that writes. Two create
paths over two existing mutations — `api.cli.threads.core.create` with no source,
`api.cli.threads.groups.addThreadToGroup` with one — chosen by
`resolveSpawnTarget` in `convex/mcp/lib/threads/resolution.ts`, which is where all
of this tool's logic lives and is tested apart from the handler for that reason.

**Reusing `addThreadToGroup` rather than writing a spawn path is the design.** The
lazy container, the pin/share transfer, the `MAX_GROUP_CHILDREN` cap, and both
one-nesting-level rejections then apply to an agent caller by construction rather
than by re-derivation (see [thread-groups.md](thread-groups.md)). The accepted
consequence is a **user-visible side effect**: spawning from a plain thread runs
the lazy-container path, so that thread's sidebar row becomes a group row and a
pin (and a share) transfers to the container. This is ordinary group behavior —
identical to adding a thread from the "+" button — and only the initiator is new.

**The argument is `sourceThreadId`, never `parentThreadId`.** The latter collides
with the schema field, where it means *the container*. The bug that falls out of
the wrong name: an agent reads `get_thread`, sees `parentThreadId: <container id>`,
passes it back, and hits `ADD_TO_GROUP_SOURCE_IS_CONTAINER`. `sourceThreadId` matches
`addThreadToGroup`'s own argument name and reads correctly against `get_thread`'s
output.

**The target tuple is conditionally required**, which JSON Schema's `required`
cannot express — so only `content` is listed there, and the handler enforces the
rest. With a source, each of `profileId` / `pathId` / `cliType` is `explicit ??
the source's value`, so "spawn a thread next to me" needs only the ID the agent
already holds. Without a source there is nothing to inherit from and all three are
required, reported per field so a caller learns which one it still owes.

**`pathId` is profile-local, so the three fields do not override independently.**
A path ID is a `crypto.randomUUID()` minted per profile (`newProfilePathEntry`) and
never shared between them, so inheriting the source's value onto another machine
reaches `createThreadCore` as `PATH_NOT_FOUND_IN_PROFILE` — every time, since no
two profiles can hold the same ID. `profileId` naming a different machine therefore
**requires `pathId`**, rejected at the boundary ("pathId is required when profileId
names a different machine") rather than left to the domain's opaque path error.
`cliType` is genuinely independent — an enum, not a per-profile ID — so it can be
sent alone to change only the runtime.

**A group never spans projects**, enforced in `addThreadToGroup` rather than here
(`ADD_TO_GROUP_CROSS_PROJECT`). Two authorizations exist on this path and they check
different projects: `addThreadToGroup` authorizes the *source thread's*, while
`createThreadCore` authorizes and writes the *target profile's*. Without the guard a
Project A container acquires a Project B child, and because `listGroupSummaries`
authorizes the container alone and then returns every owner-matching row, that
child's title, path, profile, and task leak to a key scoped to Project A only. The
web composer cannot reach this (it offers only the thread's own project's profiles);
raw MCP IDs can. The container's project is checked too, not just the source's, so a
group already holding a foreign child cannot use it as the next spawn's inheritance
source. Placed in the mutation because it must be atomic with the container
creation and the reparent.

`cliType` is the one enumerated argument (`getSupportedCliTypes()`, via
`beOptionalEnum`). `cliModel`, `cliEffort`, and `cliMode` are free-form strings,
matching `cliModelValidator` / `cliEffortValidator` being `v.string()`: which
models and effort levels a runtime accepts is the CLI's business, validated where
it is used rather than enumerated at this boundary.

`sourceThreadId` is taken as a plain string and diagnosed by `getSummary`, for the
reason recorded under `get_thread`: a `v.id("cliThreads")` declaration would reject
a well-formed ID from another table in the *argument validator*, before the handler
runs, surfacing as an opaque `-32603` instead of "Source thread not found". Since
that query already normalizes and returns null, the missing-source branch handles
the wrong-table case for free.

**A container ID is accepted and resolved to a member.** "Add a thread to this
group" is the natural phrasing, and making an agent name an arbitrary Group child
instead would expose an implementation detail. The mutation rejects plain-group
container sources. Workflow containers can be direct
targets when no member exists; the created thread is still a non-container child. Resolution is **one `listGroupSummaries` call**, preferring
the container's denormalized `originThreadId` among the rows returned and falling
back to the first row (creation order) for containers predating that denorm. Not
`getSummary(originThreadId)`: the inherited tuple lives on the child, so the denorm
alone would still need a second read, and using it as a *preference over rows
already in hand* self-heals a stale pointer — a deleted origin simply is not among
them. `includeDone: true` here, unlike every other read of that query: a done
thread is still a fine source Group child, and a group whose members are all done
would otherwise be unspawnable for no reason an agent could act on. A group with
no members left is `invalid_params`, "Group has no live threads to spawn beside",
except for a workflow container. An empty workflow container is used directly
with explicit `profileId`, `pathId`, and `cliType`; each omitted field produces
"<field> is required when the workflow container has no live threads".
The mutation rechecks ownership, project permission, target profile, and cap.
`expectedContainerId` must equal the direct source container ID. A lane arriving
before the mutation does not invalidate that target.

**The resolved member is re-checked inside the mutation** via `expectedContainerId`,
set only when a container was named. `tools/call` runs in an `httpAction`, so the
resolution and the write are separate transactions: if the chosen child is removed from the group
in between (`moveChildOut`) while the group keeps other members, `addThreadToGroup`
would see a plain thread and lazily build a *second* container around it — the call
succeeding, the thread landing outside the group the agent named, and
`spawnedByThreadId` still pointing at the original container. The guard turns that
silent misplacement into `ADD_TO_GROUP_SOURCE_MOVED`, which says to retry. A
from-scratch or plain-thread spawn sends no `expectedContainerId`, since there is no
membership assumption to violate.

**Workflow containers and lane threads accept independent sibling threads.**
Container resolution uses the same member lookup. The added thread shares the
container but has no workflow run, lane, or step linkage, so canceling the
workflow leaves it running. See `workflows.md`, Threads.

**`spawnedByThreadId` records what the agent named; `sourceThreadId` records what
`addThreadToGroup` needed** — and the divergence is the point of the field. Spawn from
a container and lineage points at the container. Spawn from a plain thread and
`addThreadToGroup` reparents it, so the new row's `parentThreadId` is a freshly-created
container while `spawnedByThreadId` still names the thread whose agent asked.
Neither is derivable from the other.

**The response is `get_thread`'s payload for the new thread, not a bare ID.** An
agent's next question after spawning is always "did it land, and is the machine even
up?" — allowing an offline target is only useful because the thread queues, and
`targetOnline` is the field that says so. One extra read, no shaping: the same
summary every other thread tool returns for the same ID.

**`worktree` and `projectAgentId` are pass-through (OS-1222).** Both were already
arguments of `createThreadArgs`, so the handler parses the *shape* — `worktree` must
be an object with a non-empty `parentPathId` and `branch` — and forwards. Every rule
they obey stays in `createThreadCore`: branch-name legality, the parent-is-a-repo
check, the project match, and the prompt snapshot. Duplicating any of them at the MCP
boundary would fork the rule, and the domain's `ConvexError` already reaches the caller
as `-32602` carrying its user-facing text. Both are spread into the one object that
feeds `create` *and* `addThreadToGroup`, so both creation paths accept them
identically. See [cli-worktrees.md](cli-worktrees.md) and
[cli-thread-agents.md](cli-thread-agents.md) for the rules themselves.

**`worktree.parentPathId` must equal the effective `pathId`**, inherited or explicit —
the mutation's `WORKTREE_PARENT_PATH_MISMATCH`, not re-checked here. The consequence
worth knowing: an agent spawning from a source thread that is *itself* running in a
worktree inherits that worktree's `pathId`, which cannot be a parent
(`WORKTREE_PARENT_NOT_REPO_PATH`) — so it must send the parent repo's `pathId`
explicitly. `list_cli_profiles` returns `kind` and `parentPathId` per path, which is
how it finds one.

**Neither field is inherited from `sourceThreadId`.** The target tuple is, which makes
the opposite the natural assumption, so the tool description says so per-field. A
spawned thread runs unbound and in the source's checkout unless the caller asks
otherwise. Binding is also immutable — there is no MCP path to rebind afterwards,
matching the domain.

**A bound agent's automation defaults are not applied.** `automation` (cliType, model,
effort, workspace) is a *web-composer* default for assignment-triggered threads;
`createThreadCore` never reads it. So `worktree` here is an explicit request, never
something an agent's `workspace: "worktree"` setting turns on implicitly.

**The response does not confirm either field.** It is `get_thread`'s summary, and
`cliThreadSummaryValidator` has neither `worktree` nor an agent field — a caller that
sent a worktree spec reads back the **parent** path. Deliberate: the summary tier is a
narrow external contract, and widening it is a separate decision from accepting these
arguments.

Errors an agent will hit are all pre-existing, and all named in the tool
description so it can recover without a round trip:

| Condition | Error | Source |
|---|---|---|
| group already at the cap | `A thread group can contain at most 100 threads` | `cli/threads/groups.ts` |
| target profile in another project | `ADD_TO_GROUP_CROSS_PROJECT` | `cli/threads/groups.ts` (new, OS-1629) |
| resolved member left the group | `ADD_TO_GROUP_SOURCE_MOVED` | `cli/threads/groups.ts` (new, OS-1629) |
| `worktree.parentPathId` ≠ the effective `pathId` | `Worktree parent must match the selected path` | `cli/threads/lib/lifecycle.ts` |
| the selected path is itself a worktree | `Worktrees can only be created from a repository path` | `cli/threads/lib/lifecycle.ts` |
| `branch` / `baseRef` is not a legal refname | `Invalid worktree branch name` | `cli/threads/lib/lifecycle.ts` |
| agent missing or deleted | `Project agent not found` | `agents/errors.ts` |
| agent in another project | `Project agent must belong to the thread's project` | `agents/errors.ts` |

The cap deserves its own sentence in the description, because the number does not
mean what it appears to: `countGroupRows` counts **every row ever parented** under
the container, soft-deleted included, so a group can be full with far fewer than
100 visible tabs and retrying will never help. The number is interpolated from
`MAX_GROUP_CHILDREN` rather than written as prose, since the description is read by
a model at call time and a stale literal there is a lie it cannot check.

**Nothing bounds how often an agent may call this, and the description is the only
brake.** Observed during OS-1629 testing: a spawned agent whose prompt merely
*described* spawning called `create_thread` itself, with no human in the loop — the
"children spawning grandchildren" case OS-1299 anticipates. The add-to-group path is
bounded structurally (a spawn with `sourceThreadId` joins the existing container and
hits `MAX_GROUP_CHILDREN`), but the **from-scratch path counts nothing**, so it is
unbounded. The description therefore asks an agent to spawn only what it was told to,
to report back rather than re-spawn if it is itself a spawned thread, and not to spawn
because its prompt mentions delegation. That is cooperative, not a boundary — a caller
ignoring it is what OS-1299's per-user cap exists to stop, and this is the behavioural
argument for that ticket rather than the withdrawn contention one.

**Out of scope**, deliberately: attachments (the upload flow's middle step is a
direct `POST` to a signed URL that an MCP client cannot be instructed to perform —
an agent passes the content inline, or a path the *target* machine can read, which
is the same machine only when spawning from a source thread), and the
worktree spec and Project-agent binding (OS-1222). Spawn caps are OS-1299; the
`"recompute"` container tier this path forces is bounded at `MAX_GROUP_CHILDREN`
and one-shot, so it is not a contention risk and does not gate on that ticket.

Sharing and scoping work exactly as in `get_thread`: `getViewableThread` with the
credential's `principal`, so a shared thread — **including a child of a shared
group**, which carries no `sharedAt` of its own — is readable by a project
teammate with `CLI_THREAD`.

#### send_thread_message

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `threadId` | string | Yes | — | Thread to post into. Not a container ID |
| `content` | string | Yes | — | The message text, delivered as a user message |
| `sourceThreadId` | string | No | — | The caller's own thread, recorded as `sentBy` |
| `runtimeCommand` | boolean | No | `false` | Deliver the content as the target runtime's own slash command |
| `steer` | boolean | No | `false` | Best-effort: inject the message into the target's in-progress run instead of waiting for its next turn |

"Say something in that thread" (OS-1630), and the tool that closes the loop
`create_thread` opens: without it a spawn can never answer. Wraps
`api.cli.messages.send` with `sentBy: { kind: "thread", threadId }` and no new
query — a human composer send and an agent send are the same mutation, differing
only in that field.

**It does not resume a paused agent, and that is the whole shape of the loop.** By
the time a spawned thread finishes its work, the spawning thread's agent has
*already ended its turn* — there is no process left to hand a value back to. The
tool queues a user message; a connected CLI then claims it and starts a **new
run**, resuming the runtime session via `continuationId` so the agent keeps its
full prior context and reads the message as a fresh user turn. Consequences worth
stating plainly, because each one is a shape an agent or a reader will otherwise
assume works:

- **"Thread 1 waits for the review" is not supported.** The loop is event-driven.
  Thread 1 must end its turn after spawning; it is woken by the incoming message,
  not by a return value.
- **The reply is not immediate and not visible to the sender.** The read-back is
  the reply message itself, which starts a new run on the sender. Sleeping or
  polling `list_thread_messages` inside the run cannot see it; the tool
  description and the `convoy` skill say so, because a bash `sleep` loop is the
  shape agents otherwise reach for.
- **A busy target queues for its next run** rather than erroring, and an offline
  one queues indefinitely — the same "pending until claimed" rule as thread
  creation.
- **"Report back when you're done" needs no schema.** Thread 1 writes the
  instruction into the prompt it gives thread 2, naming its own thread ID from the
  identity it was given at session start (see
  [cli-thread-agents.md](cli-thread-agents.md)). Purely cooperative — nothing
  forces a spawned agent to report, and nothing forces it to report to the right
  thread.

**The message runs with the thread's last-used model, not the runtime default.**
The tool takes no `cliModel`/`cliEffort`/`cliMode`, so `send` inherits the
thread's stored last-used selection onto the message at write time (OS-1894) —
see [cli-thread-model-selection.md](cli-thread-model-selection.md). Run-model
resolution reads only the latest user message of a run, so without inheritance
an agent's follow-up would silently switch an Opus thread to the runtime's own
default model.

**`pending` is not the receipt; `hasPendingUserMessages` is.** `markThreadPending`
takes `flipToPending: thread.processingState === "idle"`, so only an idle target
changes status — a streaming one stays `streaming` and picks the message up on its
next run. The flag is set either way. An agent told "the thread goes pending"
would read a correct `streaming` state as a failed send and re-send, which is
exactly the ping-pong OS-1299 caps, so every agent-facing surface names the flag
instead.

**A container can neither receive nor send.** As a target it is rejected by
`send`'s pre-existing `MESSAGE_TO_CONTAINER` guard: a container carries a real
profile/path/cliType snapshot, so a queued message on the group row would let a
connected CLI claim and run an agent on the container itself. As a *source* it is
rejected by `SOURCE_THREAD_IS_CONTAINER` — a container never runs an agent, so it
cannot be the thread that spoke, and `addThreadToGroup` refuses a container as lineage
for the same reason. Both error texts are in the tool description so an agent can
recover by listing the group's members and using one.

**A thread cannot message itself** (OS-1890). A model that reads "reply to the
user" as "send_thread_message to my own thread" gets a message queued on a thread
that is still streaming; the next run reads it as a fresh user turn and does the
same again, an unbounded loop of paid runs until the user presses Stop. `send`
rejects `sentBy.threadId === threadId` with `SOURCE_THREAD_IS_TARGET`, whose text
tells the model where its reply actually goes, and the tool description leads
with the same rule. The guard is only as good as `sourceThreadId`: a caller that
omits it can still post to its own thread and reads as a human. The per-thread
cap in OS-1299 is the backstop for that case.

**Ownership is the boundary; `sourceThreadId` is not.** Threads belong to the API
key's user and only that user's own threads are valid targets, so agent-to-agent
messaging is same-user in v1. MCP auth resolves key → user, never key → thread, so
*which* of the user's threads the caller claims to be is a **cooperative signal** —
a caller can name any of its own threads. That is not licence to skip referential
validation. `sentBy.threadId` is checked in the mutation to be live, owned by the
same user, in **the target's project**, and not a container:

- The **same-project** rule is what keeps one `requireAuthorizedProject` call
  sufficient. Validating the source under a bare `user._id` would let a key scoped
  to Project A write a Project B thread's id into a Project A message *and* learn
  that thread's liveness from the error channel — a resource the same key cannot
  read via `getSummary`. Cross-project provenance would also be unfollowable for
  its reader, so the narrower rule is the useful one.
- **The stated invariant is "a live thread of the same user in this project" — not
  "a row its reader can see".** Those differ: `getViewableThread` admits a project
  teammate to a *shared* thread, `listRecentSummaries` returns `sentBy` to them,
  and a share can be granted *after* the send — so write-time validation cannot
  express reader-side visibility at all. OS-1631 must therefore treat a `sentBy`
  whose `getSummary` returns `null` as a non-navigable "sent by an agent" label
  rather than a link.
- **Source failures carry their own messages** (`SOURCE_THREAD_NOT_FOUND` and
  friends). Over MCP both ids are arguments, so reusing the target's "Thread not
  found" would tell an agent with a stale thread identity that its healthy *target*
  was gone. Missing and not-yours still share one message, since splitting them
  would answer "is this thread alive?" about a thread the caller cannot read.

Omitting `sourceThreadId` leaves `sentBy` unset, which reads as "a human sent it" —
the absence is meaningful, so an agent should always send it. Its description points
at the thread identity every runtime is given at session start, **not** at
`CONVOY_THREAD_ID` alone: opencode's server is shared across threads, so it gets
identity by prompt injection and no env var
([cli-thread-agents.md](cli-thread-agents.md), OS-1223). An opencode agent that
checked the env var, found nothing, and concluded it was not in a thread would omit
attribution — landing on the "a human sent it" reading that `sentBy` exists to
prevent.

**`runtimeCommand` makes this the agent-facing entry point to the target's own slash
commands** (`/compact`), the same flag the web composer sets — see
[cli-runtime-commands.md](cli-runtime-commands.md) for delivery and the per-runtime
matrix. Nothing about the flag is auth-specific; it was simply not exposed when
`send_thread_message` shipped, so the mutation argument existed and the tool schema
did not.

- **The handler rejects the flag on non-slash content**, rather than passing it to
  `send`, which drops it silently. A silently-dropped flag queues the text as prose
  and lets the agent narrate a compaction that never happened — the OS-1582 failure
  mode, and worse here than in the composer because no human sees the turn.
- **No inventory check, and none available.** The composer only marks a message when
  the first token is in the runtime's advertised list; an MCP caller has no such
  list (`cli.facts.getThreadRuntimeCommands` is web-user-auth) and there is no tool
  that exposes one. So an unknown command reaches the runtime and *fails that run*
  on the runtimes that parse it. The flag's description therefore names `/compact`
  and its supported `cliType`s instead of promising the mechanism generally. Send-
  time validation against an inventory is out of scope for the same reason it is in
  the composer: a stale list would reject valid commands.
- **A command targeting a busy thread waits for its own run**, since the CLI
  slices at command boundaries and never steers one into a running turn. Same
  queueing rule as any other send.

**`steer` rides the send itself** (OS-1873): with the flag, `send` stamps the new
message's `steerRequestedAt` in the same mutation — the agent-facing counterpart of
the composer strip's Steer button, one write instead of a send-then-request pair.
See [cli-steering.md](cli-steering.md) for the availability conditions and delivery.

- **Best-effort, silent fallback.** The flag applies only when the run can consume
  it (target streaming under a live claim, runtime and session steer-capable);
  otherwise the message queues normally — no error, because an idle target is the
  common case and the delivery guarantee is identical either way. There is also
  **no receipt**: the result stays `{ messageId, threadId }`, so the tool
  description tells the agent never to narrate an injection it cannot confirm.
- **Never stamped when unavailable.** An orphaned `steerRequestedAt` is not
  harmless bookkeeping: the queued-messages strip renders it as "Steering..." and
  `removeQueued` refuses Edit/Delete on it, so an unconditional stamp would strand
  the message's UX until the next run absorbs it.
- **Rejected alongside `runtimeCommand`** — runtime commands are never steered
  (`send` drops the flag), so accepting the pair would imply an injected command
  that cannot happen: the same silently-dropped-flag failure mode as above.

Loop and spawn limits are OS-1299. Writes are identical to a human send — 1 message
+ 1 chunk + 1 thread patch, with `sentBy` a field on a row already being inserted —
and an attributed send adds one thread point read for the checks above.

The response is `{ messageId, threadId }`, not a thread summary: unlike
`create_thread`, the caller already holds the thread and its state is `get_thread`'s
question, so re-reading it here would be a read the caller did not ask for.

#### mark_thread_done

Mark an owned thread done and read, acknowledging its current attention state.
Requires `threadId`, a string. Optional `done`, a boolean defaulting to `true`;
`false` calls `core.markNotDone` and clears the mark. Returns `{ threadId }`
after the mutation succeeds. Groups and workflow runs cascade to their live
children. Ownership and `CLI_THREAD` permission apply to the thread's project,
including API-key scope; no default project is required. Missing, deleted, or
inaccessible threads fail.

Running threads are accepted (OS-2176), so an agent can mark its own thread
done mid-run. This does not stop execution. The mark is sticky: later agent
activity leaves it, and only `done: false`, mark as unread, or a new user turn
clears it. See `docs/specs/cli-thread-read-state.md` for the rules.

#### attach_task_to_thread

Attach a task to an owned thread that was started without one (OS-1713) — the
agent that created a task mid-run binds its own thread to it. Requires
`threadId` and `taskId` (raw ID or ref; a ref resolves in the thread's own
project, not the connection's). Returns the thread as `get_thread` would.

The thread then appears on the task like one created with `taskId`: Runs
column, task timeline and sidebar Threads field. The first attach also logs
"attached thread" in the task's activity. Attach-once: the same task
again is a no-op; a thread attached to another task, a group or workflow run
container, or a task outside the thread's project is rejected. Ownership and
`CLI_THREAD` permission apply, including API-key scope. Rules:
`docs/specs/cli-thread-task-attachments.md`.

#### attach_pull_request_to_thread

Attach a GitHub pull request to an owned thread that has none. Requires
`threadId` and `pullRequest`: a github.com PR URL or `owner/repo#number`.
Returns the thread as `get_thread` would, with `attachedPullRequest`.
Attach-once: the same PR again is a no-op; a thread attached to another PR, a
group or workflow run container, or a value that isn't a PR is rejected.
Ownership and `CLI_THREAD` permission apply, including API-key scope. Rules:
`docs/specs/github-integration.md` → Pull requests in threads.

#### submit_pull_request_guide

`convoy threads submit-guide` over MCP, on `integrations.github.guides.submit`
(OS-2418). Requires `threadId`, the Guide run's own thread. Send `headSha` and
`steps`, or `failure` with why the guide could not be written. Returns
`{ status: "accepted", guideId }`, or `{ status: "rejected", errors }` with
every problem at once, so the agent fixes them and submits again. Sending
neither steps nor a note is rejected the same way; an empty `failure` is
refused. `steps` that is not an array is an invalid-params error; the shape
inside each step is checked by Convoy and comes back in `errors`. Thread
ownership and `CLI_THREAD` apply, including API-key scope. Rules:
`docs/specs/github-integration.md` → Guides.

#### read_pull_request_guide

A PR's Guides for other agents, on `integrations.github.guides.read`
(OS-2418). Requires `pullRequest` (a github.com PR URL or `owner/repo#number`)
in a repository connected to the project; optional `guideId`. Returns
`pullRequest` (the stored PR's `state` and `headSha`, null before the first
sync), `guides` (the newest 20, as the Guide menu lists them, each with
`status`, `failureReason`, and `outdated`: the stored PR's head is no longer
the Guide's), and `guide`: `guideId`'s Guide with its `steps` and
`removedStepTitles`, else the newest ready one, else null. A `guideId` of
another PR is refused ("The guide was deleted."), and a PR outside the
project's connected repositories is an invalid-params error. Any project
member reads; the requester's private `threadId` stays out for everyone else.

## Partial Updates

Partial-edit support is scoped per resource:

- **Artifacts** — supported through `replace_in_task_artifact` for exact string replacements. Full rewrites and metadata updates continue to use `update_task_artifact`.
- **Task descriptions** — **deferred.** Task descriptions are stored as ProseMirror JSON and the MCP layer currently has no PM-JSON → markdown projection, so there is no stable anchor against which an agent could compose an `oldString`. Targeted-edit support for descriptions is gated on migrating task descriptions to a markdown-native editor (see `docs/adr/0002-markdown-native-task-descriptions.md`). Once that migration ships, this section should be updated to document a `replace_in_task_description` tool with exact-match partial-edit semantics, and this deferred note should be removed.

Until then, agents update task descriptions via the existing full-rewrite path on `update_task`.

## Response Format

All tools return results in MCP content format:

```json
{
  "content": [
    {
      "type": "text",
      "text": "{ ... JSON string of result ... }"
    }
  ]
}
```

## Error Handling

Errors follow JSON-RPC 2.0 conventions:

| Code | Meaning |
|------|---------|
| `-32700` | Parse error (malformed JSON) |
| `-32600` | Invalid request |
| `-32601` | Method not found |
| `-32602` | Invalid params (missing/wrong-type arguments) |
| `-32603` | Internal error |
| `-32001` | Authentication error (invalid/missing API key) |

HTTP status codes map from JSON-RPC errors:

| HTTP Status | When |
|-------------|------|
| `200` | Successful JSON-RPC response (including tool errors in result) |
| `204` | Notification acknowledged (no response body) |
| `400` | Parse error or invalid request |
| `401` | Missing or invalid API key |
| `500` | Internal server error |

## Parameter Validation

The handler uses strict validation helpers instead of type assertions:

- `requireString(args, key)` — required non-empty string
- `requireTrimmedString(args, key)` — required, whitespace-trimmed
- `optionalString(args, key)` — string or undefined
- `nullableString(args, key)` — string, null, or undefined
- `requireId(args, key)` / `optionalId(args, key)` / `nullableId(args, key)` — Convex document IDs
- `optionalStatus(args, key)` / `optionalPriority(args, key)` — enum-validated
- `optionalLimit(args, key)` — integer 1–50
- `requireStringArray(args, key, maxLength?)` — non-empty string array with optional max

All validation errors throw `McpInvalidParamsError`, which is caught and returned as JSON-RPC `-32602`.

## Adding New Tools

1. Add the tool name to the `ToolName` union in `convex/mcp/tools.ts`
2. Add the JSON Schema definition to `getToolDefinitions()` in `convex/mcp/tools.ts`
3. Add the tool case to the `switch` in `callTool()` in `convex/mcp/handler.ts`
4. Use `resolveProjectId(args, defaultProjectId)` if the tool needs a project context
5. Add tests in `convex/mcp/handler.test.ts` and `convex/mcp/tools.test.ts`

## Adding New CLI Agent Types

The MCP server is one integration point. The system also supports CLI-based agents (see CLAUDE.md "Adding New CLI Types"). MCP tools and CLI agents share the same backend queries/mutations but have separate transport layers.

## Security Considerations

- API keys are hashed server-side and cannot be recovered
- Keys should never be committed to version control — add `.mcp.json` to `.gitignore`
- Use separate keys for different machines/contexts
- Set the shortest practical expiration
- Revoke keys immediately when no longer needed
- All tool calls respect the same permission system as the web UI — no elevated access

### Codex account quota command, OS-2001

`create_thread` and `send_thread_message` accept `content: "/usage"` with
`runtimeCommand: true` for Codex. The app-server reads account quota without a
model turn. Offline requests fail with a reconnect message. Responses identify
the runtime account and refresh time. See [Codex runtime](cli-codex-runtime.md#account-usage-on-request-os-2001).

### Codex goal command, OS-2277

`create_thread` and `send_thread_message` accept `content: "/goal …"` with
`runtimeCommand: true` for Codex: `/goal <objective>`, `/goal`, `/goal pause`,
`/goal resume` and `/goal clear`. The `runtimeCommand` descriptions name it.
See [Thread goal](cli-thread-goal.md#codex).

### Task List grouping defaults

`create_task_list` and `update_task_list` accept `defaultListGroupBy` when
`defaultViewMode` is `list`: `none`, `status`, `assignee`, `owner`, `priority`,
`type`, or `label`. `defaultBoardGroupBy` also accepts `owner`. Owner grouping
uses the human owner, while Assignee uses the delegated agent when present.

Default-view grouping arguments on `create_task_list` and `update_task_list` require
the matching `defaultViewMode` in the same call: `list` for `defaultListGroupBy`,
`board` for `defaultBoardGroupBy`. Missing or incompatible modes are rejected;
grouping values are never silently ignored.

# Closed tasks query

OS-1165. Lets agents and users ask "what shipped": the last N Done tasks, or the
Done tasks closed in a date range. The answer feeds release notes and changelogs.

## `closedAt`

- `tasks.closedAt` (optional Unix ms) records when the task entered its current
  closed status (`Done` or `Canceled`, `CLOSED_TASK_STATUSES`).
- `insertTask` and `patchTask` in `tasks/lib/tasksRepo.ts` own the field. Every
  task write goes through them, so callers never set it:
  - Insert with a closed status stamps `closedAt = now`.
  - A patch that changes `status` to a closed status stamps `closedAt = now`.
    Done → Canceled re-stamps.
  - A patch that changes `status` to an open status clears `closedAt`.
  - A patch that keeps the same status, or doesn't touch `status`, leaves
    `closedAt` alone.
- No backfill. Tasks closed before the field shipped have no `closedAt` and
  never appear in closed-task results until they are reopened and closed again.
- `closedAt` is part of the task payload (`taskReturnValidator`), the MCP task
  summary, and MCP `get_task`.

## Query: `tasks.core.listClosed`

| Arg | Type | Default | Notes |
|---|---|---|---|
| `projectId` | `Id<"projects">` | — | Requires `TASK_VIEW`; no access returns `[]` |
| `status` | `"Done" \| "Canceled"` | `"Done"` | One closed status |
| `limit` | integer 1–200 | `50` | Out-of-range values throw |
| `since` | Unix ms | — | Inclusive lower bound on `closedAt` |
| `until` | Unix ms | — | Exclusive upper bound on `closedAt` |

- Reads the `by_project_and_isDeleted_and_status_and_closedAt` index, newest
  `closedAt` first, then takes `limit`.
- Covers active and archived tasks, every List, and subtasks. Rows carry
  `parentId` so callers can group subtasks.
- Excludes soft-deleted tasks.

## CLI: `convoy tasks closed`

```bash
convoy tasks closed [--status Done|Canceled] [--limit <n>] [--since <date>] [--until <date>] [--json]
```

- `--since` and `--until` take an ISO-8601 date or datetime. A date-only value
  is UTC midnight, so `--since 2026-11-01 --until 2026-12-01` is all of
  November (UTC).
- Text output prints one row per task: the closed date (`YYYY-MM-DD`, UTC) and
  then the usual task summary line.

## MCP: `list_closed_tasks`

Same arguments as the query, with `since` and `until` as ISO-8601 strings.
Returns MCP task summaries (see [mcp-server.md](mcp-server.md#list_closed_tasks)).

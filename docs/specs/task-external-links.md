# Task External Links

Lightweight external/code links attached to tasks (commits, branches, pull
requests, and generic URLs) so agent-produced work is visible on the task.
Implements `OS-760`.

Related specs: `docs/specs/task-detail-metadata.md` (sidebar `Links` row),
`docs/specs/mcp-server.md` (`update_task_link`),
`docs/specs/cli-one-shot-commands.md` (`tasks links ...`), and
`docs/specs/task-activity-log.md` (`external_link_changed`).

## Scope

- Links are stored as a small embedded, bounded array on the task document —
  no separate table and no extra backend call when opening a task.
- v1 creation/editing paths are MCP and CLI; the web sidebar renders links
  read-only.
- No stale or derivable provider state is stored: no PR open/merged/closed
  status, no provider name (derivable from the URL), no `source` provenance.

## Data Model

`tasks.externalLinks?: TaskExternalLink[]` — a discriminated union by `kind`.
The shared domain language lives in `apps/web/lib/tasks/external-links.ts`;
Convex validators mirror it in `convex/lib/contracts/taskExternalLinks.ts`.

| `kind` | Required | Optional |
|--------|----------|----------|
| `commit` | `sha` | `title`, `repo`, `branch`, `url` |
| `branch` | `name` | `repo`, `url` |
| `pull_request` | `url` | `title`, `identifier`, `repo`, `branch` |
| `url` | `url` | `title` |

Every stored link also has:

- `id` — client-generated, unique within the task's array
- `createdAt` / `updatedAt` — server-stamped timestamps

Issues and documents are representable as `kind: "url"` with a title; new
kinds extend the union later without migration.

## Validation Rules

Enforced server-side via `ensure` + the tasks domain `errors.ts` catalog
(`ConvexError` messages):

- `id`: 1–160 chars matching `[a-zA-Z0-9._:-]` — "Link id must be 1-160 characters using only letters, numbers, dots, underscores, colons, and hyphens"
- `url` fields: http(s) URLs, max 2000 chars — "Link url must be an http(s) URL"
- `sha`: 7–64 hex chars — "Commit sha must be 7-64 hex characters"
- other text fields: trimmed, max 500 chars; empty optionals are dropped
- cap: max 20 links per task — "Tasks can have up to 20 links. Delete an existing link before adding another."
- upsert without `link` — "link is required when op is 'upsert'"

## ID Ownership

Clients generate `id` values:

- Agents/CLI use deterministic IDs (`github-pr-owner-repo-123`,
  `commit-<sha>`, `branch-<name>`) so repeated upserts update rather than
  duplicate.
- UI clients may use `crypto.randomUUID()`.

## Mutation Semantics

One canonical mutation: `api.tasks.core.updateExternalLink`
(in `convex/tasks/core.ts`; external links are an embedded field on `tasks`, not a
separate entity, so the mutation lives on the core tasks module and its
normalizer is the flat helper `convex/tasks/lib/externalLinks.ts`):

```ts
{ taskId, op: "upsert" | "delete", id, link? }
```

- `upsert` with an existing `id` replaces the whole item **in place**
  (stable insertion order, no reordering churn), preserving the original
  `createdAt` and stamping `updatedAt`. With a new `id` it appends.
- There is intentionally no `patch` op: deterministic IDs plus full-item
  upsert cover field updates without a parallel partial-union validator.
- `delete` is idempotent: removing a missing `id` succeeds with no change.
- Returns `{ taskId, externalLinks }` with the full updated array.
- Requires `TASK_UPDATE` permission via the shared permission helpers.
- Writes go through `patchTask` (bumps the task's `updatedAt`).
- The write and its activity-log row are one step,
  `applyAndLogExternalLinkOp` — see Activity Log below. A call that changes
  nothing (delete of a missing id, identical re-upsert) skips the patch
  entirely, so idempotent callers do not churn the task document.

## Activity Log

Link changes emit one `external_link_changed` row per call, with the op
derived from the before/after arrays rather than the caller's `op` argument.
Payload and rendering rules live in `docs/specs/task-activity-log.md`.

## Pull Requests Captured From Threads

Automated producers (today: CLI thread PR capture) do not call the public
mutation. They schedule `internal.tasks.core.upsertExternalLink`
(`{ taskId, userId, id, link }`), which resolves the task and delegates to the
same `applyAndLogExternalLinkOp`. The producer owns the mapping from its own
payload to a link; the tasks domain stays ignorant of it.

For PR capture (`docs/specs/cli-thread-pr-badge.md`), the mapping in
`cli.threads.runControl.reportPullRequest` is:

- Deterministic id `pr:<provider>:<number>`, so repeated captures and the
  refresh sweep update in place instead of accumulating.
- The link stores `url`, `title`, `identifier` (`PR #12` / `MR !12`), and
  `branch` — never the PR's open/merged/closed state, per the no-provider-state
  rule above. Live state stays on the thread badge.
- Forge titles are unbounded while link text fields cap at
  `MAX_EXTERNAL_LINK_TEXT_LENGTH`; the title is truncated at the boundary
  rather than allowed to reject the whole link.
- A **cleared** snapshot never removes the link: "lookup found no PR" (branch
  deleted, remote gone) must not erase a merged PR from task history.
- Only `associatedTaskId` — group container threads (`originTaskId`) never run
  an agent and never report a PR.

Because the write is **scheduled**, a rejected link (e.g. a task already at the
link cap) fails only that scheduled mutation, atomically and visibly in the
function logs. The producing run is unaffected, and no half-written state is
left behind — there is no silent catch anywhere on this path.

## Read Behavior

- `taskReturnValidator` includes `externalLinks` (defaults to `[]` for tasks
  without links), so `tasks.getById`, `tasks.getByRefs`, and
  `tasks.listByProject` all carry links. There is no Convex-level
  `includeLinks` flag — the array is embedded, so the document read already
  happened; payload shaping happens in the adapters.
- `tasks.searchByProject` keeps its slim result shape (no links); use detail
  reads for link data.
- MCP: `get_task` / `get_tasks` include `externalLinks`; `list_tasks`
  summaries omit links unless `includeLinks: true`; `search_tasks` is
  unchanged.
- CLI: `tasks get` prints a `Links:` section; `tasks list --include-links`
  prints links in text mode (JSON always carries them).

## UI

- Read-only `Links` row in the task detail sidebar — see
  `docs/specs/task-detail-metadata.md` (Links Row).
- The task table name cell renders one linked pull-request icon for each
  `pull_request` entry, in stored order. The icons appear immediately after
  the resource-count indicator, or immediately after the task title when the
  resource count is absent or hidden.
- Each icon uses the link's title, identifier, or URL as its accessible label,
  opens the URL in a new tab, and does not trigger the task row's click action.
  When the GitHub integration connects the PR's repository to a project the
  viewer can read, the icon and the task detail PR link open Convoy's PR reader
  instead (`PullRequestLink`, see [GitHub integration](github-integration.md#reading)).
  The icon uses the same emerald treatment as pull-request links in task
  details. Other external-link kinds remain available only in the task detail
  sidebar.
- PR link additions, updates, removals, and reordering update the task row
  reactively without requiring a page reload. The memoized row compares an
  immutable task snapshot rather than dereferencing a mutable table-row object.

## Deferred / Out of Scope (v1)

- `tasks links add-current` (auto-attach local git branch/commit) — follow-up.
- Web UI editing of links.
- Provider sync (e.g. live PR status) — deliberately avoided to prevent stale
  state.

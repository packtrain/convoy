# CLI One-Shot Commands

This specification defines non-interactive, one-shot `convoy` commands that run once, print results, and exit.

Manual command catalog:
- See `docs/specs/cli-one-shot-manual-tests.md` for copy-pasteable commands to run in this workspace.

## Scope

Commands covered:

- `convoy orgs list`
- `convoy projects list`
- `convoy task-types list`
- `convoy project-agents list`
- `convoy project-agents create ...`
- `convoy project-agents update <projectAgentId> ...`
- `convoy prompts list`
- `convoy prompts create ...`
- `convoy prompts update <promptId> ...`
- `convoy skills list`
- `convoy skills show <skillId>`
- `convoy skills create ...`
- `convoy skills update <skillId> ...`
- `convoy skills remove <skillId>`
- `convoy lists list`
- `convoy lists create`
- `convoy lists update <list>`
- `convoy tasks list`
- `convoy tasks search <query>`
- `convoy tasks get <taskId>`
- `convoy tasks refs <REF...>`
- `convoy tasks attach <taskId> <file...>`
- `convoy tasks attachments list <taskId>`
- `convoy tasks attachments download <taskId> <attachmentId> [--output <path>] [--force]`
- `convoy tasks attachments move <taskId> <attachmentId> --to-task <taskId>`
- `convoy tasks attachments delete <taskId> <attachmentId> [--yes]`
- `convoy tasks artifacts list <taskId|ref>`
- `convoy tasks artifacts get <artifactId>`
- `convoy tasks artifacts create <taskId|ref> ...`
- `convoy tasks artifacts update <artifactId> ...`
- `convoy tasks artifacts move <artifactId> --to-task <taskId|ref>`
- `convoy tasks artifacts delete <artifactId>`
- `convoy tasks create ...`
- `convoy tasks update <taskId> ...`
- `convoy tasks move <taskId> ...`
- `convoy tasks move-to-list <taskId|ref...> --list <list>`
- `convoy tasks comments add <taskId|ref> ...`
- `convoy tasks delete <taskId> ...`
- `convoy threads list [<containerId>]`
- `convoy threads get <threadId>`
- `convoy threads messages <threadId>`
- `convoy threads create ...`
- `convoy threads send <threadId> [content]`
- `convoy threads attach <threadId> [file...] --message-id <id> --session-id <id> [--inline] [--check <key> ...]`
- `convoy threads attach-task <threadId> <task>`
- `convoy threads attach-pr <threadId> <pullRequest>`
- `convoy threads submit-guide <threadId> <file|->` or `--failed --note <why>`
- `convoy threads read-guide <threadId> [--base]`
- `convoy threads checks <threadId>`
- `convoy profiles list`

This feature intentionally does **not** add `convoy mcp ...` command surface.

## Architecture

- One-shot commands call public Convex APIs directly via generated `api.*` refs and API key auth.
- No JSON-RPC MCP transport is used by these commands.
- Commands are fail-fast and non-interactive.
- An argument that takes only a document ID rejects hyphenated input (a ref)
  locally. Convex IDs never contain a hyphen, and production would redact the
  validator error to a bare "Server Error" (OS-2267).

## Output Modes

All one-shot commands support:

- `--output <text|json>`
- `--json` as alias for `--output json`

Exception: `tasks attachments download` uses `--output <path>` for the local
download destination to match file-download CLI convention. It still supports
`--json` for JSON output.

Defaults:

- Default mode is `text`.
- `json` mode emits JSON payload only (no extra prose).

Paginated one-shot commands standardize on:

- `--limit <n>`
- `--cursor <cursor>`

Cursor pagination is the canonical CLI pagination model. JSON output preserves the raw paginated payload shape from Convex (`page`, `isDone`, `continueCursor`).

## Project/Organization Resolution

For `task-types`, `project-agents`, `lists`, and `tasks` commands that need a project:

1. Use `--project` when provided.
2. Otherwise use resolved profile `project_id`.
3. If neither exists, fail with a setup hint.

`--project` supports:

- Convex project ID
- Project alias

`--org` supports:

- Convex organization ID
- Organization slug

Rules:

- `--org` requires `--project`.
- Alias matches are case-insensitive.
- If alias matches multiple orgs, command fails and requires `--org`.

`prompts` commands additionally take `--scope project|organization` (default
`project`; same two words the MCP `scope` argument accepts, with no aliases).
Under `--scope organization`, `--org` names the target organization on its own
(no `--project` needed) and is resolved by ID or slug through
`organizations.core.getByRef`, so an organization owning no accessible project
is still a valid target. When `--org` is omitted, the organization of the
resolved project is used. Under project scope `--org` keeps its usual meaning —
it disambiguates `--project` — and passing it alone is an error that points at
`--scope organization`.

Any command that resolves an organization this way fails by naming `--org` when
neither `--org` nor a resolvable project is available. The project-shaped "No
project configured" error is wrong for an organization-scoped call: the flag the
caller is missing is `--org`.

## Command Behavior

### `orgs list`

- Source of truth: `organizations.core.listForUser` — the caller's memberships,
  narrowed by API key scope (unscoped keys see every membership, an org-scoped
  key sees only that organization).
- `projects.listAccessible` supplies the project counts only, so an
  organization with no accessible project is still listed, with a count of 0.
- Output includes organization id, slug, name, and accessible project count.

### `projects list`

- Source of truth: `projects.listAccessible`.
- `--org` filters by org ID or slug.

### `task-types list`

- Calls `api.tasks.core.listTypes` after resolving the project.
- Returns the canonical built-in task-type summaries available to the project.
- Text output prints the stable key, display name, icon key, and color.
- JSON output returns the task-type summary array unchanged.
- Inaccessible projects return an empty catalog through the same fail-soft query
  contract used by other task reads.

### `project-agents list`

- Calls `api.agents.projectAgents.listByProject` after resolving the project.
- Text output prints the name, ID, category, color, and automation state.
- JSON output returns the public Project-agent rows unchanged.

### `project-agents create`

- Calls `api.agents.projectAgents.create`.
- Requires `--name` and `--color`.
- Supports optional `--description`, `--prompt`, and `--category`.
- Assignment automation is configured as a whole value with
  `--automation enabled|disabled` plus optional prompt, CLI type/model/effort,
  mode, and workspace flags.
- Text output prints the created Project-agent ID; JSON output is
  `{ projectAgentId }`.

### `project-agents update`

- Calls `api.agents.projectAgents.update` with only provided fields.
- Supports updating name, appearance color, description, prompt, and category.
- Explicit clear flags send `null` for nullable text fields and automation.
- Automation updates replace the whole automation configuration, matching the
  MCP contract; automation detail flags require `--automation`.
- Empty updates and conflicting set/clear flags fail before the mutation.

### `prompts list`

- Calls `api.slashCommands.core.listByProject` or
  `api.slashCommands.core.listByOrganization` depending on the resolved scope.
- Text output prints the scope, `/key`, description, and ID.
- JSON output returns the prompt rows unchanged.

### `prompts create`

- Calls `api.slashCommands.core.createInProject` or
  `api.slashCommands.core.createInOrganization` depending on the resolved scope.
- Requires `--key` and `--content`.
- Supports optional `--description`, `--category`, `--auto-expand`, and
  `--auto-submit`.
- Text output prints the created prompt ID; JSON output is `{ promptId }`.

### `prompts update`

- Calls `api.slashCommands.core.update` with only provided fields.
- Takes a prompt ID argument and no scope flags: scope and permissions come from
  the stored prompt.
- Supports updating key, content, description, category, auto-expand, and
  auto-submit; `--clear-description` and `--clear-category` send `null`.
- Empty updates and conflicting set/clear flags fail before the mutation.

### `skills list`

- Calls `api.skills.core.listByOrganization`. Skills are organization-scoped in
  this release, so there is no `--scope` flag: `--org` names the organization on
  its own, and is otherwise the resolved project's organization
  (`docs/specs/skills.md`). With neither available the error names `--org`.
- Text output prints `v{version}`, `/{name}`, description, category, and ID.
- JSON output returns the Skill rows unchanged.

### `skills show`

- Calls `api.skills.core.get` with a Skill ID and fails when it resolves to
  nothing.
- Text output prints the columns, then `SKILL.md`, then the other files' paths.
- JSON output returns the whole bundle, file content included.

### `skills create`

- Calls `api.skills.core.createInOrganization`.
- Requires `--name` and `--content` or `--content-file` (mutually exclusive);
  `SKILL.md` is sent verbatim, so the content is neither trimmed nor parsed.
- Supports optional `--description`, `--category`, and `--org`.
- Text output prints the created Skill ID; JSON output is `{ skillId }`.

### `skills update`

- Calls `api.skills.core.update` with only provided fields.
- Takes a Skill ID argument and no `--org`: scope and permissions come from the
  stored Skill.
- Supports `--name`, `--content` / `--content-file`, `--description`,
  `--category`, `--clear-description`, and `--clear-category`.
- Empty updates and conflicting set/clear flags fail before the mutation.

### `skills remove`

- Calls `api.skills.core.deleteSkill` with a Skill ID (a soft delete).

### `lists list`

- Calls `api.tasks.lists.list`.
- Uses cursor pagination:
  - `--limit <n>` default `20`, max `50`
  - `--cursor <cursor>` for follow-up pages
- Supports:
  - `--archived`
  - `--query <query>` for List name/ref search
- Text output includes List ref, name, raw ID, and archived state.
- JSON output preserves the raw paginated payload shape.
- Default List markers are deferred until OS-842 adds persisted default Lists.

### `lists create`

- Calls `api.tasks.lists.create`.
- `--name <name>` required; `--ref <ref>` and `--color <hex>` optional
  (ref is derived from the name when omitted; color must be from the List
  palette, validated server-side).
- Text output prints the created List name and ID; JSON output is `{ listId }`.

### `lists update <list>`

- Resolves `<list>` (raw List ID or bare List ref) via `api.tasks.lists.resolve`,
  then calls `api.tasks.lists.update`.
- Requires at least one of `--name`, `--ref`, `--color`, `--clear-color`.
- `--color` and `--clear-color` are mutually exclusive; `--clear-color` sends
  `color: null`.
- Only the provided fields are sent; the update mutation treats each of
  `name`/`ref`/`color` as optional and leaves omitted fields unchanged.
- Scoped refs containing `/` fail fast in the CLI; system Lists (`BACKLOG`)
  don't resolve.
- Archive, unarchive, delete, and set-default are not exposed (OS-896).

### `tasks list`

- Calls `tasks.listByProject`.
- Supports `--archived` and a single `--status <status>` filter.
- Supports `--list <list>` where `<list>` is a raw List ID or bare List ref.
- Supports `--include-links`: text output prints each task's external links as
  indented sub-rows. JSON output always carries `externalLinks` regardless of
  the flag (the API payload is unchanged).
- Scoped List refs containing `/` fail fast in the CLI.
- Status values are normalized locally and validated server-side.

### `tasks search`

- Calls `tasks.searchByProject`.
- Uses cursor pagination:
  - `--limit <n>` default `20`, max `50`
  - `--cursor <cursor>` for follow-up pages
- Supports:
  - `--archive-mode active|archived`
  - `--status <status>`
  - `--assignee-id <userId>`
  - `--unassigned`
  - `--list <list>` where `<list>` is a raw List ID or bare List ref
- Text output prints a next-page hint when `continueCursor` is present.
- Next-page hints preserve `--list`. Pagination currently applies to `tasks search`;
  future paginated task commands must preserve `--list` as well.
- Scoped List refs containing `/` fail fast in the CLI.
- Status values are normalized locally and validated server-side.

### `tasks get`

Accepts a raw task ID, a project-scoped ref such as `OS-2246`, or an
organization-scoped ref. Ref lookup reuses the configured project and the shared
task resolver; `--project` and `--org` select context explicitly. Raw IDs avoid
project discovery. Missing refs fail before fetching dependent task resources.

Default response is a rich composed task payload:

- task core (`tasks.getById`)
- artifacts (`tasks.artifacts.listTaskArtifactsByTask`)
- files (`taskAttachments.listTaskAttachmentsByTask`)
- subtasks (`tasks.listByParent`)

Comments are opt-in:

- `--comments <n>` includes the latest `n` comments from `tasks.comments.listByTask`
- `n` must be an integer from `1` to `50`
- without `--comments`, comments are not fetched and `comments`/`commentsHasMore` are omitted from JSON output

Text output also appends an `Artifacts:` section at the end listing artifact summaries without content.
When `--comments` is provided, text output also appends a `Comments:` section with author, timestamp, and content.
Text output includes a `Links: <n>` count line and, when the task has external links, a `Links:` section listing each link as `[kind] label (id) [url]`. JSON output carries `externalLinks` on the task core.

Text output includes a `Runs: <n>` count line and, when the task has CLI thread
work, a `Runs:` section listing each run as
`[status] title (threadId) cliType userName [via agentName]`, newest activity
first. This reads the task's denormalized `agentThreadWork` (OS-1094), so it needs
no extra query and — unlike every `cliThreads` list, which is `userId`-scoped —
shows **all** users' runs, which is what makes it the answer to "is someone already
working this ticket?". The `threadId` feeds `threads get` / `threads send`. Two
consequences of reading a denormalized summary: it carries no runtime target (use
`threads get`), and its ordering is `updatedAt`, which is restamped on title and
status changes rather than being true last-activity.

### `tasks links upsert`

- Calls `api.tasks.core.updateExternalLink` with `op: "upsert"`.
- Usage: `convoy tasks links upsert <taskId> --id <id> --kind <kind> [fields]`.
- `--id` is required; deterministic IDs make repeated upserts idempotent.
- `--kind` must be one of `commit|branch|pull_request|url`.
- Per-kind required flags, validated client-side with clear errors:
  - `commit` → `--sha`
  - `branch` → `--name`
  - `pull_request` / `url` → `--link-url`
- Optional flags: `--title`, `--repo`, `--branch`, `--identifier`, `--link-url`.
- The link URL flag is `--link-url` (not `--url`) because `--url` is the global
  Convex backend URL override.
- Output prints the upserted link line and the task's total link count; JSON
  output is the mutation result (`{ taskId, externalLinks }`).
- Content rules (sha/url format, lengths, 20-link cap) are validated
  server-side; see `docs/specs/task-external-links.md`.

### `tasks links delete`

- Calls `api.tasks.core.updateExternalLink` with `op: "delete"`.
- Usage: `convoy tasks links delete <taskId> --id <id>`.
- Idempotent: deleting a missing link ID succeeds.

### `tasks refs`

- Calls `tasks.getByRefs` with resolved project.
- Preserves input order.
- Enriches matched tasks with the same resource set as `tasks get`.
- Text output keeps the compact `Matches`/`Missing` summary and then appends per-task artifact detail sections for matched tasks.
- Supports `--comments <n>` with the same opt-in comment behavior as `tasks get`.

### `tasks attach`

- Calls `tasks.attachments.generateTaskAttachmentUploadUrl`, uploads each local
  file to the signed Convex storage URL, then calls
  `tasks.attachments.saveTaskAttachment`.
- Usage: `convoy tasks attach <taskId> <file...>`.
- `<taskId>` accepts a raw task ID, a bare task ref resolved against the current
  project, or a scoped ref like `org-slug/ABC-5`.
- Supports multiple files and uploads them sequentially.
- Multi-file upload is best-effort: if one file fails, later files are still
  attempted. Output is printed with both `attachments` and `failures`; the
  process exits nonzero when any file fails.
- Shows a spinner per file while upload/save is in progress.
- Content type is inferred from common file extensions and defaults to
  `application/octet-stream`. Text and source extensions map to text types so
  the web app can [preview them](task-attachments.md#text-attachment-preview-os-2133).
- JSON output returns `{ taskId, attachments, failures }`; each uploaded
  attachment includes `attachmentId`, `storageId`, `fileName`, `fileSize`, and
  `contentType`, and each failure includes `file` and `error`.
- The root `tasks` command has a singular `task` alias, so
  `convoy task attach ...` is also valid.

### `tasks attachments list`

- Calls `tasks.attachments.listTaskAttachmentsByTask`.
- Usage: `convoy tasks attachments list <taskId>`.
- `attachments` has a singular `attachment` alias.
- `<taskId>` follows the same ID/ref rules as `tasks attach`.
- Text output prints attachment name, ID, formatted size, content type, and
  upload timestamp. JSON output preserves the API attachment rows including
  signed `url` values.

### `tasks attachments download`

- Calls `tasks.attachments.listTaskAttachmentsByTask`, verifies the attachment
  belongs to the task, then downloads from the signed `url`.
- Usage:
  `convoy tasks attachments download <taskId> <attachmentId> [--output <path>] [--force]`.
- Default output path is the current directory with the attachment's original
  filename reduced to a safe basename (OS-1902): the server-supplied name is
  untrusted, so `../outside.txt`, `/etc/passwd`, `C:\x.txt`, `..\x.txt`, `..`
  and control characters all land in the current directory as a plain file
  name. `toSafeFileName` in `apps/cli/src/lib/file-name.ts` is shared with the
  thread attachment cache.
- `--output <path>` is the local file path for this command and is used as
  given, because the user chose it; use `--json` for machine-readable output.
- An existing file at the target path fails with
  `<path> already exists. Pass --force to overwrite it.` instead of being
  silently replaced. `-f, --force` overwrites, matching `convoy init`.
- JSON output returns `{ taskId, attachmentId, outputPath }`.

### `tasks attachments move`

- Calls `tasks.attachments.listTaskAttachmentsByTask`, verifies the attachment
  belongs to the source task, then calls `tasks.attachments.moveTaskAttachment`.
- Usage:
  `convoy tasks attachments move <taskId> <attachmentId> --to-task <taskId>`.
- Both task arguments accept an ID or a ref, like the other attachment commands.
- `--to-task` is required. The target must be in the same project.
- JSON output returns `{ attachmentId, fileName, fromTaskId, taskId }`.

### `tasks attachments delete`

- Calls `tasks.attachments.listTaskAttachmentsByTask`, verifies the attachment
  belongs to the task, then calls `tasks.attachments.deleteTaskAttachment`.
- Usage:
  `convoy tasks attachments delete <taskId> <attachmentId> [--yes]`.
- Prompts for confirmation by default. `--yes` skips confirmation.
- JSON output returns `{ taskId, attachmentId, deleted }`.

### `tasks artifacts list`

- Calls `tasks.artifacts.listTaskArtifactsByTask`.
- `<taskId>` accepts a task ID or ref, resolved like `tasks get` (`--project`, `--org`).
- Returns artifact summaries only (no markdown content).

### `tasks artifacts get`

- Calls `tasks.artifacts.getTaskArtifact`.
- Returns the full artifact including markdown content.

### `tasks artifacts create`

- Calls `tasks.artifacts.createTaskArtifact`, then refetches via `tasks.artifacts.getTaskArtifact`.
- `<taskId>` accepts a task ID or ref, resolved like `tasks get` (`--project`, `--org`).
- Supports `--name`, `--content`, `--content-file`, and `--run-id`.
- `--content` and `--content-file` are mutually exclusive.

### `tasks artifacts update`

- Calls `tasks.artifacts.updateTaskArtifact`, then refetches via `tasks.artifacts.getTaskArtifact`.
- Supports `--name`, `--content`, `--content-file`, `--clear-content`, `--run-id`, and `--clear-run-id`.
- `--content`, `--content-file`, and `--clear-content` are mutually exclusive.
- `--run-id` and `--clear-run-id` are mutually exclusive.
- Empty updates fail fast.

### `tasks artifacts move`

- Calls `tasks.artifacts.moveTaskArtifact`.
- Usage: `convoy tasks artifacts move <artifactId> --to-task <taskId>`.
- `--to-task` is required and accepts a task ID or ref, resolved like
  `tasks get` (`--project`, `--org`).
- JSON output returns `{ artifactId, taskId }`.

### `tasks artifacts delete`

- Calls `tasks.artifacts.deleteTaskArtifact`.

### `tasks create`

- Calls `tasks.create` and uses the returned task reference metadata for output.
- Does not refetch the created task only to print its ref.
- JSON output returns a created-task summary, not a full task document. The
  nested `task` object includes `_id`, `projectId`, `organizationId`,
  `projectAlias`, `refNumber`, `refId`, and `name`.
- Defaults:
  - `priority = None`
  - `status = To Do`
  - `tags = []`
- Supports `--task-type-key <key>`.
- Supports `--list <list>` where `<list>` is a raw List ID or bare List ref.
- Scoped List refs containing `/` fail fast in the CLI.
- If creating a subtask with `--parent-id` and no `--list`, backend task creation inherits the parent task's List membership.
- If creating a subtask with both `--parent-id` and `--list`, backend task creation enforces that the requested List matches the parent's List.
- Accepts due date as unix seconds/ms or ISO-8601.
- Status and task type values are validated by the backend/project configuration.

### `tasks update`

- Calls `tasks.update`.
- Supports `--task-type-key <key>`.
- Supports set and clear semantics for nullable fields.
- Conflicting options fail fast (for example set + clear for same field).
- Status and task type values are validated by the backend/project configuration.

### `tasks move`

- Calls `tasks.updateParent`.
- Supports:
  - `--parent <taskId|REF>`
  - `--top-level`
- Exactly one of `--parent` or `--top-level` is required.
- Accepts:
  - raw task document IDs
  - bare task refs like `ABC-5`
  - scoped refs like `acme/ABC-5`
- Bare refs resolve through the same project/profile resolution flow as `tasks refs`.
- Scoped refs resolve directly from the accessible project catalog and do not require `--project`.
- External callers do not provide rank; the backend appends to the end of the destination sibling list.

### `tasks move-to-list`

- Usage: `convoy tasks move-to-list <taskId|ref...> --list <list>`.
- Resolves one project, then resolves 1-25 raw task IDs, bare refs, or scoped
  refs before making one `api.tasks.core.move.toList` mutation call.
- The target accepts a persisted List ID, bare List ref, or `BACKLOG`.
- The server remains canonical for same-project, overlapping-root, hierarchy,
  archive, permission, and List validation.
- Text output names the target List and moved task count; JSON output preserves
  the mutation result (`{ taskIds, list }`).

### `tasks comments add`

- Usage: `convoy tasks comments add <taskId|ref> --message <markdown>` or
  `--message-file <path>`.
- Exactly one message source is required, and empty/whitespace-only content is
  rejected before the mutation.
- Raw task IDs, bare refs, and scoped refs use the same resolution rules as
  attachment commands.
- Calls `api.tasks.comments.create` and returns `{ taskId, commentId }` in JSON
  mode.
- This command creates ordinary task comments; artifact comments remain under
  `tasks artifacts comments`.

### `tasks delete`

- Calls `tasks.remove`.
- Supports `--cascade delete_all|keep_children`.

### `threads list`

- Reads the same pair as the MCP `list_threads` tool: `api.cli.threads.summaries.listSummaries`
  for the project's threads, `api.cli.threads.summaries.listGroupSummaries` when a
  `<containerId>` positional is given. See [mcp-server.md](mcp-server.md) for the
  summary tier and why the two are separate queries.
- A bare positional, not a flag, because it changes *what* is listed — the same
  reason `tasks get <taskId>` is positional.
- The drill-down resolves **no project**: a container ID is globally unique and the
  query authorizes through the container's own project. It also ignores `--limit`
  and `--cursor` and prints the whole group (capped at 100 rows, one scan), so JSON
  output wraps it in the same `{ page, isDone: true, continueCursor: "" }` envelope
  the flat list returns.
- Supports `--include-done` (default off) and cursor pagination on the flat list.
- Text output prints one row per unit of work: a thread group shows its child count
  and raw `aggregateStatus`; an ordinary thread shows status, runtime, and target
  profile with online state.

### `threads get`

- Calls `api.cli.threads.summaries.getSummary`; a null is a non-zero exit with
  "Thread not found or not accessible."
- A container prints group metadata — kind, children, group status, origin thread —
  and no runtime target, matching the summary tier's disjoint field sets. Group
  membership is `threads list <containerId>`'s answer, not this command's.

### `threads messages`

- Calls `api.cli.messages.listRecentSummaries`; prints the newest window in
  conversation order (oldest first).
- `--limit` is validated 1–20 in the CLI even though the query clamps the same
  range, so a caller asking for 50 hears the ceiling instead of reading 20 rows as
  the whole thread. Omitted, the query's default of 10 applies.
- Text output prints role, timestamp, status, a `truncated` marker when a cap cut
  rows, and a "from thread" marker for agent-sent messages.
- A thread group is an error from the query — a group has no transcript.

### `threads create`

- Usage: `convoy threads create --profile-id <id> --path-id <id> --cli-type <type>
  --content <text> [--content-file <path>] [--title <title>] [--task <taskId>]
  [--source <threadId|containerId>] [--attach <file...>]
  [--worktree-branch <branch> [--base-ref <ref>] [--from-origin]]`.
- Calls `api.cli.threads.core.create`, or `api.cli.threads.groups.addThreadToGroup` when
  `--source` is given. Returns `{ threadId, containerId }` in JSON mode;
  `containerId` is absent for a from-scratch create.
- `--source` resolution mirrors the MCP `create_thread` tool exactly — a thread id
  spawns a sibling (which lazily creates a group), a container id resolves to a
  member via `originThreadId` and joins the existing group, and a workflow run is
  rejected. Each of `--profile-id`/`--path-id`/`--cli-type` is `explicit ??
  inherited from the source`, except that `--path-id` is required when
  `--profile-id` names a different machine, since a path id is profile-local. See
  [mcp-server.md](mcp-server.md); `resolveSpawnTarget` in
  `apps/cli/src/commands/threads/spawn-target.ts` mirrors the MCP resolver in
  `apps/web/convex/mcp/lib/threads/resolution.ts` — that one runs in a Convex
  action the CLI package cannot import, so the two must be kept in sync.
- Without `--source` the tuple is required and the project resolves the usual way.
  **With `--source` no project is resolved**: the source thread's own project is
  authoritative, because a group never spans projects. That project is also what
  `--task` resolves against, so a bare ref (`--task 1634`) neither requires a
  configured default nor silently queries a different project. A scoped
  `--task acme/WEB-12` still names its own project, as everywhere else.
- `--cli-type` is validated in the CLI against the same list as `cliTypeValidator`,
  so a typo names the valid runtimes instead of failing inside the mutation.
- `--content` and `--content-file` are mutually exclusive, and either may be
  omitted entirely when `--attach` is given — an attachment can carry the message.
  The requirement is that content **or** an attachment is present, matching the
  mutation's own rule; the same is true of `threads send`.
- `--worktree-branch` runs the thread in a new git worktree (OS-2488), sending
  the same `worktree` spec as MCP `create_thread`: `parentPathId` is the
  thread's resolved `pathId`, `--base-ref` maps to `baseRef`, `--from-origin` to
  `startFromOrigin`. The last two are rejected without `--worktree-branch`. The
  server validates the branch and rejects a parent that is itself a worktree, so
  spawning with `--source` from a worktree thread needs the parent repo's
  `--path-id`. To use an existing worktree, pass its `--path-id` instead.

### `threads send`

- Usage: `convoy threads send <threadId> [content] [--content-file <path>]
  [--attach <file...>]`. Calls `api.cli.messages.send` and returns
  `{ threadId, messageId }` in JSON mode.
- Queues a user message for the target's next run; it does not resume a paused
  agent. A thread group is rejected by the mutation — a group has no transcript.
- Reads `api.cli.threads.summaries.getSummary` first for the thread's `projectId`, which the
  upload mutations authorize on. The resolved `--project` is deliberately not used:
  a thread outside the configured default would otherwise fail, or attach against
  the wrong project.

### `threads attach`

- Usage: `convoy threads attach <threadId> <file...> --message-id <messageId>
  --session-id <sessionId>`. Attaches files to the running agent's own reply
  (OS-2091). Returns `{ threadId, messageId, storageIds }` in JSON mode.
- The agent does not look the IDs up: each run's prompt names the exact command
  (see [cli-thread-agents.md](cli-thread-agents.md#reply-attachment-delivery-os-2091)).
- Same thread-project lookup and upload steps as `threads send`, then one
  `api.cli.messages.attachToResponse` call for the whole batch. The mutation
  rejects a reply whose run has ended or been replaced. Contract:
  [cli-message-attachments.md](cli-message-attachments.md#agent-reply-attachments-os-2091).
- Do not rerun the whole command after an ambiguous failure: repeating the
  mutation with the same storage IDs is a no-op, but rerunning uploads new blobs.
- `--inline` (OS-2220) marks every file in the call `display: "inline"`, so the
  reply shows it expanded. Any file whose inferred type isn't `text/html` fails
  the command before anything uploads (`--inline works only on .html files: …`).
  See [Inline HTML](cli-message-attachments.md#inline-html-os-2220).
- `--check <key>` (OS-2291) with exactly one of `--passed`, `--warning`,
  `--failed`, `--not-performed` also reports a Check result; `--note` and
  `--label` go with it. Files become optional. These fail before anything
  uploads: a status, `--note` or `--label` without `--check`; `--check` with
  zero or several statuses; any status but `--passed` without `--note`; no files
  and no `--check`. Rules: [task-checks.md](task-checks.md#reporting-agent-side).

### `threads checks`

`convoy threads checks <threadId> [--json]` (OS-2291) checks the thread with
`getSummary`, then reads `api.checks.checklists.getForThread`, and prints each
derived row's key, label, instruction, current status, and note. A thread with
no task lists its own Checks (OS-2293). JSON is `{ taskId, checks: [{ key,
label, instruction, added, status, note? }] }`, with `taskId: null` for a thread
with no task.

### `--attach` on the write commands

- Applies to `threads create`, `threads send`, and the files of `threads attach`.
- Up to 10 files per message, matching `MAX_MESSAGE_ATTACHMENTS`. Content type is
  inferred from the file extension by `apps/cli/src/lib/content-type.ts`, shared
  with `tasks attach`.
- Each file is capped at 50 MB, mirroring the server's `MAX_ATTACHMENT_SIZE`.
  Checked against `stat` **before** the file is read, so an oversized file is
  rejected rather than buffered into memory. `tasks attach` runs the same check.
  The server enforces the cap at registration
  ([task-attachments.md](task-attachments.md#size-limit-os-1676)), so this check
  only avoids wasted work.
- Three steps per file, in order: `generateMessageAttachmentUploadUrl`, a direct
  `POST` of the bytes to the signed URL, then `registerPendingUploadedAttachment`.
  The metadata is passed inline to `create`/`send` — thread attachments have no
  `saveTaskAttachment` equivalent, which is why `uploadTaskAttachmentFile` is not
  reused.
- **Registration is never skipped on the reasoning that a send follows
  immediately, and `deletePendingUploadedAttachment` runs in a `finally`.** There
  is no cron sweep for pending uploads — cleanup is explicit-only — so a command
  that uploads and then fails at the send would leak the blob with nothing to
  reclaim it. Discarding after a *successful* send is a no-op on storage: the
  mutation deletes bytes only when no message references them. See
  [cli-message-attachments.md](cli-message-attachments.md).
- **Cleanup never changes the command's outcome.** Every blob is attempted even
  when one discard fails, and a discard failure prints a warning instead of
  throwing. Rethrowing from the `finally` would convert a committed send into a
  reported failure, dropping the message ID and inviting a retry that queues a
  duplicate message.
- A failed upload aborts the command; unlike `tasks attach`, there is no
  partial-success payload, because the attachments are one message's.

### `profiles list`

- Calls `api.cli.profiles.listByProject` and is its own top-level namespace, not a
  `paths` or `config` subcommand: those are local-config readers, while this
  returns what only the server knows (`isOnline`, `availableClis`, `appVersion`).
  It parallels the MCP `list_cli_profiles` tool.
- Text output prints each profile's online state, hostname, CLI version, available
  runtimes, and its working paths with path IDs — the two halves of a spawn target.
- `availableClis` entries are objects (`availableCliValidator`), printed as
  `type version`, the same pair the web hover card shows. `hostname` is optional
  and falls back to `Unknown`, as it does in the web UI.

## Error Semantics

- Missing credentials/configuration: non-zero exit with setup hint.
- Invalid option values: non-zero exit with valid value guidance.
- Inaccessible/missing resources: non-zero exit with concise message.
- A backend rejection prints the error's own wording, never Convex's transport
  frame (`[CONVEX Q(path)] ... Called by client`). `toUserFacingError`
  (`apps/cli/src/lib/convex-error.ts`) reads a `ConvexError`'s clean `data`
  payload, mirroring `getErrorMessage` in `apps/web/lib/errors.ts`.
- When a paginated command was given `--cursor` and the backend rejects the
  query, the message names the cursor as the likely cause. Convex's `.paginate()`
  raises an undeserializable cursor as a plain `Error` whose text production
  redacts to "Server Error", so the hint keys off `--cursor` being present rather
  than on the message or on Convex's cursor encoding.
- A closed stdout pipe (`| head`, `| jq`) exits quietly instead of raising an
  unhandled `EPIPE` — guarded once in `apps/cli/bin/convoy.ts`.

## Compatibility

- Existing long-running commands (`connect`, `setup`, etc.) are unchanged.
- Existing `projects list` remains available; filtering is expanded to support org slug in addition to org ID.

### `threads done`

`convoy threads done <threadId> [--json]` calls `api.cli.threads.core.markDone`.
JSON output is `{ threadId }`; text output confirms success. It requires no
project lookup. Running targets or containers with running children are rejected
before any writes. Errors return a nonzero exit without a success message.
See `cli-thread-read-state.md` for ownership, scope, cascade and activity rules.

### `threads attach-task`

`convoy threads attach-task <threadId> <task> [--json]` attaches a task to a
thread started without one (OS-1713), via `api.cli.threads.core.attachTask`.
`<task>` is an ID or ref, resolved in the thread's own project (read through
`getSummary`), never the configured default. An org-scoped ref (`acme/OS-5`) is
rejected before any request. JSON output is
`{ threadId, taskId }`. Errors (already attached to another task, container,
task outside the project) exit nonzero without a success message. Rules:
`cli-thread-task-attachments.md` → Persistence rules.

### `threads attach-pr`

`convoy threads attach-pr <threadId> <pullRequest> [--json]` attaches a GitHub
PR to a thread that has none, via `api.cli.threads.core.attachPullRequest`.
`<pullRequest>` is a github.com PR URL or `owner/repo#number`, passed through;
the server parses it. JSON output is `{ threadId, pullRequest }`. Errors
(another PR attached, container, not a PR) exit nonzero without a success
message. Rules: `github-integration.md` → Pull requests in threads.

### `threads submit-guide`

`convoy threads submit-guide <threadId> <file|-> [--json]` hands a Guide run's
Guide back, via the action `api.integrations.github.guides.submit`. The file
(or stdin for `-`) is `{ "headSha", "steps" }`; the command checks only that
shape and sends it. Convoy validates the steps against the revision's changed
files and returns every error, which the command prints as a list and exits
nonzero, so the agent can fix and resubmit. JSON output is
`{ status: "accepted", guideId }`. `convoy threads submit-guide <threadId>
--failed --note <why>` takes no file: it sends `failure` and the Guide shows
as Failed with the note. `--failed` without a note, or neither a file nor
`--failed`, fails before calling Convoy. Rules: `github-integration.md` → Guides.

### `threads read-guide`

`convoy threads read-guide <threadId> [--base]` prints a Guide run's Guide, or
with `--base` its Follow-up base, as JSON `{ guideId, status, headSha, steps }`,
via `api.integrations.github.guides.readForRun`. Steps carry `number` (from 1,
as `unchangedFrom` and `updatedFrom` count) and drop file blob SHAs. When
`--base` finds no base (a plain Guide, or the base was deleted), it prints a
sentence telling the agent to write a plain Guide and exits zero. Rules:
`github-integration.md` → Follow-up guides.

## Project creation onboarding

`setup --create` and `project add --create` support complete non-interactive
creation inputs. See cli-setup-non-interactive.md and cli-project-isolation.md.
`projects list` remains the remote discovery command for recovery; `project list`
reports local registrations and service state.

# CLI Thread Task Attachments Specification

This document defines the backend contract for attaching a task to CLI thread user messages and for associating a thread with its first attached task.

## Scope

- Applies to `cliThreads.create` and `cliMessages.send`.
- Applies to persisted task fields on `cliThreads` and `cliMessages`.
- Applies to task summary hydration in `cliThreads` and `cliMessages` query results.
- Applies to rendering user-message task pills on thread detail pages.
- Applies to thread-workspace link behavior for thread-surface task refs.
- Applies to in-place task-sidebar navigation on thread routes.

## Mutation Contract

### Inputs

- `cliThreads.create` accepts optional `taskId`.
- `cliMessages.send` accepts optional `taskId`.

### Validation

- `taskId` must resolve to an existing task.
- The task must not be soft-deleted.
- The caller must be allowed to view the task's project.
- The task must belong to the same project as the target thread/profile.
- Invalid task ids fail with `ConvexError("Task not found")`.

### Empty-message rule

- Create/send is accepted when at least one of these is present:
  - non-empty trimmed text
  - persisted file attachments
  - valid `taskId`

## Stored Data

- `cliThreads.associatedTaskId?: Id<"tasks">`
- `cliMessages.taskId?: Id<"tasks">`

### Persistence rules

- Creating a thread with `taskId` stores that `taskId` on the initial user message.
- Creating a thread with `taskId` also sets `associatedTaskId` on the new thread.
- Sending a message with `taskId` always stores that `taskId` on the new user message.
- Sending a message sets `associatedTaskId` only when the thread does not already have one.
- Once set, `associatedTaskId` is not overwritten by later task-backed messages.
- `cli.threads.core.attachTask` (MCP `attach_task_to_thread`, CLI `threads attach-task`) sets
  `associatedTaskId` on an existing thread without sending a message (OS-1713). Same rule: it only
  fills an empty slot. The same task again is a no-op; another task throws
  "This thread already has an attached task". Containers are rejected, and the task must pass the
  same check as `create`/`send` (active, same project, `task:view`); a same-task retry returns
  before that check, so it stays a no-op after the task is deleted. The thread shows on the task
  through `agentThreadWork` (`source: "manual_attachment"`) and `listByAssociatedTask`. The first
  attach also logs `thread_attached` (`docs/specs/task-activity-log.md`): the thread row sits at the
  thread's start time, which predates the task, so it can fall below the loaded timeline pages.
- Either way of filling the slot (send or `attachTask`) moves the thread's own Check results onto
  the task (OS-2293, `docs/specs/task-checks.md` → Ownership).

## Title Derivation

For `cliThreads.create`, derived titles use this precedence when `title` is not explicitly provided:

1. attached task name
2. first non-empty line of trimmed text
3. first attachment filename
4. fallback `New thread`

When a task-backed title is used, the task name is copied into the new thread at creation time only. Users can rename the thread later, and later task renames do not retroactively change stored thread titles.

## Query Output

### Thread summaries

- `cli.threads.core.get` and `cli.threads.lists.listByProject` return optional `associatedTask`:
  - `_id`
  - `refId`
  - `name`
  - `taskType`
  - `isArchived`

### Message summaries

- `cliMessages.listByThread` and `cliMessages.listUnprocessedUserMessages` return optional `task` with the same shape.

## CLI Prompt Injection

- Attached task refs are injected into CLI runtime prompts only; persisted message content remains unchanged.
- When a user message has an attached task, the runtime adds a dedicated line before the message body:
  - `task(convoy): <REF>`
- The runtime does not inline the task title, description, or any other task fields into the prompt.
- Agents are expected to resolve task details from Convoy using the available MCP tools, such as `get_tasks`.

## Thread Surface Rendering

- On thread detail pages, user messages render the attached task before file attachments when `message.task` is present.
- The user-message task affordance shows:
  - task ref
  - task name
  - task type icon
- Missing or unresolved hydrated task summaries fail soft by rendering no task affordance.

## Link Behavior

- Thread-surface task affordances target the shared `/threads` workspace, not the project task page.
- On `/threads/[threadId]`, detail-page task pills and associated-task refs stay on the current thread route and update:
  - `task=<REF>`
- If the linked task is archived, the route also includes:
  - `archived=true`
- Thread-surface task affordances set only `task`; they do not set `attachedTask`.
- Opening task details in the thread workspace must not implicitly attach that task to the composer draft.
- Dragging a task row onto the composer is an explicit attach affordance (it sets `attachedTask=<REF>`); see `docs/specs/thread-task-selector.md`.

## Fail-Soft Resolution

- Persisted task references are resolved at read time using the task row and project alias.
- If a stored `taskId` or `associatedTaskId` can no longer be resolved, queries omit the hydrated summary field instead of throwing.
- File attachments remain independent from task attachment fields.

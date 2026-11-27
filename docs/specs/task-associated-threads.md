# Task-Associated Threads

## Scope

Defines task-to-thread association behavior for the task detail sidebar `Threads` metadata row, the task-attached thread composer, and the `/threads` page handoff flow.

The sidebar's footer tabs are gone (OS-1388): threads are rows in the merged
timeline, and `docs/specs/task-timeline.md` owns that stream and the in-stream
composer. This spec owns the association itself, the metadata row, the
composer's task-attachment contract, and the full-page handoff.

## Association Source

- Task-associated threads are defined by `cliThreads.associatedTaskId`.
- It is set at thread creation, by the first task-bearing message, or later by an explicit attach
  (OS-1713, `docs/specs/cli-thread-task-attachments.md` → Persistence rules).
- Historical message-level task attachments do not participate in this lookup.
- The sidebar row shows only the current user's non-deleted associated threads for the current task.
- Other users' threads on the same task are visible only through the task's
  `agentThreadWork` rows (`docs/specs/agent-automation.md` → Storage and
  readers), never through this lookup — every
  thread list index is `userId`-scoped (`docs/specs/cli-thread-sharing.md`).
  The Runs column and the timeline both read it that way.

## Sidebar Row

- The task detail sidebar includes a `Threads` metadata row between `Assignee` and `Due date`.
- Every associated thread is rendered as its own compact row, stacked vertically;
  there is no count trigger and no dropdown (OS-1803). Each row links directly to
  that thread's detail route in a new tab.
- Workflow run containers (`kind: "group"` with `workflowRunId`, see
  `workflows.md` → Threads page integration) render as a nested group inside
  the same list: the container row first, its lane threads directly under it
  indented with a `CornerDownRight` glyph. Non-run threads keep the query's
  activity order around the group. A lane thread whose container isn't
  associated renders as a plain row. Nested rows count toward the same
  collapse rule as any other row.
- Rows are ordered newest activity first (the query's `lastActivityAt` order).
- Rows fill the metadata column's width (capped at `max-w-88`) rather than
  shrinking to the title, so a short title still gets a full-width hit area.
- `0` threads: render plain `No threads` text.
- More than 5 threads collapse to the first 4 rows plus a `Show {n} more threads`
  button row that expands the rest in place (no dropdown, no re-collapse). 5
  threads render in full: collapsing would spend a row to hide a single row.
- Compact thread rows in this sidebar suppress row actions; their CLI icon and activity timestamp remain visible on hover because there is no overflow action to reveal.
- The `+` action:
  - is always visible in every thread-count state, on the right of the **first**
    thread row (or beside `No threads` when there are none)
  - focuses the timeline's in-stream thread composer, opening the thread side if
    the comment composer is showing
  - preserves the existing task draft
  - re-focuses the composer on repeated clicks even when it is already open
- The row includes a separate icon-only external-link action with tooltip text `Open threads page`.
- That action opens the project `/threads` route with the current task ref in the `attachedTask` query param in a new tab.

## Sidebar Rows

- Rows are the same compact thread rows used in the threads sidebar compact layout.
- Rows suppress the associated task ref because the current task is already implied by the surrounding context.
- All associated threads are listed once expanded; the query still caps the set at
  `TASK_THREADS_MAX` and truncates silently.

## Task-Attached Thread Composer

The reusable new-thread composer for a known task. Two hosts share it: the task
timeline's in-stream composer and the task table's Runs popover/drawer.

- It uses the shared thread composer surface.
- Profile/path/CLI/mode selectors stay editable.
- It renders the single shared composer layout (see
  `docs/specs/cli-thread-context-selectors.md`): working directory,
  worktree/branch, and agent selectors wrap in the context bar above the input,
  and the footer keeps labeled CLI/model and mode controls plus a visible Send
  button in the narrow sidebar.
- It preattaches the current task and **locks** it, so the attachment cannot be
  removed or replaced from this surface.
- It creates new threads in place for the current task.
- Its draft scope key is `task:<taskId>` (`docs/specs/cli-thread-drafts.md`), so
  a draft survives the composer being swapped out and back within a mounted
  sidebar.
- Archived tasks keep the thread rows visible but disable new-thread
  composition.
- Each host supplies its own container/input padding and decides whether the
  composer draws a top border; neither is baked into the component.

Thread rows themselves — presentation, ordering, and click behavior — are
`docs/specs/task-timeline.md` in the sidebar and the Runs column's own
behavior in the task table.

## Full-Page Handoff

- The task sidebar full-page action opens the current project `/threads` route.
- The route carries composer attachment preselection by task ref in the `attachedTask` query param.
- `attachedTask` may coexist with:
  - `task` for the shared right-pane task-details selection
  - agent-context preselection params such as `profileId` and `pathId`
- The `/threads` page resolves `attachedTask` against the current project before rendering it as an attached task pill in the composer.
- Valid `attachedTask` values remain in the URL until the user clears or replaces the attachment.
- Invalid or missing `attachedTask` refs fail soft and are removed from the URL.
- The full-page action sets only `attachedTask`; it does not open the task-details pane by itself.

## Composer Contract

- There is no inline composer in the task-sidebar dropdown.
- Task attachment/removability behavior for the full `/threads` page remains defined by:
  - `docs/specs/thread-task-selector.md` for attached-task pill semantics
  - the `Full-Page Handoff` section above for thread-route `attachedTask` preselection

# Thread Task Selector Specification

This document defines the thread composer task-selector dialog introduced for task attachment workflows.

## Scope

- Thread composer `Attach task` action
- Centered task-selector dialog behavior
- Shared task search/result rendering reused from project task search
- Single attached-task pill behavior inside the composer

## Dialog Shell

- The selector opens as a centered command-style modal dialog.
- The desktop dialog content is 36rem wide and 32rem tall, capped by the shared responsive dialog viewport constraint.
- It is thread-scoped, not a global application command palette.
- The shell may change in the future, so task search state and row rendering should stay reusable outside the dialog.

## Data Sources

- Typed search uses `api.tasks.core.search.byProject`.
- Empty-state seeded results use a dedicated paginated recent-tasks query for active tasks only.
- Seeded recent-task results:
  - are ordered by `createdAt` descending
  - include active tasks regardless of status
  - are shown when there is no query
  - are subscribed **only while the dialog is open** — one selector is mounted per
    composer, so a closed one held a live subscription per composer (OS-1719)
- The dialog searches active tasks only in this iteration; archived task selection is out of scope.

## Result Rendering

- Result rows reuse the same task metadata presentation as the project header task search:
  - task type glyph + ref
  - task title
  - compact status metadata
  - compact priority metadata
- Result rows should preserve tooltip and accessibility behavior for status and priority metadata.
- Result rows are real links to the thread workspace task deep-link URL so standard browser actions such as middle-click, Cmd/Ctrl-click, copy link, and open in new tab work.

## Interaction

- `Attach task` menu action opens the dialog.
- When the task search input contains non-whitespace text, a right-side `X` icon button is shown with the accessible label `Clear search`.
- Activating the clear button clears the input and keeps the dialog open, returning the list to seeded recent tasks.
- Arrow-key navigation and Enter selection must work inside the dialog.
- Plain left-click or keyboard selection closes the dialog and emits the selected task through a callback.
- Modified clicks and browser link actions must rely on the row anchor's `href` without attaching the task in the current composer.
- The composer holds at most one attached task at a time.
- Selecting a new task replaces the current attached task.
- Dragging a task row, task-list card, or task-detail subtask card with a mouse
  onto the composer attaches it, equivalent to selecting it in the
  dialog. The drop target is the composer's input box (the composer wraps its
  prompt input in `ThreadComposerTaskDropZone`), gated by the cross-surface
  drag payload's project (see `docs/specs/task-table-drag-and-drop.md`). Task
  drags are intercepted in the capture phase so the rich-text editor never
  receives them (it would otherwise insert the drag's plain-text id). A
  multi-task drag attaches only the first root task, and a drop replaces the
  current attached task.
- **Every composer that can attach a task accepts the drag** (OS-1685). The
  drop zone is live wherever the attach affordance is — it is gated on the same
  condition as the "Attach task" menu action (`isAttachedTaskRemovable`), not on
  the host passing a drop callback. A drag carries only task ids, so the
  composer resolves the dropped task's name and type itself and attaches once
  the summary lands; hosts that additionally mirror the attachment into the URL
  pass `onTaskDrop`. Gating on that prop instead left the group draft tab's
  composer with a dead drop zone while its menu action still worked.
- The attached task renders as a removable pill in the composer header before file pills.
- The pill uses a visible accent derived from the selected task type color.
- The pill's full task tooltip opens after a 500 ms hover/focus delay so
  incidental pointer movement through the composer does not flash it.
- Removing the pill clears only the attached task state.
- Attached task state is mounted-composer state only; it is not persisted in thread drafts.
- Composer submit is valid when the queued content contains text, files, or an attached task.

## Non-Goals

- Message persistence and read-model behavior are defined in `docs/specs/cli-thread-task-attachments.md`.
- Message/thread rendering outside the composer is deferred to later slices.
- Task-sidebar routing from thread surfaces is deferred to later slices.

# Task Deep Links

## Scope

Defines project task table behavior for URL task deep links on the canonical project route:

- `/o/:organizationSlug/:projectAlias?task=<REF>`
- `/o/:organizationSlug/:projectAlias?list=<LIST_REF>&task=<REF>`

This spec covers list/detail-surface synchronization for direct links.
For header navigation rules that clear task deep links, see `docs/specs/project-header-navigation-state.md`.

## Resolution

- The `task` query param is interpreted as a task ref (`ABC-123`).
- Optimistic placeholder refs, such as tasks that have not yet received a
  server-assigned ref, must not open task details or write a `task` query param.
- When Lists are enabled, the `list` query param identifies the selected project List by List ref.
- Task resolution is project-scoped and is not constrained by the selected List query param.
- If `list` is missing, the route resolves to the project default List and may canonicalize the URL with that List ref.
- In v1, if the resolved task's current List differs from the selected `list`, the app still renders the selected List and opens the task detail surface.
- Automatic canonicalization from selected List to task current List is deferred.
- Task search surfaces avoid that mismatch by constructing active-task deep links with the result task's owning List ref; see `docs/specs/task-search-dropdown.md`.
- Opening or closing task details preserves the selected `list`.
- Closing task details removes `task` and `artifact` but keeps `list`.
- Switching Lists clears `task` and `artifact`.
- The project page resolves that ref within the current archive dataset:
  - active list mode resolves against active tasks
  - archived list mode resolves against archived tasks
- When resolution succeeds, the task detail sidebar opens for that task.
- On desktop, the task detail surface is the existing resizable right sidebar overlay.
- On mobile, the same task detail content opens in a right-side drawer that fills the viewport instead of the sidebar overlay.

## Table Synchronization

- If the resolved task is present in the current rendered list dataset after status/assignee filtering, the table must:
  - select and highlight that task row
  - expand every visible ancestor in the task's chain before highlighting the row
  - when the list is grouped, expand the collapsed group that holds the task, the same way Up/Down navigation does (`docs/specs/task-list-grouping.md`)
  - scroll the row into view through the list virtualizer, so rows outside the rendered window are reached too; a row already on screen does not move
  - leave keyboard focus where it is
- Ancestor expansion only applies to ancestors that are present in the current rendered dataset.
- If filters exclude one or more ancestors but still include the target task, the target task behaves like a visible root for expansion purposes.

## Filtered-Out Tasks

- If the resolved task is not present in the current rendered list dataset, the detail surface may remain open for the task, but the table must not force an incorrect row highlight.
- In that filtered-out state, the table must not fabricate expansion state for rows that are not currently rendered.
- A List/task mismatch is treated the same way in v1: the selected List stays rendered, the task detail surface opens, and no row is highlighted if the task is not in the rendered List.
- Archived task search may also open a sidebar for a task outside the currently loaded archive page; this accepted pagination case follows the same no-fabricated-highlight rule.

## Parity With In-List Opens

- URL-driven task opens should match the task-table selection affordance used by normal row/input opens.
- The selected row uses the existing highlight styling from the task table; direct links do not need to add keyboard focus automatically.
- In-list task opens may render the detail surface optimistically before the `task` query param finishes updating, but transient URL-sync delay must not close and reopen the detail surface for the same task.
- In-list task opens must wait for a concrete task ref (`ABC-123`). Rows whose ref is still unavailable or only an optimistic placeholder must not open the detail surface or write a `task` query param.
- Desktop and mobile use the same `TaskDetailSidebar` content and URL handlers; only the host presentation changes.

## Acceptance Checklist

- Opening a root task via `?task=<REF>` highlights that row in the list.
- Opening a nested task via `?task=<REF>` expands visible parents until the row is visible, then highlights it.
- Opening `?task=<REF>` for a row far down a long list scrolls that row into view without focusing it.
- Opening `?task=<REF>` for a task in a collapsed group expands that group and scrolls the row into view.
- Opening a filtered-out task via `?task=<REF>` does not highlight an unrelated row or scroll the list.
- Opening `?list=<LIST_REF>&task=<TASK_REF>` where the task belongs to another List keeps the selected List rendered and opens the task detail surface without an unrelated row highlight.
- Manual selection changes after the deep-link sync are not immediately overwritten unless the URL task changes again.
- Opening a task from the list does not briefly close and reopen the same detail surface when URL sync is slow.
- At mobile width, opening `?task=<REF>` renders task details in a full-width, full-height right drawer with no sidebar resize handle.

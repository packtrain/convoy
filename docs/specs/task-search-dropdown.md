# Task Search Dropdown Specification

This document defines the task result rendering and interaction rules for the project header task search dropdown.

## Scope

- Project header task search input and result popover
- Active/archived task result tabs
- Search result metadata rendering

## Result Rendering

- Each result row shows:
  - task type glyph + task ref
  - task title
  - compact status metadata
  - priority icon metadata
- Each result row is a real link to the task deep-link URL so standard browser actions such as middle-click, Cmd/Ctrl-click, copy link, and open in new tab work.
- The task type glyph replaces the old middle-dot separator between the ref and the title.
- The status metadata uses the compact/icon-only task status presentation rather than the full text badge.
- The priority metadata remains icon-only.

## Interaction

- Plain left-click selection preserves the existing dropdown behavior: select the task, reset/close the search, and navigate to the task sidebar deep link.
- Modified clicks and browser link actions must rely on the row anchor's `href` without running the in-place selection handler.
- Active task result links include the task's owning List ref so the canonical List route renders that List and can highlight the selected task.
- This owning-List navigation applies consistently to project-header search, global Cmd+K quick open, and mobile search.
- Archived task result links include the archived view state required to resolve the task and do not include stale List state.
- Archived pagination may leave the opened task outside the currently rendered table page; the sidebar still opens and the table does not force a highlight.
- When used from the board route, task result links target the canonical List route and preserve the board-return preference.
- When the search input contains non-whitespace text, a right-side `X` icon button is shown with the accessible label `Clear search`.
- Activating the clear button clears the input, resets the highlighted result, and closes the result popover without selecting a task.
- Shared task selector searches load 50 items initially and fetch 100 more when loading additional results.
- When more results are available, `Load more` renders as the final item inside the scrollable result list, not as a fixed footer below the list.

## Metadata Tooltips And Accessibility

- Compact status and priority metadata must show hover tooltips with their human-readable labels.
- Icon-only metadata must still expose readable text to assistive technology without depending on tooltip visibility alone.
- Tooltip copy should be the plain status or priority label only.
- When a task priority is `None`, the tooltip/accessibility label should read `No priority`.

## Non-Goals

- No backend or Convex query payload changes.
- No changes to search ranking or result selection behavior.

## Shared Sources Of Truth

- Shared task status iconography lives in `apps/web/components/blocks/tasks/task-table/badges.tsx`.
- Task type glyph metadata comes from `apps/web/lib/tasks/task-types.ts`.

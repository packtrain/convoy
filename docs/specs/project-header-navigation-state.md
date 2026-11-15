# Project Header Navigation State Specification

This document defines the shared project header controls for table and board views.

## Overview

- The project table page and board page use the same header controls.
- Switching between Table and Board must preserve the shared header shell and
  must not visibly reload the List selector.
- The header shows `Agents`, `Table`, List selector, `Filter`, search, members,
  settings, and add task. When the matching developer setting is enabled, it
  also shows `Board`.
- Outside the Board developer toggle, the header hides only the `Board` button
  while keeping the rest of the controls unchanged.
- The base project route remains the canonical table route.
- The `/kanban` route remains the canonical board route.
- `Backlog` is a system List selected through the List selector and behaves like
  any other selected List for Table/Board switching. `Archived` remains a
  table-only archive mode until OS-908.

## Developer Settings Gate

- Header developer controls are enabled by the shared local developer-settings subsystem.
- The settings persist in local browser storage and are controlled from the `Developer` section of the user settings dialog.
- The subsystem may continue reading the legacy dev-mode local storage key during migration.
- `Project header: Board view` controls the `Board` button.
- The real data-backed Board remains behind this developer setting until the v1
  Board behavior is complete.
- The header settings trigger is always visible and is not controlled by a
  developer setting.
- Hiding the header `Board` button does not disable direct navigation to the `/kanban` route.

## Header Settings Menu

- `Copy link` writes the absolute project root URL to the clipboard using the current browser origin and canonical project path.
- The header settings menu shows `Add members`, not `Share`.
- `Add members` uses the `UserPlus` icon and opens Project Settings on the `Members` section.
- The header settings menu does not include a destructive `Delete` action.
- The top of the settings menu contains grouping icon buttons, labeled `Group by`
  in list view and `Columns by` in board view. Layout switching stays in the
  page header; the dropdown has no layout switch or nested list-grouping menu.
- Both views offer `Status`, `Assignee`, `Owner`, `Priority`, `Type` and `Label`.
  Lists also offer `No grouping`. Board columns always have a grouping.
- The selected icon uses a solid primary background, primary-foreground color
  and `aria-checked`. The icons are radio menu items with accessible names and
  tooltips. Menu arrow keys reach them; Enter or Space changes grouping while
  keeping the menu open.
- Icons update only the current view's grouping. List `listGroupBy` and board
  `groupBy`/`rowGroupBy` URL state remain separate and survive layout
  switches. A view with no grouping in the URL opens with its default.
- Board rows use a separate `Rows by` submenu; see
  [task-board-rows.md](task-board-rows.md).
- The header settings menu does not include a `Lists` item; Lists are managed
  through the dedicated header List selector and project settings.
- Unimplemented header settings entries (`Filters`, `Auto hide done items`,
  `Import`, `Export`, `Notify me`) are hidden, or shown disabled under
  [`Show unfinished items`](user-settings-developer-section.md#unfinished-items).

## View Controls

- `Board` replaces the old `Kanban` label everywhere in the project header.
- `Board` always points to the canonical `/kanban` route for the project and preserves current List, status filter, and assignee filter state while clearing task deep links and artifact selection.
- `Table` is a dedicated view button in the header, not a filter-dropdown option, and always points to the canonical base project route while preserving current List, status filter, and assignee filter state and clearing task/artifact sidebar selection.
- `Filter` remains a dedicated trigger control, but its label reflects the currently active filter state (`All`, `Active`, `Done`, `Canceled`, `Archived`, `Assigned`, `Assigned to me`).
- The all-tasks status filter URL value should be `all`.
- The old all-tasks value `filter=board` is not supported; this project was not in production for that value.

## Task Lists Interaction

- Task Lists introduce a dedicated List selector separate from the existing `Filter` trigger.
- Header control order is rendering mode (`Table`/`Board`), then List selector, then `Filter`.
- Backlog is controlled by List selection (`list=BACKLOG`).
- Archived remains controlled by archive state until OS-908.
- Switching Lists preserves status and assignee filters, but clears task and artifact deep-link state.
- Creating a List from the header List selector immediately selects the new List.
- Selecting a color while creating a List from the header List selector must not
  close the create dialog or parent selector before the List is saved or canceled.
- Creating a List from project settings only creates the List; it does not change the current project-page List selection.
- The selected List in the header selector is indicated with an active row background, not a checkbox-style marker.
- The Filter trigger uses `All` as the UI label and `all` as the canonical URL value.

## Active State Rules

- `Table` uses the neutral active styling and sets `aria-current="page"` only for the canonical default table state (`All`, non-archived, no assignee filter).
- On the board route, `Board` uses the neutral active styling and sets `aria-current="page"`.
- The `Filter` trigger does not use neutral active styling for ordinary task filters such as `All`, `Active`, `Done`, `Canceled`, or assignee-only states.
- In archived mode, the archived amber styling takes precedence over the neutral `Filter` active styling.

## Table-Only State Rules

- When the archive mode is `Archived`, the header must disable the `Board`
  button and keep `Table` active.
- Direct navigation to `/kanban` with a table-only state must redirect back to
  the table route.
- The app should not preserve a URL-backed board-return preference for Archived
  in v1.

## Acceptance Checklist

- Default table route: `Table` is active and `Filter` is not highlighted.
- Board route with `Project header: Board view` enabled: `Board` is active.
- Filtered table route (`Active`, `Done`, `Canceled`, assignee-only): neither `Table` nor `Filter` is highlighted.
- Backlog table route with `Project header: Board view` enabled: `Board`
  remains available, the List selector label reads `Backlog`, and switching to
  Board preserves `list=BACKLOG`.
- Archived table route with `Project header: Board view` enabled: `Board` is
  disabled, `Table` is active, and `Filter` shows archived amber styling with
  the label `Archived`.
- The filter menu shows `All`, `Active`, `Done`, `Canceled`, and `Archived`, with no `Table` or `Backlog` option.
- The settings menu shows `Add members`, disables unimplemented feature entries,
  and does not show `Share` or `Lists`.
- The settings menu does not show `Delete`, `Layout` as a submenu, or `Group by`
  as a submenu.
- With the Board header toggle off, the header does not render `Board` and still
  renders the header settings trigger.

## List grouping

The desktop settings menu offers grouping icons directly when List view is selected.
The mobile toolbar offers the same dimensions under Group by. Options are None,
Status, Assignee, Owner, Priority, Type and Label. The URL uses `listGroupBy`
independently of board `groupBy`. Default-view actions snapshot this grouping.
See [task-list-grouping.md](task-list-grouping.md).

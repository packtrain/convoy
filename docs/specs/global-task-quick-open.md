# Global Task Quick Open

This document defines the app-wide task quick-open dialog used for keyboard-driven task navigation.

## Scope

- Authenticated organization routes under `/o/:organizationSlug`.
- Current project routes, including task list, board, threads, and project settings.
- Organization-only routes with a last-used project fallback.

## Behavior

- `Cmd/Ctrl+K` opens the global task quick-open dialog when a project can be resolved.
- The shortcut is ignored while focus is in an input, textarea, select, or contenteditable editor.
- On project routes, search is scoped to the current project.
- On org-only routes, search is scoped to the last-used project for the organization.
- If no current or last-used project can be resolved, the shortcut does nothing.
- The dialog is navigation-only; it does not attach tasks to thread composers.
- The dialog shell keeps a stable 32rem height so the centered modal does not jump as result counts change.

## Search And Navigation

- Empty active search shows recent active tasks.
- The seeded recent-tasks query is subscribed **only while the dialog is open**.
  The dialog is mounted on every authenticated org route, so a closed one used to
  hold a live subscription to the newest tasks for a whole session (OS-1719).
- Initial task selector pages load 50 items, and `Load more` fetches 100 more.
- Typed search uses the shared project task search query.
- The dialog supports Active and Archived tabs.
- Result rows reuse the shared task selector row rendering.
- Result rows are real task links so modified clicks and browser link actions work normally.
- Plain click or keyboard selection closes the dialog and opens the canonical project list route with `task=<REF>`.
- Archived result links include `archived=true`.

## Non-Goals

- No cross-project or organization-wide task search.
- No Convex schema or query contract changes.

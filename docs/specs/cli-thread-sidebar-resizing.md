# CLI Thread Sidebar Resizing Specification

This document defines resize behavior for the left-hand thread list sidebar on `/o/{organizationSlug}/{projectAlias}/threads`.

## Overview

- The thread list sidebar is user-resizable on desktop.
- Width persistence is client-side only and stored in local storage.
- The remembered width is project-agnostic and applies to the threads workspace shell.

## Width Rules

- The sidebar starts from a default width of `320px` when no valid stored value exists.
- The width is clamped between `256px` and `640px`.
- Invalid or out-of-range stored values are ignored and replaced by the default width for the current session.
- The main thread content pane fills the remaining horizontal space.

## Persistence Rules

- Width is stored in local storage under a dedicated thread-sidebar key.
- Mouse resizing persists when the drag interaction ends.
- Keyboard resizing persists immediately after each step change.
- Persistence stays local to the browser/device; it is not synced through backend user preferences.

## Interaction Rules

- A vertical separator is rendered on the trailing edge of the sidebar.
- Dragging the separator right increases width.
- Dragging the separator left decreases width.
- Resizing must not block normal interaction with thread rows except on the separator hit area itself.

## Collapsing

- "Hide thread list" is the first entry of the list's settings menu (the gear), with `[` as its keycap hint. The gear shows in the default header only, not in multiselect or the shared-threads view; mobile's panel omits the entry.
- Collapsed, the list is hidden entirely; no icon rail. It stays mounted, so loaded pages, multiselect, and the shared view survive reopening.
- Every thread header (thread, new-thread composer, worktree changes) leads with a reopen button (`PanelLeftOpen`) while the list is collapsed.
- The reopen button carries an info dot when any active or pinned thread is unread or needs attention. Done threads don't count.
- `[` toggles the list when no input is focused. It matches the physical key (`BracketLeft`), so it works on layouts where that key types another character. It is independent of the app sidebar (`Cmd/Ctrl + B`).
- Collapsed state is stored in local storage under `thread-list-collapsed`, browser-local like the width. Reopening restores the stored width.
- Mobile ignores the collapsed state; the list is its own screen there.

## Accessibility Rules

- The separator uses `role=\"separator\"` with vertical orientation metadata.
- The separator is keyboard-focusable.
- `ArrowRight` increases width by `16px`.
- `ArrowLeft` decreases width by `16px`.
- Holding `Shift` changes the step size to `48px`.
- The separator exposes current/min/max values via ARIA attributes.

## Related Code

- Sidebar shell: `apps/web/components/blocks/thread/thread-sidebar.tsx`
- Threads layout owner: `apps/web/app/o/[organizationSlug]/[projectAlias]/threads/layout.tsx`
- Shared resize hook: `apps/web/hooks/ui/use-resize-panel.ts`
- Collapse state: `apps/web/components/blocks/thread/thread-list-collapse-context.tsx`

## QA Checklist

- Dragging the separator changes the sidebar width.
- Reloading the page restores the most recently persisted width.
- Keyboard resize works from the separator with normal and `Shift` step sizes.
- Invalid stored values fall back safely instead of breaking layout.
- The settings entry and `[` collapse the list; the header button and `[` reopen it at the stored width.
- The reopen button shows a dot while an unread thread is in the hidden list.
- The thread list and thread detail pane remain usable across the supported width range.

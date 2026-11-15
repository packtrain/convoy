# Keyboard Shortcut Refactoring Backlog

Standardize keyboard handling across the codebase using `react-hotkeys-hook` (already installed v5.2.3). The thread-composer refactoring (`Shift+Tab`) is complete and serves as the reference pattern.

## Completed

- **thread-composer.tsx** — Replaced inline `onKeyDown` with `useHotkey(PLAN_MODE_TOGGLE_SHORTCUT, ...)`. Shortcut constant exported from `lib/browser/hotkeys.ts`.

## Candidates for `useHotkeys` (global/scoped shortcuts)

| File | Current pattern | Shortcut | Notes |
|---|---|---|---|
| `components/ui/sidebar.tsx:107` | `window.addEventListener("keydown")` in `useEffect` | `Cmd+B` toggle sidebar | ~15 lines of manual setup + cleanup. Direct `useHotkeys("mod+b", ...)` swap. |

## Candidates for `useKeyBindings` helper (inline `onKeyDown` patterns)

These share a pattern: check `e.key === "..."` with optional modifier checks inside an `onKeyDown` prop. A thin `useKeyBindings` hook could reduce boilerplate.

| File | Keys handled | Complexity |
|---|---|---|
| `components/blocks/tasks/comments/comment-item.tsx:76` | `Cmd+Enter` save, `Escape` cancel | Low |
| `components/blocks/tasks/comments/comment-input.tsx:54` | `Shift+Enter` submit | Low — single shortcut |
| `components/blocks/tasks/task-table/add-task-row.tsx:87` | `Enter` add task, `Backspace` (empty) navigate back | Low |
| `components/blocks/tasks/task-table/columns.tsx:137` | `Enter` save, `Backspace` delete on empty, `Escape` cancel | Medium |
| `components/blocks/project/task-search-dropdown.tsx:125` | `ArrowDown/Up` navigate, `Enter` select, `Escape` close | Medium — has index state |

## Leave alone

| File | Why |
|---|---|
| `components/ai-elements/prompt-input.tsx` | Internal to ai-elements library; `onKeyDown` is a public extension point. Refactoring would change the API. |
| `hooks/use-keyboard-navigation.ts` | 400+ line hook with complex state (selection, reorder, expand/collapse). Too intertwined for `useHotkeys`. |
| `hooks/use-menu-navigation.ts` | Scoped to a specific DOM element ref with capture-phase listeners. Doesn't map to `useHotkeys`. |
| `components/blocks/sidebar/nav-projects.tsx`, `components/blocks/attachment-list.tsx` | Simple accessibility handlers (`Enter`/`Space` activate). One-liners that don't benefit from abstraction. |
| Tiptap components | Already using `useHotkeys`. |

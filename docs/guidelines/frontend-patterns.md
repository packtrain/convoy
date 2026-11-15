# Frontend code patterns

Design-system rules (layout, typography, forms, buttons, settings pages) live in
[frontend-development.md](frontend-development.md) — **read that before any UI
work.** This file covers code-level patterns that sit outside the design system.

## Component layers

- `components/ui/` — shadcn primitives
- `components/custom/` — extended UI (`ActionButton` and `ButtonExt`, both on `ui/button`; `FormFieldExt`). Titled and confirm dialogs (`TitledDialog`, `ConfirmDialog`) live in `ui/dialog`
- `components/blocks/` — feature components

Use `cn()` for conditional classes.

## Theming

- **Never use raw colors** (`bg-white`, `text-black`).
- **Always use semantic tokens** (`bg-background`, `text-foreground`,
  `border-border`).
- **Use `size-{N}`** for square elements, not `h-{N} w-{N}`.
- Inline command / Plan accent color: `text-info`.
- Status colors: `success`, `warning`, `info` and `destructive` tokens. See
  [frontend development](frontend-development.md#product-ui-principles).

## Optimistic updates

The `useTasks` hook wraps mutations with optimistic updates via
`withOptimisticUpdate()`.

Tasks use `clientId` (a stable UUID) for React keys so identity survives
optimistic updates. All other entities use `_id`.

## LexoRank ordering

```typescript
import { LexoRank } from "lexorank";
const between = LexoRank.parse(rankA).between(LexoRank.parse(rankB)).toString();
```

## Keyboard shortcuts

- Use `react-hotkeys-hook` for global or cross-component shortcuts (app-level
  toggles, command-like combinations).
- For textarea submit behavior (`Enter` to send, `Shift+Enter` for newline) use
  `useEnterToSubmitTextarea` in a local `onKeyDown` handler, **not** a global
  hotkey binding.
- Keep IME/composition and modifier-key guards on submit shortcuts.
- Where space permits, show the key inline with the `Kbd` component from
  `@/components/ui/kbd` (e.g. `<Kbd>N</Kbd>` next to a "New thread" button).
  Optional — skip it when there's no room.
- New shortcuts must be registered in the shortcuts dialog and the spec — see
  [../agents/specs-first-workflow.md](../agents/specs-first-workflow.md).

Spec: [`docs/specs/keyboard-navigation.md`](../specs/keyboard-navigation.md).

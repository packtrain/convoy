# CLI Thread Context Selectors Specification

This document defines behavior for thread composer context selectors:

- working directory selector (profile + path)
- CLI selector (includes Claude model submenu)
- mode selector reference links

## Related Specs

- Runtime architecture and ownership: `docs/specs/cli-runtime-architecture.md`
- Draft persistence and resolution: `docs/specs/cli-thread-drafts.md`
- Mode behavior: `docs/specs/cli-thread-modes.md`
- Claude model behavior: `docs/specs/cli-thread-model-selection.md`

## Trigger Interaction Requirements

- Selector triggers must show `cursor-pointer` when enabled.
- Selector triggers must show `cursor-default` when disabled/locked.
- Disabled/locked selectors use muted foreground styling.
- Hovering or focusing the working-directory selector trigger for 500ms opens
  the selected CLI profile's read-only details card without opening the
  dropdown, editable or locked, so the new-thread composer matches the thread
  page (OS-2253). While the dropdown is open the card stays closed, and focus
  returning to the trigger after the dropdown closes does not reopen it.

## Working Directory Selector

### Trigger Text Rules

- Trigger primary label is always the selected profile name.
- Trigger secondary label is the selected path label prefixed by `/`.
- Show the path label whenever a path is selected, editable or locked, so the
  trigger does not change width when sending disables it.
- The path suffix is capped in width and truncates in the middle, keeping the
  last characters visible. Worktree labels often share a long prefix
  (`feat/os-2289-…`) and the end is what tells them apart. Branch labels in
  the bar (branch chips, base-branch and workspace triggers) truncate the same
  way.
- In compact mode, hide the path suffix in the trigger.
- In a narrow composer bar (`@container/composer-bar` below `@lg`), hide the
  path suffix too; the trigger's title still names profile and path (OS-2144).

### Dropdown Content Rules

- Selectable profiles are always scoped to the authenticated user. Teammates'
  profiles, machines, paths, and runtime metadata are not returned by the
  project profile query and never appear in composer selectors.
- Paths are grouped by profile.
- Group heading shows profile status dot, profile name, and profile key badge (when available).
- Group heading includes a hover/focus options trigger (`...`) when selector is enabled.
- Hovering or focusing the profile heading for 500ms opens a read-only profile
  details card. The card shows connection status/timing, hostname/profile key,
  created/last-connected timestamps, detected agent runtimes, and configured
  working directories. Offline runtime data is labeled as last detected.
- The profile options trigger is not part of the details-card trigger. Opening
  the options menu suppresses the details card; closing the parent selector
  closes both overlays.
- Options menu includes:
  - `Rename` (enabled)
  - `Delete` (enabled destructive action)
- Profile options menu renders in an overlay layer so opening it does not resize the parent working-directory dropdown or introduce extra scrollbars there.
- Do not implement the profile options menu as a nested Radix dropdown inside the working-directory selector overlay; use a separate overlay/menu so the parent selector and profile actions menu do not fight over dismiss/focus behavior.
- If the profile options menu is rendered as a custom portalled overlay, the parent selector must not block pointer interaction with it. Keep the selector non-modal for this case and ensure the custom menu is explicitly hit-testable, otherwise hover/clicks can fall through to the path rows underneath.
- Each path item row shows:
  - path label
  - truncated absolute path on a muted second line
- Worktree path entries (`kind: "worktree"`) are never listed as selectable
  working directories; they are selected through the base-ref selector (see
  `docs/specs/cli-worktrees.md`). The trigger label still resolves worktree
  entries for existing threads that point at one.

### Profile Rename Rules

- Rename is available from the group options menu only when selector is enabled.
- Rename opens a popup dialog for the selected profile.
- Saving a non-empty name stores the trimmed value.
- Saving an empty name resets using fallback order:
  1. profile hostname
  2. profile key
- If both hostname and profile key are unavailable, save is rejected with a user-facing error.
- Rename action is hidden in locked contexts (for example thread detail with `lockAgentContext=true`).

### Profile Delete Rules

- Delete is available from the group options menu only when selector is enabled.
- Delete opens a destructive confirm dialog for the selected profile.
- Confirming delete soft-deletes the profile and removes it from active profile/path selectors.
- Delete does not remove existing threads or messages.
- Existing thread detail can continue rendering a deleted profile name/path from thread-scoped reads and existing thread path snapshots.
- Deleted profiles are not returned in the normal selectable profile list APIs.

## Composer Context Bar (wide composers, OS-1218)

Every composer surface renders the **same single layout** (decided 2026-07-24,
OS-1377 follow-up): there are no compact/wide variants, no per-surface layout
props, and no viewport-conditional placement. `ThreadComposer` is the one
shared component; only content availability varies (e.g. no meters on a
new-thread composer, no agent selector on follow-ups).

- Context bar **above** the input (a muted wrapping strip visually attached to
  the input's top edge), in order: working directory selector, split
  environment + branch selectors (`WorkspaceSelectors`, see
  `docs/specs/cli-worktrees.md`), the read-only workspace summary
  (worktree/non-git paths), and the persona selector (or read-only persona
  chip on existing threads). The usage/cost/context-window meters render
  right-aligned in the same bar. The bar never wraps: chips shrink and
  truncate, and in a narrow bar (`@container/composer-bar` below `@2xl`,
  672px) the environment selector, workspace summary, persona selector, and
  workflow selector collapse to icon-only dropdowns, with the label kept in the
  accessible name and title. Below `@2xl` five labelled pills don't fit: the
  task sidebar's and a pull request's Activity composers truncated every label
  to a few letters. The 768px `/threads` composer keeps its labels.
- Neither the bar nor the footer may widen the composer's host. Both carry
  `[contain:inline-size]`, so a long label truncates instead of pushing the
  thread column past a phone viewport (OS-2144).
- The bar is an inset muted strip stacked flush above the input in normal
  flow — no negative-margin overlap behind the input (its background is
  translucent, so anything tucked behind it shows through).
- Read-only chips in the bar (workspace summary, branch chip) use the same
  text size as `size="sm"` button triggers (`text-[0.8rem] leading-4`).
- Started threads keep separate read-only environment and branch chips
  (OS-1988). Local checkouts retain the laptop icon and `Work locally` label;
  worktrees show the branch icon and `Worktree` label. The branch chip uses
  the detail query's canonical execution branch and updates when it changes.
  Clicking the branch chip copies the branch name to the clipboard.
  Creation seeds the local thread's branch from the draft scan, so sending
  the first message does not hide an already-known branch while the CLI starts.
  The first execution report replaces or clears that snapshot.
  Missing profile paths do not discard known thread metadata. See the
  workspace UI section of `cli-worktrees.md` for unknown-branch behavior.
- Footer toolbar keeps: attachment tools, `extraSelectorTools`, the labeled
  CLI type (model/effort) and mode selectors, and the send/stop control. The
  CLI type label truncates when the footer is too narrow for it. On mobile the edit-last-message
  composer passes `compact`, which renders both selectors icon-only (OS-2151). The footer
  never hosts the working directory, agent, base-ref, or meters.
- The top bar is suppressed when `hideWorkingDirectory` is set and nothing
  else would render in it (config editors).
- The queued-messages strip and interaction-request cards render in normal
  flow above the whole composer block; the context bar must stay in flow so
  they stack (no absolute positioning / upward overlap).

## Base-Ref Selection

- Wide composers: the split environment + branch selectors in the context
  bar. Compact composers: the combined single-dropdown selector inline in
  the selector row. Both edit the same `BaseRefSelection` value; the
  `baseRef`/`onBaseRefChange` props travel through `selectorsProps`.
- Shown only in new-thread composers (surfaces that pass `onBaseRefChange`)
  and only when the selected path has a `gitRemoteUrl`.
- Full behavior (rows, badges, rescan, remove action, footer controls, the
  disabled Cloud preview) is specified in `docs/specs/cli-worktrees.md`.

## CLI Type Selector

- Trigger label/icon reflect the currently selected CLI type.
- For `claude-code`, the trigger label is:
  - `Claude Code` when the selected model is `default`
  - the selected model label otherwise
- Claude model options are nested under a `Claude Code` submenu in the CLI selector.
- Claude submenu items do not show provider/model icons.
- When the selected online Claude profile exposes Claude provider metadata, the submenu uses provider-aware labels from the backend Claude runtime metadata in `apps/web/convex/cli/lib/runtimes/claudeCode/` and frontend selector metadata in `apps/web/lib/cli-runtime-ui/`.
- When runtime model metadata is missing, the submenu falls back to generic slot labels.
- The `Default` Claude submenu item shows an adjacent info affordance with tooltip copy explaining that it uses the user's Claude Code CLI default.
- Cursor rules match the shared trigger interaction requirements.
- In locked thread-detail contexts, the CLI selector remains interactive so model/effort options stay reachable.
- In locked thread-detail contexts, the selector does not list CLI types at all: started threads cannot switch CLI, so opening the selector shows the active runtime's model/effort options directly as the top-level menu.
- If the locked runtime exposes no model or effort options, the selector does not open.
- In locked thread-detail contexts, the mode selector remains interactive for the next outgoing message.

## QA Checklist

- Enabled working directory trigger has pointer cursor.
- Disabled working directory trigger has default cursor.
- Enabled CLI type trigger has pointer cursor.
- Disabled CLI type trigger has default cursor.
- Claude trigger shows the selected model label when non-default.
- Claude submenu can render provider-aware labels like `Sonnet 4.6 (1M)` when the selected online profile reports them.
- Locked thread-detail selector opens the active runtime's model/effort menu directly and lists no other CLI types.
- Locked thread-detail keeps the mode selector editable.
- Working directory group heading shows profile key badge text.
- Working directory group heading shows options trigger only when unlocked.
- Profile heading hover/focus opens the details card after 500ms.
- Working-directory trigger hover/focus opens the selected profile's details
  card without opening the selector, editable or locked.
- Profile options menu contains Rename and Delete, with no Info item.
- Opening the profile options menu does not change the parent selector height or create a new scroll area inside it.
- Single-option triggers show profile and path label, editable or locked.

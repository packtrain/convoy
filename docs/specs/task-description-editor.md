# Task Description Editor

## Scope

Defines rich-text editing behavior for the task description editor in the task details sidebar.

## Editor Sync

- The editor saves on update with the existing debounce policy and flushes pending changes on blur/unmount.
- While unfocused, external server updates sync back into the editor content.
- While focused, external updates must not clobber the local draft.

## Theme

- The editor (`components/mdx-editor/editor.tsx`) follows the app's resolved
  theme. A caller's `theme` prop overrides it (OS-2256).
- Code blocks are readable in both themes: plain code text uses the
  foreground color and line numbers the muted foreground under
  `mdx-editor-kit--light`.
- Table add-row and add-column controls are transparent until the table is
  hovered or holds focus. They show a `+` glyph, in a lighter grey in light
  mode. The row and column menus use lucide glyphs for every table action.
- A row's `...` menu trigger appears only while that row is hovered, and a
  column's only while that column is hovered. A trigger also stays visible
  while its menu is open or it has keyboard focus.

## Toolbar Interaction Rules

- Toolbar controls must not steal focus from the ProseMirror editor before their command or overlay can take over.
- Trigger buttons for overlays or menus should cancel `pointerdown` so the current editor selection remains available.
- Toolbar roving-focus keyboard navigation must ignore focused form controls and editable fields inside overlays.
- While the editor is focused, app-level shortcuts must not steal editor-owned formatting chords such as `Cmd/Ctrl + B`.
- This applies in particular to controls that open secondary UI such as the link popover, heading/list menus, and image insertion actions.

## Markdown Copy

- The toolbar exposes an icon-only `Copy as markdown` action.
- Clicking the action copies the current editor document to the clipboard as markdown without mutating editor content or stealing editor focus on pointer down.
- The copied markdown should preserve the task-description editor's supported block structure where markdown has a stable representation: headings, paragraphs, blockquotes, code blocks, ordered lists, bullet lists, task lists, links, images, bold, italic, inline code, and strikethrough.
- If the Clipboard API is unavailable or copying fails, the editor fails soft and reports the failure without changing the description.

## Heading Menu

- The heading dropdown exposes an explicit `Normal text` option as the first menu item.
- Selecting `Normal text` converts the current convertible block selection back to a paragraph.
- Selecting the currently active heading level still toggles that block back to paragraph text.
- The heading dropdown trigger remains unchanged: same icon, same label, and heading-active trigger state.

## Link Popover

- Clicking the link toolbar button opens the link popover without immediately dismissing it.
- Opening the link popover preserves the active editor focus/selection long enough for link commands to operate on the current selection.
- The link URL input owns arrow-key, Home/End, Tab, and text-editing interactions while it is focused.
- Existing link marks in the current selection do not auto-open the popover on initial task load.
- The link popover remains interactive after opening and exposes the URL input plus apply/open/remove actions.

## Related

- See `docs/specs/task-detail-title-input.md` for title-editing rules in the same sidebar.
- See `docs/specs/task-attachments.md` for attachment and clipboard-image behavior around the task sidebar.

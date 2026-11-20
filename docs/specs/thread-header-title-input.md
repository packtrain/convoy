# Thread Header Title Input

## Scope

Defines title editing in the web thread header (`ThreadHeader`).

## Rendering

- An editable title is a text input from the first render, not a button that
  swaps to an input on click. Clicking puts the caret where the click lands, and
  drag-select and double-click word select work without extra code.
- An invisible copy of the title sizes the block, so the title hugs its text and
  `titleTrailing` stays beside it. The input sits over that footprint and adds
  no horizontal padding, which would clip the text (a short title vanished).
- Unfocused, a long title truncates with an ellipsis. On blur the input scrolls
  back to its start.
- A read-only title (no `onTitleCommit`) is a plain `h1`.
- Slash command links show as their plain display label, both in the input and
  in the read-only `h1`.

## Commit Rules

- Blur and `Enter` save the trimmed draft.
- An empty or unchanged draft reverts without saving.
- `Escape` restores the title from when the input was focused and blurs without
  saving.
- A failed save shows a toast and reverts.

## External Sync

- Unfocused, external title updates sync into the input.
- Focused, external updates do not overwrite the draft.

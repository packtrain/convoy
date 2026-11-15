# Task Detail Title Input

## Scope

Defines title editing behavior in the task details sidebar.

## Rendering

- The title field is rendered as a textarea to allow soft-wrapped multi-line display.
- Wrapping comes from available sidebar width; hard line breaks are not supported.
- The control keeps task-title visual hierarchy in the sidebar (`text-xl`, `font-semibold`).

## Input Rules

- Pressing `Enter` or `Shift+Enter` does not insert a newline.
- Pressing `Escape` cancels the current draft, restores the current persisted value, and blurs the field without saving.
- Any `\r` or `\n` from user input or paste is sanitized to spaces immediately.
- The control resizes with its content **and with its available width**: the
  height comes from CSS (`field-sizing: content`), so a sidebar resize, window
  resize, or font swap re-wraps and re-sizes it in the same reflow. It never
  carries a measured height, which would freeze at the width it was measured on
  and crop the wrapped tail.
- Height is clamped to one line box (40px) at the floor and 160px at the
  ceiling; past the ceiling the field scrolls rather than cropping.

## Commit Rules

- Persist happens on blur only.
- Before commit, value is normalized: line-break sanitization, `trim()`, then whitespace collapse (`/\s+/g -> " "`).
- If normalized value is empty, the editor reverts to the current server value and does not save.
- If normalized value equals the normalized server value, no save is triggered.
- If normalized value differs and is non-empty, save with the normalized value.

## External Sync

- While unfocused, external task-name updates sync into the editor value.
- While focused, external updates do not clobber the current local draft.

## Related

- See `docs/specs/task-detail-metadata.md` for other metadata rows.

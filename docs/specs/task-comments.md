# Task Comments

## Scope

Defines user-visible behavior for task comment composition and submission in the task details sidebar.

This spec owns the composer and the comment row. It does **not** own where they
sit: comments are rows in the merged task timeline, and
`docs/specs/task-timeline.md` owns that host — the stream, its ordering, its
source toggles, and the in-stream composer the rules below apply to.

## Sidebar Layout

- The comment composer lives in the timeline's in-stream composer at the end of
  the stream, sharing it with the thread composer (one open at a time). There is
  no pinned footer input area and no `Comments` tab.
- The composer keeps the open task's unsent text and pending comment
  attachments while the sidebar remains mounted, including across swaps to the
  thread composer and back.
- An archived task renders the stream and disables the composer.

## Comment Composer Keyboard Behavior

- `Enter` submits the comment.
- `Shift+Enter` inserts a newline in the comment input.
- The submit shortcut only triggers when the composer is enabled and the comment has content or pending attachments.

## Comment Composer Clipboard Image Paste

- When the user pastes clipboard images into the task comment composer textarea, those images are added as pending comment attachments.
- Only clipboard image files are captured by this behavior.
- Non-image clipboard content remains unchanged and follows normal textarea paste behavior.
- If clipboard content includes both text and images, text paste behavior remains unchanged while images are added as pending attachments.

## Comment Attachment Upload Timing

- Added/pasted/dropped comment attachments begin uploading immediately (before comment submission).
- Submit is blocked while any pending attachment is still uploading or has failed.
- Sending a comment waits for in-flight uploads to finish and then creates the comment with all successful attachments atomically.
- If any attachment upload fails, the comment is not submitted until the failed attachment is removed.
- Unsent uploaded files are cleaned up on a best-effort basis when removed/cancelled/unmounted.

## Comment List Loading and Empty States

- Comments have no list region or empty state of their own: they are rows in the
  merged timeline, whose loading and empty states are defined in
  `docs/specs/task-timeline.md`.
- No comment surface owns or reserves composer space; the composer lives in the
  timeline's in-stream composer.

## Comment Display Truncation

- In task sidebar comment display mode (non-editing), long comments are initially collapsed to a larger multi-line preview (about five lines).
- Collapsed long comments render a fade-out gradient at the bottom of the preview so text appears to disappear smoothly.
- The fade treatment must work in both light and dark themes using semantic background tokens.
- For overflowed collapsed comments, the entire comment preview area is clickable (cursor pointer) and expands the comment.
- Overflowed collapsed previews expose keyboard-expand semantics (`Enter`/`Space`) and are focusable with an `Expand comment` accessible label.
- Hovering the collapsed preview shows a centered bottom pill hint: `Click to expand`.
- Expansion is one-way for this interaction: once expanded, the truncation affordances are hidden.
- Short comments that do not overflow render fully and do not show expand/fade/hint affordances.

## Activity Logging

Creating a comment writes **no** `comment_added` activity row — the timeline
renders the comment itself, so the row would be a duplicate. See
`docs/specs/task-activity-log.md`. The `task.comment_added` internal event
(notifications) is unaffected and still emitted.

## Non-goals

- This spec does not define markdown rendering rules.
- This spec does not define comment edit-mode keyboard shortcuts.
- This spec does not define the timeline that hosts comments
  (`docs/specs/task-timeline.md`).

## One-Shot CLI

- `convoy tasks comments add <taskId|ref>` creates an ordinary markdown task
  comment through `api.tasks.comments.create`.
- The command accepts exactly one of `--message` or `--message-file` and
  rejects empty content.
- Raw task IDs, bare refs, and organization-scoped refs use the shared task
  resolution rules.
- Text output confirms the created comment; JSON output returns
  `{ taskId, commentId }`.
- Artifact comment commands remain under `tasks artifacts comments` and are
  intentionally separate.

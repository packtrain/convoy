# CLI Thread Read State Specification

This document defines unread/read behavior for CLI threads, including manual toggles and active-chat auto-read suppression rules.

## Overview

- Read state is represented by `readAt` on `cliThreads`.
- A chat is considered unread when `readAt` is missing or older than `lastActivityAt`.
- Attention acknowledgment for `failed` / `waiting_input` threads is represented separately from `readAt`.
- Sidebar exposes a toggle action:
  - `Mark as unread` for read threads
  - `Mark as read` for unread threads

## Attention Acknowledgment

- `failed` and `waiting_input` are attention states, not unread states.
- Opening a thread may auto-mark it read, but that must not acknowledge attention.
- Attention acknowledgment is represented by `attentionAcknowledgedAt` on `cliThreads`.
- A thread `requiresAttention` when:
  - `status` is `failed` or `waiting_input`, and
  - `attentionAcknowledgedAt` is missing or older than `lastActivityAt`.
- Explicit `Mark as read` on a thread that requires attention:
  - sets `readAt` to now
  - sets `attentionAcknowledgedAt` to now
- `Mark as unread` clears both `readAt` and `attentionAcknowledgedAt`.
- Newer activity invalidates prior attention acknowledgment by advancing `lastActivityAt`.
- `Mark as done` on a thread that requires attention also acknowledges it (done implies reviewed).
- Thread-list surfaces must keep the red/amber attention indicator visible whenever `requiresAttention === true`, even if `hasUnread === false`.
- After attention has been explicitly acknowledged, thread-list surfaces render the row like a normal completed/read thread until newer activity reintroduces attention.

## Done State (OS-1382)

- Read and done are independent: reading a finished thread never makes it
  done. Done is an explicit action by the user or an agent. Marking done
  stamps `doneAt` and sets `isMarkedDone: true` on `cliThreads`.
- The mark is sticky (OS-2176). Agent activity (chunks, run completion,
  workflow progress) leaves it alone, so an agent can mark its own thread
  done mid-run. Only these clear it: mark not done, `markUnread`, a workflow
  run starting in the group, and a user turn. A user turn is `send`, retry,
  edit-and-resend, or releasing a held queue. A user turn in a group child
  also clears the group's mark (`reopenThreadForUserTurn` in
  `cliThreadsRepo.ts`).
- Marks written before OS-2176 have `doneAt` but no `isMarkedDone`. They keep
  the old rule and count as done only while `doneAt >= lastActivityAt`, so no
  backfill was needed. `isThreadDone` in `convex/cli/lib/watchStatus.ts`
  holds both rules.
- Mutations: `cli/threads/batch.batchMarkDone` / `batchMarkNotDone` for UI batches. CLI and MCP use
  `cli/threads/core.markDone` / `markNotDone({ threadId, apiKey? })`, which reject inaccessible
  threads and enforce API-key scope. Mark done also sets `readAt` and
  acknowledges the current attention state. Mark not done clears only
  `doneAt` and `isMarkedDone`. `markUnread` clears both too (unread ⇒ not done).
- The thread list's "..." menu (dropdown and context menu) shows a
  `Mark as done` / `Mark as not done` toggle based on the enriched item's
  `isDone`. Every done surface (list menus, hover shortcut, detail header,
  the `D` hotkey) stays enabled while the thread runs (OS-2176). The mark is
  sticky, so marking a running thread done holds through the rest of the run.
- The desktop project sidebar also exposes the same toggle as the row hover
  shortcut and renders done-state checkmarks/dimming. Exact compact and
  full-layout placement is specified in `docs/specs/cli-thread-list.md`.
- The thread-detail header shows the same toggle (`ThreadMarkDoneButton`,
  next to `Mark as read`): always rendered in both
  directions and always enabled.
- The group tab strip marks a done sibling by **striking through its tab
  title** plus the same dimming, with no checkmark (OS-1594) — a tab has no
  room for one beside the task-ref chip. See
  `docs/specs/thread-groups.md`.
- Watch Tower container rows aggregate child read and done state (OS-1984).
  All live children must reach the Done bucket for the container to appear
  there; the project list keeps its existing container timestamp rule.
  Bucketing is specified in `docs/specs/watch-tower.md`.

## Backend Rules

## Read/Unread Derivation

- `hasUnread = !readAt || readAt < lastActivityAt`
- Derivation is used by chat list and chat detail query responses.
- The canonical implementation of the unread and attention rules lives in
  `convex/cli/lib/watchStatus.ts` (`hasUnreadThreadActivity`,
  `requiresThreadAttention`). Read/attention writes also recompute the
  denormalized `cliThreads.statusProjection` (`watchTowerStatus` and `isDone`)
  at the repo write seam —
  see `docs/specs/watch-tower.md` (OS-1259, OS-1451).

## Mutations

- `markRead({ threadId })`
  - Sets `readAt` to current time.
  - Optional explicit acknowledgment mode may also set `attentionAcknowledgedAt` when the thread currently requires attention.
- `markUnread({ threadId })`
  - Sets `readAt` to `undefined`.
  - Clears `attentionAcknowledgedAt`.

Both mutations:

- require authenticated chat ownership
- require `ProjectPermission.CLI_THREAD`
- must not change chat processing fields (`status`, claims, watchdog, `lastActivityAt`)

## Frontend Rules

## Auto Mark-Read

- Auto mark-read is always on. The former per-user opt-out
  (`threadAutoMarkRead`, OS-1305) was removed in OS-1382: with done now an
  explicit action, read state no longer buckets threads away, so the opt-out
  had no purpose. The stored schema field remains as deprecated-optional and
  is ignored.
- Chat detail auto-marks read when:
  - the chat is open
  - `hasUnread === true`
  - **the caller owns the thread** (`isOwner !== false`)
  - auto-read suppression is not active
  - the thread is settled (`processingState === "idle"`) and has stayed
    unchanged for a short settle delay (~1s)
- The ownership rule is what keeps read-only sharing free
  (`cli-thread-sharing.md`): `markRead` is owner-only, and the viewer path is
  specified to perform zero writes, so N teammates watching a live run add no
  contention on the document the CLI is already writing. Read state stays the
  owner's — a viewer never marks the owner's thread read. The gate lives in
  `useCliThread`, so every host inherits it.
- The settle rule exists because every run-lifecycle write (claim, stream
  start/end, release) bumps `lastActivityAt` and so re-flags the thread
  unread. Auto-reading on those transitions writes the same `cliThreads`
  document the CLI is mid-sequence on and forces write-conflict retries of
  `releaseClaim`. Any thread change restarts the delay, so the write lands
  only after the run's write burst is over. A thread that is still being
  processed stays unread until it settles.
- `markRead` is a no-op when the thread is already read and there is no
  attention to acknowledge, so redundant calls from any surface never touch
  the document.
- Regardless of read state, a finished thread remains in Watch Tower's
  "Needs your review" bucket until explicitly marked done (OS-1382).

## Thread Header Action

- Thread detail shows a `Mark as read` header action when marking the current
  thread read would have an effect (`hasUnread === true` or
  `requiresAttention === true`).
- The action follows the active-chat `Mark as read` semantics below: it clears
  local suppression, sets `readAt`, and acknowledges the current
  failed/waiting-input attention state when applicable.
- A failed mutation shows an error toast and leaves read state unchanged.

## Manual Toggle on Active Chat

- Active chat may be manually set to unread.
- On thread detail, `R` invokes the manual toggle: mark read when unread or requiring attention, otherwise mark unread. It follows the same typing and ownership guards as `D`, but remains available during runs. See `keyboard-navigation.md`.
- For active `Mark as unread`:
  - set local suppression first
  - call backend `markUnread`
  - if mutation fails, rollback suppression

- For active `Mark as read`:
  - clear suppression immediately
  - call backend `markRead`
  - when the row still requires attention, this explicit action also acknowledges the current attention state

## Suppression Lifecycle

- Suppression is local UI state only (not persisted).
- Suppression is keyed to one chat id.
- Suppression is cleared when the user navigates to a different chat from the chat list.
- Returning to an earlier chat does not restore previous suppression.
- Full page reload clears suppression.

## Error Handling

- If read-state mutation fails, UI should keep previous effective behavior.
- Active-chat unread operation must rollback suppression if backend mutation fails.

## QA Checklist

- The header `Mark as read` action appears only for unread/attention threads
  and marks read (acknowledging attention when required).
- Toggling from read to unread updates indicator.
- Toggling from unread to read updates indicator.
- Active chat can be marked unread and stays unread while still on that route.
- Opening a failed/waiting-input thread does not remove the attention indicator by itself.
- Explicit `Mark as read` hides the attention indicator for the current failed/waiting-input state.
- Navigating to another chat clears suppression.
- Returning to prior chat uses normal auto-read behavior.
- Reload clears suppression behavior.

## Related

- `docs/specs/watch-tower.md` — the global dashboard derives its "Needs your
  review" bucket and attention demotion from these read/attention semantics.

## CLI and MCP done action (OS-2011)

`convoy threads done <threadId>` and `mark_thread_done({ threadId })` call
`core.markDone`. They use the same repo operation as the UI batch action,
including group and workflow-run cascades. They do not stop execution or alter
`lastActivityAt`.

`markDone` accepts a running target (OS-2176), so an agent can mark its own
thread done before its run ends. The mark survives the rest of the run. The UI
toggle accepts a running thread too.

`mark_thread_done({ threadId, done: false })` calls `core.markNotDone`, the MCP
undo. `done` defaults to `true`. The CLI has no undo command.

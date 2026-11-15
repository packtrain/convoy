# CLI Thread Message Pagination Specification

This document defines how thread detail loads and reveals older CLI messages.

## Scope

- `apps/web/lib/threads/hooks/use-cli-messages.ts`
- `apps/web/components/blocks/thread/workspace/thread-workspace.tsx`

## Data Loading Rules

- Opening a thread detail page loads a **capped window of the newest message
  envelopes** (`ENVELOPE_WINDOW_LIMIT = 50` in `convex/cli/lib/constants.ts`),
  newest first, plus a `hasOlderEnvelopes` flag (OS-1600).
  - The window is **newest-anchored** because every client derivation that
    needs envelopes operates on the newest end: the pending/streaming/failed
    assistant placeholder, chunkless user envelopes, and the no-holes check.
    The chunk window paginates backwards from that same end, so it starts inside
    the envelope window.
  - Containment is **enforced, not assumed**: the chunk axis knows nothing about
    `ENVELOPE_WINDOW_LIMIT`, so on a thread longer than the window its own
    `hasMore` would stay true past the window edge and each further page would
    load rows whose messages have no envelope — reads paid for rows that can
    never render. The hook therefore clamps `hasOlderChunks` to
    `nextOlderCursor.createdAt >= ` the oldest loaded envelope's `createdAt`.
    The clamp keys on the **cursor**, not on "every in-window message is
    loaded": a loaded message id only proves some of its chunks arrived, so
    in-window messages may still have pages pending.
  - The query is subscribed for as long as a thread view is open and re-runs on
    every message write in the thread, so its per-message cost is re-paid
    repeatedly. The **window size is a direct multiplier** on that: Convex
    invalidates per document, so a write to any one message re-reads the whole
    window (OS-1719). A chunk flush used to do that several times a second for a
    whole run; its cursor now lives on `cliMessageStreamHeads`, which no query
    reads, leaving one invalidation per run from the continuation stamp (OS-1729).
    Envelope payloads are therefore kept small:
    - `attachments` carry **metadata only**; signed storage URLs are resolved
      on demand by a one-shot `cli.messages.getMessageAttachmentUrls` read,
      when a message with images scrolls into view or on first click of a file.
    - `diffSummary` is a **compact preview** — refs, roll-up `additions` /
      `deletions`, the true `fileCount`, and the leading file rows
      (`DIFF_SUMMARY_PREVIEW_FILES = 5`). The full file list comes from
      `cli.messages.getRunDiffSummary` when a Changes card is expanded.
- The client then loads the newest historical chunk window through `api.cli.messageChunks.listWindowByThread`.
- The client requests chunk rows in batches of 50. The message-aligned backend
  window extends that batch until it covers 10 complete messages (subject to
  its bounded chunk-read budget), for both the initial load and each older
  history request.
- When the user requests older history, the client loads successive older chunk
  windows using the returned `before` cursor. It stops when a page adds a new
  message ID belonging to the loaded envelope window, history ends, the cursor
  leaves that window or stops moving backwards, or five pages have loaded.
  Same-message additions do not stop the request, since they can remain inside
  an existing collapsed tool group. This continuation runs only after a click.
- The five-page limit bounds total work per click while preserving backend query
  limits. When it pauses a request, show `More history remains. Continue loading`.
  Another click starts a fresh budget from the last cursor. Thread changes and
  live-stream resets discard the pending request. Query errors use the existing
  query error boundary; no further pages are requested after an error.
- Live streaming continues through `api.cli.messageChunks.listLiveByThread` from the latest known chunk cursor.
- The client must not automatically drain every remaining older chunk window on mount.
- The hook exposes explicit older-history state:
  - `hasOlderChunks` — more chunk history is fetchable **inside the envelope
    window** (clamped as above, not the raw chunk-table flag)
  - `hasOlderEnvelopes` — history exists above the capped envelope window; no
    amount of chunk pagination can reach it
  - `isLoadingOlderChunks`
  - `loadOlderChunks()` — a no-op once the clamp closes, so the cut cannot issue
    reads that deliver nothing

## Thread Detail Rendering Rules

- Thread detail renders visible messages oldest-first.
- A message becomes visible when:
  - one or more of its chunk rows are in the current loaded chunk window, or
  - it is the latest assistant message in `pending`, `streaming`, or `failed` status and still has no loaded chunks.
- User envelopes, task pills, and attachments do not create visible history rows on their own; if a user message has no loaded chunks, it remains hidden.
- Completed zero-output assistant envelopes do not render.
- The thread must not render envelope-only holes inside the visible history; if loaded chunks currently cover messages `3,4`, the UI shows `3,4`, not `1,4`.
- A message cut by the chunk window hides its unanchored task groups (OS-2285).
  The composer files sub-agent events under the `Agent`/`Task` call that
  launched them, and background task notices under the tool call that started
  them. When that call is above the loaded window, the event used to open its own
  top-level group, so a background agent's activity rendered as loose rows in the
  main transcript until "Show more" rebuilt the message.
  - Cut means the oldest loaded message, while older chunks remain in the window
    and its first loaded row is not `chunkOrder` 0. Only that message can be cut,
    because the loaded rows are a suffix of the thread's chunk order.
  - Unanchored means a top-level Claude task group keyed on a `tool_use_id`
    whose tool call has not loaded (no `taskTool`). The Codex agent group and
    groups keyed on a bare `task_id` are never hidden.
  - The groups are hidden in the view only (`hideUnanchoredTaskGroups`). The
    composer keeps them, and loading older chunks rebuilds the message so they
    nest under their accordion. A fully loaded message renders every group, so
    an orphan notice for an agent launched in an earlier message still shows.
  - Hiding may leave a cut message with no visible parts. That is accepted:
    the top cut is still shown, and history is not drained on mount.
- The top cut is shown when any of:
  - already loaded rows are hidden by the local part-budget slice,
  - the backend reports more older chunk windows are available, or
  - the thread is longer than the envelope window (`hasOlderEnvelopes`).
- The visible slice **only ever grows while a thread stays open**. The part
  budget picks the initial slice and clicks widen it, but a message that has been
  revealed is never re-hidden: the budget is derived from live part counts, which
  shrink as well as grow (a whole-message `text` event drops the streamed delta
  parts), so a purely derived slice made the cut flap open and shut during a run
  (OS-1707). Two properties keep the floor honest:
  - It is a **count** of revealed messages, not the oldest revealed message's
    **id**. Ids leave the array mid-session — `editLastResend` and `removeQueued`
    delete rows, and the newest-anchored envelope window slides on a long thread
    — and an id-keyed floor silently resolves to "no floor" when that happens,
    collapsing the history in one frame. A count is ordinal, so it degrades
    gracefully against any reshuffle below it and needs no coupling to
    `use-cli-messages`' own renderability rules.
  - Part costs are a per-message **high-water mark**, so only a click can widen
    the budget. Using the live count let a delta collapse (`removeDeltaParts`)
    free budget on its own and latch that widening permanently — mounting ~9×
    the part budget with no user action.
- The floor is per-thread and resets when the thread changes, so the budget still
  bounds what a freshly opened thread renders. Within one open thread the bound is
  the widest the budget ever legitimately reached: `INITIAL_PART_LIMIT` plus
  `LOAD_MORE_PART_STEP` per click.
- Clicking the cut:
  - immediately replaces the cut with a skeleton row
  - increases the local part budget and reserves at least five messages beyond
    the current visible count, so same-message part growth cannot hide the next
    older message fetched by this click, and
  - requests the next older backend chunk window when one exists.
- The view stays where it was. Older rows load above it and the user scrolls
  up to them; the scroller is not moved to their top (OS-2170). From the click
  until the skeleton is gone, the conversation keeps its distance from the
  bottom, so growth above the viewport does not shift it. The fork prefix's cut
  (cli-thread-fork.md) shares the scroller and gets the same behavior.
- The skeleton remains while an older-history request is in flight.
- The local optimistic flag covers the initial click until chunks arrive. The
  hook keeps `isLoadingOlderChunks` true throughout the continuation, so an
  intermediate same-message page does not remove the skeleton.
- Top cut labels:
  - `Show more messages` when only already loaded rows are hidden by the local render budget
  - `Show more` when older chunk pages are available
  - `Beginning of loaded history` at the envelope-window edge — nothing left to
    fetch or reveal, but the thread is longer than the window. This label
    renders as a **static marker, not a button** (clicking it could do
    nothing); the hook reports this as `isOlderMessagesCutActionable: false`.

## Known Gaps

- **Legacy-content backfill only covers the envelope window.** The client
  triggers `cli.messages.backfillLegacyContentForThread` when any *loaded*
  envelope reports `hasLegacyContent`. Since the window caps at the newest
  `ENVELOPE_WINDOW_LIMIT` messages, a thread whose legacy messages all sit older
  than that no longer triggers the migration (OS-1600 changed this; before the
  cap, every envelope was loaded and so every legacy message was seen). Those
  messages are outside the window and therefore unrenderable anyway, so nothing
  visibly breaks — the migration simply stalls for them. Fixing it properly
  means a dedicated indexed "any legacy content in thread" check rather than a
  scan of the loaded window.
- **Two unpaginated thread-wide reads remain**, both in mutations (so not
  subscribed, but both can hit the per-transaction read ceiling on a long
  thread): `backfillLegacyContentForThread` (`listThreadMessagesAsc`) and
  `retry`'s run lookup (`listMessagesByThread`).

## Non-Goals

- No infinite-scroll auto-pagination for thread detail.
- No **paging back** through envelopes beyond the newest window (OS-1600
  capped it; it did not make it a second paginated axis). Reaching history
  older than `ENVELOPE_WINDOW_LIMIT` messages would mean reconciling two
  independent cursors over the same messages while preserving the no-holes
  rule — deferred until the capped window proves insufficient.

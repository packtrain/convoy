# CLI Message Chunk Storage Specification

This spec defines how CLI thread message bodies are stored and read from chunk rows.

## Overview

- All CLI thread messages use an **envelope + chunks** model:
  - envelope row: `cliMessages` for lifecycle, claims, status, metadata, attachments, tasks, and `nextChunkOrder`
  - chunk rows: `cliMessageChunks` (one row per stored body chunk)
- `cliMessages.content[]` remains only as temporary dormant legacy data during migration; steady-state reads must not depend on it.

## Data Contract

`cliMessageChunks` schema:

```ts
{
  messageId: Id<"cliMessages">,
  threadId: Id<"cliThreads">,
  profileId: Id<"cliProfiles">,
  chunkOrder: number,
  type: string,
  data: string,
  // Runtime-agnostic rendering of `data`; readers work off this, not raw `data`.
  normalizedEvent?: CliNormalizedEvent,
  // Set on partial-streaming rows (deltas), deleted when the message completes.
  // `true` or absent, never `false` — enforced as `v.optional(v.literal(true))`.
  ephemeral?: true,
  timestamp: number,
  createdAt: number,
}
```

`cliMessageStreamHeads` schema — the chunk cursor of an in-flight assistant
message, indexed `by_message` (`messageId`):

```ts
{
  messageId: Id<"cliMessages">,
  nextChunkOrder: number,
}
```

No query reads this table, which is the point: the envelope window is subscribed
per document, so the cursor cannot live on `cliMessages` without a flush
re-sending every envelope in the window several times a second (OS-1729).

Indexes:

- `by_thread_and_message_and_chunkOrder` (`threadId`, `messageId`, `chunkOrder`)
- `by_thread_and_message_and_createdAt_and_chunkOrder` (`threadId`, `messageId`, `createdAt`, `chunkOrder`)
- `by_thread_and_createdAt_and_messageId_and_chunkOrder` (`threadId`, `createdAt`, `messageId`, `chunkOrder`)
- `by_thread_and_message_and_ephemeral_and_chunkOrder` (`threadId`, `messageId`, `ephemeral`, `chunkOrder`)
  - `ephemeral` sits **before** `chunkOrder` so a range is addressable per
    ephemeral state: the cleanup job takes the `true` range, tail readers take
    the unset range, and the two never overlap. Ordering them the other way
    would leave every tail read spanning the rows cleanup deletes, which forced
    write-conflict retries of `events/core:ingest` (OS-1673 — see
    `notifications.md`). Since stored rows leave the field unset, readers pin
    `eq("ephemeral", undefined)`.

## Runtime Rules

1. `send` creates a user envelope with `content: []`, inserts user chunk rows, and increments `nextChunkOrder`.
2. `startRunResponse` creates one assistant envelope row with `content: []` and `nextChunkOrder = 0`.
3. `appendRunContent` inserts each incoming assistant chunk into `cliMessageChunks` using the run's chunk cursor, then advances the cursor.
   - **A steady-state chunk flush writes no `cliMessages` document.** The cursor
     lives on a `cliMessageStreamHeads` row, created on the run's first flush and
     read back on each later one; a flush with no head row falls back to the
     envelope's `nextChunkOrder`, which is what carries a run streaming across a
     deploy. The one envelope write a flush may still make is the run's
     `cliContext.continuationId`, at most once per run: it has to be on the
     message, because `scanStrandedTail` reads it there to find the resume point.
   - At settle (`complete`, `fail`, and the thread-side wind-downs
     `failStreamingChat` / `cancelProcessing`) the head row's value is written
     back to `cliMessages.nextChunkOrder` and the row deleted, so
     `chunkCount` is correct on a settled envelope. The row is also dropped by
     `deleteAssistantChunkRows`, which every path that destroys a message's
     chunks routes through.
   - Oversized chunks (`data` above a 100k-char budget) never reach the
     insert as-is — a chunk row stores `data` plus a normalized copy, so an
     unbounded chunk can exceed Convex's 1 MiB document limit and fail the
     whole append (OS-1521). At insert time the chunk is split losslessly
     when the runtime knows how (`splitOversizedChunk` runtime hook;
     Claude Code splits coalesced `stream_event` text/thinking deltas back
     into smaller deltas), else scrubbed into one smaller chunk with valid
     JSON by a structural walk with a base64 heuristic
     (`runtimes/shared/scrubChunk.ts`: base64 payloads dropped — both
     `type:"base64"` source blocks and bare `base64` keys, e.g. a `Read` of
     an image inlines the file in the tool_result and
     `tool_use_result.file.base64` — and other huge strings clamped with a
     truncation notice at the widest per-string cap that fits), else its
     `data` is raw-truncated to the budget. Split pieces
     occupy consecutive `chunkOrder` slots and keep the original chunk's
     timestamps and ephemeral marking. The CLI applies the same scrub in its
     shared flush buffer for all runtimes before upload (CLI ≥ 0.39.8), so
     multi-megabyte tool results never leave the agent machine; the server
     scrub is the backstop for older CLIs.
4. Thread detail rendering reads both user and assistant bodies from chunk rows, not `cliMessages.content[]`.
   - External readers (MCP, the CLI) read the same rows through
     `cli/lib/messages/agentText.ts`, which composes a **plain-text** rendering
     from `text` normalized events only — no tool output, no reasoning (OS-1627).
     A bounded tail scan, capped per message and derived from the page actually
     returned; see `docs/specs/mcp-server.md` for the contract. Which rows carry
     agent-visible text is `chunkAgentText` in that module. The notification
     preview (`notifications/fanout.ts`) repeats the same test rather than
     importing it: that domain may reach the cli domain's `*Repo` files but not
     its lib, and the two readers differ in what they do with a match.
   - Both readers scan through `listLatestStoredChunksByMessage`, which excludes
     ephemeral rows **in the index** rather than after reading (OS-1673). So the
     ephemeral half of each reader's row test is no longer what does the
     filtering; `chunkAgentText` keeps it as a cheap guard, since it is an
     exported pure predicate that direct and future callers may reach with rows
     from any query.
5. `cliMessages.listEnvelopesByThread` returns envelope metadata only and excludes message body payloads.
6. Historical chunk reads use `api.cli.messageChunks.listWindowByThread`; live chunk deltas use `api.cli.messageChunks.listLiveByThread`.
   - A window page is message-aligned, not a fixed chunk count: the query
     keeps fetching batches of `limit` rows until the page covers at least
     10 complete messages, then cuts the page at the trailing message
     boundary. Per request, the fetch count is derived from a 400-chunk
     budget and capped at 8 batches, so a large `limit` cannot multiply the
     scan cost past Convex's per-query document limit. Only a suffix may be
     trimmed — the cursor must stay older than every returned row — and
     trimmed rows are re-fetched by the next page. Chunk-dense runtimes
     (codex app-server stores 50+ event rows per run) would otherwise
     surface ~1 message per "Show more" click.
   - The boundary guarantee applies to the page tail only: a mid-page
     message whose `createdAt` range interleaves with newer messages can
     still land partially in a page; its remaining chunks arrive with the
     next older page.
   - Completeness heuristic: a message is complete on the older side when its
     `chunkOrder = 0` row is inside the window. When the thread is exhausted
     (no older rows), all loaded rows are delivered regardless, because
     ephemeral cleanup may have deleted a message's order-0 row. A single
     message larger than the whole per-request fetch budget still splits
     across pages.
7. `retry` for failed Thread runs deletes the assistant envelope row and all associated `cliMessageChunks` rows.
   - `deleteAssistantChunkRows` deletes at most `CHUNK_DELETE_BATCH_SIZE` (500)
     rows per transaction and reschedules `cli/messages:cleanupMessageChunks`
     while a full batch comes back. A long run holds tens of thousands of rows,
     and collecting plus deleting them all at once exceeds Convex's per-mutation
     read limit (OS-1840). The envelope is deleted in the first transaction, so
     the trailing batches operate on rows whose message is already gone — they
     are unreachable by every reader, which is keyed on `messageId`.
8. Legacy inline message content is migrated into chunk rows through an idempotent backfill path; after migration, reads stay chunk-only.
9. Visible thread history rows are derived from loaded chunk rows, not envelope presence.
   - A chunkless bootstrap (empty window page with no older history) must not
     complete the client bootstrap: the window subscription stays active until
     the first chunk row exists, because the live delta subscription is gated
     on a cursor derived from loaded rows. Threads launched from a task
     without typed text start with a chunkless user message, so their first
     chunk arrives only once the agent starts streaming.
10. Envelope-only rendering exceptions (rows visible without loaded chunks):
    - The latest assistant row in `pending`, `streaming`, or `failed` status
      when it has not emitted any chunk yet.
    - User rows that provably have no chunk rows (`chunkCount = 0`, no legacy
      content) — threads launched from a task without typed text store no
      user chunk; the row renders from envelope data (task pill,
      attachments). Such rows are shown only inside the fully-loaded suffix
      of history so they cannot form envelope-only holes above unloaded
      chunk-backed messages.
11. When the live delta query reports `resetRequired` (its cursor's chunk row
    was deleted — an edit-and-resend or a retry rewinds a turn), the client
    re-bootstraps without clearing what is on screen: the loaded rows stay
    rendered and are replaced wholesale when the fresh bootstrap window
    arrives. The thread must not fall back to the loading skeleton during a
    re-bootstrap; only a thread's first load counts as loading.

## Acceptance Checklist

- Long assistant streams no longer risk large single-row `cliMessages` payloads.
- Envelope reads do not reread `cliMessageChunks` for payload hydration.
- Thread detail opens with all envelopes plus a newest-first historical chunk window.
- Live chunk updates continue through a thread-level delta subscription after the current newest chunk cursor.
- User and assistant body rendering both derive from `cliMessageChunks`.
- Thread history never renders a user row whose `messageId` is absent from the loaded chunk window.
- Expanding history prepends older chunk-backed messages; it does not fill holes in the middle of the visible thread.
- Existing claim/cancel/retry/thread ordering invariants remain unchanged.
- A steady-state chunk flush writes no `cliMessages` document, so it invalidates
  no envelope subscription — only the once-per-run continuation stamp does; a
  settled assistant envelope still reports its real `chunkCount`.
- Steady-state thread message body source-of-truth is `cliMessageChunks`.

## API Path

The chunk-read queries live in `convex/cli/messageChunks.ts`, under the
`api.cli.messageChunks.*` public paths. The `cliMessageChunks` **table** name is
unchanged.

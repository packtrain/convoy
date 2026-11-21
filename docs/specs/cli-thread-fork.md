# CLI Thread Fork Specification

Branching a conversation mid-thread (OS-1397): `Branch from here` on a run
creates a new thread that owns a copy of that one run and continues from the
same agent session. The parent is never modified.

Related specs: `cli-thread-assistant-message-actions.md` (the menu entry),
`cli-thread-edit-last-message.md` (editing the copied run),
`cli-message-context.md` (continuation resolution).

## The unit is a run

Whether the user picks the user message or the assistant reply, the fork
copies the run containing it: every user message stamped with that `runId`
and the assistant reply. Nothing before the run is copied. Nothing after it
exists in the fork.

A run is forkable when:

- the thread's `cliType` is `claude-code`, or `codex` with a reply that
  recorded its `cliContext.turnId` (see Runtime gating),
- the picked message belongs to a run (`runId` set), so a queued message
  cannot be forked,
- the run's assistant reply is finished (`completed`, or `failed` such as a
  user stop) and carries a `cliContext.continuationId`. A stopped reply's
  session is what the parent itself resumes on the next send, so a fork can
  resume it too. A reply still `streaming`, or finished without a session,
  cannot be branched,
- no user message in the run is a Bash script step. The copy drops
  `scriptRequest` and `scriptResult` and none of the lanes a script starts,
  so a copied script reply would pass as an ordinary reply without a session.

Otherwise `cli.threads.core.fork` rejects with `FORK_RUNTIME_UNSUPPORTED`,
`FORK_RUN_NOT_RESUMABLE`, or `FORK_RUN_IS_SCRIPT`. Only the thread owner may
fork; shared read-only viewers see the action disabled.

## What the fork thread is

`cli.threads.core.fork({ messageId })` returns the new thread id. The new
thread:

- is a flat sibling (no `parentThreadId`) unless branched in a new tab, with the parent's title, profile,
  path, CLI type, Project agent binding and prompt snapshot, and task
  attachment (recorded as `manual_attachment`),
- opens `completed` / idle with `hasPendingUserMessages: false`, like a
  workflow lane born before its first message,
- stores `forkedFrom`:

```ts
forkedFrom: {
  threadId,        // the parent; may dangle after the parent is deleted
  runStart: { messageId, createdAt }, // the run's first user message: the envelope cutoff
  reply: { messageId, createdAt },    // the copied reply: the chunk cutoff
  runId?,          // the copied run's id, shared with the parent: divider anchor; absent on earlier forks
  continuationId?, // the parent's turn before the copied run
  turnId?,         // Codex: the turn `continuationId` is forked through (OS-2073)
}
```

Two cutoffs because the two tables stamp time differently. Message rows carry
their creation time, so the parent's earlier messages are those created before
`runStart`. Chunk rows are stamped when appended, and the previous reply may
still have been streaming when the forked prompt was queued, so its last
chunks sort after `runStart`. The reply row is created only once the previous
run has settled, which makes `reply` the safe chunk cutoff.

`forkedFrom.continuationId` is found the way `scanStrandedTail` finds a
resumable turn, scanning the parent's assistant messages older than the
copied reply. A fork of a fork has no earlier assistant of its own, so the
scan falls back to the parent's own `forkedFrom.continuationId`. The seed is
absent when the copied run was the parent's first, or when every earlier
turn failed without a session. `forkedFrom.turnId` is that same row's
`cliContext.turnId`, or the parent's `forkedFrom.turnId` on a fork of a fork.
A Codex seed without a turn is dropped, not stored: it could only be resumed
in place, so after edit-last the fork starts a fresh session instead, the
same as a fork of the parent's first run.

### In a new tab

`fork({ messageId, groupWithThreadId })` births the fork as a Group child of
`groupWithThreadId`'s container instead of a flat thread
(`thread-groups.md`). When that thread is in no group yet, the container is
created around it first, the same way `addThreadToGroup` does it, through the
shared `resolveGroupContainer`. The group cap applies. The caller must own
`groupWithThreadId`; it must be a thread, not a container
(`FORK_GROUP_TARGET_IS_CONTAINER`), in the source's project
(`FORK_GROUP_CROSS_PROJECT`).

`groupWithThreadId` is the viewed thread, not always the source: a history
row forks an ancestor, but the tab opens beside the thread on screen.

The tab is titled "Forked from: *source title*", so it reads apart from the tab
it came from (OS-1559). A source already titled that way keeps its title, so
branching a branch does not stack the prefix.

`fork` returns `{ threadId, containerId? }`, the container set only for a tab.
The workspace adopts that container before switching to the tab, as it does
for `addThreadToGroup` (`thread-groups.md`, OS-1615), so the strip, header and
panels stay mounted while the fork's doc loads. The switch goes through the
workspace's tab navigation, which keeps the query string (`task`, `artifact`).
The workspace withholds the tab action at the group cap, so the item renders
disabled. A host without a workspace (the mini preview) never offers it.

## What is copied

Rows are copied with new ids and the fork's `threadId`. `createdAt` is fork
time plus the row's position in the run (one millisecond per user row, the
reply last), so a steered run keeps its order in the chunk index:

- user messages: text chunks, attachments (a new `cliMessageAttachmentRefs`
  row per attachment pins the blob, which is reference counted), selection
  fields, `processedAt`, `runId`, `steeredAt`,
- the assistant reply: `cliContext`, `diffSummary`, `nextChunkOrder`,
  `status` and `errorMessage` as they stand, `runId`,
- the reply's chunk rows, in `chunkOrder`, all sharing one `createdAt`.
  Steered-message markers name a user row by id; the copy rewrites them to
  the copied row's id so the inline bubble still resolves its attachments.

Not copied: claim fields, cost fields, `workflowRunStepId`, usage snapshots,
the thread's line counters. Cost is recorded once, on the parent.

### Chunk copy runs in batches

A long run holds thousands of chunk rows, more than one transaction may read
or write. The fork mutation copies the first `CHUNK_COPY_BATCH_SIZE` rows
inline so the reply renders immediately, then
`internal.cli.messages.copyMessageChunks` copies the rest, one batch per
transaction, rescheduling itself while a batch comes back full or crosses
`CHUNK_COPY_BATCH_CHARS` of chunk data. The copied reply is `completed` from
the start; rows appear as they land.

While any chain is still scheduled, `forkedFrom.copiesInFlight` counts them;
the fork mutation sets it and the last batch of each chain decrements it.
Until it reaches zero the fork's composer is disabled ("Copying the original
response...") and the branch action is hidden, because a message sent in the
meantime would move the live chunk cursor past the fork-time stamp the
remaining batches carry, and a fork of the copy would truncate at the rows
present. The server enforces the second case (`FORK_COPY_IN_PROGRESS`). The loop stops
silently when the target message no longer exists, which is what happens
when the user edits the copied message before the copy finishes. When the
*source* reply is gone instead (the parent edited the forked run before the
copy finished), the loop appends a `convoy_notice` chunk with code
`fork-copy-incomplete` to the copy and stops, so the truncation is visible
rather than silent.

## Continuation

Two ids make the fork behave like a normal thread:

- The copied reply keeps its `continuationId`, so the next message resumes
  the parent's session at that turn. Claude Code resumes with
  `forkSession: true`, so the parent's session file is never written.
- `getResumeHandleForThread` falls back to
  `forkedFrom.continuationId` when the fork has no assistant with a
  continuation. After edit-last deletes the copied reply, the rerun resumes
  from the parent's previous turn, exactly as the parent would. A fork of
  the parent's first run has no fallback and starts a fresh session.
- Codex has no frozen sessions: resuming the parent's thread id would append
  the branch to it. The resume handle marks the copied reply's session, and
  the seed, with `forkTurnId` (`cli-message-context.md`). The fork's first
  run calls `thread/fork { threadId, lastTurnId }` instead of
  `thread/resume`, keeps the parent's turns through that one, and stores the
  returned thread id and its own turn on its reply, so later runs resume
  plainly. Until the fork RPC answers, the runner reports no continuation,
  so a launch failure never records the parent's id on the fork's reply.
  Edit-last or Retry on the copied run makes the next run fork again, from
  the seed. The resume handle never hands out a borrowed Codex session
  without its turn; it answers null and the run starts fresh.

## Runtime gating

Claude Code is forkable because every turn already runs
`resume + forkSession: true` and stores the forked session id on its own
reply, so the id on reply N names a session that ends at turn N.

Codex keeps one mutable session per thread, so a fork goes through the
app-server's `thread/fork` (OS-2073). A Codex run is forkable when its reply
recorded `cliContext.turnId`; replies written by Convoy CLIs before 0.84.0
have none and stay disabled, like legacy replies without a continuation id.
The fork's first run needs codex-cli `MIN_CODEX_FORK_VERSION` (0.156.1, the
version `lastTurnId` was verified on); an older binary fails that run with a
version message and no continuation, so the next send tries again. A Convoy
CLI before 0.84.0 reads the legacy continuation query, which answers null for
a session that must be forked: the fork starts a fresh Codex session, losing
context but leaving the parent's transcript alone. The `codex exec` transport
(`--codex-exec`) has no fork call: a fork's first run over it fails with a
message naming the app-server transport and records no continuation, so the
next send retries once the agent reconnects.

A runtime-command run (OS-2337) is gated like any other run. A Claude Code
`/compact` reply records the compacted session, so its branch resumes that.
Claude `/usage` saves no session and passes the previous id through, so its
branch resumes the run before it. A Codex `/compact` is a server-side turn
whose id `turn/started` reports; `thread/fork` accepts it as `lastTurnId`
(probed live on codex-cli 0.166.0) and the fork's history ends at the
compaction. Codex `/usage` records no turn and stays disabled. A branch of a
`/goal` run has no goal: `thread/fork` never copies it (cli-thread-goal.md F1–F3). The copy drops
`runtimeCommand`; the copied message is already processed and edit-last takes
the flag from the composer draft.

OpenCode and Cursor still resume in place and stay disabled until their fork
calls (OpenCode `POST /session/{id}/fork`) are wired. Antigravity resumes in
place too: agy cannot truncate a session's history.

## Thread view

A fork renders as one seamless transcript, in this order:

1. the ancestors' messages before the copied run (`ThreadForkHistory`),
   one window on open, read-only, with the usual "Show more" cut on top,
2. the copied run,
3. a divider, "Forked from *parent title*" (`ThreadForkDivider`), on the
   same separator line a context-compaction notice uses,
4. the fork's own messages.

There is no card, accordion, or toggle. The title links to the parent and
is read once with the Convex client, not subscribed. When the parent is gone
or not viewable the divider reads "Forked from a deleted thread".

### Divider placement

The divider sits below the last row whose `runId` is `forkedFrom.runId`,
the copied run's id (`forkDividerAnchor`). Edit-last and Retry rewrite that
run under a new id, so once nothing carries the copied id the divider is
gone, as in Codex: the run is the fork's own from then on. The parent's
earlier messages stay, since the rerun resumes from the parent's previous
turn and they remain the agent's context. No other state is kept. A fork
recorded before `runId` existed has no divider. On a long fork the copied
run can sit above the "Show more" cut; the divider appears once that row is
loaded, since anchoring it elsewhere would misstate where the copy ends.

### Earlier parent messages

`ThreadForkHistory` is the transcript header. Rows come from one-shot reads
by `useForkPrefix`, one ancestor ("hop") at a time:

- `threads.core.get({ threadId })`, for the ancestor's own `forkedFrom`,
- `listEnvelopesByThread({ threadId, before: runStart.createdAt })`,
- `listWindowByThread({ threadId, before: { ...reply, chunkOrder: 0 } })`.

Opening a fork reads one window from the parent, whatever the chain's depth.
"Show more" pages both axes of the frontier hop together: the chunk window
from its older cursor and, while the server reports older envelopes, another
envelope page before the oldest loaded one. Once the frontier is exhausted
and that ancestor is a fork itself, the next click reads the grandparent's
first window instead, and so on up the chain. The button stays while either
is left. An ancestor with nothing before its copied run (a fork branched at
the run it copied) is passed through in the same read, so the walk never
stops on an empty hop.

Messages render once both their envelope and their chunks are present; rows
of the forked run itself arrive without an envelope and are dropped.

Everything above the cutoff is immutable in the parent (only the newest user
message can be edited), so a one-shot read is exact and nothing subscribes.
An empty history renders nothing. A parent that is deleted or not viewable
(`threads.core.get` returns null; its message queries return empty, not an
error) renders "The original thread is no longer available." A gone ancestor
further up ends the walk and keeps what is loaded.

Each hop renders as its own embedded list, oldest first. A hop whose
ancestor is a fork carries that ancestor's divider among its rows, anchored
the same way as the fork's own. Only the oldest list shows the "Show more"
cut.

History rows keep the branch action: branching from one forks the ancestor
at that run, so the new thread is a sibling of the current one.

### Entry points

- Assistant reply overflow menu: `Branch from here` → `In a new thread` or
  `In a new tab` (`cli-thread-assistant-message-actions.md`).
- Assistant reply footer: a branch icon next to `Copy response`, which
  branches into a new thread. It sits under the reply, not the user message,
  because the fork copies the reply too. Both entry points share one gate,
  `canBranchFromReply`: a forkable runtime (Runtime gating), finished, with a
  continuation. Sent user messages carry no branch action.
- Neither appears for read-only viewers of a shared thread: the handler rides
  in the transcript's write-handler bundle.

## Non-goals

- Forking OpenCode or Cursor threads.
- Reading the whole chain on open; ancestors load one hop per "Show more".
- Forking a streaming run, or a finished run that recorded no session.
- Carrying cost or usage history into the fork.

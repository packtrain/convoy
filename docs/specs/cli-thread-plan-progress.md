# CLI Thread Plan Progress (Steps Pill)

Agents keep a checklist as they work (Claude Code `TodoWrite` or its task
tools, Codex `update_plan`). That is thread state, not conversation:
rendering every update inline buries the stream under near-identical
checklists, and the one that matters scrolls away.

Convoy normalizes every provider's checklist into provider-neutral plan
events, folds them into thread state, and renders the current plan as a pill
docked above the composer.

The checklist is separate from a proposed implementation document. Codex native
proposals render in the transcript; see [Codex proposed plans](cli-codex-runtime.md#proposed-plans-os-1481).

## Where the plan lives

**On the thread, not in the chunk stream.** `cliThreads.metadata.plan.steps`
holds the current plan; the chunk-insert path folds plan events into it
(`insertMessageChunkRows` → `applyThreadMetadataEvents`). The client reads that
field off the thread doc it already subscribes to and derives nothing.

The fold skips the write when the result matches what is stored. Nothing else
in the streaming path touches the thread doc, so a no-op patch would add
avoidable OCC contention. `metadata` is also deliberately absent from the
shared thread-list validator (`get` alone returns it): otherwise every plan
update would change list-query results and re-render every thread list.

Deriving from chunks at read time does not work, for two independent reasons:

- The message list is paginated. A reader holds a window of chunks, so a plan
  whose source chunks have scrolled out is invisible — the pill silently
  disappears on reload of a long thread.
- Claude's task tools report **one step at a time**. Reconstructing the plan
  requires replaying every create and update from the start of the thread,
  which a partial window cannot do. A partial replay is worse than nothing:
  it reports a confidently wrong `Step 2/3`.

`metadata` is the bag for denormalized thread-level state generally; other
computed fields (diff stats, …) move there separately. It also holds
`metadata.cli` — the thread's last-used model/effort/mode, folded from the
**message** stream rather than the chunk stream, for the same
pagination-safety reason (OS-1454, see
`docs/specs/cli-thread-model-selection.md`), and `metadata.contextWindow` /
`metadata.usageLimits`, the latest context-window and per-window usage-limit
snapshots, folded by the same chunk-insert pass as the plan (OS-1889, see
`docs/specs/cli-thread-context-window-meter.md`), and `metadata.goal`, the
thread's runtime goal behind the composer goal button (OS-2276, see
`docs/specs/cli-thread-goal.md`). Writers of any key merge into `metadata` so
the siblings survive.

## Normalized events

Two kinds (see `cliNormalizedEventValidator` in
`convex/lib/contracts/validators.ts`), because runtimes report plans in two
fundamentally different ways:

```ts
{ kind: "plan-progress",    steps: { id?, text, status }[] }              // full snapshot, replaces
{ kind: "plan-step-update", steps: { id, text?, status? }[] }             // upsert by id
```

`status` is `pending | in-progress | completed`.

- Runtimes build both through `convex/cli/lib/runtimes/shared/planProgress.ts`,
  which refuses empty/meaningless events so callers fall back to their normal
  event. An empty plan is a normal thing for a runtime to send, so every
  transport falls back to silent metadata rather than an "unsupported event"
  card.
- `foldPlanEvents` applies them in stream order: a snapshot replaces
  everything; an update patches only the fields it names and leaves other
  steps alone. An update for an unknown id appends only if it carries text —
  a status for a step that has no text has nothing to render.
- The plan persists across turns and runs within a thread; it is replaced, not
  reset. Claude's task list is session-scoped and behaves the same way.
- Neither event renders inline. The client composer explicitly ignores both.

## Per-runtime mapping

| Runtime | Source | Form | Active step |
|---|---|---|---|
| Claude Code | `TodoWrite` call input (`todos[].content` / `status`) | snapshot | exact (`in_progress`) |
| Claude Code | `TaskCreate` **result**, `TaskUpdate` **call**, `TaskList` result | patch / patch / snapshot | exact |
| Codex (app-server) | `turn/plan/updated` notification | snapshot | exact (`inProgress`) |
| Codex (exec) | `item.*` × `todo_list` (`items[].text` / `completed`) | snapshot | not reported — never guessed |

Claude uses **either** `TodoWrite` or the task tools depending on version and
configuration, so both must stay supported.

The task tools are the awkward case:

- `TaskCreate`'s input has no task id — the id first appears on its result, so
  the plan step is emitted from the result, not the call. The id and subject
  come from `tool_use_result.task`, but that is a single top-level field on the
  message: when Claude batches parallel results into one chunk it cannot be
  attributed to a block, so it is only used for single-result messages.
  Batched creates go through the per-block result text ("Task #3 created
  successfully: …"), which is unambiguous.
- Task results normalize **per result block**, not per chunk. Sibling tool
  results in the same message keep their own events (dropping them would leave
  those tool cards spinning forever) and bundle with the plan event through
  `singleOrBundled`.
- `TaskUpdate` has the id and status in its input and maps directly.
- `TaskCreate` and `TaskList` calls normalize to silent metadata. Together
  with the replaced `TodoWrite` and `TaskUpdate` calls, no checklist tool
  leaves a raw JSON card in the transcript. The paired tool results become
  orphans and are silently dropped by the composer.
- Subagent checklist calls (`parent_tool_use_id` set) stay plain tool calls
  inside the subagent group. The pill tracks the main agent's plan, not each
  subagent's private checklist.
- Codex exec JSON only distinguishes completed from incomplete. The
  normalizer does not infer which step is active; the client falls back to
  the first incomplete step for display.

## Client

`toPlanProgress` (`lib/threads/plan-progress.ts`) shapes the stored steps for
the pill and does nothing else — no chunk scanning:

- `currentIndex` is the in-progress step when one is reported, otherwise the
  first incomplete step, otherwise the last step (a finished plan).
- Returns `null` for threads with no plan.

The thread view reads `chat.metadata?.plan?.steps` from the live
`api.cli.threads.core.get` subscription, so the pill updates whenever the fold
patches the thread.

## UI

`ThreadPlanProgress` (`components/blocks/thread/thread-plan-progress.tsx`),
a chip in the composer top bar placed after the PR badge — not a floating
element above the composer, which would compete with the queued-messages
strip for that space.

- A blue progress ring (`CircularProgress`, `progressClassName`) plus
  `Step X / Y`. The step title is never shown in the bar; it is one hover
  away and would crowd the other chips.
- The counter drops in two cases, leaving the ring alone: a finished plan (a
  full ring already says so), and narrow containers, using the same
  `hidden @lg/composer-bar:inline` idiom as the bar's other chips.
- Clicking opens the full checklist in a popover — not a hover card, which
  never opens on touch. Uniform muted icons and `text-sm` text, no per-status
  coloring or strikethrough: check for completed, spinner for in-progress,
  hollow circle for pending.
- The chip is absent entirely when the thread has no plan.

## Not covered

- No backfill and no read-time fallback: `metadata.plan` is written going
  forward only, so threads that ran before this shipped show no chip, and
  their stored checklist tool calls render as generic tool cards.
- Cursor's `updateTodosToolCall` still renders as a tool call; it has not
  been mapped to `plan-progress` yet.
- Codex's proposed-plan markdown (`item/*` × `plan`,
  `item/plan/delta`) is a different feature and is not part of this pill.

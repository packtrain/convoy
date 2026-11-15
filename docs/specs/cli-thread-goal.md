# CLI Thread Goal (`/goal`)

OS-2270. Slice 1 (OS-2276) covers Claude Code. Slice 2 (OS-2277) covers Codex
on the app-server transport.

## User-visible behavior

- The user sends `/goal <condition>` from the thread composer. Claude Code
  sets a session-scoped Stop hook and keeps working, turn after turn, until a
  separate evaluator agrees the condition holds.
- `/goal` shows the current goal. `/goal clear` removes it.
- `/goal` works as a new thread's first message. Before Claude or Codex
  reports its command list, the composer assumes `/goal`
  (`getComposerRuntimeCommands`), with that runtime's argument hint,
  so the message goes out as a runtime command, not as prose. See
  `docs/specs/cli-runtime-commands.md` → Cold start.
- A goal button (target icon) sits in the composer footer, right after the
  mode selector, while the thread has a goal:
  - Blue while the goal is active. Its label reads `Goal active`, plus
    `· N checks` once the evaluator has rejected at least one stop.
  - Green once the run ends with the goal met (`Goal met`). A met goal stays
    until the next `/goal <condition>` or `/goal clear`.
  - Codex only: grey `Goal paused`, amber `Goal blocked`, `Goal stopped at a
    usage limit` or `Goal reached its token budget`. An active Codex goal's
    label adds `· N tokens`; the popover shows `Tokens: N used of B`, and a
    paused goal says "Send /goal resume to continue."
  - The popover shows the label, the full condition and the last check
    reason. A "Clear goal" button sends `/goal clear` as a runtime command
    (`handleClearGoal`). It leaves the composer draft and attachments alone.
    The button shows only when the runtime advertises `/goal`, so Convoy
    never sends a command the runtime would read as prose. While a run is
    streaming the command queues behind it like any message.
- Each failed check renders a "Goal not met yet" notice with the evaluator's
  reason, with a target icon. Before this, the agent seemed to continue for no
  reason, because the feedback chunk was silent.
- A user-configured Stop hook (no goal prefix) renders a "Stop hook feedback"
  notice and does not touch the goal button.
- Claude's replies to `/goal`, `/goal <condition>` and `/goal clear` render
  as goal notices ("Goal set", "Goal active", "Goal cleared", "Goal: No goal
  set"), not as assistant text. As text, the reply ran into the model's first
  paragraph with no break ("Goal set: X" + "Goal noted: …"), because the
  composer joins adjacent text events. A reply Convoy does not recognize, such
  as the length-limit error, stays text.
- Agent readers (`list_thread_messages`) see each goal notice as
  `<title>: <message>`, so `/goal` replies stay readable without text events.

## Where the goal lives

`cliThreads.metadata.goal` (`cliThreadGoalValidator`): `{ objective, status,
iterations, lastReason?, tokensUsed?, tokenBudget? }`. `status` is `active` or
`complete` for Claude, plus Codex's `paused`, `blocked`, `usageLimited` and
`budgetLimited`. Same reason as the plan
(`docs/specs/cli-thread-plan-progress.md` → Where the plan lives): the message
list is paginated, so the latest goal chunk may not be loaded. The thread view
passes `chat.metadata?.goal` to the composer; no new query or subscription.

## Normalized events

Provider-neutral `goal` event, folded at chunk insert and silent inline:
`{ kind: "goal", source, objective?, status?, iterations?, lastReason?, tokensUsed?, tokenBudget?, sessionId? }`.

| `source` | Meaning |
|---|---|
| `set` | A goal with `objective` was set |
| `check` | The goal's Stop hook rejected a stop with `lastReason` |
| `report` | The goal's reported state (Claude status reply, Codex snapshot or update), or `status: "none"` |
| `cleared` | The goal was removed |
| `run-completed` | The run ended normally. Means met only while a goal is active |

## Fold rules

`foldGoalEvents` in `convex/cli/lib/chunks/lifecycle.ts`, applied in chunk
order inside `applyThreadMetadataEvents`. It writes only when the result
differs from the stored goal.

1. `set` replaces the goal: `{ objective, status: active, iterations: 0 }`.
2. `check` with the active goal's objective adds one to `iterations` and
   stores `lastReason`. A check for any other objective, or with no goal
   stored, starts that objective at one check. The check proves the goal is
   active, and adopting it repairs a goal set before this shipped.
   The normalizer splits `[X]: R` at the first `]: `, which cuts an objective
   that itself holds `]: `. The fold rebuilds the feedback and splits it on
   the stored objective when the feedback starts with it, so the stored goal
   and its count stay whole. The `goal-check` notice is stateless and shows
   the first split in that rare case.
3. `report` replaces the goal with the reported state. `status: none` removes
   it.
4. `cleared` removes the goal.
5. `run-completed` turns an active goal into `complete`. Otherwise no-op.

## Claude Code mapping

The CLI is unchanged: a solo `/goal …` message is already forwarded as a raw
prompt (`docs/specs/cli-runtime-commands.md`). `normalizeClaudeCodeChunk`
maps, root chunks only:

- An `assistant` chunk with top-level `local_command_run.command === "goal"`
  and a single text block. The text is replaced by the goal event and a
  `goal-set`, `goal-status` or `goal-cleared` notice:
  - `Goal set: X` → `set`.
  - `Goal active: X (N turn[s])` or `(not yet evaluated)`, optionally
    followed by `\nLast check: R` → `report` (`active`, `iterations` N or 0).
  - `Goal cleared: X` → `cleared`.
  - `No goal set…` → `report` (`none`).
  - Anything else (for example the length-limit error) stays plain text.
- A top-level text-only `user` chunk `Stop hook feedback:\n[X]: R` → `check`
  plus a `goal-check` notice. Without the `[X]: ` prefix → a
  `stop-hook-feedback` notice only. Subagent chunks (`parent_tool_use_id`
  set) keep their existing mapping.
- A `result` chunk with `terminal_reason: "completed"` whose outcome is
  completed → `run-completed`.

"Met" is inferred, not reported. The goal's Stop hook blocks a normal stop
until the evaluator agrees, so a run that ends `completed` with an active goal
met it. Claude's stream carries no met signal in 2.1.318 (`active_goal` is
typed in the SDK but never emitted), and the session file is Claude's
internal state, so Convoy does not read it. The stateless normalizer cannot
know a goal was active, so "met" shows on the goal button only, never as a
transcript notice.

Stop (`terminal_reason: "aborted_streaming"`) and failed runs emit nothing:
Claude keeps the goal active, and so does the goal button. The next message wakes
the goal again. A local command run (`/goal` status) ends with no
`terminal_reason`, so it never marks a goal met.

## Codex

The app-server runner (`codex/goals/`, CLI ≥ 0.130.0) bridges `/goal` to the
native goal RPCs of codex-cli 0.166.0. The exec transport advertises no
`/goal`.

| Command | RPC | Opens the thread? |
|---|---|---|
| `/goal` | `thread/goal/get` | No |
| `/goal <objective>` | `thread/goal/set {objective, status: active, origin: user}` | Yes, before the set |
| `/goal pause` | `thread/goal/set {status: paused, origin: user}` | No |
| `/goal resume` | `thread/goal/set {status: active, origin: user}` | Yes, before the set |
| `/goal clear` | `thread/goal/clear {origin: user}` | No |

`parseGoalCommand` reserves the bare words `pause`, `resume` and `clear`;
anything else is the objective, at most 4,000 characters.

### Run lifecycle

- **Pause before resume.** `thread/resume` with an active goal starts a goal
  turn by itself, after a crash and after a clean stop (C6, C3b). So every run
  that reopens a thread calls `thread/goal/get` first. Goal RPCs work on a
  thread that is not loaded (R1, R2). An active goal is paused with `origin:
  "automatic"`. Unless the command is `/goal <objective>` or `/goal resume`,
  a "Goal paused" notice tells the user to send `/goal resume`. One check covers Stop, a Codex crash, a CLI crash and a lost
  connection. Any other state is sent as a silent `sync` snapshot, which
  repairs a stored goal whose last change never reached Convoy (a lost Stop
  confirmation, a missed notification). Only an unknown-method answer (a
  Codex without goal RPCs) lets the run open without the check. Any other
  `get` failure, or a response Convoy cannot read, fails the run.
- **Read, pause, clear** answer by RPC only and end the run. They never open the
  thread, so they never start a turn. The run keeps its continuation ID and has
  no turn ID.
- **Set, resume** run last: open the thread (`thread/start` or `thread/resume`;
  no goal is active, so no turn starts), then `thread/settings/update` with the
  selected `collaborationMode` (plan or default, from `collaborationModeForRun`)
  and `effort`, then `thread/goal/set`. Convoy sends no `turn/start`: Codex
  starts the goal turn itself (C1, C4), and a second one would double the work.
  So the thread settings are the only way the selected mode and effort reach
  the goal turns. Codex 0.166.0 echoes the new mode and effort in
  `thread/settings/updated` and starts no turn for the update.
- **Branches** do no goal handling. `thread/fork` never copies the goal and
  starts no turn (F1–F3). On a new thread or branch, `/goal`, `/goal pause`,
  `/goal resume` and `/goal clear` answer "No goal set" without a thread.
- **Continuation.** After a successful root `turn/completed` with the goal
  still active, the run stays open for the next root `turn/started` (observed
  ~14 ms later, C2) and adopts its turn ID, so steer, interrupt and usage
  follow the current turn. Steering between turns is declined and queues for
  the next run. A goal that leaves `active` while the run waits ends the run.
  A goal the model creates on an ordinary run (C8) follows the same rule.
- **Watchdog.** No next turn within 30 seconds: the runner re-reads the goal
  and sends it as a `sync` snapshot. Still active → the run fails ("Codex did not start the next goal turn"); the
  next message pauses the goal. Otherwise the run ends normally.
- **Stop** sends `turn/interrupt`, which leaves the goal active (C3), then
  `thread/goal/set paused` with `origin: "user"`. The runner waits at most
  2 seconds for the answer before it kills Codex. Stop has already released the
  message claim, so no chunk can carry the pause. A confirmed pause rides
  `acknowledgeStop` as `goalPaused: true`, which turns an active stored goal
  `paused`. An unconfirmed pause sends nothing; the next run's check pauses it.
- `/goal clear` does not stop a running turn (C5). The command queues behind
  the run like any message.

### Events

RPC responses are the source of truth. Each one is emitted as a synthetic
`convoy/goal/snapshot` chunk `{ action, threadId, goal, clearedObjective? }`,
where `goal` is the native `ThreadGoal` or null and `action` is `read`, `set`,
`pause`, `resume`, `clear`, `auto-pause` or `sync`. A notification that arrives while
a goal RPC is in flight, or with an `updatedAt` older than the last response,
is dropped. `thread/goal/updated` is forwarded only when objective or status
changes, because Codex sends usage-only updates after every tool call (C2).
`thread/goal/cleared` is forwarded only when a goal was known. Notifications
for any thread but the root are dropped, in the CLI and again in the
normalizer (assumption: child goals do not drive the parent).

`appServerEvents.ts` maps each to a `report` (or `cleared`) goal event and a
notice:

| Chunk | Notice |
|---|---|
| snapshot `set` / `resume` / `pause` | `goal-set` "Goal set", `goal-resumed` "Goal resumed", `goal-paused` "Goal paused" |
| snapshot `auto-pause` | `goal-paused` "Goal paused", with how to resume |
| snapshot `read` | `goal-status`, titled by status, with token use |
| snapshot `clear` | `goal-cleared` with the cleared objective |
| snapshot with no goal | `goal-status` "Goal: No goal set" |
| snapshot `sync` | none: only the goal event |
| `thread/goal/updated` | `goal-met` (complete), `goal-limited` (blocked, usage or budget limit), `goal-paused`, or `goal-set` (a goal the model set) |
| `thread/goal/cleared` | `goal-cleared` |

The token count on the goal button updates only at these transitions.

## Cost

- Writes: one `cliThreads` patch per goal transition, only on change. A Claude
  goal costs one patch for the set, one per failed check, one at the end.
- Reads: `applyThreadMetadataEvents` reads the thread once per chunk batch
  holding a goal event. Every completed Claude run carries `run-completed`, so
  that is one extra thread read per Claude run, and no write unless a goal
  was active.
- Fanout: each patch re-runs queries that read this thread doc, the same
  channel as `plan` and `usageLimits`.
- Codex: one patch per goal transition (set, each status change, clear).
  Usage-only updates never leave the CLI. Each run that reopens a thread adds
  one small `sync` chunk to its first chunk batch; the fold writes only when
  the goal changed. Locally, each such run costs one `thread/goal/get`, plus
  one `thread/goal/set` when a goal was left active, with no model tokens. The
  `sync` batch reads the thread at most once more; `thread/started`
  (background-task metadata) usually triggers that read in the same batch.
- A Stop with a confirmed pause adds `goalPaused` to the existing
  `acknowledgeStop` patch; no extra write.

## Not covered

- Codex budget editing, the exec transport, and goals of Codex child agents.
- Historical threads: stored chunks are not re-normalized, so only goal
  events from new runs drive the goal button.
- Claude's `ProposeGoal` approval flow.
- Branches (`forkThreadCore`) do not copy `metadata.goal`.

## Trace evidence

Claude Code 2.1.318 through the Agent SDK, captured for OS-2270:

| # | Observation |
|---|---|
| L1 | `Goal set: X` synthetic reply with `local_command_run: { command: "goal", args }`. Met run ends `completed`; a later `/goal` says `No goal set`. |
| L2 | Each failed check is a root user text `Stop hook feedback:\n[X]: reason`; work continues in the same run. |
| L3 | Stop ends `aborted_streaming`; the goal stays active. Status reads `Goal active: X (1 turn)\nLast check: …`. Clear reads `Goal cleared: X`. |
| L5 | A user Stop hook reads `Stop hook feedback:\n<reason>` with no `[X]:`. |
| L6 | The goal survives a restart; the count resets (`not yet evaluated`). |

Codex app-server 0.166.0, captured for OS-2270 and OS-2277:

| # | Observation |
|---|---|
| C1 | `goal/set` starts a turn itself (~6 ms). |
| C2 | Continuation turns start ~14 ms after `turn/completed`; `complete` arrives before the last `turn/completed`; `goal/updated` after every tool call. |
| C3 | Interrupt leaves the goal `active`; no new turn in the same app-server. |
| C4 | Resume starts a turn itself. The RPC response precedes its echo notification; both carry the new state. `updatedAt` is in seconds. |
| C5 | Clear does not stop a running turn. |
| C6, C3b | `thread/resume` with an active goal starts a goal turn itself, after a crash and after a clean stop. |
| C7 | `budgetLimited` mid-turn; the turn still finishes. A failed turn turns the goal `blocked`. |
| C8 | The model can create its own goal from a plain prompt. |
| R1, R2 | `goal/get` and `goal/set paused` work before `thread/resume`; then no turn starts. |
| F1–F3 | `thread/fork` never copies the goal and starts no turn; `origin: automatic` pause is accepted. |

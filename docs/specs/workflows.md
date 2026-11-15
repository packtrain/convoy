# Agentic Workflows

Status: design agreed (grilling session 2026-07-07/08); implementation in
progress under OS-1366 — run start, cancel, and the Run view landed with
OS-1867; the engine (scheduled advance, lazy lane threads, prompt dispatch,
single lane end-to-end) landed with OS-1868, along with Lane holds and their
Resume action; the stage barrier and concurrent single-lane dispatch landed
with OS-1869. Parallel lanes landed with OS-1884 (Step overrides validated
at the cut) and OS-1885 (one fresh thread per Step, concurrent same-stage
dispatch). Bash steps — editor, script requests run by the CLI, result
handling, and the approval gate — landed with OS-1886.
Failed steps recover in-thread (see In-thread recovery) or via
the Run view's Retry/Skip on the failed Step row (OS-1870), which also stamps
`waiting_input` answers with their Step. Wait steps (in-thread approval card,
steer-then-approve — see Wait steps), full cancel, and soft-delete canceling
active runs landed with OS-1871.

A **Workflow** is a project-scoped, reusable definition of staged prompts and
actions that drive CLI threads automatically. A **Workflow run** executes one
Workflow: the backend sends each prompt Step into a CLI thread as the starting
user, waits for the Thread run to complete, and advances.

Canonical vocabulary lives in `CONTEXT.md` (Workflow, Workflow version,
Workflow run, Stage, Lane, Single lane, Parallel lane, Step, Lane hold). Related specs:
`cli-thread-agents.md`, `cli-thread-cancel-processing.md`,
`agent-automation.md`, `cli-worktrees.md`, `thread-groups.md`,
`agent-execution-v2-discussion.md`.

## Definition model

- A Workflow belongs to one project. Members with task write access create
  and edit Workflows (same bar as Project agents); starting a run requires
  `ProjectPermission.CLI_THREAD`.
- Structure: ordered **Stages** → each Stage holds **Steps** → each Step is
  assigned to one **Lane**. Lanes are definition-level columns shared across
  Stages.
- Authoring UI is a Stage × Lane grid (rows = Stages, columns = Lanes).
  Vertical position of Steps inside a Stage cell is **layout only** — it does
  not impose cross-lane ordering. Execution order comes solely from:
  - Lane sequence: a Lane's Steps within a Stage run one after another.
  - Stage barrier: Stage N+1 starts only when every Step in Stage N is
    completed or skipped.
- Cross-lane sequencing (lane 1 step → lane 2 step → lane 1 step) is
  expressed by putting those Steps in consecutive Stages, not by row
  position.
- The definition is one freely editable draft, persisted with an explicit
  Save button (consistent with Agents and prompts). Save writes the draft
  only — it never creates a version. Immutable versions are cut automatically
  at run start when the draft has changed (see Versioning).

### Lane types

- **Single lane**: maps to exactly one CLI thread per run — one ongoing
  conversation across all Stages. Steps run sequentially. The Lane stores
  everything its thread needs at start as Lane defaults: `cliType`, model,
  effort, mode, and optionally one Project agent for the whole Lane — a
  thread's runtime and agent binding are immutable, so these are Lane-level,
  one and for all Steps.
- **Parallel lane**: its Steps within a Stage run concurrently, each in its
  own fresh CLI thread. No conversation continuity, ever — a Parallel lane is
  a burst of independent one-shot threads. Exists so "run 5 agents in
  parallel" doesn't require 5 sparse columns. It has no Lane defaults; each
  Step carries its own runtime settings.

### Step types (v1)

1. **Prompt** — composer content sent as a user message into the Lane's
   thread. In a single Lane the one optional per-Step override is `mode`
   (the per-message setting); unset inherits the Lane default. Single-lane
   Steps cannot override `cliType`, model, effort, or Project agent — the
   Lane is the thread, and its settings are chosen once, on the Lane.
   **Parallel-lane** Steps carry their own settings and may set all of them,
   including `cliType` and Project agent, since each gets a fresh thread —
   enabling cross-runtime panels (e.g. Fable review + GPT review in one
   Stage). Profile/path is run-level only (one machine per run). A prompt
   Step whose runtime the run profile's online session does not advertise
   fails at dispatch with the reason (`workflowStepRuntimeUnavailable`,
   OS-1895) — only that Step; same-stage siblings dispatch and the barrier
   holds. Retry re-checks the session's current runtimes, so installing the
   runtime and retrying is the recovery. With no session online the prompt
   queues until one connects — the same no-timeout rule as any unclaimed
   message (see Orchestration). Bash Steps skip the check: the CLI's script
   runner needs no agent runtime.
2. **Wait for human** — blocks its Lane until the starting user explicitly
   approves; in a Parallel lane, which has no intra-Stage order, it
   dispatches alongside its Stage siblings and blocks only the stage
   barrier. Pure state change; no execution (see Wait steps). Validated at
   the version cut: a wait cannot be a Lane's first Step — every wait lives
   in an existing conversation.
3. **Bash script** — stores script text, a timeout, and the output-reporting
   mode. All three are required in the stored shape; the editor supplies the
   defaults (10-minute timeout, report on failure), not the server — see
   [workflow-data-schema.md](workflow-data-schema.md) → Save and version cut.
   Anyone with task write access (`task:update` — every project member) can
   author a script, the same permission that edits the rest of the Workflow;
   the script executes on the machine of whichever user starts the run, with
   that user's credentials. The trust decision is mode-gated at execution
   time, not at start (see Bash steps below): the Step's resolved mode — a
   single Lane's default mode — decides; only act mode (`agent`) runs a
   script unprompted, every other mode holds it for the starting user. A
   Parallel lane has no mode; its bash Steps run unprompted.
   Executes as a typed script request in the Lane's thread queue:
   the CLI claims it like a normal run but runs the script (in the run's
   working directory) instead of an agent, streaming stdout/stderr back as
   chunks into the thread transcript. The request's bubble shows the script
   text in the bash card's blue exec accent with a terminal icon, so a
   command the CLI ran reads apart from prose the user typed. No env/secret
   injection in v1.
   In a **Parallel lane** only `stop_on_failure` is allowed — the Step's
   one-shot thread has no agent to report to; Save normalizes the other two
   values to it and the version cut rejects any that slipped past.
   **Result handling** (`reportOutput`, chosen per Step in the editor):
   `on_failure` (default) sends the script's output to the Lane's agent as a
   user message only when the script fails — so a passing check does not
   spend context — and `always` sends it either way; under both, the Lane
   continues and the agent decides what a failure means. `stop_on_failure`
   sends nothing to the agent: non-zero exit or timeout marks the Step
   failed and halts the Lane for the starting user (retry or skip, like any
   failed Step). Every mode keeps the raw output in the thread transcript
   for the human.

Deferred step types (v2 candidates): deterministic task actions ("set task
status/label/list"), create-task, post-comment, HTTP/webhook call, start
another workflow. V1 reaches task mutations by prompting the agent to use
MCP tools.

## Versioning

- The Workflow stores its draft; Save writes the draft and sets a
  `dirtySinceLastVersion` flag. Saves never create versions.
- Run start cuts the version: flag clear → the run pins the latest immutable
  **Workflow version**; flag set → the draft is copied into a new version,
  the flag is cleared, and the run pins the copy. No hashing or comparison.
- Version history is exactly the definitions that have run. Old versions are
  read-only; reverting the draft to an older version is a planned later
  feature.
- Editing the Workflow mid-run has no effect on in-flight runs — they read
  only their pinned version.
- Deleting a Workflow (soft delete) **cancels its active runs**; version and
  run history are kept.

See ADR 0006 and `workflow-data-schema.md`.

## Run model

### Start

Runs start from the new-thread composer — both the `/threads` composer and
the task sidebar's Activity composer — or from `convoy workflows start` (see
CLI), which collects the same inputs as flags. A workflow selector in the
composer's context bar (branch-selector styling: search input on top, a "New
workflow…" row linking to the editor, an empty state saying the project has
no Workflows yet) lists the project's Workflows. Selecting one arms the
composer as the start form; send starts the run and navigates to the run's
container thread. Picking "No workflow" (or re-picking the checked row)
disarms back to a plain thread; untouched seeds — the prefill and the
worktree preselect — are reverted with it, edits are kept. A failed start
(rejected version cut, unreachable machine) keeps the composer content for
a retry.

The new-subthread composer opened with the tab strip's "+" also offers the
workflow selector when neither the source thread nor its container belongs to
a workflow run, including a finished run. Sending starts the workflow in that
container. A standalone source gets a group on send, with its title and pin
preserved. Existing conversations stay manual threads with their transcripts,
runtimes, tasks, and processing state unchanged; every workflow lane starts
fresh. No extra manual thread is created for the draft.

The draft's machine, directory or worktree, and optional task apply to the run
and its new lanes. They need not match the existing manual threads. The normal
prompt prefill, worktree preselect, and attachment restrictions below apply.
After a successful start, the submitted draft stays active and disabled, with
its text and workflow selection intact, until the first available run-owned
thread and its messages and group have loaded. The workspace then replaces the
draft tab with that thread and opens its URL directly. It never routes through
the container or briefly selects the original thread. The workspace, header,
thread tabs, and sidebar tabs keep their mounts. In split view the Workflow
panel opens alongside the new thread; full view keeps the thread visible.
Starting beside a standalone thread preserves the draft's storage key and tab
strip while the new group loads.

Closing the draft or selecting another thread cancels this automatic tab
selection; the started run continues. If the run stops or needs attention or
approval before creating a thread, close the draft and show Workflow progress
in place. A rejected start keeps the draft and selection for retry.

Run start resolves the source and container in one transaction. Both must be
live, owned by the starting user, and in the workflow's project. The caller can
supply the expected container, or null for a standalone source; a moved source
is rejected. An existing group at the manual-thread limit also rejects start,
counting deleted rows as the normal new-subthread action does. Existing workflow
bindings reject a second start even when the first run has finished. Shared sources or containers must be unshared before
start because workflow containers do not support sharing; start never removes
a share. The reused container keeps its title, pin, children, and unread state,
uses the run's selected machine and task, and mirrors the run's status.

An armed composer collects, shared by all Lanes:

- The first Lane's first prompt, prefilled into the input (slash-command
  refs included) and editable — unless the user had already typed something,
  which is never overwritten. The edit is stored as a run-local prompt
  override on that run Step, refs and all; the Workflow version is
  untouched. All other Steps run exactly as defined, read from the pinned
  version. The model/mode pills show that Lane's runtime for orientation —
  the run itself reads the pinned Lane defaults.
- **Kickoff step.** When the first Lane has no prompt Step at all (a
  bash-only Lane, a parallel-only Workflow) the composer prefills nothing,
  and typed text is never dropped: start inserts one run-local prompt Step
  ahead of Stage 1, in the first Lane, with the text as its prompt. A single
  Lane runs it as its thread's first turn on the Lane's defaults (mode
  included), so a bash Step behind it waits for approval inside that
  thread; a parallel Lane runs it as one one-shot thread on the run's
  runtime. The Workflow version is untouched — the Step exists only in the
  run (`definitionStepId: "kickoff"`, stage order −1) and resolves its
  prompt from its own override. The Run view lists it as a **Kickoff**
  stage. An empty composer inserts nothing.
- CLI profile + path, or a new worktree (the composer's existing
  selectors). Runtime/model/effort/mode are **not** collected here — they
  live on the Lanes (single) and Steps (parallel) in the definition.
- If the Workflow is marked `runInNewWorktree`, selecting it preselects a
  new worktree, named from the attached Task's ref (e.g. `abc-123`) when
  present, else derived from the prompt plus a short run suffix so repeat
  runs don't collide on the branch name; the selection stays editable.
- Optional attached **Task** — the composer's task pill (the task sidebar
  composer keeps its Task locked and attached). Attachments are rejected
  while a workflow is armed — a run start has nowhere to carry files.
- Start collects no bash consent. Execution approval is governed by the
  Step's mode (the same approve-vs-act idea as the composer's mode pill):
  act mode runs each script without prompting, any other mode holds it for
  the starting user to approve; Parallel-lane scripts never prompt (see
  Bash steps).

### Threads

- Each single Lane's thread is created lazily when its first executable Prompt
  or Bash Step is about to run, named from the Workflow + Lane. Wait Steps do
  not create threads. Parallel-lane executable Steps each create their own
  thread the same way. The one thread born without a message: a single Lane
  whose first Bash Step is held for approval gets its thread at the hold (see
  Bash steps), empty until Approve sends the script.
- Run threads are ordinary CLI threads afterward: they persist after the run
  and follow existing visibility rules (user-scoped to the starting user).
  They are children of the run's container thread, so they collapse out of
  the flat thread list into the run item (see Threads page integration) but
  remain directly linkable.
- Users can add manual threads with the tab strip's "+" button. These share
  the run's container through `parentThreadId` but have no `workflowRunId`,
  `workflowLaneId`, or `workflowRunStepId`. They do not hold lanes, advance
  steps, or affect run completion or the container's workflow status.
  Canceling the workflow stops only its lane and step threads; manual threads
  keep running. Manual threads can also be added after the run finishes or
  is canceled. The usual group permissions and size limit still apply.
  The container row continues to show the run's status even while a manual
  thread is running; unread and attention indicators still include all children.
- Manual threads keep the Workflow sidebar tab, including during tab switches,
  but do not show the Run rail. They can be removed from the container with
  "Remove thread from group" and then pinned or shared as standalone threads.
  Threads created by the workflow cannot leave its container.
- An empty workflow container offers the same manual composer. It seeds from
  the container's saved profile, path, runtime, and task. A lane arriving while
  the draft is open does not dismiss it. The first send creates a manual child
  directly in the container, and navigation waits until that child is ready.
  MCP and CLI callers can target an empty run container by providing profile,
  path, and runtime explicitly. Containers with children still inherit from a
  selected child. A lane arriving between selection and creation is harmless.
- Every run-created thread is associated with the run's attached Task (all
  lanes), feeding the existing `agentThreadWork` summary.
- Lane ↔ thread is 1:1 within a run (1:1 per Step for Parallel lanes); a
  run-created thread belongs to exactly one run + Lane. Lanes never share
  threads.
- A Workflow may have many concurrent runs.

### Orchestration

- The backend orchestrates. Prompt Steps are inserted as user messages
  authored by the starting user, marked with the originating run/step. The
  CLI stays unchanged for prompt steps — it sees ordinary pending messages.
- Advancement hooks the existing `cliThreads` intent-named write seams
  (`convex/cli/threads/lib/cliThreadsRepo.ts`: message queued, stream end,
  claim reset, retry requeue, soft delete, interaction flag): a seam crossed
  by a run-bound thread schedules the
  run engine (`ctx.scheduler.runAfter(0, …)` — transactional scheduling, so
  the reaction is durable and there is no polling). The engine re-derives
  Step and run state from the lane thread's current status instead of
  coupling to the seam's transaction, so it is idempotent and concurrent
  triggers (simultaneously finishing Lanes) converge. Run start schedules the
  first advance the same way.
- Each advance settles running Steps, then dispatches every idle, unheld
  Lane's next pending Step within the earliest unfinished Stage — the stage
  barrier. A running, waiting, or failed head Step blocks only its own Lane;
  Lanes advance independently up to the barrier. A Parallel lane dispatches
  every pending Step of the frontier Stage at once, each into a fresh thread
  titled Workflow — Lane — Step; a failed one blocks nothing but the barrier.
  One advance dispatches at most 10 Steps (`MAX_DISPATCHES_PER_ADVANCE`) and
  reschedules itself for the rest, bounding each transaction's writes.
  Leftovers stay pending; the barrier is unaffected. A dispatch insert folds
  into the container's stored denorms in O(1) — it never rescans the group,
  whose agent prompt snapshots would otherwise be re-read on every insert of
  a wide stage. Reconciling `MAX_GROUP_CHILDREN` is OS-1896.
- Same-stage Lanes share the run's one checkout (see Out of scope:
  worktree-per-lane is v2) — v1 leaves coordinating concurrent edits to the
  prompt author. A stage can also dispatch more Lanes (up to 12) than the
  CLI's `DEFAULT_MAX_CONCURRENT_CHATS = 5`; the extra prompts queue and are
  claimed as slots free up.
- Every state change that happens in a transaction reaches the engine through
  a seam or its own mutation. The states with no transaction to hook — a CLI
  machine that never claims the queued message, a `waiting_input` question
  the user never answers — deliberately keep the run `running`: the Run view
  shows what the run is waiting on, and Cancel is always available. There is
  no timeout reconciler; add one only if a real staleness requirement shows
  up.
- The CLI already processes up to `DEFAULT_MAX_CONCURRENT_CHATS = 5` claimed
  threads concurrently, so same-stage Steps genuinely run in parallel on one
  machine.

### Step / run lifecycle

Step statuses: `pending → running → completed | failed | skipped | canceled`
(plus `waiting` for wait-for-human). `canceled` marks steps that were in
flight when their run was canceled.

- A prompt Step completes when its Thread run completes.
- If the thread ends in `waiting_input` (agent asked a question), the Lane
  pauses; the user answers in the thread, and when that response's run
  completes, the same Step is re-evaluated and finished. The run stays
  `running`, but the container's `aggregateStatus` shows `needs_attention`
  while a lane thread waits on the user, so the list dot matches the thread's.
- Stop in a lane thread fails the Step like any failed run, even while the
  agent waits on an approval or question: the parked wind-down that keeps a
  standalone thread in `waiting_input` (`cli-thread-cancel-processing.md`
  rule 10) does not apply to run threads, where the engine owns the turn
  and a parked Step would spin until the user typed something.
- A failed run (or failed/timed-out script) marks the Step failed and stops
  **its Lane only** — the other Lanes keep advancing to the end of the
  current Stage, then the barrier holds them. The container dot flips to
  `needs_attention` as soon as the Step fails; the run itself parks once
  nothing can move. The starting user recovers the Step in the thread (see
  In-thread recovery), **retries** it, or **skips** it — Retry and Skip
  render on the failed Step row (`retryStep`/`skipStep`, starting user
  only). Skipped Steps satisfy the stage barrier. Retry of a thread-run
  failure rides the in-thread message retry (failed assistant message
  deleted, prompt requeued, same thread); a Step whose prompt never landed —
  dispatch refusal or a deleted lane thread — resets to `pending` and
  re-dispatches, on a fresh lane thread when the old one is gone.
- Steps of a pinned version are otherwise immutable mid-run — skip is the
  only in-flight modification (prompt edits mid-run are v2).

### In-thread recovery

The thread is the Step: fixing the thread fixes the Step, with no extra
click. When the user acts on a failed lane thread — the message retry button
or a new prompt — the crossed seam re-runs the engine, which revives a Step
that failed for a *thread-run* failure whose thread has left `failed`: the
Step returns to `running` (same attempt, no new dispatch) and its thread's
next completed run finishes it as usual. The advance re-derives run status,
so a parked run returns to `running` as soon as any Lane can move again.

The recovery message is the fix, not steering, so it takes no Lane hold — a
Lane whose head Step is `failed` never holds, whether the run parked (single
lane) or other Lanes kept it `running`. Once the Lane is moving again,
further manual messages hold it as usual: one message resumes, continued
typing means the user is steering.

Only `WORKFLOW_STEP_THREAD_FAILED` steps revive. Dispatch failures and
deleted lane threads have nothing to recover in-thread — the Step's prompt
never landed — so they un-park only through the Run view's explicit
Retry/Skip (see Step / run lifecycle).

Run status is a stored field re-derived by the orchestrator on every advance:
`running | needs_attention | completed | canceled`. The run parks as
`needs_attention` only when nothing can advance without the starting user —
every Lane is stopped on a wait Step, a hold, a failed Step, or the stage
barrier behind one of those. The container dot shows `needs_attention`
earlier, matching thread-group semantics: as soon as any Lane waits on the
user (question, blocking hold, wait Step, failed Step), even while other
Lanes keep running. The run completes when every Step of the final Stage is
completed or skipped.

### Wait steps

A wait Step reaching the front of its Lane blocks it until the starting user
approves — the Lane stops, the stage barrier holds behind it, and the run
parks once nothing else can move. The wait renders in two places:

- **In the Lane's thread**: the engine parks the idle lane thread as
  `waiting_input` (the same amber bucket as an agent question) and an
  approval card renders above the composer — the wait Step's title plus an
  Approve button, in the editor wait card's amber styling. A held bash Step
  also shows the pinned script and timeout (the Run view step item carries
  `script`), on the card and on the Run view row alike — the approver reads
  what they authorize, not the editor's mutable draft.
  **Steer-then-approve**: the user may keep sending normal messages instead;
  each runs as an ordinary turn (no Lane hold, no Step stamp — the head Step
  is `waiting`, not `running`), the card hides while the turn runs, and
  comes back once it settles, whatever the outcome: the card keys off the
  waiting head plus an idle thread, so a steer turn that failed or was
  stopped keeps its `failed` state (park only flips `completed` threads) and
  still shows the card. Only Approve (`approveStep`, starting user only)
  completes the Step; the rescheduled advance un-parks the thread and
  dispatches the Lane's next Step.
- **On the Run view's step row**: the same Approve, so the wait is
  actionable from the Workflow tab too.

The waiting Step carries its Lane's `threadId` (row link, card lookup). The
version cut guarantees a wait is never a Lane's first Step, but a Lane can
still reach one threadless — every earlier step skipped after a dispatch
refusal, or any wait in a Parallel lane, which owns no thread — and then only
the Run view's Approve renders; there is no thread to park. The park is
**stored**, never inferred: the engine stamps
`waitParkedAt` on the Lane when it parks an idle `completed` thread under a
`waiting` head, and un-parks (back to `completed`) only when its own marker
is set — cleared in the same pass. The cli domain produces idle
`waiting_input` for its own reasons (agent question tools, parked
wind-downs), and pattern-matching the status would clobber those; a
`running` head's `waiting_input` is likewise a real agent question and is
left alone.

### Bash steps

A bash Step is a thread run with no agent in it (OS-1886). Dispatch inserts a
user message into the Lane's thread — the script text as its visible content,
stamped with the Step, carrying a `scriptRequest` (`script`, `timeoutMs`)
the same way `runtimeCommand` marks a solo command. A single Lane whose first
executable Step is bash creates its thread here — at the approval hold when
its mode holds, else at dispatch — so the run's worktree is in place before
the first script (the CLI creates a pending worktree before any run). The CLI
claims the message like any run but hands it to its script runner instead of
the agent runtime: `bash -c` in the run's working directory, stdout/stderr
streamed as `convoy_script_output` chunks (rendered as text whatever runtime
the thread has), killed at the Step's timeout or by Stop. The agent session is
untouched — no continuation id is read or written, and the continuation lookup
skips assistant rows carrying a `scriptResult`, so the model never sees the
script as a turn and the next agent turn resumes where the agent left off.
`complete` carries a `scriptResult` (`exitCode`, `timedOut`, and the last
8,000 characters of output) onto the assistant message.

- **Approval gate.** Before dispatch the engine checks a single Lane's
  resolved mode. `agent` (Act) dispatches at once; any other mode marks the
  Step `waiting` exactly like a wait Step: the Run view row and the
  in-thread card show Approve with the pinned script and timeout, the
  Lane's idle thread is wait-parked, the run parks once nothing else moves.
  Approve (`approveStep`) stamps `approvedAt` and returns the Step to
  `pending`; the rescheduled advance dispatches the script. A retry keeps
  the approval. A held first Step has no Lane thread to park, so the gate
  creates one before marking the Step waiting (OS-1920): an empty thread,
  idle and `completed`, named from Workflow + Lane, a child of the container,
  stamped on the Lane — the same advance wait-parks it, and the user lands in
  a real thread whose wait card carries Approve; the script bubble is its
  first message. The transcript above the card is deliberately blank — no
  empty-state copy: the card already says what the thread is waiting for,
  and a steer message fills it like any other thread. A dispatch the cli
  domain refuses — a removed profile (`sendForWorkflowStep` rechecks it, so a
  profile removed during the hold fails the Step on Approve rather than
  queueing a message no CLI will claim), revoked access — fails the Step
  like any refused dispatch. Lanes that never hold stay lazy. A Parallel
  lane has no mode and its bash Steps run unprompted: the lane is the
  automated part of the run, and a per-Step approval knob is deferred until
  someone needs it.
- **Settle** (`settleScriptRun`): when the script run's thread completes and
  the Step's current user message is a script request, the engine reads the
  run's `scriptResult` and applies `reportOutput`. A non-zero exit, a
  timeout, or a missing result is the failure. `stop_on_failure` marks the
  Step failed (`workflowStepScriptExited(code)`,
  `WORKFLOW_STEP_SCRIPT_TIMED_OUT`) — the existing Retry/Skip flow; Retry
  re-runs the script in the same Lane thread. `on_failure` on a failure, and
  `always` regardless, send the outcome, the script itself (the agent never
  saw the request turn), and the output tail to the Lane's agent
  as a user message from the starting user (stamped with the Step, so the
  Step's `userMessageId` now points at the report) and the Step stays
  `running` until that agent turn completes — the Lane's next Step runs after
  the agent has reacted. A passing `on_failure` script completes silently.
  The full output stays in the transcript under every mode.
- **Older CLIs.** A CLI from before 0.55.0 would prompt its agent with the
  script text, so `MIN_SUPPORTED_CLI_VERSION` is 0.55.0 and registration
  refuses anything older (`cli-minimum-version.md`). No per-session
  capability flag: a session that registered is one that runs scripts.

### Lane hold (user interference)

Any manual user message sent into a run's thread flips that Lane to **held**,
except an answer to the active Step after `waiting_input` — a message sent
while the lane thread waits for input is stamped with the Step running in
that thread (`workflowRunStepId` on the message) and counts as the answer:

- The currently running Step still finishes normally.
- The run sends no further Steps into that Lane until the starting user
  explicitly resumes it (resume can be issued even while the manual message
  is still streaming — the continuation queues). Resume renders on the
  **blocked Step row** — the held Lane's next pending Step, marked `held` in
  the run detail — so each held Lane resumes individually (`resumeLane`
  clears the hold and reschedules the advance, which re-derives run status).
  A held Lane with no pending Steps left blocks nothing, so no Resume shows.
- Other Lanes keep advancing; a hold blocks only the stage barrier via its
  own unfinished Steps. The container dot flips to `needs_attention` as soon
  as the hold blocks a dispatch; the run parks only once no Lane can move.
- Whether a message holds is decided per Lane, by the Step running in the
  thread the message entered (a Parallel lane runs several; a single Lane's
  is its head): a `failed` Step takes a recovery message (see In-thread
  recovery), a `waiting` one has its own Approve (see Wait steps) — neither
  is steering, so neither holds. The same Step gets the `waiting_input`
  answer stamp. A Parallel-lane one-shot carries its Step from creation
  (`workflowRunStepId` on the thread); once that Step finishes, the thread
  serves none — a later message in it stamps no Step but still holds, since
  it steers the run's shared checkout. Every other Lane of a live run takes
  holds as usual, parked
  run or not: steering a healthy Lane waiting at the barrier is still
  steering.

### Who acts on a run

Only the **starting user** approves wait Steps, resumes held Lanes and
failed Steps, and cancels the run. (Threads are user-scoped; teammates can't
read the run's threads anyway. Configurable reviewers are v2.)

### Cancel

Cancel stops all advancement: in-flight Steps flip to `canceled`, and every
run thread — a single Lane's, and each Parallel-lane Step's — gets the
existing cancel-processing (Stop) treatment through an internal cli
boundary — a streaming agent is stopped, a queued step message
is stamped into a stopped run, an idle thread no-ops, and a wait-parked
thread (its Lane's `waitParkedAt` is set) is un-parked back to `completed`
instead (nothing runs in it). The cancel commits terminal state in its own
transaction; the stop treatment then runs in scheduled batches of 10
threads (`STOP_THREADS_BATCH`), so a long run's accumulated threads can
never roll the cancel itself back. Threads survive as normal threads.
Canceled runs cannot be resumed. `cancelWorkflowRun` is shared with workflow soft
delete, which cancels the workflow's active runs across all starters (see
Versioning) — the acting user is stamped on the resulting `thread.failed`
events, so a teammate's delete still notifies the starter whose threads it
stopped.

## UI

- A "Workflows" project section lists definitions and their runs.
- The workflow's optional color (an identity field, agent-palette values
  only) tints the workflow glyph wherever one identifies a workflow: the
  Workflows list rows, thread-list run rows (both layouts), and the
  composer's workflow selector (rows and the armed trigger). No color →
  the glyph stays muted. Run rows resolve the identity live (run →
  workflow), so a rename or color edit shows on existing runs; the row's
  glyph names the workflow on hover and links to its editor (a real
  anchor, so middle click opens a new tab). A run whose workflow no longer
  resolves keeps a plain, unlinked glyph (OS-1875). The glyph marks the run's
  container row only — a lane thread carries `workflowRunId` too, but badging
  it would show one run twice with no distinction (OS-1879).
- Editor: the Stage × Lane grid per the design mock (add Stage row, add Lane
  column, step cards with type + override pills). Authorable today
  (through OS-1813): identity fields, Lane/Stage structure, all three Step
  types with their config dialogs, drag-and-drop of step cards, and Lane
  settings (name, single/parallel type, single-Lane defaults) with the
  Lane override rules applied in the editor and at Save, and an
  unsaved-changes guard on leaving — detailed behavior in
  `project-settings.md` → Workflows. Not yet built: version history and
  revert, run start and monitoring (OS-1366).
- Run detail: the same grid rendered live — per-Step status, links into each
  Lane's thread.

### Threads page integration

A run with many threads must not flood the thread list:

- **Collapsed run item**: the run-start mutation creates a **container
  thread** (`kind: "group"` with `workflowRunId` set — the same mechanic as
  Thread groups, see `thread-groups.md`); every run-created thread is its
  child via `parentThreadId` and is thereby excluded from the flat list,
  which is one paginated `cliThreads` query with no merging. The container
  renders as a normal group row: title = Workflow name, status dot = the
  container's denormalized `aggregateStatus` mirroring run status, sorted by
  the container's `lastActivityAt`, bumped on any child activity. The
  threads remain normal threads everywhere else (task attachments, direct
  links). Run containers are never shareable and never auto-delete. Workflow
  threads stay attached; manual children may be moved out.
- **Run view**: the run's progress panel lists the run's **Steps grouped by
  Stage** (step title/prompt excerpt, type, live status, lane name with the
  prompt step's resolved runtime — CLI icon, model, and effort; a step with
  no runtime shows the lane name alone, no separator). A run started with a
  Kickoff step (see Start) shows it as a "Kickoff" stage ahead of the
  version's stages. A row whose Step has a thread is one stretched link
  covering the whole card — glyph, controls, and a held script included —
  so hover highlights and clicks land on the row, not on the title alone;
  the controls sit above the link as siblings, never inside the anchor. While
  the run has no Lane threads yet (they are created lazily), opening the
  container renders the Run view and an add-thread action as the detail pane.
  Once children exist it resolves to a child tab like any group, unless a
  manual composer is still open. Every child, including manual threads,
  carries the Run view as a **Workflow** tab in its detail sidebar —
  so cancel stays reachable for the run's whole lifetime.
  The tab is there from the first paint after the container's redirect: the
  container doc already names the run, so the tab does not wait for the
  child's own doc (OS-2067).
- **Controls live in the Run view**: Cancel in its header, behind a
  confirmation dialog since a canceled run cannot be resumed; Step-level
  interventions on the step rows themselves (Resume on a held lane's blocked
  step, Retry/Skip on a failed step, Approve on a waiting step — the latter
  doubled by the in-thread wait card, see Wait steps).
  The threads page is the primary surface for babysitting a run; the
  Workflows section holds definitions and run history.
- **Run rail** (OS-1368; `/playground/workflow-run-rail` previews it on
  mock data): every run-bound thread also docks a collapsed column of Step
  dots at its transcript's right edge — filled for finished, spinner for
  running, dimmed for not started, amber for anything that needs the
  starting user (waiting, held), red for failed; stages separate by a gap.
  The column is height-capped and centers the live Step, fading the dots
  that overflow either edge. Hover (after a short delay, so a passing
  cursor never opens it) expands it into a bordered panel. The collapsed
  rail shows only step dots, with no separate expand icon. The dot column
  is a native button: click or tap it, or focus it with Tab and press Enter
  or Space to pin the panel open. Activation moves focus to the expanded
  header's Pin/Unpin toggle, which exposes its pressed state. Hover expansion
  also preserves focus when the dot column was focused. An unpinned panel
  stays open while hovered or while keyboard focus remains inside it. Escape
  within the rail closes it, clears pending hover expansion, and returns focus
  to the dot column if focus was inside the panel. Escape in a confirmation
  dialog belongs to that dialog. Step links become available in the expanded
  panel. The panel shows Stage labels, Step titles,
  runtime and lane, and the Run
  view's controls — Cancel behind the same confirmation, through the
  shared `useWorkflowRunActions`. Rows of other threads link there; the
  open thread's own rows say "this thread" and stay put. It reads the same
  run detail query as the Workflow tab, stays for the run's whole lifetime
  (read-only once terminal), hides below the `lg` breakpoint where it would
  overlap the transcript, and is an addon to the Run view, not its
  replacement.

### CLI

`convoy workflows` manages definitions from the terminal (OS-1915) so an
agent or a script can author and drive a Workflow without the editor.
Landed: `list` (project summaries) and `get` (the stored record; its
`draftDefinition` is the update payload, so get → edit → update round-trips)
(OS-1927); `create`, `update`, and `delete` (OS-1928). `--definition-file`
takes a bare definition or a `get` dump, so no unwrapping step is needed;
`create --from` copies another Workflow's draft. Delete goes through the same
soft-delete mutation as the UI, so it cancels active runs. `validate`
(OS-1929) dry-runs the version-cut checks through the `validate` query
(`workflow-data-schema.md` → Save and version cut) on the stored draft or a
file, and `create`/`update --validate` run it right after saving. `start`
(OS-1930) calls the same `start` mutation as the composer with an explicit
profile + path, an optional new worktree, an attached Task, and the first-prompt
override (see Start); the definition owns runtime/model/mode, so it takes no
`--cli-type`. `runs` (OS-1931) mirrors the Run view's controls one-to-one:
`list`, `get`, `cancel` (confirmed unless `--yes`), `approve`/`retry`/`skip`
by run-step id, and `resume --lane`; each calls the same mutation as the
button, so the starting-user gate and status checks live only in the backend.
Lane, Stage, and Step ids are plain unique strings, so hand-written files
may use readable ids.

The CLI authenticates with an API key, not a session: every public function
in `workflows/core.ts` and `workflows/runs/core.ts` takes an optional `apiKey`
and authorizes with the key's principal, so a project-scoped key reaches only
its own projects' Workflows and runs. The starting-user gate on run controls
applies to the key's user. A failed verdict exits non-zero in every output
mode, and `--output json` always prints exactly one JSON object —
`create`/`update --validate` carry the verdict as `validation`.

## Out of scope for v1

- Per-lane worktrees (e.g. N lanes exploring N variants) — the run has one
  shared checkout; worktree-per-lane is an anticipated v2 direction.
- Deterministic task-action steps; other action step types listed above.
- Editing pending Step prompts mid-run.
- Named run variables / template engine (only the first prompt is editable
  at start).
- Org-level Workflow templates (mirroring Agent → Project agent) and
  personal Workflows.
- Reviewer routing for wait Steps; any non-starting-user control of a run.
- Triggers other than manual start (schedules, assignment, webhooks — see
  `agent-execution-v2-discussion.md`).

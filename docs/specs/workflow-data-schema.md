# Workflow Data Schema

Status: the `workflows` table and the full definition validator tree
(`convex/lib/contracts/workflowDefinition.ts`) are implemented with
identity CRUD (OS-1809), draft-definition saves with structural
validation (OS-1810), Wait/Bash/Prompt Step editing (OS-1811, OS-1812),
and Lane settings with override normalization (OS-1813).
`workflowVersions`, `latestVersionId`, the version cut, and the run tree
are implemented with run start/cancel (OS-1867); the engine — scheduled
advance, lazy lane threads, prompt dispatch — landed with OS-1868.
Workflow `color` is constrained to the shared agent palette, not free-form.

This is the persistence source of truth for Workflows. `?` means optional.
Types are expanded on their first appearance and reused afterward.

## Core decision

- A Workflow stores its one freely editable **draft definition**. The
  editor's explicit Save updates the draft and sets
  `dirtySinceLastVersion: true`. Saves never create versions.
- Versions are cut only at run start: if the flag is clear and a latest
  version exists, the run pins it; otherwise the draft is copied into a new
  immutable `workflowVersions` row, the flag is cleared, and the run pins the
  copy. No hashing or deep comparison — the flag is the change detector.
- Existing versions are never mutated. Version history is exactly the
  definitions that have run.
- Later Saves affect only later runs. Existing runs stay pinned.
- Definitions are nested because they are edited and validated together.
- Mutable run Lane and Step state is normalized because Lanes run concurrently.

See ADR 0006.

## Definition tree

```text
workflow
    _id: Id<"workflows">
    projectId: Id<"projects">
    name: string
    description?: string
    category?: string
    color?: string
    dirtySinceLastVersion: boolean
    latestVersionId?: Id<"workflowVersions">
    createdBy: Id<"users">
    updatedBy: Id<"users">
    createdAt: number
    updatedAt: number
    isDeleted: boolean
    deletedAt?: number
    deletedBy?: Id<"users">

    draftDefinition: WorkflowDefinition
        runInNewWorktree?: boolean
        lanes[]: LaneDefinition
            laneId: string
            name: string
            type: "single" | "parallel"
            defaults?: LaneRuntimeDefaults
                cliType: CliType
                cliModel?: CliModel
                cliEffort?: CliEffort
                mode?: string
                projectAgentId?: Id<"projectAgents">

        stages[]: StageDefinition
            stageId: string
            name: string

            steps[]: WorkflowStep
                stepId: string
                laneId: string
                name?: string

                action: StepAction
                    prompt:
                        type: "prompt"
                        content: ComposerContent
                            displayContent: string
                            composerDocument?: SlashCommandComposerDocument
                        overrides?: StepOverrides
                            projectAgentId?: Id<"projectAgents">
                            cliType?: CliType
                            cliModel?: CliModel
                            cliEffort?: CliEffort
                            mode?: string

                    wait:
                        type: "wait"

                    bash:
                        type: "bash"
                        script: string
                        timeoutMs: number
                        reportOutput: "always" | "on_failure" | "stop_on_failure"

workflowVersion
    _id: Id<"workflowVersions">
    workflowId: Id<"workflows">
    projectId: Id<"projects">
    versionNumber: number
    definition: WorkflowDefinition
    createdBy: Id<"users">
    createdAt: number
```

`laneId`, `stageId`, and `stepId` are stable UUID strings scoped to the
definition, not Convex document IDs. They survive copying and reordering when
the logical item still exists.

`name`, `description`, `category`, and `color` live on the Workflow identity
(mirroring Project agents), not inside the definition: the Workflows list and
the collapsed run item render titles without a version join, and renaming
does not create a version. The soft-deleted Workflow row remains readable, so
historical runs keep their title.

`defaults` applies to single Lanes only: a single Lane maps to one thread
per run, so the Lane stores everything that thread needs at start (runtime,
model, effort, mode, optional Project agent). A Parallel Lane stores no
defaults — each of its executable Steps starts its own thread and carries
its own settings via Step overrides.

`reportOutput` decides what a run does with a Bash Step's result.
`on_failure` (the default) posts the script's output into the Lane's thread
only when the script fails, so green checks stay out of the conversation;
`always` posts it either way. Under both, the Lane continues — the agent
decides what a failure means. `stop_on_failure` addresses nothing to the
agent: non-zero exit or timeout marks the Step failed and halts the Lane
for the starting user, the existing failed-Step retry/skip flow. The
transcript chunks are written in every case. In a Parallel Lane only
`stop_on_failure` is legal — a one-shot thread has no agent to report to —
so Save normalizes the other two values to it (like it drops a parallel
Lane's `defaults`) and the version cut rejects any that slipped past.
Execution mechanics: docs/specs/workflows.md → Bash steps.

`runInNewWorktree` marks that runs of this Workflow should execute in a
fresh worktree: selecting the Workflow in the composer preselects a new
worktree, named from the attached Task's ref (e.g. `abc-123`) when present,
falling back to a prompt-derived name with a short run suffix (repeat runs
must not collide on the branch); the selection stays editable and the
resolved spec is stored in `workspace.worktree` as usual.

Array order is authoritative: `lanes[]` is column order, `stages[]` is Stage
execution order, and `steps[]` is card layout order within a Stage. Execution
order remains Lane sequence plus Stage barriers. Prompt content reuses the
existing structured composer contract so Slash command references survive
until normal send-time expansion.

## Save and version cut

The Save mutation (the identity `update` with an optional `definition` — the
editor has one Save button, so identity and definition persist atomically):

1. Authenticates and requires project task-write access.
2. Validates structure and size limits only (see below) — beyond one Lane
   and one Stage, a half-built Workflow is a legal draft, so Save never
   blocks work in progress.
3. Patches `draftDefinition` and sets `dirtySinceLastVersion: true` **only
   when the definition actually changed**, compared server-side against the
   stored draft (key order and absent-vs-`undefined` don't count; array order
   does). The editor re-sends every field on every save, so a rename-only
   save leaves the flag clear. A fully unchanged save skips the patch —
   `updatedAt` doesn't move.

Creating a Workflow inserts the identity with its draft, `dirtySinceLastVersion:
true`, and no versions; `latestVersionId` stays unset until the first run.
`definition` is required on create and validated the same way, so no Workflow
is ever stored without a Lane and a Stage. Rows from before the grid editor
shipped can still hold an empty draft; the editor seeds a Lane and Stage when
it opens one.

The version cut happens inside the run-start mutation:

1. If `dirtySinceLastVersion` is false and `latestVersionId` is set, the run
   pins `latestVersionId`. Done — nothing is created or compared.
2. Otherwise the draft must pass full validation (below); the mutation
   inserts one immutable `workflowVersions` row with `versionNumber` = the
   latest version's number + 1 (or 1), patches `latestVersionId`, clears the
   flag, and pins the new version.

Convex transaction retries serialize concurrent edits and run starts, so the
flag and version numbers cannot race.

Save validates structure and limits
(`convex/workflows/lib/invariants.ts`):

- at least one Lane and one Stage — an empty grid is not a Workflow;
- unique Lane and Stage IDs; Step IDs unique within their Stage (reuse
  across Stages is legal);
- every Step references a Lane in the same definition;
- counts: at most 12 Lanes, 50 Stages, and 50 Steps per Stage;
- per-field caps that exist only to fail early with a specific message
  instead of a baffling aggregate failure — they are not independent guards
  and are not sized to sum to the aggregate cap: Bash scripts and Prompt
  `displayContent` ≤ 32,000 characters each. The Bash cap is also a
  `maxLength` on the editor's textarea; the prompt cap is server-only (the
  composer has no length prop), surfacing as a Save error toast without
  losing the draft;
- one binding size cap: the JSON-serialized definition stays ≤ 256,000
  characters. The cap counts UTF-16 code units (`String#length`), not bytes —
  a CJK-heavy definition at the cap is ~768 KB of UTF-8, still under Convex's
  1 MB document limit but without 4× headroom; don't raise the cap assuming
  bytes.

Save also normalizes the definition on the way to storage: Lane, Stage, and
Step names are whitespace-trimmed (Step names: empty → unset), a Prompt
`composerDocument` with no refs is dropped, a parallel Lane's `defaults` are
dropped, a single Lane without `defaults` gets the app default runtime
pinned (the editor header already displays that fallback, so the stored
draft runs as shown rather than failing the cut with a runtime error the
editor gives no way to see), and a single Lane's Step overrides are reduced
to `mode`. The defaults moves apply the Lane override rules (below) as
normalization, not a Save error, so a Lane-type flip never makes a draft
unsaveable; the version cut still validates them. Normalization runs before
the changed-definition comparison, so a whitespace-only rename or an empty
composer shell does not set the dirty flag.

The version cut re-normalizes the stored draft before validating and
pinning — a no-op for anything Save stored, but drafts saved before a
normalization rule existed still cut without a migration.

Bash `timeoutMs` and `reportOutput` are required in the stored shape and on
the wire; the defaults (10 minutes, `on_failure`) are the editor's job — the
server neither defaults nor bounds them on Save. Non-UI callers must send
complete Bash actions.

Other string lengths inside the definition (Lane/Stage/Step names) and Bash
timeout bounds are deliberately not validated on Save — they are enforced at
the version cut, where full validation runs. Save does normalize a Parallel
Lane's Bash `reportOutput` to `stop_on_failure` (see above).

Full validation at version cut (run start) additionally requires:

- non-empty Stage and Lane names (the Workflow name is validated on the
  identity mutations, not per version);
- at least one Step per Stage;
- every single Lane defines `defaults.cliType` (normalization pins the app
  default, so this only rejects data written past Save); every Parallel-Lane
  Prompt Step carries a `cliType` in its overrides, and those overrides meet
  the same model/effort/agent checks as Lane defaults;
- referenced Project agents are active and belong to the project;
- Bash timeouts between 1 second and 6 hours (`MIN_/MAX_WORKFLOW_BASH_TIMEOUT_MS`),
  and `stop_on_failure` on every Parallel-Lane Bash Step;
- runtime/model/effort/mode compatibility through the runtime subsystem; and
- the Lane override rules below.

Validation failures at run start surface as an error on the starting
composer; nothing is created.

The same checks are exposed as a read-only `validate` query (stored draft,
or a supplied definition checked in the Workflow's project) that returns
the first failing rule instead of throwing, so the CLI can report a draft
as not runnable without starting anything (OS-1929).

## Version history

- The editor loads and edits `draftDefinition`.
- Version history lists by `workflowId` and `versionNumber` — exactly the
  definitions that have run.
- Old versions are read-only. **Revert** (planned, not v1): copy an old
  version's definition into the draft and set `dirtySinceLastVersion` — the
  schema already supports it with no changes.
- Versions are never edited or deleted. They remain after Workflow soft
  deletion so run history is readable.
- Deleting a Workflow cancels active runs but preserves versions and runs.

## Run tree

```text
workflowRun
    _id: Id<"workflowRuns">
    workflowId: Id<"workflows">
    workflowVersionId: Id<"workflowVersions">
    projectId: Id<"projects">
    startedBy: Id<"users">
    attachedTaskId?: Id<"tasks">

    selection: RunSelection
        profileId: Id<"cliProfiles">
        workspace: RunWorkspace
            pathId: string
            pathSnapshot: string
            worktree?: CliThreadWorktreeSpec

    status: "running" | "needs_attention" | "completed" | "canceled"
    startedAt: number
    lastActivityAt: number
    completedAt?: number
    canceledAt?: number

workflowRunLane
    _id: Id<"workflowRunLanes">
    runId: Id<"workflowRuns">
    laneId: string
    laneType: "single" | "parallel"
    laneOrder: number
    threadId?: Id<"cliThreads">
    hold?: LaneHold
        heldAt: number
        triggeringMessageId: Id<"cliMessages">
        resumeRequestedAt?: number
    waitParkedAt?: number    // engine holds the thread parked on a wait step
    completedAt?: number

workflowRunStep
    _id: Id<"workflowRunSteps">
    runId: Id<"workflowRuns">
    stageId: string
    laneId: string
    definitionStepId: string
    stageOrder: number
    laneOrder: number
    stepOrder: number

    promptOverride?: ComposerContent
    resolvedExecution?: ResolvedExecution
        projectAgentId?: Id<"projectAgents">
        cliType: CliType
        cliModel?: CliModel
        cliEffort?: CliEffort
        mode?: string

    status:
        "pending"
        | "running"
        | "waiting"
        | "completed"
        | "failed"
        | "skipped"
        | "canceled"
    threadId?: Id<"cliThreads">
    userMessageId?: Id<"cliMessages">
    assistantMessageId?: Id<"cliMessages">
    attemptCount: number
    errorMessage?: string
    startedAt?: number
    finishedAt?: number
```

Run start resolves the pinned version (reusing the latest or cutting a new
one per the version-cut rules above), creates the run, creates or binds its
container thread (`kind: "group"` with `workflowRunId` set; see
[workflows.md](workflows.md) → Start for the new-subthread flow), creates one
Lane row per version Lane, and creates one Step row
per version Step. Step rows carry
no copy of the definition — readers resolve a Step's prompt, script, and
overrides from the pinned version via `definitionStepId` (the version is
immutable, so the data cannot drift). The permitted first-prompt edit is the
one run-local exception, stored as that Step's `promptOverride`. When the
first Lane has no prompt Step, that edit is a Step row of its own — the
Kickoff step (`stageId`/`definitionStepId: "kickoff"`, `stageOrder: -1`), whose
prompt is its `promptOverride`; resolution synthesizes its definition
(workflows.md → Start). Lane defaults and Step overrides are resolved into
`resolvedExecution` at this boundary.

There is no per-Lane "active step" pointer: active work is derived from Step
status, since a Parallel Lane legitimately has several `running` Steps at
once.

Retrying a failed Step (`retryStep`) has two shapes. A thread-run failure
rides the existing run-retry invariant: the failed assistant message is
deleted and the same prompt message requeued — message ids unchanged, and
the revived Step keeps its attempt. A Step whose prompt never landed
(dispatch refusal, deleted lane thread) resets to `pending` and
re-dispatches: `threadId`/`userMessageId` re-point at the new dispatch and
`attemptCount` increments, on a fresh lane thread when the old one is gone.

A `waiting` Step carries its Lane's `threadId` too — the Run view row links
there and the in-thread wait card resolves its Step through it (docs/specs/
workflows.md → Wait steps); it stays unset when the Lane has no thread yet.

`projectId` is denormalized onto versions and runs for indexed permission and
project queries after soft deletion. `pathSnapshot` preserves context if a
profile path is later renamed or removed.

Separate run Step rows hold orchestration state, retries, failures, message
links, and the first-prompt override without rewriting a large run document
when parallel Lanes finish together.

## Existing CLI additions

```text
cliThread
    existing fields...
    kind?: "group"                       // absent = plain chat thread (no migration)
    parentThreadId?: Id<"cliThreads">    // set on every child thread of a container
    aggregateStatus?: "running" | "needs_attention" | "failed" | "idle"
    childCount?: number                  // containers only
    hasUnreadChildren?: boolean          // containers only (OS-1475)
    hasAttentionChildren?: boolean       // containers only (OS-1475)
    originBranch?: string                // containers only (OS-1476): oldest live child's branch
    workflowRunId?: Id<"workflowRuns">
    workflowLaneId?: string
    workflowRunStepId?: Id<"workflowRunSteps">

cliMessage
    existing fields...
    workflowRunStepId?: Id<"workflowRunSteps">
    request?: CliRequest
        agent:
            type: "agent"
        bash:
            type: "bash"
            script: string
            timeoutMs: number
```

An absent `cliMessage.request` retains legacy agent-message behavior. A single
Lane thread has a run and Lane ID but no permanent Step ID because it serves
many Steps. A Parallel Lane thread also has a Step ID because it serves one.

`kind` and `parentThreadId` implement **container threads** (see
`thread-groups.md`): a container is a `cliThreads` row with no transcript of
its own that represents many threads as one thread-list item. Every container
is a `kind: "group"` row; the run's list item is a group with `workflowRunId`
set, created or bound by the run-start mutation together with the run (OS-1867 — a
separate `"workflowRun"` kind was dropped so run containers inherit the whole
group UI instead of forking it). Every child thread sets `parentThreadId` to
its container; run-created Lane threads are children of the run's container.
One nesting level — a child is never a container.

The flat thread list therefore needs no merging and no second source:
containers and plain threads are rows in the same table, so one paginated
query serves the list. `.filter()` is forbidden, so child exclusion is
index-backed: the list index gains `parentThreadId` immediately before the
sort field — `by_user_project_deleted_parent_lastActivity`
(`["userId", "projectId", "isDeleted", "parentThreadId",
"lastActivityAt"]`) — and the flat list queries
`eq("parentThreadId", undefined)`. Legacy threads have the field unset, so
they match without a migration.

Containers denormalize `aggregateStatus`, `childCount`, the child
unread/attention aggregates `hasUnreadChildren`/`hasAttentionChildren`
(OS-1475), and `originBranch` (OS-1476) so the list renders without per-row
child queries. `aggregateStatus` precedence (OS-1476 Group status): any child
failed → `failed`; else any child `waiting_input` or held →
`needs_attention`; else any child streaming or pending → `running`; else
`idle`. Run containers mirror `workflowRun.status` instead of the child fold
(running → `running`, needs_attention → `needs_attention`, terminal →
`idle`), written by the runs domain at its own seams; the child-fold recompute
skips them. One refinement on a `running` run: the engine's advance mirrors
`needs_attention` while any Lane waits on the user — an in-flight step's
thread in the `waiting_input` watch bucket (question, approval, held queue),
a failed or waiting step, or a hold blocking a dispatch — so the list dot
matches thread-group semantics even though the run is not parked. It is
recomputed — and the container's `lastActivityAt` bumped — in the same
`cliThreadsRepo` write-seam transaction that updates the child thread.

Deleting a container cascades to its children ("children follow");
cascades never promote children. The explicit **move out** action
(unset `parentThreadId`, container auto-deleted when the last child is moved
out or deleted) exists for plain groups only — run children can never be
moved out, and a run's container never auto-deletes: it exists before its
lazily-created Lane threads do. See `thread-groups.md`.

Workflow-dispatched user messages carry `workflowRunStepId`; a user's
`waiting_input` answer gains the same stamp at send (→ the Lane hold
paragraph below). The thread lifecycle write seams (stream end, claim reset, retry
requeue) schedule the run engine rather than updating Steps in their own
transaction: `ctx.scheduler.runAfter(0, …)` is transactional, so the reaction
is durable with no polling, and the engine re-derives Step and run state from
the lane thread's current status — idempotent under concurrent Lane
completions (docs/specs/workflows.md → Orchestration).

Task thread summaries add:

```text
AgentThreadWorkSource
    "assignment_automation"
    | "manual_attachment"
    | "workflow_run"
```

All run-created threads use the run's optional `attachedTaskId` as their
existing `associatedTaskId`.

## Lane and override rules

CLI thread Project-agent binding and CLI runtime are immutable. Therefore:

- A single Lane stores its thread's start settings as Lane `defaults`
  (runtime, model, effort, mode, at most one `projectAgentId`).
- Single-Lane Steps cannot override Project agent, `cliType`, model, or
  effort — the Lane is the thread, and its settings are chosen once, on the
  Lane. A Prompt Step there is a follow-up message in that thread.
- Single-Lane Steps may override mode (act/plan), the one per-message
  setting; unset inherits the Lane default.
- Parallel-Lane Steps may override Project agent, runtime, model, effort, and
  mode because each executable Step gets a fresh thread. There are no Lane
  defaults to inherit — each Step's overrides are its settings.

A single Lane creates its thread lazily for its first executable Prompt or
Bash Step — for a Bash Step held for approval, at the hold, with no message
yet (OS-1920). A Wait Step needs no thread. This resolves the case where Bash
is the Lane's first executable Step.

When a runtime returns `waiting_input`, the user's in-thread answer continues
the Step and does not create a Lane hold — the answer is stamped with the
Step running in that thread (`workflowRunStepId`) at send: a Parallel-Lane
one-shot's own stored Step, a single Lane's head. A finished one-shot serves
no Step, so a later message in it stamps none. Beyond that, the hold is
decided **per Lane**, by the same thread-step rule
(`holdLaneForManualMessage`): a thread step that is `failed` (recovery,
docs/specs/workflows.md → In-thread recovery) or `waiting` (own Approve,
docs/specs/workflows.md → Wait steps) takes no hold; any other manual
message into a run thread of a non-terminal run — including one serving no
Step, which still steers the run's shared checkout — writes `lane.hold`
(`cli/messages.ts` `send`) — a parked
run's healthy Lanes still take holds. The engine dispatches nothing further
into a held Lane (other Lanes keep advancing; the run parks once no Lane can
move), and the starting user's Resume action (`workflows/runs/core.ts`
`resumeLane`, rendered on the blocked step row via the run detail's `held`
flag — a held Parallel Lane flags only the first of its blocked Steps, one
Resume per Lane) clears the hold and reschedules the advance.

## Indexes

```text
workflows
    by_project_and_isDeleted_and_updatedAt

workflowVersions
    by_workflow_and_versionNumber

workflowRuns
    by_project_and_status_and_lastActivityAt
    by_workflow_and_startedBy_and_startedAt

workflowRunLanes
    by_run_and_laneId

workflowRunSteps
    by_run_and_stageOrder_and_laneOrder_and_stepOrder

cliThreads
    by_workflowRunId
    by_parentThreadId
```

The engine reads a run's Steps whole (bounded by the definition caps), so
per-Lane and per-status Step indexes, a per-Lane thread index and a Step to
message index were dropped as unread (2026-11-24). Add one with its first reader.

Application mutations enforce uniqueness of `(workflowId, versionNumber)` and
`(runId, laneId)`; Convex indexes are not database-level unique constraints.

## Why this split

The definition is one cohesive value: it is edited, validated, copied, and
versioned together. Separate Stage/Lane/Step definition tables would permit
partial states and make history difficult to load.

Runtime state has the opposite access pattern. Lanes complete concurrently,
Steps retry independently, and the Run view subscribes to live status.
Separate Lane and Step rows reduce write contention and keep those updates
small.

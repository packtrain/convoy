# Agent Assignment Automation

Tracking tasks: OS-1094 (v1), OS-1131 (auto-submit), OS-1335 (delegation
trigger).

## Scope

This document defines v1 assignment automation for Project agents and the
task-level `agentThreadWork` visibility that comes with it:

- The Automation section of project-agent configuration.
- The composer-first flow triggered by delegating a task to an
  automation-enabled agent in the web UI.
- The `agentThreadWork` table (one row per task-linked thread), its
  lifecycle sync, and its task list / board / sidebar indicators.

Since the assignee/delegation split (OS-1335, see `agents.md`), the trigger
is DELEGATION — an interactive change of the task's `delegatedToAgentId` —
not assignment: changing the human owner (`assigneeId`) never triggers
automation.

Related specs: `agents.md` (Project agents, assignee/delegation split),
`cli-thread-task-attachments.md` (task ↔ thread association),
`slash-commands.md` (composer refs + expansion), `cli-thread-drafts.md`
(composer draft defaults), `mcp-server.md` (MCP `automation` params),
`cli-thread-agents.md` (thread agent binding + agent prompt delivery,
OS-1138).

## Automation Config

Each Project agent has an optional `automation` config:

- `enabled`: whether web-UI delegation offers to start a thread.
- `prompt`: composer content — `displayContent` (text with slash-command
  markdown links) plus optional `composerDocument` refs. Saving preserves refs
  unexpanded; expansion happens only through the normal thread create/send
  path when the user sends.
- `cliType`: preferred CLI runtime, one of the existing runtime registry
  slugs (no separate hardcoded union). The agent form always persists the
  runtime its pill displays, so a config that sets a model/effort also sets the
  runtime they belong to (OS-1512). Runtime and model/effort selections made
  by one menu interaction are applied atomically from the user's perspective:
  the model/effort callback must retain the runtime selected earlier in that
  interaction rather than restoring the previous render's runtime.
- `cliModel` / `cliEffort`: preferred model and reasoning-effort level.
- `mode`: preferred CLI mode string for that runtime.
- `workspace`: `"local"` or `"worktree"` — whether the automation thread
  prefers the selected checkout as-is or a new worktree based on the repo's
  default branch.

### Composer seed (single source of truth)

Every surface that preselects composer pills from an automation config — the
composer's Agent pill (`buildProjectAgentDraftPatch`), the delegation composer
dialog, and the headless auto-submit path — derives them from one helper,
`buildAutomationDraftSeed` in `apps/web/lib/threads/draft-flow.ts`. Deselecting
an agent reverts its unedited seeds by comparing against that same helper, so
seed and revert cannot drift apart (OS-1512).

Rules the seed applies:

- `cliModel`/`cliEffort` are seeded whenever the config stores them, independent
  of whether it also stores a `cliType`. Nesting them under `cliType` previously
  made a model-only config fall through to the user's remembered last-used
  model.
- Model slots are runtime-scoped but not globally unique (`default` exists in
  every runtime, `claude-fable-5` is a Cursor slot, OpenCode accepts any
  `provider/model` slug), so the runtime is never inferred from the model. A
  config storing a model/effort without a `cliType` assumes the runtime the
  agent form displayed (the fallback runtime) — but only when the stored model
  is one that runtime can actually run; otherwise the model is dropped rather
  than seeded into a pill that cannot offer it. This path only serves configs
  saved before the form began persisting its displayed runtime.
- The prompt is deliberately outside the seed: whether it may overwrite the
  composer depends on what the composer already holds, which only each caller
  knows.

Worktree branch names for task-attached threads derive from the task, not the
prompt text (`withTaskBranchFallback` → `deriveTaskWorktreeBranchName`):
`<type-prefix>/<ref>-<first 4 task-name words>`, e.g.
`bug/os-808-fix-login-crash-on`. Type prefixes: `feature`/`task` → `feat/`,
`bug` → `bug/`, `chore` → `chore/`, `epic` → `epic/`,
`investigation`/`idea` → `spike/`, unknown → `feat/`. An explicit
user-entered branch name always wins. This applies to every composer surface
that creates a thread with an attached task (automation dialog, task sidebar
composer, threads workspace).

The config never stores a user-specific CLI profile/path — project agents are
shared, and each delegating user picks their own profile in the composer.
Composer profile queries are server-scoped to that user, so a teammate's
profile cannot satisfy availability gating or become an automation target.
Copying a project agent copies its automation config. An empty prompt (no
trimmed text, no refs) is normalized away.

The settings UI edits automation inside the project-agent create/edit dialogs
(`AgentAutomationFields`) using the real `ThreadComposer` in config mode:
`hideAttachmentTools`/`hideSubmit` hide the sending affordances,
the prompt input uses a non-form root so it can live inside the owning agent
form without invalid nested form markup, and selector triggers remain
non-submitting controls,
`selectorsProps.hideWorkingDirectory` hides the profile-bound
working-directory/base-ref selectors (model options fall back to the runtime
registry), `onComposerDocumentChange` streams the slash-command refs out
continuously, and `extraSelectorTools` injects the profile-agnostic workspace
preference pill ("Work locally" / "New worktree"). The CLI, model, effort, and
mode pills are the composer's own. An (i) tooltip on the section label notes
that automation only runs for delegations made in the web UI — delegations
via MCP or the CLI never trigger it.

## Delegation-Triggered Flow

The trigger lives at the shared web-UI update choke point
(`useTaskCrudActions.updateTask` via `AgentAutomationProvider` in the project
task views shell) and fires on interactive changes of `delegatedToAgentId`.
Table cell, kanban card, and task sidebar delegations all route through it.
Non-interactive paths — MCP task tools, CLI commands, bulk update actions —
only delegate and never trigger automation. Owner (`assigneeId`) changes
never trigger it either.

When a task is interactively delegated to an automation-enabled agent:

1. No-op re-delegations to the already-delegated agent are ignored.
2. If the task has unresolved `agentThreadWork` (`pending`, `streaming`,
   `waiting_input`), a confirmation dialog lists that work (status, CLI icon,
   thread title, user name). The user can cancel or continue — intentional
   parallel runs are allowed.
3. The thread composer opens in a dialog, without navigating away:
   - prefilled with the automation prompt (slash-command refs rebuilt into
     real composer nodes),
   - the delegated task attached and locked,
   - the delegated agent preselected and locked in the Agent pill (OS-1138) —
     the delegation decided the binding, so the pill renders normally but
     cannot be changed,
   - the configured `cliType`/`cliModel`/`cliEffort`/`mode` preselected (via the
     shared composer seed above),
   - a `workspace: "worktree"` preference preselecting a bare new-worktree
     base-ref selection (default branch, auto-derived name),
   - profile/path defaulting per the new-thread composer rules: persisted
     project draft selection first, otherwise first online profile, otherwise
     first profile.
4. Nothing is sent until the user submits. Sending creates the thread through
   the normal `cliThreads.create` path (slash-command expansion included) with
   `agentWorkSource: "assignment_automation"` — which records the source on the
   task's `agentThreadWork` entry — and `projectAgentId`, which binds the
   delegated agent to the thread and snapshots its prompt for runtime delivery
   (see `cli-thread-agents.md`).
5. Canceling the dialog leaves the delegation in place and creates nothing.

The flow uses its own draft slot (`agent-automation:<taskId>`), seeded per
flow and cleared on submit/cancel, so it never clobbers the user's new-thread
draft. When automation is disabled, delegation only delegates.

## Auto-Submit (OS-1131)

An opt-in path that skips the composer dialog: delegation creates the thread
immediately with no interaction.

### Preference

- Scope: **per user × per project** — one preference per user per project,
  covering all automation-enabled agents in that project. Auto-submit is
  personal consent, not shared agent config: the thread always runs as the
  delegating user, on their machine, with their CLI profile.
- Storage: `userProjectPreferences` table (`by_user_and_project`), field
  `agentAutoStart`, default `false`. Read/write via
  `users.projectPreferences.get/upsert` (`get` is gated on
  `ProjectPermission.PROJECT_VIEW` so viewers don't error when the provider
  reads it; `upsert` requires `ProjectPermission.CLI_THREAD`, the same
  permission thread creation needs);
  `users.projectPreferences.listForUser` returns the user's own stored rows.
- Set from the delegation dialog itself: a dropdown among the composer
  selector pills — "Ask each time" (default) / "Auto-start next time". The
  choice is persisted only when the user actually sends.
- Changeable later: the "Agents" section in **user settings** (not project
  settings — the preference is personal, and a project-level surface reads as
  shared config). It lists all accessible projects (across organizations,
  sorted by organization then project), each with an explicit dropdown —
  "Ask each time" / "Start automatically" — so untouched projects visibly
  show the default rather than an ambiguous off-toggle. The same row holds
  the Generate guide choice (`guideAutoStart`,
  [github-integration.md → Guides](github-integration.md#requesting-and-running)).
  `upsert` sets only the choices it is passed.

### Behavior

When the delegating user's preference for the project is auto
(`AgentAutomationAutoSubmit`, rendered headlessly by the provider):

- The same create pipeline as the dialog runs without UI: the automation
  config (prompt display text + slash-command refs passed as the
  `composerDocument`, cliType/cliModel/cliEffort/mode, workspace → worktree
  base-ref — the same `buildAutomationDraftSeed` the dialog uses) plus the
  delegated-agent binding (`projectAgentId`, OS-1138) is
  resolved through `resolveNewThreadDraftState` exactly like the dialog's
  draft seed, then submitted via `useCreateThreadSubmit` with
  `agentWorkSource: "assignment_automation"`. Auto-started threads bind the
  agent the same way dialog-created ones do (see `cli-thread-agents.md`).
- Profile/path resolution reuses the dialog's rules silently: persisted
  new-thread draft selection → first online profile → first profile.
- Feedback: a success toast ("Thread started for OS-123") with an Open
  action, and the agent-work column badge shows the queued entry immediately.

### Edge rules

- Zero CLI profiles, unresolvable profile/path, or a failed create → fall
  back to opening the composer dialog (create failures also toast).
- Profiles exist but none online → create anyway; the thread queues as
  `pending`, consistent with manual sends.
- Task already has unresolved agent work → the confirmation dialog still
  appears; "Start another thread" then proceeds straight to auto-submit.
- No-op re-delegation to the same agent stays ignored.

## Task Work Summary (`agentThreadWork`)

One `agentThreadWork` row per task-linked thread lets list/board/sidebar
render without per-task thread queries (thread queries are user-scoped).
`agentThreadWork` tracks threads working on a task and is independent of delegation
(`delegatedToAgentId`, OS-1335) — a task can have runs without being
delegated and vice versa:

```ts
// table agentThreadWork, indexes by_thread and by_project_and_task
{
  projectId: Id<"projects">;
  taskId: Id<"tasks">;
  threadId: Id<"cliThreads">;
  threadTitle: string;
  userId: Id<"users">;
  userName: string;
  cliType: CliTypeSlug; // runtime registry slugs
  status: CliThreadStatus; // mirrors cliThreadStatusValidator
  source: "assignment_automation" | "manual_attachment" | "workflow_run";
  createdAt: number; // thread's own creation time, snapshotted (OS-1588)
  updatedAt: number;
}
```

### Storage and readers (OS-2579)

Until OS-2579 this was an array on the task document. Every status change
patched the task, which re-ran `tasks/core.listByProject` in every open board
of every project member, and every thread list page whose task chip reads the
task. The rows now live in their own table, and no thread lifecycle write
touches the task document.

- **Board, list and archive view** subscribe to
  `tasks/agentThreadWork.listByTasks({ projectId, taskIds })` next to the task
  list, and `useWithAgentThreadWork` merges the result into each task row. The
  query reads one `by_project_and_task` range per shown task, so a status
  change re-runs only the views that show that task. A whole-project read was
  rejected: it grows with every thread ever linked in the project and re-runs
  on any status change in it. The client sends saved task ids only (optimistic
  rows have temp ids), sorted so reordering doesn't resubscribe, in chunks of
  `MAX_AGENT_THREAD_WORK_TASK_IDS` (1000, the server cap), one subscription per
  chunk. While a changed id set loads, the previous result stays up.
- **Single-task reads** (`tasks/core.getById`, `getByRefs`) attach the
  task's rows as `agentThreadWork`. That covers the task detail view and
  timeline when the task isn't in the loaded list, the thread workspace
  sidebar, MCP `get_task`, and CLI `tasks get`. `listByProject`,
  `listByParent`, `listClosed` and `listArchivedByProject` leave the field out.
- Permanently deleting a task deletes its rows.
- `migrations.moveAgentThreadWorkToTable` moved the legacy arrays: a legacy
  entry without `createdAt` gets its `updatedAt`. Entries whose thread is gone,
  soft-deleted, or now linked to another task are skipped: the sync already
  dropped or moved their rows after the deploy. If a row was already synced
  after the deploy, it keeps its fresher status, and the legacy `source`,
  `createdAt` and names win, because the sync could only guess them. The
  legacy `tasks.agentThreadWork` field stays in the schema, unread, until a
  follow-up deploy drops it after the migration has run.

Rules:

- `workflow_run` marks threads a workflow run created — the run's container
  and its lane threads (`workflows.md` → Threads).
- Tracking follows the thread's `associatedTaskId` only (set at creation with
  an attached task or by the first task-attached message, never overwritten).
  A later message attaching a different task does not create entries on that
  other task.
- The entry status matches the thread-list display status: `waiting_input`
  while a streaming/pending run is parked on a pending interaction request
  (mid-run AskUserQuestion/approval, mirrors `deriveThreadWatchStatus`),
  `pending` while user input is queued and no run is streaming (a follow-up
  queued mid-stream keeps the entry `streaming`, matching the thread list),
  the stored thread status otherwise (OS-1287). There are no
  `canceled`/`closed` statuses — cancellation is stored as `failed` with an
  error reason (`cli-thread-cancel-processing.md`).
- Thread title changes update `threadTitle`. Soft-deleting a thread removes
  its entry. Marking a thread **done** does not (OS-1561): users toggle
  done back and forth, so entry churn on every toggle would be
  noise — done threads keep their task-work entry.
- Completed/failed entries stay visible so the task shows finished work; they
  do not block or require confirmation for new runs.
- Sync lives at the single `cliThreads` write seam
  (`convex/cli/threads/lib/cliThreadsRepo.ts` → `cli/threads/lib/agentThreadWork.ts`): every
  intent-named write that can change association, status, title, or delete
  state re-syncs the row. The sync reads the thread's row by `by_thread`, and
  reads the task only when the row is new or the thread's task changed. It
  skips the write when title and status are unchanged.
- `createdAt` is the thread's own `createdAt`, snapshotted on first sync and
  preserved from the existing entry afterwards — the same pattern `userName`
  and `agentName` use. It exists because the task timeline sorts every source
  by creation time (`docs/specs/task-timeline.md`) and `updatedAt` is restamped
  on each status/title change, which would drift a row down the stream while
  its agent works.
- A thread has at most one row. If its `associatedTaskId` changes, the row
  moves to the new task with fresh snapshots.
- Deleted tasks fail soft: a thread whose task is gone or soft-deleted gets no
  new row. An existing row keeps syncing, but no reader shows a deleted task's
  rows.
- Threads archived before OS-1561 had their entry removed at archive time, and
  the retirement migration that converted them to done did not restore it (it
  patched through the projection seam, which does not re-sync task work). Those
  threads stay absent from their task's summary until the next intent-named
  write re-adds them, and because `agentWorkSource` is a create-time argument
  rather than a stored field, the re-add lands on `source: "manual_attachment"`
  regardless of how the thread originally started.

Manual attachment (starting a thread with an attached task from the threads
UI, or the first task-attached message in an unassociated thread) creates the
same entries with `source: "manual_attachment"`.

## Visibility UI

- Task table: a dedicated narrow column titled "Runs" right after status
  (`AgentThreadWorkCell`), in both full and compact modes (the title is
  visually hidden in compact mode, like the other metadata headers). Entries render as
  stacked CLI-icon badges avatar-group style — latest on top, at most 2; with
  3+ entries the second slot becomes a "+N" counter — each icon with its
  status dot in the badge's bottom-right corner. Tasks without entries show a
  muted dash. Clicking the cell opens a popover (OS-1130):
  - When the viewer has own threads on the task, the latest one (by
    `lastActivityAt`) opens directly in a **mini thread preview** — the
    embeddable `ThreadView` (see `cli-thread-embeddable-view.md`) with the
    message stream and follow-up composer, so the user can reply, answer an
    AskUserQuestion, or retry a failure without leaving the task list. A
    one-line header shows a back button, the thread title, a "Start new"
    button, and an open-full-thread link; nothing else — no thread list above
    the preview.
  - Back lands on the plain thread list (rows only — no composer, so the
    view stays unambiguous), with a "+ Start new" row at the top followed by
    the viewer's own threads and other users' info rows. A plain left-click
    on a thread row opens the mini preview, while modified clicks
    (cmd/ctrl/shift) keep the browser's open-in-new-tab behavior on the full
    thread page.
  - "Start new" (header button or list row) opens a new-thread view under
    the same one-line header — back button, "New thread" title, and an
    open-full-page link to the threads workspace with the task preattached —
    with the task-attached thread composer (`TaskThreadComposer`) below,
    auto-focused so the user can type immediately. Sending switches the
    overlay to the created thread's mini preview right away (the preview
    renders by thread id, so it does not wait for the thread list query to
    include the new thread). This Run-column composer uses a 48px minimum
    input height; the task-sidebar composer keeps its larger default. The
    shared composer context bar sits flush with the input, uses 12px bottom
    padding, extends 8px behind it, and has a subtle border on its top and
    sides. The input surface uses exactly `#FFF` in light mode and `#1D1D1D`
    in dark mode.
  - When the viewer has no own threads on the task, the initial view is that
    same new-thread view (header with the back button disabled — there is no
    list to go back to — plus the composer), with other users' info rows, if
    any, between header and composer.

  Below the shared 768px mobile breakpoint, the same trigger opens this
  content in a bottom drawer instead of the fixed-width popover so
  the surface stays within the viewport. Desktop keeps the anchored popover.
  Interactions inside either overlay — including portalled CLI/model/mode
  menu items — stay isolated from the owning task row: they must not open task
  details, steal focus back to the row, or initiate mobile long-press drag.
  Thread queries are user-scoped, so the list mixes two row kinds: the
  viewer's own threads (`listByAssociatedTask`) as regular rows, and
  other users' `agentThreadWork` entries as info-only rows matching the compact
  owner thread-row layout: active/attention status indicator when applicable,
  title, then user name, CLI icon, and compact relative activity date on the
  right. Completed rows omit the leading status indicator, matching owner
  rows. Owner and info-only rows use the same compact row renderer; the user
  name is conditional metadata on info-only rows, while owner-only navigation,
  actions, selection, and task-ref behavior are supplied around or through the
  shared renderer. The viewer has no access to other users' threads and those
  rows never open the mini preview.
- Kanban card: a single status dot for the latest entry, with all entries
  detailed in a tooltip (`AgentThreadWorkIndicator`), in the card footer.
- Task sidebar: no dedicated section — the Threads row already lists the
  task's threads.

Visual states: working (`pending`, `streaming`), needs attention
(`waiting_input`, pulsing), done (`completed`), failed (`failed`).

## MCP

`create_project_agent` / `update_project_agent` accept an `automation` param
(plain-text prompt only; whole-config replacement; `null` clears). See
`mcp-server.md`. Delegating a task to an agent through MCP or the CLI never
triggers automation; whether/how MCP could opt in later (e.g. a dedicated
tool) is an open question on OS-1094 and out of scope for v1.

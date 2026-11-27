# Recurring tasks

OS-2506. A Recurring task creates an Occurrence on a schedule and can start a
thread on it. Vocabulary is in [CONTEXT.md](../../CONTEXT.md): Recurring task,
Recurrence, Occurrence, Skipped slot. The model and its rejected alternatives
are in
[ADR 0011](../adr/0011-a-recurring-task-is-a-task-with-a-recurrence.md).

Not built yet. The prototype at `/playground/recurring-tasks` shows the UI.

## Recurring task

A Recurring task is a normal task that carries a Recurrence. It is an ordinary
task in its List. Nobody works on it: the work happens on its Occurrences,
which are copies of it.

- Any top-level task can become recurring by setting Repeat on it. It keeps
  its history, comments, and artifacts. Its first Occurrence appears at the
  first slot.
- A subtask cannot carry a Recurrence, and neither can an Occurrence.
- A Recurring task cannot become a subtask. Dragging it offers no nested drop
  position, the parent pickers leave it out, and the backend rejects the move
  with "Remove repeat first".
- It moves between Lists like any task, Backlog included, and keeps running.
  Its subtask Occurrences move with it, as subtasks do.
- It uses the normal task editor, subtasks, attachments, and artifacts.
- Permissions are the task permissions: `TASK_CREATE` to create,
  `TASK_UPDATE` to edit. No recurrence-specific permission.
- No agent guards. An agent can create, edit, pause, run, and remove a
  Recurrence through the CLI and MCP (see below). "Update this checklist for
  next week" is normal agent work.
- A Recurring task is an open task in its List and is hidden nowhere. The UI
  marks it with the repeat chip. CLI and MCP task output marks it as recurring,
  so an agent picking work can tell it from an Occurrence.

### Stopping

| Action | Effect |
|---|---|
| Pause | Keeps the rule, creates nothing. Resume continues at the next future slot. |
| Mark Done or Canceled | Creates nothing while closed. Reopening continues at the next future slot. |
| Delete | Creates nothing while deleted. Restore continues at the next future slot. |
| Archive the task | Creates nothing while archived. Restoring it from the Archived List continues at the next future slot. |
| Remove repeat | Deletes the Recurrence. The task becomes a normal task again. |
| Archive the project | Pauses every open Recurring task in the project. Unarchiving resumes none of them. |
| Nobody opens the project for 60 days | Pauses the Recurring task at its next slot. Nothing resumes it automatically. |

Pause, closing, and Remove repeat do not touch existing Occurrences. Delete
and Archive take the Occurrences that are subtasks of the Recurring task with
it, as they do for any parent, and leave the ones created in a List. There is
no end date or run count in v1.

After Remove repeat the Occurrences keep their link and their chip, which
opens the now ordinary task. Setting Repeat on that task again creates a new
Recurrence that starts fresh: the old Occurrences do not hold back a slot and
the archive rule does not count them.

### Duplicating

- A copy of a Recurring task carries its Recurrence, paused, so one schedule
  never silently becomes two. The copy's Acting user is the user who made it.
- The copy does not include the Recurring task's Occurrences. Copied as plain
  subtasks they would become part of the copy's own subtasks, and so part of
  every Occurrence it creates. The spawn skips them for the same reason.
- A copy of an Occurrence is an Occurrence of the same Recurring task. It
  keeps the link, the slot time, and the chip, so it is never taken for one
  of the Recurring task's own subtasks. It becomes the latest Occurrence for
  rule 3, and the archive rule counts it.

### Archived project

An archived project is hidden, not frozen (OS-2528), so Recurring tasks are
paused explicitly rather than skipped by the spawner.

- Archiving pauses every open, unpaused Recurring task in the project, in the
  archive transaction. It is the same Pause a user sets by hand.
- Unarchiving resumes nothing. The Unarchive confirmation, in the web UI and
  in `convoy projects unarchive`, says that Recurring tasks stay paused and
  must be resumed one by one. The line shows only when the project has a
  paused Recurring task.
- A user can resume a Recurring task inside an archived project. The spawner
  honors it like any resume.

### Inactive project

A Recurring task whose agent closes every Occurrence would otherwise run
forever in a project nobody looks at. GitHub disables scheduled workflows the
same way after 60 days without repository activity.

- The project stores when a member last opened it in the web app, written at
  most once a day. CLI, MCP, and agent activity do not count, because agent
  actions are recorded as the acting user.
- At a slot, the spawner pauses the Recurring task instead of spawning when
  both that time and the Recurrence's last save are more than 60 days old.
- It is the normal Pause with a stored reason. The Recurring task shows
  "Paused after 60 days without a visit", and a member resumes it by hand.
- No notification in v1. 60 days is a constant.
- Built last, as a follow-up slice.

## Recurrence

A Recurrence has a rule, a timezone, the place its Occurrences are created,
an Acting user, and, when it starts a thread, a CLI profile and working path.

### Rule

| Unit | Extra fields |
|---|---|
| Every N hours | none |
| Every N days | time of day |
| Every N weeks | weekday set, time of day |
| Every N months | day of month, time of day |
| Every N years | month and day, time of day |

- Day of month clamps to the last day of a short month. A yearly rule on
  Feb 29 runs on Feb 28 in a year without one.
- The interval counts from the Recurrence's first slot.
- Time of day is wall-clock time in the Recurrence's timezone. Hourly rules
  count fixed hours from the first slot, so daylight saving does not shift
  them.
- No cron expressions.

### Timezone

An IANA zone, taken from the browser when the Recurrence is set. The UI shows
it next to the rule and lets the user change it. There is no project timezone.

Open implementation check: nobody has confirmed that the default Convex
runtime resolves IANA zones through `Intl`. The first slice tests it on a
deployment. If it does not, the next-slot function moves to a Node action and
nothing else changes.

### Where Occurrences are created

The repeat control has a "Create in" picker. It is the existing List selector
(`TaskListPicker`, as the task sidebar's List field uses it) with one row
added on top, "Under this task". It offers two kinds of choice:

| Choice | The Occurrence is |
|---|---|
| Under this task (default) | A subtask of the Recurring task, in its List. |
| A List of the project | A top-level task at the top of that List. |

So a Recurring task can live in one List and create its work in another, and
the two never sit side by side. Picking the Recurring task's own List is
allowed.

- The selector behaves as in the task sidebar: search, Backlog as a target,
  Archived disabled, no row actions, and no "Create list" row. The current
  choice is highlighted. An Occurrence lands in no section.
- Every Occurrence stores a link to its Recurring task and its slot time, in
  both cases. Rule 3, the Occurrences listing, and archiving read that link,
  never `parentId`.
- An Occurrence in a List shows the link as "Recurring task" where a subtask
  shows "Parent". In tables and on the board it carries a chip with the
  Recurring task's ref, and clicking the chip opens the Recurring task.
- Changing the choice affects new Occurrences only. Existing ones stay where
  they are.
- If the chosen List is archived or deleted at spawn time, the Occurrence
  lands in the project default List and the Recurring task shows a warning.
- The board shows root tasks only. An Occurrence in a List is a root task and
  needs no rule. An Occurrence that is a subtask gets its own card with the
  same chip, and the Recurring task has none. The chip is the way from the
  board to the Recurring task.
- A new subtask Occurrence is ranked first among the Recurring task's
  subtasks, so the newest is on top.

### Acting user

The Acting user is the user a Recurrence acts as when it creates Occurrences
and starts threads. Every Recurrence has one, with or without a thread.

- It is the user who made the task recurring.
- A user can only pick their own CLI profiles, so whoever picks the profile
  becomes the Acting user. The Recurring task shows "alice-macbook ·
  ~/code/convoy, as Alice".
- Another member editing the description, rule, or delegated agent keeps the
  Acting user.
- When the Acting user is removed from the project or loses access to it,
  nothing is deleted. Every slot is skipped and the Recurring task shows a
  warning, "Alice is no longer in this project", on its chip and in its
  sidebar. Run now fails with the same message.
- Any member who can edit the task fixes it by opening Repeat and saving.
  They become the Acting user. If the Recurrence starts a thread, the save
  asks them to pick their own CLI profile and path first.
- Open Occurrences and threads that already started are not touched.
- The agent's comments, status changes, and PRs on an Occurrence are recorded
  as the Acting user, like every agent thread today. A separate agent actor is
  tracked in OS-1040.

### Thread

A "Start a thread for every occurrence" switch decides whether the Recurrence
starts anything.

- Off: nothing is started, and the Occurrence is a plain task for a person,
  even when the task has a delegated agent.
- On: the CLI profile and path are required.
- A new Recurrence starts with the switch on when the task has a delegated
  agent, and off otherwise.
- The stored composer is kept while the switch is off.

With the switch on, the Recurrence stores a thread composer, edited with the
real `ThreadComposer` in config mode (no send button, no attachments), as
agent automation and Workflow Prompt steps do. It holds:

- the prompt, which may be empty;
- the CLI profile and working path;
- the workspace: work locally, an existing worktree, or a new worktree from a
  base branch, created fresh for every Occurrence with an auto-derived branch
  name. A named new branch is not offered, because the same name cannot be
  created twice;
- an optional Workflow. Selecting one behaves as in the new-thread composer:
  the workflow's first prompt fills an empty composer, its lane defaults fill
  the CLI, model, effort, and mode pills, and a workflow that runs in a new
  worktree preselects one;
- CLI type, model, effort, and mode overrides. They apply to a single thread.
  A Workflow run takes them from the workflow.

The composer's agent is the task's delegated agent. Changing one changes the
other. Picking an agent seeds the composer as the new-thread composer does
(`buildProjectAgentDraftPatch`): its automation prompt fills an empty
composer, and its runtime settings fill the pills. A new Recurrence on a task
that has a delegated agent starts seeded the same way. After that the composer
holds what the user sees, and nothing is substituted at spawn time.

## Spawning

### When an Occurrence is created

At each slot the spawner creates the Occurrence only if all of these hold:

1. The Recurring task is open, not paused, not deleted, and not archived.
2. The spawner reached the slot within 15 minutes of its time.
3. The previous Occurrence is closed, or there is none.
4. The Acting user is still a project member. If the Recurrence starts a
   thread, its CLI profile still exists, and so does the delegated agent when
   one is set.

Otherwise the slot is a Skipped slot. A Skipped slot is never created later.
The next Occurrence comes at the next slot.

Example, daily at 09:00. Nov 1 runs. The spawner is broken on Nov 2 and fixed
at 10:00, so Nov 2 is skipped. Nov 3 09:00 runs, if the Nov 1 Occurrence is
closed by then.

"Closed" for rule 3 means status Done or Canceled. An archived, deleted, or
hard-deleted Occurrence also frees the next slot. Only the latest Occurrence
counts; reopening an older one changes nothing. Closing the latest Occurrence
creates nothing by itself. The next one appears at the next slot.

An offline CLI profile does not skip the slot. The thread queues as `pending`
and runs when the profile connects, as manual sends do.

### Skipped slots

| Reason | Cause | Shown as |
|---|---|---|
| `late` | The spawner reached the slot more than 15 minutes late. | "Skipped, spawner was late" with the slot time |
| `previous_open` | The previous Occurrence is not closed. | "Skipped, OS-123 is still open" |
| `unavailable` | The Acting user, the CLI profile, or the agent is gone. | A warning that names what is gone |

- The Recurring task records the last run: slot time, outcome, reason, and
  the Occurrence ref for a spawn. It also counts Skipped slots since the last
  spawn, shown in a tooltip.
- For `previous_open`, the open Occurrence gets one activity entry the first
  time. Later skips only raise the counter, so an hourly Recurrence does not fill
  the history.
- No notification.

### What an Occurrence carries

Copied from the Recurring task: name, description, type, priority, label,
tags, checklist, assignee, delegated agent, and subtasks recursively. The
Recurring task's Occurrences are not its subtasks for this purpose and are
skipped.

Set by the spawner:

- Status is `To Do`, for the Occurrence and every subtask.
- Due date is the slot time. For Run now it is the moment Run now was used.
- A link back to the Recurring task and the slot time.
- A normal ref from the project counter. The whole tree reserves its refs in
  one counter write, as `tasks.core.duplicate` does.
- Rank puts it at the top of the chosen List, or first among the Recurring
  task's subtasks.

Not copied: attachments, artifacts, comments, external links, and
`agentThreadWork`. An attachment row owns its stored file, so a copy would
make two tasks share one file. They stay readable on the Recurring task, one
link away.

The Occurrence payload names the Recurring task and the previous Occurrence,
so an agent can read last run's artifacts and comments one hop back. Nothing
else is shared between Occurrences in v1.

### Archiving older Occurrences

A Recurring task keeps its 10 most recent closed Occurrences. When the
spawner or Run now creates an Occurrence, it archives the closed ones beyond
those 10 in the same transaction, so neither the subtask list nor the chosen
List grows without bound.

There is one rule, and it follows the link to the Recurring task. It does not
look at where an Occurrence is: a subtask, a top-level task in a List, and an
Occurrence a user moved somewhere else are all counted and archived the same
way.

- Open Occurrences are never archived.
- It uses the normal archive (`archiveTasksByIds`): the Occurrence moves to the
  Archived List with its subtasks, and a subtask Occurrence is detached from
  the Recurring task. It keeps its link and slot time, and can be restored
  like any archived task.
- A steady Recurrence archives one Occurrence per spawn. The Recurrence stores the
  ids of the Occurrences it still tracks (open ones and the 10 newest closed),
  so the read is those tasks by id and `tasks` needs no new index.
- The Recurrence stores no count of past Occurrences.
- Deleting the Recurring task does not touch archived Occurrences, since they
  are no longer its subtasks.

The threshold is a constant in v1, not a setting.

### Starting the thread

When the switch is on (see Thread), the spawn creates the thread for the
Occurrence in the same transaction.

- The thread is created as the Acting user on the Recurrence's CLI profile and
  path, through `createThreadCore`, the way a workflow run does.
- The first message is the Recurrence's prompt, and the Occurrence is the
  thread's attached task. An empty prompt stays empty: the agent's automation
  prompt is not substituted. `createThreadCore` accepts an empty message when
  a task is attached.
- CLI type, model, effort, and mode come from the Recurrence's overrides, then
  from the agent's automation config.
- With a Workflow selected, the spawn starts a Workflow run on the Occurrence
  through the core of `workflows.runs.start`, with the prompt as its input,
  and no single thread.
- `agentWorkSource` is the new value `recurrence`.
- The agent's "automation enabled" flag is not consulted. The switch is the
  opt-in.

With the switch off, the spawn creates a plain task for a human.

### Run now

Creates an Occurrence immediately.

- It ignores rule 3, so it works while the previous Occurrence is open.
- It does not move the schedule and belongs to no slot. Its due date is the
  moment it was used.
- It fails with an error when rule 4 fails.
- The new Occurrence becomes the latest one for rule 3, so the next slot is
  skipped while it is open.

### Mechanism

- One cron every 5 minutes calls an internal mutation. It reads at most 200
  due Recurring tasks through an index on the next fire time and schedules one
  spawn mutation per task with `runAfter(0)`. A full page schedules the tick
  again.
- The next fire time is the processed marker. The spawn mutation re-reads the
  Recurring task and exits if the next fire time is in the future. Otherwise
  it spawns or records the Skipped slot, and sets the next fire time to the
  first slot after now. All of that is one transaction, so a doubled spawn is
  a no-op and a failed clone retries on the next tick.
- The next fire time is set only while the Recurring task is open, not
  paused, and not deleted. `patchTask` in `tasks/lib/tasksRepo.ts` owns it, as
  it owns `closedAt`.
- Rule 3 is one `get` of the latest Occurrence, whose id the Recurring task
  stores. Occurrences never write back to the Recurring task.
- Spawns in one project contend on the ref counter. Batching spawns per
  project is the fix if that shows up. Not built.

## CLI

Every action a user has in the UI has a command, so an agent with a shell can
create, edit, and run Recurring tasks.

```bash
convoy tasks recurrence set <taskId|ref> --every <n><h|d|w|mo|y> [--at HH:mm] [--on mon,tue] [--day <1-31>] [--month <1-12>] [--tz <iana>]
                                         [--list <list> | --under-task]
                                         [--start-thread | --no-start-thread] [--prompt <text>] [--profile <id> --path <id>]
                                         [--workspace local|worktree] [--workflow <id|name>]
                                         [--cli-type <type>] [--model <model>] [--effort <effort>] [--mode <mode>]
convoy tasks recurrence pause <taskId|ref>
convoy tasks recurrence resume <taskId|ref>
convoy tasks recurrence run <taskId|ref>
convoy tasks recurrence remove <taskId|ref>
convoy tasks occurrences <taskId|ref> [--limit <n>] [--json]
convoy tasks list --recurring
```

- `recurrence set` on a plain task makes it recurring. On a Recurring task it
  edits the Recurrence: flags that are left out keep their stored value.
- `--list` is the "Create in" List. `--under-task` switches back to subtasks,
  which is also the default for a new Recurrence.
- `--tz` defaults to the machine's timezone.
- `--profile` and `--path` are required with `--start-thread` when none are
  stored. They must be the caller's own, so the caller becomes the Acting
  user.
- The agent of the composer is the task's delegated agent, set with
  `convoy tasks update --delegate-to-agent`.
- `tasks get` prints the Recurrence, the next slot, and the last run on a
  Recurring task, and the Recurring task and the previous Occurrence on an
  Occurrence.
- `tasks list`, `tasks search`, and `tasks get` mark a Recurring task with its
  rule, in text and as a `recurrence` field in `--json`. An Occurrence carries
  `occurrenceOf` with the Recurring task's ref.

## MCP

MCP comes second and stays small, because every tool adds to an agent's
context.

- `create_task` and `update_task` take a `recurrence` argument with the same
  fields as `recurrence set`. On `update_task` it is a patch: fields that are
  left out keep their value, `{ paused: true }` pauses, `{ paused: false }`
  resumes, and `null` removes the Recurrence.
- One new tool, `run_recurring_task`, is Run now.
- `get_task` returns the Recurrence, the next slot, the last run, and the
  latest Occurrences on a Recurring task, and the Recurring task and the
  previous Occurrence on an Occurrence.
- `list_tasks` and `search_tasks` mark a Recurring task with a `recurrence`
  summary and an Occurrence with `occurrenceOf`. Both accept
  `recurring: true` to list only Recurring tasks.
- The tool descriptions say that a Recurring task is a schedule and that work
  belongs on its Occurrences.

## UI

- A Repeat row on the task sidebar, and a repeat chip after the task's name in
  tables. Both open the same repeat popup.
- The repeat popup, top to bottom: next slot and last run (on a Recurring
  task), the rule, a two-line preview (the rule in words, then the next three
  dates), the "Create in" picker, the "Start a thread for every occurrence"
  switch, the composer, and a footer with Run now, Pause or Resume, and Save
  or "Make recurring".
- The Recurring task's sidebar has a repeat icon at the end of the title and
  the rows Repeat (rule, then timezone), Create in (only when a List is
  chosen), Next, Last run, and Runs on (only when a thread starts). Its menu
  has Run now, Pause or Resume, Mark done or Reopen, Remove repeat, and
  Delete.
- The Recurring task lists its Occurrences, newest first, with an info popover
  that says older closed ones are archived.
- A table keeps its columns. Runs shows agent threads only, and a Recurring
  task shows no next slot in Due date.
- An Occurrence shows a link to its Recurring task ("Parent" or "Recurring
  task") and a "Last occurrence" link to the one before it. It shows no
  warning about blocking the next slot, and its thread carries no Recurrence
  chip.
- A Recurring filter in the project's task views shows the Recurring tasks of
  every List in the normal table, with the same columns. It is not a separate
  view. The repeat chip on a row opens the popup with the next slot, the last
  run, and Pause.
- No explanatory banners or tags. A Recurring task's own subtasks look like
  any subtasks.

## Deferred

- Sharing notes or artifacts across the Occurrences of one Recurring task. The
  first design shared its artifacts by reference as "Series notes". OS-2507
  decides the approach.
- Creating an Occurrence some time before it is due.
- Ending a Recurrence after a date or a count.
- A per-task "create anyway while the previous one is open" switch.
- A hosted or organization-owned Acting user, which needs the Execution principal from
  OS-1040.
- A recurring subtask.

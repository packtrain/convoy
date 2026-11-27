# A recurring task is a task with a Recurrence

Recurring work is modeled as a Recurring task: a normal task that carries a
Recurrence and stays in the List it was created in. On schedule the backend
deep-copies it, subtasks included, into an Occurrence, and starts a thread on
the Occurrence when the Recurrence says so. The Occurrence is created under
the Recurring task as a subtask, or as a top-level task in a List the
Recurrence names. The Recurring task is never worked on, so nothing an agent
does to an Occurrence leaks into the next one. Artifacts are not copied, and
v1 shares nothing between Occurrences.

We rejected five alternatives.

- A built-in Recurring List that holds the templates, hidden from default
  queries. This was the first design. It needs a second system List, guards on
  moving tasks in and out, and a hidden-task rule in every query, where a
  normal task in a normal List needs none of that.
- A rolling task that resets its due date. It mixes every run's threads,
  artifacts, and PR links on one row.
- Reopening the same task at every slot. Its subtasks, checks, and links need
  resetting on each run, there is no record per run, and its threads pile up
  in an uncapped array on the task document.
- Treating the latest Occurrence as the template. It fails as soon as an agent
  edits the ticket it is working on.
- A separate template table. It needs its own editor and permissions, while a
  task reuses the task editor, subtasks, duplicate, MCP tools, and soft delete
  for free.

Occurrences are created on the clock, not on completion of the previous one,
because agent-run series have nobody to complete anything. The clock is
gated, though. A slot is skipped while the previous Occurrence is still open,
because a daily agent run on top of yesterday's unmerged PR redoes the same
work and opens a conflicting one. Closing the previous Occurrence creates
nothing by itself. A slot the spawner does not reach on time is skipped as
well. No Occurrence is ever created late; the series resumes at the next slot.

Older closed Occurrences are archived as new ones are created, so a Recurring
task keeps a fixed number of them. The Recurring task is stopped by pausing it,
marking it Done, or removing its Recurrence. Behavior details live in the
[recurring tasks spec](../specs/recurring-tasks.md).

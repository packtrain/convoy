# A recurring task template is a task in a system list

Recurring work is modeled as a Recurring task template, a normal task that
lives in the built-in Recurring List and carries a Recurrence. On schedule the
backend deep-copies it, subtasks included, into its target list as an
Occurrence, and starts the delegated agent in a new thread when there is one.
The template is never worked on, so nothing an agent does to an Occurrence
leaks into the next one. The template's artifacts are shared with every
Occurrence by reference as Series notes; everything else is copied once.

We rejected three alternatives. A rolling task that resets its due date mixes
every run's threads, artifacts, and PR links on one row. Treating the latest
Occurrence as the template fails as soon as an agent edits the ticket it is
working on. A separate template table needs its own editor and permissions
while a template-as-task reuses the task editor, subtasks, duplicate, MCP
tools, and soft delete for free.

Occurrences are created on the clock, not on completion of the previous one,
because agent-run series have nobody to complete anything. A slot is skipped
only while an agent execution on the previous Occurrence is still unresolved;
work waiting on human review does not block the series. After downtime the
spawner creates at most one catch-up Occurrence and advances to the next
future slot. Behavior details live in the
[recurring tasks spec](../specs/recurring-tasks.md).

# Issue tracker: Convoy

Issues, planning work, and PRDs for this repository live as Convoy tasks. Use the production `mcp__convoy__*` tools for all tracker operations.

The MCP connection is pre-scoped to the Convoy project. Do not call `list_projects` unless the user explicitly asks about another project.

## Conventions

- **Create a task:** use `create_task`.
- **Read a task:** use `get_task` with its task ID or ref.
- **List tasks:** use `list_tasks`.
- **Search tasks:** use `search_tasks`, then post-filter results against exact task tags when tag identity matters because search is full-text.
- **Comment:** use `create_task_comment`.
- **Update:** use `update_task`.
- **Close as completed:** set status to `Done`.
- **Close as rejected or out of scope:** set status to `Canceled` after posting an explanation.
- **Create a subtask:** use `create_task` with the parent task ID or ref in `parentId`.
- **Default List:** omit `listId` so Convoy uses the project's default List. Do not default tasks to Backlog.
- **References:** use the task's human-readable ref and retain the `taskUrl` returned when creating it.

## Tags and labels

Task labels are reserved for user-defined project stages.

Engineering skills must never read, create, update, clear, or otherwise reinterpret a Convoy task label.

Skill metadata is stored in task tags. Because `update_task` replaces the complete tag array, every tag mutation must:

1. Fetch the current task.
2. Preserve all unrelated tags.
3. Add or remove only tags owned by the active skill.
4. Write the merged tag array.

## Pull requests as a triage surface

**Pull requests as a request surface: no.**

Pull requests, commits, branches, and other related resources may be attached to a Convoy task using external links. They are not independently discovered or triaged as tracker issues.

## When a skill says “publish to the issue tracker”

Create a Convoy task in the project's default List.

## When a skill says “fetch the relevant ticket”

Use `get_task` with the supplied Convoy task ID or ref.

## Wayfinding operations

Wayfinder uses Convoy tasks, native subtasks, tags, comments, statuses, artifacts, and external links.

### Map

A Wayfinder map is a top-level task with:

- Task type `epic`
- Tag `wayfinder:map`
- Status `Planning` while active
- The Wayfinder map template in its description

Leave `listId` unset so the map is created in the project's default List.

### Decision tickets

Each decision ticket is a native Convoy subtask whose `parentId` points to the map.

Each ticket has exactly one type tag:

- `wayfinder:research`
- `wayfinder:prototype`
- `wayfinder:grilling`
- `wayfinder:task`

The ticket description contains its question and any blocking metadata. Labels remain untouched.

### Blocking

The Convoy MCP currently exposes no native task-dependency operation. Record blockers in the ticket description:

```markdown
## Blocked by

- OS-123
- OS-124
```

A blocker remains open until its status is `Done` or `Canceled`. Before canceling a blocker, update or invalidate any tickets whose route depended on it.

### Frontier query

Load the map with `get_task` and inspect its direct subtasks in their returned order.

A ticket is on the frontier when:

- Its status is neither `Done` nor `Canceled`.
- Every task listed under `## Blocked by` is closed.
- It has no assignee.
- It has no `wayfinder:claimed:*` tag.
- It is not already `In Progress`.

The first matching subtask is the next ticket.

### Claim

Prefer claiming by assigning the ticket to the configured user or Project agent.

If no suitable assignee identity is available:

1. Fetch the current ticket and tags.
2. Add `wayfinder:claimed:<session-id>`.
3. Set the status to `In Progress` in the same update.
4. Re-fetch immediately.
5. Continue only if no competing assignee or claim tag is present.

Claiming is the session's first write and happens before investigation or discussion.

### Resolve

To resolve one ticket:

1. Post the decision as a task comment.
2. Remove the session's claim tag, if used.
3. Set the ticket status to `Done`.
4. Re-fetch the map immediately before changing its description.
5. Append one linked context pointer to `## Decisions so far` without restating the full decision.

Use the ticket name as the visible link text and retain its Convoy ref or URL inside the link.

### Out of scope

When a ticket is found to sit beyond the map's destination:

1. Post an explanatory comment.
2. Remove its claim tag, if used.
3. Set its status to `Canceled`.
4. Add one linked line to the map's `## Out of scope` section.
5. Do not include it under `## Decisions so far`.

### Assets

Store substantial supporting material as task artifacts or external links on the decision ticket. Refer to the asset from the resolution comment rather than pasting the full material into the ticket description.

### Completing the map

Set the map to `Done` only when:

- No open decision tickets remain.
- `## Not yet specified` contains no unresolved in-scope fog.
- The route to the destination is clear.

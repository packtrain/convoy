# Model task organization as Lists

Task organization will be modeled with project-scoped Lists: every task belongs to one List in the target model, task rank is interpreted within that List, and each project has a persisted default List created as `Inbox`. We chose this over tags-only history, multi-list membership, independent per-view ranks, and hardcoded Inbox keys because Lists need stable identity for UI, MCP, CLI, movement, ordering, and project-wide defaults.

## Consequences

- `Inbox` is a persisted List row and `projects.defaultListId` points to the project-wide default List.
- Backlog and Archived remain compatibility behavior first, then migrate toward system List containers later.
- `Backlog` leaves the target status model; `Done` and `Canceled` remain statuses.
- MCP and CLI resolve Lists by project-scoped ref or raw ID, defaulting task creation/listing to `projects.defaultListId`.
- List ref changes are explicit because refs are integration-facing.

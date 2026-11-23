# Project archive

OS-2528. Archiving hides a project from navigation. It does not freeze it.

## Behavior

- `projects.isArchived` is the flag. It has existed since the table was
  created, so archiving needs no migration.
- An archived project leaves the sidebar, the sidebar's pinned Lists, every
  project picker, and the org home redirect.
- `projects.core.listByOrganization` still returns archived projects, flagged
  `isArchived`. Callers find the current or selected project in it, so each
  navigation caller drops archived rows itself: the sidebar and the org home
  redirect. `tasks.lists.listPinnedForOrganization` serves only the sidebar and
  drops them on the server, through the
  `by_organization_and_isDeleted_and_isArchived` index.
- Pickers keep an archived project that is already in use. The create-task
  dialog and mobile panel offer the current project even when it is archived,
  so Add task works inside it. The API key scope picker keeps an archived
  project the key is already limited to.
- The API key scope picker never empties a project list by itself, because an
  empty list means every project. When every selected project has been
  deleted, the stale IDs stay and saving fails with "Project not found".
- Everything else keeps working. The project URL opens, tasks and threads stay
  editable, CLI and MCP calls that name the project succeed, and the GitHub
  connection stays as it is.
- The alias stays taken. An archived project is not deleted.
- The project's task views show "This project is archived." above the task
  list. Callers who can archive also get an Unarchive button there.
- Recurring tasks pause on archive and stay paused on unarchive. See
  [recurring-tasks.md](recurring-tasks.md#archived-project).

## Who can archive

`project:archive` (project admins), or org `projects:manage_all` (owners and
admins) as the explicit alternative. This is the same rule as project edits,
`requireProjectAdministration` in `convex/projects/lib/permissions.ts`.

## Mutation

`projects.core.setArchived({ apiKey?, id, isArchived })`. Idempotent. It
patches `isArchived` and stamps `updatedAt`. An API key must have the project
in scope. That holds for the org-admin path too, so a key limited to project
B cannot archive project A even when its owner is an org owner.

## Web

- **Danger zone.** The first row reads Archive project, or Unarchive project
  on an archived one. The button opens a confirmation that names the project.
  After confirming, the page stays where it is. The section opens for
  `project:archive` or org `project:delete`, so a project admin who is an org
  member can reach Archive while Delete stays disabled for them.
- **Banner.** Shown on the project's task views while archived. Unarchive
  opens the same confirmation.

## CLI

```bash
convoy projects archive <project> [--org <org>] [--json]
convoy projects unarchive <project> [--org <org>] [--json]
```

`<project>` is an ID or alias. `projects.core.listAccessible` still returns
archived projects, so both commands resolve them. `listAccessible` only lists
projects the caller is a member of. An org admin may archive without being a
member, so an ID that does not resolve goes to the server unchanged, and the
server decides. Aliases are 2 to 5 characters, so a longer value is treated as
an ID.

## Not built yet

These land in the next slice of OS-2528.

- The Archive item in the sidebar `...` menu
  ([project-sidebar-actions.md](project-sidebar-actions.md)).
- Org settings, Projects: a status filter (Active by default, Archived, All)
  and Archive / Unarchive in the row menu.
- `isArchived` on `listAccessible` rows, `convoy projects list --archived`,
  and MCP `list_projects` hiding archived projects.

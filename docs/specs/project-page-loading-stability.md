# Project Page Loading Stability

## Scope

This spec defines loading behavior for the project task-list route:

- `/o/:organizationSlug/:projectAlias`

It covers transient client-side loading gaps after the page has already resolved
the current organization, project, and task list.

## Resolved Route Data

- After an organization or project has resolved for the current signed-in user
  and route key, brief Convex/Clerk auth re-initialization must not replace the
  mounted page with the full route skeleton.
- Initial visits with no resolved data still show the normal loading skeleton.
- Explicit `null` results still clear the cached value and use the normal
  no-access/not-found behavior.
- Cached values must be scoped by user and route key.

## Task List Data

- After active tasks have resolved for a project, brief `undefined` query results
  from `tasks.listByProject` must not replace the table with the task-list
  skeleton.
- After archived tasks have resolved for a project, a transient
  `LoadingFirstPage` state from `tasks.listArchivedByProject` must not replace
  the archived table with the task-list skeleton.
- Initial active or archived task-list loads with no resolved rows still show the
  normal task-list skeleton.
- Switching projects or archive modes must not reuse task rows from another
  project or mode.

## Acceptance Checklist

- A resolved project page stays mounted through transient auth/query loading.
- A resolved active task list stays visible through a transient `undefined`
  `listByProject` result.
- A resolved archived task list stays visible through a transient
  `LoadingFirstPage` paginated-query state.
- Initial loading and explicit no-access states remain unchanged.

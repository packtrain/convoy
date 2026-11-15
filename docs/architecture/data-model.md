# Data model concepts

See `apps/web/convex/schema.ts` for the full schema, and
[CONTEXT.md](../../CONTEXT.md) for product vocabulary (task vs. list vs. status).

- **Task refs** — `{alias}-{refNumber}` (e.g. `ABC-5`), computed server-side.
- **Project `alias` vs `slug`** — `alias` is 2–5 uppercase chars (`ABC`); `slug`
  is URL-friendly.
- **Client IDs** — stable UUIDs used as React keys during optimistic updates
  (tasks only; other entities key on `_id`).
- **LexoRank** — string-based ordering for drag-and-drop.
- **Soft delete** — `isDeleted` flag everywhere. Always query with
  `isDeleted: false`. Tasks hard-delete after 30 days.
- **Subtasks** — tasks with a `parentId`.

When adding a task field, update `taskReturnValidator` in
`convex/tasks/lib/validators.ts`.

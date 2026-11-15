# Task Ref Numbers Specification

Every task has a human-facing reference like `ABC-123` ("ref"). This spec defines how ref numbers are allocated, stored, and kept unique per project.

## Scope

- Ref number allocation for all task-creation paths (single create, subtask, duplicate, MCP/agent create, future import/bulk flows)
- The dedicated `taskRefCounters` counter table and its repo
- Copying a ref from the UI

## Canonical Model

A task ref is `{project.alias}-{task.refNumber}`. `alias` is the 2–5 char project identifier; `refNumber` is a positive integer stored on the task.

Ref numbers are:

- **Per project** — uniqueness and monotonicity are scoped to one project. Two projects can both have a task `-1`.
- **Monotonic** — each allocation hands out a strictly higher number than the last; numbers are never reused, even after a task is deleted.
- **Contiguous within one reservation** — a bulk allocation of N numbers yields a gap-free range `[start, start + N)`. Across separate reservations, gaps are allowed (deleted tasks leave their numbers retired).

## Copying a Ref

Clicking a rendered ref (`TaskRef`) copies the ref. ⌘/ctrl-click copies the task page link, `/o/<orgSlug>/<alias>?task=<ref>` (`appRoute.task`), with the alias taken from the ref. The task menus' "Copy link" and "Open in new tab" use the same link. It never depends on the current page, so it opens the task page even from a thread (OS-2325).

The thread composer's task selector links each task the same way when its host passes no `getTaskHref` (OS-2326).

## Counter Storage

The next ref number to hand out lives in the dedicated `taskRefCounters` table — one row per project, `{ projectId, nextRefNumber }`, indexed `by_project` — **not** on the `projects` document (OS-934).

Why a separate table: the project document is in the read set of nearly every workspace query (project resolution, permission checks, every `projectValidator`-returning query). When the counter lived on the project doc, creating a task patched that doc and invalidated all of those subscriptions. Moving the counter to a narrowly-subscribed row removes that read amplification.

This does **not** reduce write serialization of task creation within a single project — there is still one counter row per project, so concurrent creates in the same project still conflict and retry under Convex OCC, exactly as before. Counter sharding (to parallelize same-project creates) is intentionally out of scope.

## Allocation

All creation paths reserve numbers through one helper, `reserveTaskRefNumbers(ctx, projectId, count)` (`apps/web/convex/tasks/lib/taskRefCountersRepo.ts`), which returns the first reserved number and advances the counter by `count` in a single write:

- **Single create** (web UI, MCP `create_task`, agents) reserves `count = 1`.
- **Duplicate** counts the task tree and reserves the whole range once, then assigns numbers in memory while inserting (OS-935). Future bulk/import flows follow the same pattern: reserve once, assign in memory.

`count` must be a positive integer.

### Counter resolution (lazy creation)

The helper never throws on a missing counter row. It resolves in this order:

1. existing `taskRefCounters` row → start at its `nextRefNumber`;
2. no row → start at `1`.

Every pre-OS-934 project was backfilled with a counter row, so a missing row means a project created after OS-934 (counters are created lazily, not at project creation), which has zero tasks — seeding at `1` is always correct. Lazy creation means no creation path needs an explicit counter-setup step, and is safe under Convex OCC: a concurrent first-create reads the empty `by_project` range, so the losing transaction conflicts on that read and retries, observing the row the winner inserted.

## History

The counter originally lived on `projects.nextRefNumber`. OS-934 moved it to `taskRefCounters` via a widen → backfill → narrow rollout: the field was made optional, a backfill seeded one counter row per project, a second migration unset the field, and a final deploy removed it from the schema and `projectValidator`. All of that transition code has since been deleted — the field no longer exists.

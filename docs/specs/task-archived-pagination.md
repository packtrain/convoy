# Archived Task Pagination

## Scope
- Project task table when `archiveFilter = "archived"`.
- Paginated archived task data loaded via `usePaginatedQuery`.

## Behavior
- Archived tasks are loaded incrementally (infinite load).
- Load-more trigger is enabled only in archived mode.
- Next page loads when the virtualized viewport is near the end of loaded rows.
- While the virtualizer reports active scrolling, load-more is deferred until scrolling settles.
  - This prevents React `flushSync` lifecycle warnings from synchronous virtualizer updates.
- If new archived rows arrive while scrolling is active, they are buffered and attached to the virtualizer only after scrolling settles.
- A loading indicator is shown while additional archived rows are loading.

## Non-Goals
- Active task mode pagination.
- Changes to task ordering semantics (archived ordering remains backend-defined).

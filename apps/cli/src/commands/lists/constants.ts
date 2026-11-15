/**
 * Per-List default view (OS-1566) enums, shared by `create` and `update`.
 * Source of truth is `projectViewModeValidator`/`boardGroupByValidator` in
 * `apps/web/convex/lib/contracts/validators.ts`; this package can't import it.
 */
export const DEFAULT_VIEW_MODES = ["list", "board"] as const;
export const BOARD_GROUP_BYS = [
  "status",
  "assignee",
  "priority",
  "type",
  "label",
] as const;

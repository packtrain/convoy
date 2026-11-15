/**
 * Coerce a caller's requested page size into `[min, max]`, clamped not rejected.
 *
 * Floors non-integers and sends `NaN` to the default: `v.number()` admits both,
 * `NaN` survives `Math.min`/`Math.max`, and `.take()` then fails opaquely.
 */
export function clampPageSize(
  requested: number | undefined,
  bounds: { min: number; max: number; default: number }
): number {
  const size = Number.isFinite(requested) ? Math.floor(requested as number) : bounds.default;
  return Math.max(bounds.min, Math.min(size, bounds.max));
}

/**
 * Empty paginated result constant.
 * Use in queries when returning early due to auth/access checks.
 */
export const EMPTY_PAGE: {
  page: never[];
  isDone: true;
  continueCursor: "";
} = {
  page: [],
  isDone: true,
  continueCursor: "",
};

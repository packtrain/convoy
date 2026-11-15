/**
 * Helpers for building `ctx.db.patch` objects from optional mutation args,
 * replacing per-field `if (args.x !== undefined) patch.x = args.x` blocks.
 *
 * Convex patch semantics make the key/value distinction matter: an absent key
 * means "don't change", while a key explicitly set to `undefined` removes the
 * field. `buildPatch` keeps a field only when its value is defined, and the
 * `CLEAR` marker (produced by `clearable`) turns into an explicitly-present
 * `undefined` key so Convex removes the field.
 *
 * ```ts
 * const patch = buildPatch<ProjectUpdatePatch>({
 *   name: args.name,                                     // undefined → key dropped
 *   color: clearable(args.color, validateProjectColor),  // null → clear, value → validate+set
 *   description: mapClearable(args.description, normalizeDescription),
 *   hiddenTaskTableColumns: mapDefined(args.hiddenTaskTableColumns, normalize),
 * });
 * ```
 *
 * Pass the generic explicitly (`buildPatch<ProjectUpdatePatch>`) so typos
 * become excess-property errors and each value is checked against its field.
 * Values are computed eagerly and mappers are sync — async validations stay
 * outside the literal.
 */

const CLEAR = Symbol("patch.clear");
type ClearMarker = typeof CLEAR;

type PatchFields<P extends object> = { [K in keyof P]?: P[K] | ClearMarker };

/**
 * Builds a patch from possibly-undefined values: `undefined` values are
 * dropped (key absent = "don't change"); `CLEAR` markers become explicit
 * `undefined` keys (Convex removes the field).
 */
export function buildPatch<P extends object>(fields: PatchFields<P>): Partial<P> {
  const patch: Partial<P> = {};
  for (const key of Object.keys(fields) as Array<keyof P>) {
    const value = fields[key];
    if (value === undefined) continue;
    patch[key] = value === CLEAR ? undefined : (value as P[keyof P]);
  }
  return patch;
}

/**
 * Whether a value about to be patched matches what the document already holds —
 * for skipping no-op writes on fat documents, where a rewrite costs the whole
 * doc plus every index (OS-1721). Key order and `undefined` fields don't count
 * as differences (Convex drops absent/undefined fields); array order does.
 *
 * JSON-safe values only: `v.int64()` throws, `v.bytes()` compares equal for
 * different buffers, and non-finite floats collapse to `null`.
 */
export function sameStoredValue(next: unknown, stored: unknown): boolean {
  return JSON.stringify(normalizeForCompare(next)) === JSON.stringify(normalizeForCompare(stored));
}

/**
 * The patch keys whose value differs from the stored document — for skipping
 * no-op writes and for "did this field really change" decisions. A key set to
 * `undefined` (a clear) counts as changed only if the field was actually set.
 */
export function changedFields<P extends object>(patch: P, stored: object): Array<keyof P> {
  const current = stored as Record<string, unknown>;
  return (Object.keys(patch) as Array<keyof P>).filter((key) => !sameStoredValue(patch[key], current[key as string]));
}

function normalizeForCompare(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeForCompare);
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, normalizeForCompare(entry)]);
  }
  return value;
}

/** Maps a value only when it is defined — for transform/validate fields. */
export function mapDefined<V, R>(value: V | undefined, map: (value: V) => R): R | undefined {
  if (value === undefined) {
    return undefined;
  }
  return map(value);
}

/**
 * Maps a provided value to either a patch value or a clear marker.
 * Use when `undefined` input means "don't change", but a mapper returning
 * `undefined`/`null` means "clear this field".
 */
export function mapClearable<V, R>(
  value: V | undefined,
  map: (value: V) => R | null | undefined
): NonNullable<R> | ClearMarker | undefined {
  if (value === undefined) {
    return undefined;
  }

  const mapped = map(value);
  return mapped == null ? CLEAR : (mapped as NonNullable<R>);
}

/** Tri-state fields: `undefined` = don't change, `null` = clear the field, value = set (after optional map). */
export function clearable<V>(value: V | null | undefined): V | ClearMarker | undefined;
export function clearable<V, R>(value: V | null | undefined, map: (value: V) => R): R | ClearMarker | undefined;
export function clearable<V, R>(
  value: V | null | undefined,
  map?: (value: V) => R
): V | R | ClearMarker | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return CLEAR;
  }
  return map ? map(value) : value;
}

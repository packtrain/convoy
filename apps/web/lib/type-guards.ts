export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function isNumber(value: unknown): value is number {
  return typeof value === "number";
}

/** The value if it is a finite number, otherwise undefined. */
export function getFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export function isStringArray(value: unknown): value is string[] {
  return isArray(value) && value.every((item) => isString(item));
}

/**
 * Compile-time exhaustiveness guard: use as the `default` of a switch over a
 * union so adding a variant fails typecheck instead of silently falling
 * through.
 */
export function assertNever(value: never): never {
  throw new Error(`Unhandled variant: ${String(value)}`);
}

export const is = {
  record: isRecord,
  string: isString,
  number: isNumber,
  boolean: isBoolean,
  array: isArray,
  stringArray: isStringArray,
};

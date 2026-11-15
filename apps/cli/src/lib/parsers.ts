export function parseOptionalNonEmptyString(
  value: string | undefined,
  label: string
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return normalized;
}

export function parseOptionalEnum<T extends string>(
  value: string | undefined,
  label: string,
  valid: readonly T[]
): T | undefined {
  const normalized = parseOptionalNonEmptyString(value, label);
  if (normalized === undefined) {
    return undefined;
  }

  if (!(valid as readonly string[]).includes(normalized)) {
    throw new Error(`${label} must be one of: ${valid.join(", ")}.`);
  }

  return normalized as T;
}

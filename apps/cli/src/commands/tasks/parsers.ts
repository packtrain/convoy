import { parseOptionalNonEmptyString } from "../../lib/parsers.js";

const VALID_PRIORITIES = ["None", "Low", "Medium", "High", "Critical"] as const;
const VALID_ARCHIVE_MODES = ["active", "archived"] as const;
const MAX_COMMENTS_LIMIT = 50;
const TASK_REF_PATTERN = /^[A-Z][A-Z0-9]{1,4}-\d+$/i;
const SCOPED_TASK_REF_PATTERN = /^([^/\s]+)\/([A-Z][A-Z0-9]{1,4}-\d+)$/i;

export const LIST_OPTION_DESCRIPTION = "List ID or bare List ref";

export type TaskPriority = (typeof VALID_PRIORITIES)[number];
export type TaskArchiveMode = (typeof VALID_ARCHIVE_MODES)[number];
export interface ScopedTaskRef {
  orgSlug: string;
  ref: string;
}

export function isTaskRef(value: string): boolean {
  return TASK_REF_PATTERN.test(value.trim());
}

export function parseScopedTaskRef(value: string): ScopedTaskRef | undefined {
  const match = value.trim().match(SCOPED_TASK_REF_PATTERN);
  if (!match) {
    return undefined;
  }

  const [, orgSlug, ref] = match;
  return {
    orgSlug,
    ref: ref.toUpperCase(),
  };
}

export function getProjectAliasFromTaskRef(ref: string): string {
  const dashIndex = ref.indexOf("-");
  if (dashIndex <= 0) {
    throw new Error(`Invalid task ref "${ref}".`);
  }

  return ref.slice(0, dashIndex).toUpperCase();
}

function splitValues(values: string[] | undefined): string[] {
  if (!values) {
    return [];
  }

  return values
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

export function parseOptionalTaskStatus(
  value: string | undefined,
): string | undefined {
  return parseOptionalNonEmptyString(value, "Status");
}

export function parseOptionalTaskTypeKey(
  value: string | undefined,
): string | undefined {
  return parseOptionalNonEmptyString(value, "Task type key");
}

export function parseOptionalTaskPriority(
  value: string | undefined,
): TaskPriority | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!VALID_PRIORITIES.includes(value as TaskPriority)) {
    throw new Error(
      `Invalid priority "${value}". Valid values: ${VALID_PRIORITIES.join(", ")}`,
    );
  }

  return value as TaskPriority;
}

export function parseOptionalTaskArchiveMode(
  value: string | undefined,
): TaskArchiveMode | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!VALID_ARCHIVE_MODES.includes(value as TaskArchiveMode)) {
    throw new Error(
      `Invalid archive mode "${value}". Valid values: ${VALID_ARCHIVE_MODES.join(", ")}`,
    );
  }

  return value as TaskArchiveMode;
}

export function parseOptionalListIdentifier(
  value: string | undefined,
): string | undefined {
  const normalized = parseOptionalNonEmptyString(value, "List");
  if (normalized === undefined) {
    return undefined;
  }
  if (normalized.includes("/")) {
    throw new Error(
      "Cross-project List refs containing '/' are not supported here. Use a raw List ID or a bare List ref like 'SPRINT-1'."
    );
  }

  return normalized;
}

export function parseOptionalCommentsLimit(
  value: string | undefined,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim();
  const limit = Number(normalized);
  if (!/^\d+$/.test(normalized) || limit < 1 || limit > MAX_COMMENTS_LIMIT) {
    throw new Error(
      `Invalid comments limit "${value}". Use an integer from 1 to ${MAX_COMMENTS_LIMIT}.`,
    );
  }

  return limit;
}

export function parseOptionalTags(
  values: string[] | undefined,
): string[] | undefined {
  const tags = splitValues(values);
  if (tags.length === 0) {
    return undefined;
  }
  return tags;
}

export function parseOptionalDueDate(
  value: string | undefined,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    if (numeric <= 0) {
      throw new Error("dueDate must be a positive timestamp");
    }

    // Treat plausible unix-second values as seconds and everything larger as
    // milliseconds. This handles leading zeroes and numeric notation better
    // than string-length checks.
    if (numeric < 1e11) {
      return numeric * 1000;
    }

    return numeric;
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(
      `Invalid due date "${value}". Use unix seconds/ms or ISO-8601.`,
    );
  }

  return parsed;
}

export function validateNoConflict(
  enabledFlag: boolean,
  hasValue: boolean,
  message: string,
): void {
  if (enabledFlag && hasValue) {
    throw new Error(message);
  }
}

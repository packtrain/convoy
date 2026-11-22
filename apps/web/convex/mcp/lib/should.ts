import type { Id, TableNames } from "../../_generated/dataModel";
import type { SystemTableNames } from "convex/server";
import { is } from "@/lib/type-guards";

export { is };

type Args = Record<string, unknown>;
type AnyTableName = TableNames | SystemTableNames;
const CONVEX_ID_LIKE_REGEX = /^[a-z0-9;_-]+$/i;
const MAX_CONVEX_ID_LENGTH = 128;

export class InvalidParamsError extends Error {}

export function throwInvalidParams(message: string): never {
  throw new InvalidParamsError(message);
}

/**
 * Reject anything that cannot be a Convex id before it reaches a query. Shape
 * only — whether the id names a live document of the right table is the query's
 * answer, not this module's.
 */
function assertIdShaped<T extends AnyTableName>(value: string, key: string): Id<T> {
  if (value.length > MAX_CONVEX_ID_LENGTH || !CONVEX_ID_LIKE_REGEX.test(value)) {
    throwInvalidParams(`${key} must be a valid Convex ID`);
  }
  return value as Id<T>;
}

export const should = {
  // ---------------------------------------------------------------------------
  // Assertion
  // ---------------------------------------------------------------------------

  beRecord(value: unknown, key?: string): Record<string, unknown> {
    if (!is.record(value)) {
      throwInvalidParams(`${key ?? "value"} must be an object`);
    }
    return value;
  },

  // ---------------------------------------------------------------------------
  // Required (throw if missing/invalid)
  // ---------------------------------------------------------------------------

  beString(args: Args, key: string): string {
    const value = args[key];
    if (!is.string(value) || value.length === 0) {
      throwInvalidParams(`${key} is required and must be a non-empty string`);
    }
    return value;
  },

  beTrimmedString(args: Args, key: string): string {
    const raw = args[key];
    if (!is.string(raw)) {
      throwInvalidParams(`${key} is required and must be a non-empty string`);
    }
    const value = raw.trim();
    if (value.length === 0) {
      throwInvalidParams(`${key} is required and must be a non-empty string`);
    }
    return value;
  },

  /**
   * For arguments where `""` is a value rather than a missing argument: a blank
   * file, or a replacement that deletes. `beString` rejects it.
   */
  bePossiblyEmptyString(args: Args, key: string): string {
    const value = args[key];
    if (!is.string(value)) {
      throwInvalidParams(`${key} is required and must be a string`);
    }
    return value;
  },

  beStringArray(args: Args, key: string, maxLength?: number): string[] {
    const value = args[key];
    if (!is.array(value) || value.length === 0 || !is.stringArray(value)) {
      throwInvalidParams(`${key} is required and must be a non-empty array of strings`);
    }
    if (maxLength !== undefined && value.length > maxLength) {
      throwInvalidParams(`${key} must have at most ${maxLength} items`);
    }
    return value;
  },

  beId<T extends AnyTableName>(args: Args, key: string): Id<T> {
    return assertIdShaped(should.beString(args, key), key);
  },

  // ---------------------------------------------------------------------------
  // Optional (undefined if missing)
  // ---------------------------------------------------------------------------

  beOptionalString(args: Args, key: string): string | undefined {
    const value = args[key];
    if (value === undefined || value === null) return undefined;
    if (!is.string(value)) {
      throwInvalidParams(`${key} must be a string`);
    }
    return value;
  },

  beOptionalNumber(args: Args, key: string): number | undefined {
    const value = args[key];
    if (value === undefined || value === null) return undefined;
    if (!is.number(value)) {
      throwInvalidParams(`${key} must be a number`);
    }
    return value;
  },

  beOptionalBoolean(args: Args, key: string): boolean | undefined {
    const value = args[key];
    if (value === undefined || value === null) return undefined;
    if (!is.boolean(value)) {
      throwInvalidParams(`${key} must be a boolean`);
    }
    return value;
  },

  beOptionalStringArray(args: Args, key: string): string[] | undefined {
    const value = args[key];
    if (value === undefined || value === null) return undefined;
    if (!is.array(value) || !is.stringArray(value)) {
      throwInvalidParams(`${key} must be an array of strings`);
    }
    return value;
  },

  /**
   * Validates the id's shape when present, like `beId` — an absent optional id
   * is a call shape, a malformed one is a mistake. Skipping the check would let
   * garbage reach a query that answers "no such document" with an empty page,
   * which a caller reads as "there is nothing here" rather than "fix your id".
   */
  beOptionalId<T extends AnyTableName>(args: Args, key: string): Id<T> | undefined {
    const value = should.beOptionalString(args, key);
    if (value === undefined) return undefined;
    return assertIdShaped<T>(value, key);
  },

  beOptionalInteger(args: Args, key: string, min: number, max: number): number | undefined {
    const value = args[key];
    if (value === undefined || value === null) return undefined;
    if (!is.number(value)) {
      throwInvalidParams(`${key} must be an integer between ${min} and ${max}`);
    }
    if (!Number.isInteger(value) || value < min || value > max) {
      throwInvalidParams(`${key} must be an integer between ${min} and ${max}`);
    }
    return value;
  },

  /** ISO-8601 date or datetime string → Unix ms. */
  beOptionalIsoDate(args: Args, key: string): number | undefined {
    const value = should.beOptionalString(args, key);
    if (value === undefined) return undefined;
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) {
      throwInvalidParams(`${key} must be an ISO-8601 date or datetime`);
    }
    return ms;
  },

  // ---------------------------------------------------------------------------
  // Nullable (null preserved, undefined if absent)
  // ---------------------------------------------------------------------------

  beNullableString(args: Args, key: string): string | null | undefined {
    const value = args[key];
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (!is.string(value)) {
      throwInvalidParams(`${key} must be a string or null`);
    }
    return value;
  },

  beNullableNumber(args: Args, key: string): number | null | undefined {
    const value = args[key];
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (!is.number(value)) {
      throwInvalidParams(`${key} must be a number or null`);
    }
    return value;
  },

  /** Shape-checked like `beId` and `beOptionalId`; `null` is a value, not an id. */
  beNullableId<T extends AnyTableName>(args: Args, key: string): Id<T> | null | undefined {
    const value = should.beNullableString(args, key);
    if (value === undefined) return undefined;
    if (value === null) return null;
    return assertIdShaped<T>(value, key);
  },

  // ---------------------------------------------------------------------------
  // Generic enum
  // ---------------------------------------------------------------------------

  beOptionalEnum<T extends string>(
    args: Args,
    key: string,
    valid: readonly T[]
  ): T | undefined {
    const value = should.beOptionalString(args, key);
    if (value === undefined) return undefined;
    if (!(valid as readonly string[]).includes(value)) {
      throwInvalidParams(`${key} must be one of: ${valid.join(", ")}`);
    }
    return value as T;
  },

  /** Tri-state enum: absent = don't change, null = clear, value = set. */
  beNullableEnum<T extends string>(
    args: Args,
    key: string,
    valid: readonly T[]
  ): T | null | undefined {
    const value = should.beNullableString(args, key);
    if (value === undefined || value === null) return value;
    if (!(valid as readonly string[]).includes(value)) {
      throwInvalidParams(`${key} must be one of: ${valid.join(", ")}, or null`);
    }
    return value as T;
  },

};

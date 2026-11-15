import { ConvexError } from "convex/values";

/**
 * Fluent guard for user-facing validations in Convex handlers. Wraps a value
 * (or a promise of one), lets checks chain, and throws `ConvexError(message)`
 * on the first failed check. Awaiting the chain yields the narrowed value.
 *
 * ```ts
 * const org = await ensure(getOrganizationBySlug(ctx, args.slug))
 *   .notDeleted("Organization not found");
 *
 * const org = await ensure(getOrganizationById(ctx, args.id))
 *   .active("Organization not found", "Organization has been deleted");
 *
 * const invitation = await ensure(getInvitationById(ctx, args.id))
 *   .notNull("Invitation not found")
 *   .satisfies((inv) => inv.status === "pending", "Can only revoke pending invitations");
 *
 * ensure(slug.length <= 50).isTrue("Slug must be at most 50 characters");
 * ensure(slug).regex(/^[a-z0-9-]+$/, "Slug is invalid");
 * ensure(invitation.status).eq("pending", "Can only revoke pending invitations");
 * ```
 *
 * Checks against immediate values throw synchronously. Checks against promises
 * run in chain order once the wrapped value resolves; await promise-backed
 * chains so a failed check surfaces as a rejection.
 */
export function ensure<T>(value: T | Promise<T>): Ensured<T> {
  return new Ensured(value);
}

export class Ensured<T> implements PromiseLike<T> {
  constructor(private readonly value: T | Promise<T>) {}

  /** Throws unless the value is neither `null` nor `undefined`. */
  notNull(message: string): Ensured<NonNullable<T>> {
    return this.check((value): value is NonNullable<T> => value !== null && value !== undefined, message);
  }

  /**
   * Soft-delete guard: throws when the document is missing OR flagged
   * `isDeleted`. Mirrors the ubiquitous
   * `if (!doc || doc.isDeleted) throw new ConvexError(...)` pattern.
   */
  notDeleted<U extends { isDeleted: boolean }>(this: Ensured<U | null | undefined>, message: string): Ensured<U> {
    return this.check((value): value is U => value !== null && value !== undefined && !value.isDeleted, message);
  }

  /** Throws distinct messages for missing vs. soft-deleted documents. */
  active<U extends { isDeleted: boolean }>(
    this: Ensured<U | null | undefined>,
    notFoundMessage: string,
    deletedMessage: string
  ): Ensured<U> {
    return this.map((value) => {
      if (value === null || value === undefined) {
        throw new ConvexError(notFoundMessage);
      }
      if (value.isDeleted) {
        throw new ConvexError(deletedMessage);
      }
      return value;
    });
  }

  /** Throws unless the value is `null` or `undefined`. */
  isNull(message: string): Ensured<Extract<T, null | undefined>> {
    return this.check((value): value is Extract<T, null | undefined> => value === null || value === undefined, message);
  }

  /** Throws unless the document is missing OR flagged `isDeleted`. */
  isNullOrDeleted<U extends { isDeleted: boolean }>(this: Ensured<U | null | undefined>, message: string): Ensured<U | null | undefined> {
    return this.check((value): value is U | null | undefined => value === null || value === undefined || value.isDeleted, message);
  }

  /** For boolean conditions: throws unless the value is strictly `true`. */
  isTrue(this: Ensured<boolean>, message: string): Ensured<true> {
    return this.check((value): value is true => value === true, message);
  }

  /** For boolean conditions: throws unless the value is strictly `false`. */
  isFalse(this: Ensured<boolean>, message: string): Ensured<false> {
    return this.check((value): value is false => value === false, message);
  }

  /** Throws unless the value is equal to `expected`. */
  eq<U extends T>(expected: U, message: string): Ensured<U> {
    return this.check((value): value is U => Object.is(value, expected), message);
  }

  /** Throws unless the value is not equal to `expected`. */
  notEq(expected: T, message: string): Ensured<T> {
    return this.check((value): value is T => !Object.is(value, expected), message);
  }

  /** For numbers: throws unless the value is greater than or equal to `minimum`. */
  gte(this: Ensured<number>, minimum: number, message: string): Ensured<number> {
    return this.check((value): value is number => value >= minimum, message);
  }

  /** For numbers: throws unless the value is less than or equal to `maximum`. */
  lte(this: Ensured<number>, maximum: number, message: string): Ensured<number> {
    return this.check((value): value is number => value <= maximum, message);
  }

  /** For numbers: throws unless the value is strictly less than `limit`. */
  lt(this: Ensured<number>, limit: number, message: string): Ensured<number> {
    return this.check((value): value is number => value < limit, message);
  }

  /** For numbers: throws unless the value is strictly greater than `limit`. */
  gt(this: Ensured<number>, limit: number, message: string): Ensured<number> {
    return this.check((value): value is number => value > limit, message);
  }

  /** For numbers: throws unless the value is between `minimum` and `maximum`, inclusive. */
  between(this: Ensured<number>, minimum: number, maximum: number, message: string): Ensured<number> {
    return this.check((value): value is number => value >= minimum && value <= maximum, message);
  }

  /** For strings: throws unless the value matches the regex. */
  regex(this: Ensured<string>, pattern: RegExp, message: string): Ensured<string> {
    return this.check((value): value is string => {
      pattern.lastIndex = 0;
      return pattern.test(value);
    }, message);
  }

  /** Generic escape hatch: throws unless the predicate holds. */
  satisfies(predicate: (value: T) => boolean, message: string): Ensured<T> {
    return this.map((value) => {
      if (!predicate(value)) {
        throw new ConvexError(message);
      }
      return value;
    });
  }

  private check<U extends T>(guard: (value: T) => value is U, message: string): Ensured<U> {
    return this.map((value) => {
      if (!guard(value)) {
        throw new ConvexError(message);
      }
      return value;
    });
  }

  private map<U>(mapper: (value: T) => U): Ensured<U> {
    if (isPromiseLike(this.value)) {
      return new Ensured(Promise.resolve(this.value).then(mapper));
    }

    return new Ensured(mapper(this.value));
  }

  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.value).then(onfulfilled, onrejected);
  }
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return (
    (typeof value === "object" || typeof value === "function") && value !== null && "then" in value && typeof value.then === "function"
  );
}

import { describe, expect, test } from "vitest";
import { ConvexError } from "convex/values";
import { ensure } from "./ensure";

async function expectConvexError(run: () => Promise<unknown>, message: string): Promise<void> {
  let caught: unknown;
  try {
    await run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ConvexError);
  expect((caught as ConvexError<string>).data).toBe(message);
}

function expectSyncConvexError(run: () => unknown, message: string): void {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ConvexError);
  expect((caught as ConvexError<string>).data).toBe(message);
}

describe("ensure", () => {
  describe("notNull", () => {
    test("returns the value when present", async () => {
      await expect(ensure("value").notNull("missing")).resolves.toBe("value");
    });

    test("accepts a promise input", async () => {
      const value = Promise.resolve({ name: "Org" });
      await expect(ensure(value).notNull("missing")).resolves.toEqual({
        name: "Org",
      });
    });

    test("throws ConvexError for null and undefined", async () => {
      expectSyncConvexError(() => ensure<string | null>(null).notNull("missing"), "missing");
      expectSyncConvexError(() => ensure<string | undefined>(undefined).notNull("missing"), "missing");
    });
  });

  describe("notDeleted", () => {
    test("returns the document when active", async () => {
      const doc = { isDeleted: false, name: "Org" };
      await expect(ensure<typeof doc | null>(doc).notDeleted("not found")).resolves.toBe(doc);
    });

    test("throws for missing documents", async () => {
      expectSyncConvexError(() => ensure<{ isDeleted: boolean } | null>(null).notDeleted("not found"), "not found");
    });

    test("throws for soft-deleted documents", async () => {
      expectSyncConvexError(
        () =>
          ensure<{ isDeleted: boolean } | null>({
            isDeleted: true,
          }).notDeleted("not found"),
        "not found"
      );
    });
  });

  describe("active", () => {
    test("returns the document when present and not deleted", async () => {
      const doc = { isDeleted: false, name: "Org" };
      await expect(ensure<typeof doc | null>(doc).active("missing", "deleted")).resolves.toBe(doc);
    });

    test("throws the not-found message for missing documents", () => {
      expectSyncConvexError(() => ensure<{ isDeleted: boolean } | null>(null).active("missing", "deleted"), "missing");
    });

    test("throws the deleted message for soft-deleted documents", () => {
      expectSyncConvexError(() => ensure({ isDeleted: true }).active("missing", "deleted"), "deleted");
    });
  });

  describe("isNull", () => {
    test("passes for null and undefined", async () => {
      await expect(ensure<string | null>(null).isNull("exists")).resolves.toBeNull();
      await expect(ensure<string | undefined>(undefined).isNull("exists")).resolves.toBeUndefined();
    });

    test("throws when a value is present", () => {
      expectSyncConvexError(() => ensure("value").isNull("exists"), "exists");
    });
  });

  describe("isNullOrDeleted", () => {
    test("passes for missing and soft-deleted documents", async () => {
      await expect(ensure<{ isDeleted: boolean } | null>(null).isNullOrDeleted("active")).resolves.toBeNull();
      await expect(ensure({ isDeleted: true }).isNullOrDeleted("active")).resolves.toEqual({ isDeleted: true });
    });

    test("throws for active documents", () => {
      expectSyncConvexError(() => ensure({ isDeleted: false }).isNullOrDeleted("active"), "active");
    });
  });

  describe("isTrue", () => {
    test("passes through on true", async () => {
      await expect(ensure(1 < 2).isTrue("nope")).resolves.toBe(true);
    });

    test("throws on false", async () => {
      expectSyncConvexError(() => ensure(1 > 2).isTrue("nope"), "nope");
    });
  });

  describe("isFalse", () => {
    test("passes through on false", async () => {
      await expect(ensure(1 > 2).isFalse("nope")).resolves.toBe(false);
    });

    test("throws on true", () => {
      expectSyncConvexError(() => ensure(1 < 2).isFalse("nope"), "nope");
    });
  });

  describe("equality guards", () => {
    test("eq passes for matching values", async () => {
      await expect(ensure("pending" as "pending" | "revoked").eq("pending", "wrong status")).resolves.toBe("pending");
    });

    test("eq throws for different values", () => {
      expectSyncConvexError(() => ensure("revoked" as "pending" | "revoked").eq("pending", "wrong status"), "wrong status");
    });

    test("notEq passes for different values", async () => {
      await expect(ensure("pending").notEq("revoked", "bad status")).resolves.toBe("pending");
    });

    test("notEq throws for matching values", () => {
      expectSyncConvexError(() => ensure("revoked").notEq("revoked", "bad status"), "bad status");
    });
  });

  describe("number guards", () => {
    test("gte passes for values at or above the minimum", async () => {
      await expect(ensure(2).gte(2, "too small")).resolves.toBe(2);
      await expect(ensure(3).gte(2, "too small")).resolves.toBe(3);
    });

    test("gte throws below the minimum", () => {
      expectSyncConvexError(() => ensure(1).gte(2, "too small"), "too small");
    });

    test("lte passes for values at or below the maximum", async () => {
      await expect(ensure(2).lte(2, "too large")).resolves.toBe(2);
      await expect(ensure(1).lte(2, "too large")).resolves.toBe(1);
    });

    test("lte throws above the maximum", () => {
      expectSyncConvexError(() => ensure(3).lte(2, "too large"), "too large");
    });

    test("lt passes below the limit and throws at or above it", async () => {
      await expect(ensure(1).lt(2, "at limit")).resolves.toBe(1);
      expectSyncConvexError(() => ensure(2).lt(2, "at limit"), "at limit");
    });

    test("gt passes above the limit and throws at or below it", async () => {
      await expect(ensure(3).gt(2, "at limit")).resolves.toBe(3);
      expectSyncConvexError(() => ensure(2).gt(2, "at limit"), "at limit");
    });

    test("between is inclusive", async () => {
      await expect(ensure(2).between(2, 50, "outside")).resolves.toBe(2);
      await expect(ensure(50).between(2, 50, "outside")).resolves.toBe(50);
    });

    test("between throws outside the range", () => {
      expectSyncConvexError(() => ensure(1).between(2, 50, "outside"), "outside");
      expectSyncConvexError(() => ensure(51).between(2, 50, "outside"), "outside");
    });
  });

  describe("regex", () => {
    test("passes strings matching the pattern", async () => {
      await expect(ensure("acme-1").regex(/^[a-z0-9-]+$/, "invalid")).resolves.toBe("acme-1");
    });

    test("throws for non-matching strings", () => {
      expectSyncConvexError(() => ensure("Acme 1").regex(/^[a-z0-9-]+$/, "invalid"), "invalid");
    });
  });

  describe("satisfies", () => {
    test("returns the value when the predicate holds", async () => {
      const invitation = { status: "pending" };
      await expect(ensure(invitation).satisfies((inv) => inv.status === "pending", "bad")).resolves.toBe(invitation);
    });

    test("throws when the predicate fails", async () => {
      expectSyncConvexError(
        () => ensure({ status: "revoked" }).satisfies((inv) => inv.status === "pending", "Can only revoke pending invitations"),
        "Can only revoke pending invitations"
      );
    });
  });

  describe("chaining", () => {
    test("runs checks in order and stops at the first failure", async () => {
      let predicateRan = false;

      await expectConvexError(
        async () =>
          ensure<{ isDeleted: boolean } | null>(null)
            .notNull("not found")
            .satisfies(() => {
              predicateRan = true;
              return true;
            }, "unused"),
        "not found"
      );
      expect(predicateRan).toBe(false);
    });

    test("narrows through the chain to the final value", async () => {
      const doc = Promise.resolve({ isDeleted: false, slug: "acme" });

      const result = await ensure(doc)
        .notDeleted("not found")
        .satisfies((org) => org.slug.length >= 2, "slug too short");

      expect(result.slug).toBe("acme");
    });

    test("checks immediate values synchronously", () => {
      expectSyncConvexError(() => ensure<string | null>(null).notNull("missing"), "missing");
    });

    test("promise-backed checks still surface on await", () => {
      const chain = ensure(Promise.resolve<string | null>(null)).notNull("missing");
      expect(chain).toBeDefined();
      return expectConvexError(async () => chain, "missing");
    });
  });
});

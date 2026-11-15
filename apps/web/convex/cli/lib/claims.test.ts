import { describe, expect, test } from "vitest";
import type { Doc, Id } from "../../_generated/dataModel";
import { assertThreadClaimedBySession, isThreadClaimExpired } from "./claims";

const SESSION_ID = "session_1" as Id<"cliSessions">;

/**
 * The gate reads five fields; the rest of a thread doc is irrelevant to it, so
 * these tests build the shape rather than a whole fixture. The integration
 * side (a real container reaching `startRunResponse`) lives in
 * `cli/messages.test.ts` — here we pin both branches for all six callers at
 * once.
 */
function thread(overrides: Partial<Doc<"cliThreads">> = {}): Doc<"cliThreads"> {
  return {
    claimedBySessionId: SESSION_ID,
    claimLeaseExpiresAt: Date.now() + 60_000,
    ...overrides,
  } as Doc<"cliThreads">;
}

describe("assertThreadClaimedBySession", () => {
  test("accepts a live claim held by the session", () => {
    expect(() => assertThreadClaimedBySession(thread(), SESSION_ID)).not.toThrow();
  });

  test("rejects a container even with a live claim (OS-1556)", () => {
    expect(() => assertThreadClaimedBySession(thread({ kind: "group" }), SESSION_ID)).toThrow(
      "Groups and workflow runs cannot be processed by a CLI"
    );
  });

  test("rejects an expired lease, and another session's claim", () => {
    expect(() =>
      assertThreadClaimedBySession(thread({ claimLeaseExpiresAt: Date.now() - 1 }), SESSION_ID)
    ).toThrow("Chat not claimed by this session");
    expect(() =>
      assertThreadClaimedBySession(thread({ claimedBySessionId: undefined }), SESSION_ID)
    ).toThrow("Chat not claimed by this session");
  });
});

describe("isThreadClaimExpired", () => {
  test("a missing or elapsed lease is expired; a future one is not", () => {
    const now = 1_000;
    expect(isThreadClaimExpired(thread({ claimLeaseExpiresAt: undefined }), now)).toBe(true);
    expect(isThreadClaimExpired(thread({ claimLeaseExpiresAt: now }), now)).toBe(true);
    expect(isThreadClaimExpired(thread({ claimLeaseExpiresAt: now + 1 }), now)).toBe(false);
  });
});

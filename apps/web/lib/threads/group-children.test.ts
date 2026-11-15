import { describe, expect, test } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";
import type { ThreadGroupChild } from "@/lib/threads/thread-query-patches";
import { pickDefaultChild } from "./group-children";

function child(id: string, lastActivityAt: number, isDone = false): ThreadGroupChild {
  return {
    _id: id as Id<"cliThreads">,
    title: id,
    lastActivityAt,
    isDone,
    // Neither status nor read state plays any part in picking a default tab;
    // both fixed so the fixture stays about activity and doneness.
    status: "completed",
    hasPendingInteraction: false,
    requiresAttention: false,
    hasUnread: false,
  };
}

describe("pickDefaultChild", () => {
  test("picks the most recently active child", () => {
    const children = [child("old", 1), child("recent", 3), child("mid", 2)];

    expect(pickDefaultChild(children)?._id).toBe("recent");
  });

  test("prefers a live child over a more recently active done one", () => {
    const children = [child("live", 1), child("finished", 3, true)];

    expect(pickDefaultChild(children)?._id).toBe("live");
    // All done: the most recent one still wins.
    expect(pickDefaultChild([child("a", 1, true), child("b", 2, true)])?._id).toBe("b");
  });

  test("selects the most recently completed child when all are done", () => {
    const children = [
      { ...child("recent-activity", 10, true), doneAt: 11 },
      { ...child("recent-completion", 1, true), doneAt: 20 },
    ];

    expect(pickDefaultChild(children)?._id).toBe("recent-completion");
  });

  test("skips the excluded child and leaves the input untouched", () => {
    const children = [child("a", 1), child("b", 2)];

    expect(pickDefaultChild(children, { exclude: "b" as Id<"cliThreads"> })?._id).toBe("a");
    expect(children.map((entry) => entry._id)).toEqual(["a", "b"]);
    expect(pickDefaultChild([])).toBeUndefined();
  });
});

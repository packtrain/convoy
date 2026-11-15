import { describe, expect, test, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { api } from "../../../_generated/api";
import type { ActionCtx } from "../../../_generated/server";
import { InvalidParamsError } from "../should";
import { resolveSpawnTarget } from "./resolution";

/**
 * `resolveSpawnTarget` (OS-1629). Both queries are mocked, so what is under test
 * is the classification, the `explicit ?? inherited` merge, and which id lands in
 * which field.
 */

const THREAD = {
  threadId: "thread_source",
  title: "Implement OS-1629",
  isDone: false,
  createdAt: 1,
  lastActivityAt: 2,
  status: "completed" as const,
  profileId: "profile_a",
  pathId: "path_a",
  path: "/Users/dev/contoso",
  cliType: "claude-code" as const,
  profileName: "Laptop",
  targetOnline: true,
};

const CONTAINER = {
  threadId: "container_1",
  title: "Group title",
  isDone: false,
  createdAt: 1,
  lastActivityAt: 2,
  kind: "group" as const,
  childCount: 2,
  aggregateStatus: "idle" as const,
  originThreadId: "thread_origin",
};

/** A group member: an ordinary thread summary with its own target tuple. */
function member(threadId: string, profileId: string, pathId: string) {
  return { ...THREAD, threadId, profileId, pathId };
}

/** Keyed by function name, not call order, so a test says which query answered. */
function createCtx(results: { summary?: unknown; members?: unknown }): {
  ctx: ActionCtx;
  runQuery: ReturnType<typeof vi.fn>;
} {
  const runQuery = vi.fn().mockImplementation(async (query: unknown) => {
    const name = getFunctionName(query as Parameters<typeof getFunctionName>[0]);
    if (name === getFunctionName(api.cli.threads.summaries.getSummary)) {
      return results.summary ?? null;
    }
    if (name === getFunctionName(api.cli.threads.summaries.listGroupSummaries)) {
      return results.members ?? [];
    }
    throw new Error(`Unexpected query: ${name}`);
  });

  return { ctx: { runQuery } as unknown as ActionCtx, runQuery };
}

describe("resolveSpawnTarget without a source thread", () => {
  test("takes the explicit tuple and asks for no create-path Group child", async () => {
    const { ctx, runQuery } = createCtx({});

    const target = await resolveSpawnTarget(ctx, "sk_user_test", {
      profileId: "profile_a",
      pathId: "path_a",
      cliType: "claude-code",
    });

    // No `Group child` routes the handler to `create`; nothing was read either.
    expect(target).toEqual({
      profileId: "profile_a",
      pathId: "path_a",
      cliType: "claude-code",
    });
    expect(runQuery).not.toHaveBeenCalled();
  });

  test.each(["profileId", "pathId", "cliType"])(
    "names %s when it is missing and there is nothing to inherit from",
    async (missing) => {
      const { ctx } = createCtx({});
      const args: Record<string, unknown> = {
        profileId: "profile_a",
        pathId: "path_a",
        cliType: "claude-code",
      };
      delete args[missing];

      await expect(resolveSpawnTarget(ctx, "sk_user_test", args)).rejects.toThrow(
        new RegExp(`${missing}.*sourceThreadId`)
      );
    }
  );

  test("rejects a cliType no connected runtime supports", async () => {
    const { ctx } = createCtx({});

    await expect(
      resolveSpawnTarget(ctx, "sk_user_test", {
        profileId: "profile_a",
        pathId: "path_a",
        cliType: "emacs",
      })
    ).rejects.toThrow(/cliType must be one of/);
  });
});

describe("resolveSpawnTarget from a plain thread", () => {
  test("inherits the whole tuple from the source", async () => {
    const { ctx } = createCtx({ summary: THREAD });

    const target = await resolveSpawnTarget(ctx, "sk_user_test", {
      sourceThreadId: "thread_source",
    });

    expect(target).toEqual({
      profileId: "profile_a",
      pathId: "path_a",
      cliType: "claude-code",
      // Both name the source: no container exists yet, `addThreadToGroup` makes it.
      addToGroup: { sourceThreadId: "thread_source", spawnedByThreadId: "thread_source" },
    });
  });

  test("cliType alone overrides just the runtime", async () => {
    const { ctx } = createCtx({ summary: THREAD });

    const target = await resolveSpawnTarget(ctx, "sk_user_test", {
      sourceThreadId: "thread_source",
      cliType: "codex",
    });

    // An enum, not a per-profile id, so it inherits and overrides independently.
    expect(target.cliType).toBe("codex");
    expect(target.profileId).toBe("profile_a");
    expect(target.pathId).toBe("path_a");
  });

  test("a different profileId without pathId is rejected, not silently inherited", async () => {
    // Path ids are per-profile UUIDs, so the source's would reach the domain as
    // PATH_NOT_FOUND_IN_PROFILE — every time, since no two profiles share one.
    const { ctx } = createCtx({ summary: THREAD });

    await expect(
      resolveSpawnTarget(ctx, "sk_user_test", {
        sourceThreadId: "thread_source",
        profileId: "profile_other",
      })
    ).rejects.toThrow(/pathId is required when profileId names a different machine/);
  });

  test("a different profileId with its own pathId cross-targets", async () => {
    const { ctx } = createCtx({ summary: THREAD });

    const target = await resolveSpawnTarget(ctx, "sk_user_test", {
      sourceThreadId: "thread_source",
      profileId: "profile_other",
      pathId: "path_other",
    });

    expect(target.profileId).toBe("profile_other");
    expect(target.pathId).toBe("path_other");
    // Runtime still inherited: only what was named changes.
    expect(target.cliType).toBe("claude-code");
  });

  test("re-sending the source's own profileId needs no pathId", async () => {
    // The guard is about *changing* machine, not about naming one redundantly.
    const { ctx } = createCtx({ summary: THREAD });

    const target = await resolveSpawnTarget(ctx, "sk_user_test", {
      sourceThreadId: "thread_source",
      profileId: "profile_a",
    });

    expect(target.pathId).toBe("path_a");
  });

  test("sends no expectedContainerId when the source is a plain thread", async () => {
    // There is no membership assumption to violate, so the mutation must not be
    // asked to check one — the source has no parent yet.
    const { ctx } = createCtx({ summary: THREAD });

    const target = await resolveSpawnTarget(ctx, "sk_user_test", {
      sourceThreadId: "thread_source",
    });

    expect(target.addToGroup?.expectedContainerId).toBeUndefined();
  });

  test("passes the api key to the read", async () => {
    const { ctx, runQuery } = createCtx({ summary: THREAD });

    await resolveSpawnTarget(ctx, "sk_user_test", { sourceThreadId: "thread_source" });

    expect(runQuery).toHaveBeenCalledWith(api.cli.threads.summaries.getSummary, {
      threadId: "thread_source",
      apiKey: "sk_user_test",
    });
  });

  test("a source it cannot read is an error, not a from-scratch create", async () => {
    // Falling through to `create` would silently make an ungrouped thread.
    const { ctx } = createCtx({ summary: null });

    await expect(
      resolveSpawnTarget(ctx, "sk_user_test", { sourceThreadId: "thread_missing" })
    ).rejects.toThrow(/Source thread not found/);
  });

  test("rejects a malformed source id before reading anything", async () => {
    const { ctx, runQuery } = createCtx({ summary: THREAD });

    await expect(
      resolveSpawnTarget(ctx, "sk_user_test", { sourceThreadId: "not a convex id!" })
    ).rejects.toThrow(InvalidParamsError);
    expect(runQuery).not.toHaveBeenCalled();
  });
});

describe("resolveSpawnTarget from a container", () => {
  test("resolves a group to its origin child and keeps lineage on the container", async () => {
    const { ctx } = createCtx({
      summary: CONTAINER,
      members: [
        member("thread_second", "profile_b", "path_b"),
        member("thread_origin", "profile_a", "path_a"),
      ],
    });

    const target = await resolveSpawnTarget(ctx, "sk_user_test", {
      sourceThreadId: "container_1",
    });

    // The origin wins over the first row, and the tuple comes from that child.
    expect(target.profileId).toBe("profile_a");
    expect(target.pathId).toBe("path_a");
    // The ids diverge: `addThreadToGroup` needs a child, the agent named the group.
    // `expectedContainerId` lets the mutation re-check the membership this
    // resolution assumed, since it resolved in an earlier transaction.
    expect(target.addToGroup).toEqual({
      sourceThreadId: "thread_origin",
      spawnedByThreadId: "container_1",
      expectedContainerId: "container_1",
    });
  });

  test("falls back to the first member when originThreadId is unset", async () => {
    // Containers predating the denorm; creation order, so first = oldest.
    const { ctx } = createCtx({
      summary: { ...CONTAINER, originThreadId: undefined },
      members: [member("thread_first", "profile_b", "path_b"), member("thread_second", "profile_c", "path_c")],
    });

    const target = await resolveSpawnTarget(ctx, "sk_user_test", {
      sourceThreadId: "container_1",
    });

    expect(target.addToGroup?.sourceThreadId).toBe("thread_first");
    expect(target.profileId).toBe("profile_b");
  });

  test("falls back to the first member when originThreadId names a row that is gone", async () => {
    // A preference over rows in hand, not a lookup, so a stale pointer self-heals.
    const { ctx } = createCtx({
      summary: CONTAINER,
      members: [member("thread_survivor", "profile_b", "path_b")],
    });

    const target = await resolveSpawnTarget(ctx, "sk_user_test", {
      sourceThreadId: "container_1",
    });

    expect(target.addToGroup?.sourceThreadId).toBe("thread_survivor");
  });

  test("reads done members too, so an all-done group is still spawnable", async () => {
    const { ctx, runQuery } = createCtx({
      summary: CONTAINER,
      members: [{ ...member("thread_origin", "profile_a", "path_a"), isDone: true }],
    });

    const target = await resolveSpawnTarget(ctx, "sk_user_test", {
      sourceThreadId: "container_1",
    });

    expect(runQuery).toHaveBeenCalledWith(api.cli.threads.summaries.listGroupSummaries, {
      parentThreadId: "container_1",
      includeDone: true,
      apiKey: "sk_user_test",
    });
    expect(target.addToGroup?.sourceThreadId).toBe("thread_origin");
  });

  test("a group with no members left is an error", async () => {
    const { ctx } = createCtx({ summary: CONTAINER, members: [] });

    await expect(
      resolveSpawnTarget(ctx, "sk_user_test", { sourceThreadId: "container_1" })
    ).rejects.toThrow(/Group has no live threads/);
  });

  test("an empty workflow container accepts an explicit target without a seed member", async () => {
    const { ctx } = createCtx({ summary: { ...CONTAINER, workflowRunId: "wfrun_1" }, members: [] });
    const target = await resolveSpawnTarget(ctx, "sk_user_test", {
      sourceThreadId: "container_1", profileId: "profile_a", pathId: "path_a", cliType: "codex",
    });
    expect(target).toEqual({
      profileId: "profile_a", pathId: "path_a", cliType: "codex",
      addToGroup: { sourceThreadId: "container_1", spawnedByThreadId: "container_1", expectedContainerId: "container_1" },
    });
  });

  test.each(["profileId", "pathId", "cliType"])("an empty workflow container explains its missing %s", async (missing) => {
    const { ctx } = createCtx({ summary: { ...CONTAINER, workflowRunId: "wfrun_1" }, members: [] });
    const args: Record<string, unknown> = { sourceThreadId: "container_1", profileId: "profile_a", pathId: "path_a", cliType: "codex" };
    delete args[missing];
    await expect(resolveSpawnTarget(ctx, "sk_user_test", args)).rejects.toThrow(`${missing} is required when the workflow container has no live threads`);
  });

  test("a workflow run resolves to a lane thread for an independent sibling", async () => {
    const { ctx } = createCtx({
      summary: { ...CONTAINER, workflowRunId: "wfrun_1" },
      members: [member("thread_origin", "profile_a", "path_a")],
    });
    const target = await resolveSpawnTarget(ctx, "sk_user_test", { sourceThreadId: "container_1" });
    expect(target.addToGroup).toEqual({
      sourceThreadId: "thread_origin",
      spawnedByThreadId: "container_1",
      expectedContainerId: "container_1",
    });
  });
});

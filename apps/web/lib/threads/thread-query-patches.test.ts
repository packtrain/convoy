import { describe, expect, test, vi } from "vitest";
import type { OptimisticLocalStore } from "convex/browser";
import { getFunctionName, type FunctionReference } from "convex/server";
import type { Id } from "@/convex/_generated/dataModel";
import {
  moveThreadOutOfGroup,
  patchThreadQueries,
  removeThreadFromGroup,
  type ThreadPatchTarget,
} from "./thread-query-patches";

const threadId = "thread-1" as Id<"cliThreads">;
const containerId = "container-1" as Id<"cliThreads">;

const target: ThreadPatchTarget = {
  threadId,
  containerId,
};

function makeLocalStore(values: {
  detail?: {
    _id: Id<"cliThreads">;
    title: string;
    hasUnread: boolean;
    parentThreadId?: Id<"cliThreads">;
    containerChildCount?: number;
  };
  group?: {
    children: Array<{
      _id: Id<"cliThreads">;
      title: string;
      lastActivityAt: number;
      hasUnread?: boolean;
    }>;
    totalRowCount: number;
  };
}) {
  const getQuery = vi.fn((query: FunctionReference<"query">) => {
    const name = getFunctionName(query);
    if (name === "cli/threads/core:get") {
      return values.detail;
    }
    if (name === "cli/threads/groups:getGroup") {
      return values.group;
    }
    return undefined;
  });
  const setQuery = vi.fn();
  const localStore = { getQuery, setQuery } as unknown as OptimisticLocalStore;
  const writes = () =>
    setQuery.mock.calls.map(([query, args, value]) => ({
      name: getFunctionName(query as FunctionReference<"query">),
      args,
      value,
    }));
  return { localStore, setQuery, writes };
}

const detail = { _id: threadId, title: "Old", hasUnread: true };
const group = {
  children: [
    { _id: threadId, title: "Old", lastActivityAt: 1 },
    { _id: "thread-2" as Id<"cliThreads">, title: "Other", lastActivityAt: 2 },
  ],
  totalRowCount: 2,
};

describe("patchThreadQueries", () => {
  test("patches the detail query and the matching group child", () => {
    const { localStore, writes } = makeLocalStore({ detail, group });

    patchThreadQueries(localStore, target, { title: "New" });

    expect(writes()).toEqual([
      {
        name: "cli/threads/core:get",
        args: { threadId: "thread-1" },
        value: { ...detail, title: "New" },
      },
      {
        name: "cli/threads/groups:getGroup",
        args: { containerId },
        value: { ...group, children: [{ ...group.children[0], title: "New" }, group.children[1]] },
      },
    ]);
  });

  test("removeThreadFromGroup drops the child without rewriting the detail query", () => {
    const { localStore, writes } = makeLocalStore({ detail, group });

    removeThreadFromGroup(localStore, target);

    expect(writes()).toEqual([
      {
        name: "cli/threads/groups:getGroup",
        args: { containerId },
        value: { ...group, children: [group.children[1]] },
      },
    ]);
  });

  test("projects done state and its sort key onto the group child (OS-1478)", () => {
    const { localStore, writes } = makeLocalStore({ detail, group });

    patchThreadQueries(localStore, target, { isDone: true, doneAt: 42 });

    expect(writes()).toEqual([
      {
        name: "cli/threads/core:get",
        args: { threadId: "thread-1" },
        // `doneAt` is group-only — the detail item derives `isDone` server-side.
        value: { ...detail, isDone: true },
      },
      {
        name: "cli/threads/groups:getGroup",
        args: { containerId },
        value: {
          ...group,
          children: [{ ...group.children[0], isDone: true, doneAt: 42 }, group.children[1]],
        },
      },
    ]);
  });

  test("moveThreadOutOfGroup unparents the detail and drops the tab", () => {
    const child = { ...detail, parentThreadId: containerId, containerChildCount: 2 };
    const { localStore, writes } = makeLocalStore({ detail: child, group });

    moveThreadOutOfGroup(localStore, target);

    expect(writes()).toEqual([
      {
        name: "cli/threads/core:get",
        args: { threadId: "thread-1" },
        value: { ...child, parentThreadId: undefined, containerChildCount: undefined },
      },
      {
        name: "cli/threads/groups:getGroup",
        args: { containerId },
        value: { ...group, children: [group.children[1]] },
      },
    ]);
  });

  // Children carry `hasUnread` since OS-1618, so mark-read has to reach the tab
  // projection too — the active tab reads the detail doc, but it stops being
  // active the moment the user switches away and would take the dot back.
  test("clears the tab's unread dot alongside the detail row", () => {
    const { localStore, writes } = makeLocalStore({ detail, group });

    patchThreadQueries(localStore, target, { hasUnread: false });

    expect(writes()).toEqual([
      {
        name: "cli/threads/core:get",
        args: { threadId: "thread-1" },
        value: { ...detail, hasUnread: false },
      },
      {
        name: "cli/threads/groups:getGroup",
        args: { containerId },
        value: {
          ...group,
          children: [{ ...group.children[0], hasUnread: false }, group.children[1]],
        },
      },
    ]);
  });

  // `requiresAttention` is what flips a failed tab's red dot to quiet through
  // `getThreadDisplayStatus`, so acknowledging attention has to reach the child
  // too — same reason as `hasUnread` above.
  test("clears the tab's attention state alongside the detail row", () => {
    const { localStore, writes } = makeLocalStore({ detail, group });

    patchThreadQueries(localStore, target, { hasUnread: false, requiresAttention: false });

    expect(writes()).toEqual([
      {
        name: "cli/threads/core:get",
        args: { threadId: "thread-1" },
        value: { ...detail, hasUnread: false, requiresAttention: false },
      },
      {
        name: "cli/threads/groups:getGroup",
        args: { containerId },
        value: {
          ...group,
          children: [
            { ...group.children[0], hasUnread: false, requiresAttention: false },
            group.children[1],
          ],
        },
      },
    ]);
  });

  test("skips the group write when the patch has no child-visible fields", () => {
    const { localStore, writes } = makeLocalStore({ detail, group });

    // Every field a tab reads is now child-visible, so the guard is reached
    // only by an empty patch — kept because `patchThreadQueries` is called with
    // spread-built patches whose fields are all conditional.
    patchThreadQueries(localStore, target, {});

    expect(writes()).toEqual([
      {
        name: "cli/threads/core:get",
        args: { threadId: "thread-1" },
        value: { ...detail },
      },
    ]);
  });

  test("no-ops when neither query is cached, and skips a detail row for a different thread", () => {
    const empty = makeLocalStore({});
    patchThreadQueries(empty.localStore, target, { title: "New" });
    expect(empty.setQuery).not.toHaveBeenCalled();

    const mismatch = makeLocalStore({
      detail: { ...detail, _id: "thread-9" as Id<"cliThreads"> },
    });
    patchThreadQueries(mismatch.localStore, { ...target, containerId: undefined }, { title: "New" });
    expect(mismatch.setQuery).not.toHaveBeenCalled();
  });
});

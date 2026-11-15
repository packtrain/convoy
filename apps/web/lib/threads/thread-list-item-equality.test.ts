import { describe, expect, test } from "vitest";
import type { ThreadListItemData } from "@/components/blocks/thread/thread-list-item";
import type { Id } from "@/convex/_generated/dataModel";
import {
  areThreadListItemsEqual,
  areThreadListsEqual,
} from "./thread-list-item-equality";

/**
 * Both samples list every field, so a field added to the interface fails this
 * file to compile until it is given a value here and a differing one below —
 * the runtime half of the type-level exhaustiveness the comparator itself
 * enforces. `changed` admits `undefined` per field because a single-literal
 * field (`kind`) can only differ by absence.
 */
type EveryField = Required<ThreadListItemData>;
type EveryFieldChanged = ThreadListItemData & {
  [Key in keyof EveryField]: EveryField[Key] | undefined;
};

const baseline: EveryField = {
  _id: "thread_1" as Id<"cliThreads">,
  title: "Ship the badge",
  branch: "feat/badge",
  pathLabel: "web",
  pathString: "/home/dev/web",
  gitRemoteUrl: "git@github.com:acme/web.git",
  linesAdded: 12,
  linesRemoved: 3,
  pullRequest: {
    provider: "github",
    number: 7,
    title: "Add the badge",
    url: "https://github.com/acme/web/pull/7",
    state: "open",
    headBranch: "feat/badge",
    baseBranch: "main",
    capturedAt: 1000,
  },
  attachedPullRequest: { owner: "contoso", name: "web", number: 7, ref: "contoso/web#7" },
  associatedTask: {
    _id: "task_1" as Id<"tasks">,
    refId: "OS-1",
    name: "Ship the badge",
    taskType: {
      key: "task",
      name: "Task",
      icon: "Dot",
      color: "#64748b",
      isSystem: true,
    },
    isArchived: false,
  },
  status: "completed",
  hasPendingInteraction: false,
  queueHeldAt: 2000,
  cliType: "claude-code",
  agent: { name: "Reviewer", color: "#ff0000", isDeleted: false },
  hasUnread: false,
  requiresAttention: false,
  isDone: false,
  lastActivityAt: 3000,
  isPinned: false,
  kind: "group",
  sharedAt: 4000,
  parentThreadId: "thread_parent" as Id<"cliThreads">,
  containerSharedAt: 5000,
  containerKind: "group",
  workflowRunId: "wfrun_1" as Id<"workflowRuns">,
  containerWorkflowRunId: "wfrun_1" as Id<"workflowRuns">,
  workflow: { _id: "wf_1" as Id<"workflows">, name: "Release Train", color: "#ef4444" },
};

const changed: EveryFieldChanged = {
  _id: "thread_2" as Id<"cliThreads">,
  title: "Ship the other badge",
  branch: "feat/other",
  pathLabel: "api",
  pathString: "/home/dev/api",
  gitRemoteUrl: "git@github.com:acme/api.git",
  linesAdded: 13,
  linesRemoved: 4,
  pullRequest: { ...baseline.pullRequest, state: "merged" },
  associatedTask: { ...baseline.associatedTask, name: "Something else" },
  attachedPullRequest: { ...baseline.attachedPullRequest, number: 8, ref: "contoso/web#8" },
  status: "streaming",
  hasPendingInteraction: true,
  queueHeldAt: 2001,
  cliType: "codex",
  agent: { ...baseline.agent, color: "#00ff00" },
  hasUnread: true,
  requiresAttention: true,
  isDone: true,
  lastActivityAt: 3001,
  isPinned: true,
  kind: undefined,
  sharedAt: 4001,
  parentThreadId: "thread_other_parent" as Id<"cliThreads">,
  containerSharedAt: 5001,
  containerKind: undefined,
  workflowRunId: "wfrun_2" as Id<"workflowRuns">,
  containerWorkflowRunId: "wfrun_2" as Id<"workflowRuns">,
  workflow: { _id: "wf_1" as Id<"workflows">, name: "Release Train", color: "#3b82f6" },
};

function withField<Key extends keyof ThreadListItemData>(
  key: Key,
  value: ThreadListItemData[Key] | undefined
): ThreadListItemData {
  return { ...baseline, [key]: value };
}

// `Object.keys` erases the key type; the sample is exactly `ThreadListItemData`,
// so every key it yields is one of its keys.
const threadFieldKeys = Object.keys(baseline) as (keyof ThreadListItemData)[];

describe("areThreadListItemsEqual (OS-1581)", () => {
  test("treats a structurally identical copy as equal", () => {
    expect(areThreadListItemsEqual(baseline, { ...baseline })).toBe(true);
  });

  test.each(threadFieldKeys)("detects a change to %s", (key) => {
    expect(areThreadListItemsEqual(baseline, withField(key, changed[key]))).toBe(
      false
    );
  });

  test("compares the pull request by value, not by identity", () => {
    expect(
      areThreadListItemsEqual(baseline, {
        ...baseline,
        pullRequest: { ...baseline.pullRequest },
      })
    ).toBe(true);
  });

  test.each([
    ["title", { ...baseline.pullRequest, title: "Renamed" }],
    ["capturedAt", { ...baseline.pullRequest, capturedAt: 9999 }],
  ] as const)("detects a pull request %s change", (_field, pullRequest) => {
    expect(areThreadListItemsEqual(baseline, { ...baseline, pullRequest })).toBe(
      false
    );
  });

  test("detects a renamed associated task", () => {
    expect(
      areThreadListItemsEqual(baseline, {
        ...baseline,
        associatedTask: { ...baseline.associatedTask, name: "Renamed" },
      })
    ).toBe(false);
  });

  test("detects an agent that was deleted out from under the row", () => {
    expect(
      areThreadListItemsEqual(baseline, {
        ...baseline,
        agent: { ...baseline.agent, isDeleted: true },
      })
    ).toBe(false);
  });

  // Unsharing and un-parenting clear the field rather than change it, which
  // is how `sharedAt` slipped past the sidebar's old comparator (OS-1576).
  test.each([
    ["pullRequest", { ...baseline, pullRequest: undefined }],
    ["agent", { ...baseline, agent: undefined }],
    ["sharedAt", { ...baseline, sharedAt: undefined }],
    ["containerSharedAt", { ...baseline, containerSharedAt: undefined }],
    ["containerKind", { ...baseline, containerKind: undefined }],
    ["parentThreadId", { ...baseline, parentThreadId: undefined }],
    ["kind", { ...baseline, kind: undefined }],
  ] as const)("detects %s being cleared", (_field, next) => {
    expect(areThreadListItemsEqual(baseline, next)).toBe(false);
  });
});

describe("areThreadListsEqual (OS-1581)", () => {
  test("holds for a rebuilt list of structurally identical rows", () => {
    expect(areThreadListsEqual([baseline], [{ ...baseline }])).toBe(true);
  });

  test("fails when a row is added or removed", () => {
    expect(areThreadListsEqual([baseline], [baseline, changed])).toBe(false);
  });

  test("fails when the rows are reordered", () => {
    expect(
      areThreadListsEqual([baseline, changed], [changed, baseline])
    ).toBe(false);
  });

  test("fails when any row changed", () => {
    expect(
      areThreadListsEqual(
        [baseline, baseline],
        [baseline, { ...baseline, title: "Renamed" }]
      )
    ).toBe(false);
  });
});

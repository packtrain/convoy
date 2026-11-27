import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { listAgentThreadWorkByTask } from "../../tasks/lib/agentThreadWorkRepo";
import { api, internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import { createTestContext } from "../../../convex-testing";
import type { WorkflowDefinition } from "../../lib/contracts/workflowDefinition";
import { errors } from "../errors";
import { KICKOFF_STEP_ID } from "./lib/resolution";
import {
  markThreadStreamEnded,
  requeueThreadForRetry,
  setThreadHasPendingInteraction,
  softDeleteThread,
} from "../../cli/threads/lib/cliThreadsRepo";

const PATHS = { paths: [{ id: "path-1", path: "/repo/path-1", label: "path-1" }] };

/** One single lane, two stages of one prompt each — the slice-2 happy path. */
function singleLaneDefinition(): WorkflowDefinition {
  return {
    lanes: [{ laneId: "lane-1", name: "Executor", type: "single", defaults: { cliType: "claude-code", mode: "act" } }],
    stages: [
      {
        stageId: "stage-1",
        name: "Plan",
        steps: [
          {
            stepId: "step-1",
            laneId: "lane-1",
            action: { type: "prompt", content: { displayContent: "plan it" }, overrides: { mode: "plan" } },
          },
        ],
      },
      {
        stageId: "stage-2",
        name: "Build",
        steps: [{ stepId: "step-2", laneId: "lane-1", action: { type: "prompt", content: { displayContent: "build it" } } }],
      },
    ],
  };
}

/** Two single lanes × two stages — the OS-1869 concurrency shape. */
function twoLaneDefinition(): WorkflowDefinition {
  return {
    lanes: [
      { laneId: "lane-a", name: "Executor", type: "single", defaults: { cliType: "claude-code", mode: "act" } },
      { laneId: "lane-b", name: "Reviewer", type: "single", defaults: { cliType: "claude-code", mode: "act" } },
    ],
    stages: [
      {
        stageId: "stage-1",
        name: "Work",
        steps: [
          { stepId: "step-a1", laneId: "lane-a", action: { type: "prompt", content: { displayContent: "build it" } } },
          { stepId: "step-b1", laneId: "lane-b", action: { type: "prompt", content: { displayContent: "review the approach" } } },
        ],
      },
      {
        stageId: "stage-2",
        name: "Verify",
        steps: [
          { stepId: "step-a2", laneId: "lane-a", action: { type: "prompt", content: { displayContent: "fix findings" } } },
          { stepId: "step-b2", laneId: "lane-b", action: { type: "prompt", content: { displayContent: "verify fixes" } } },
        ],
      },
    ],
  };
}

async function setupStartedRun(options?: {
  definition?: WorkflowDefinition;
  startExtras?: Record<string, unknown>;
}) {
  const ctx = createTestContext();
  const { user, project, asUser, t } = await ctx.setupProject();
  const profile = await ctx.cliProfile(user._id, project._id, PATHS);
  const workflowId = await asUser.mutation(api.workflows.core.create, {
    projectId: project._id,
    name: "Release Train",
    definition: options?.definition ?? singleLaneDefinition(),
  });
  const { runId, containerThreadId } = await asUser.mutation(api.workflows.runs.core.start, {
    workflowId,
    profileId: profile._id,
    pathId: "path-1",
    ...options?.startExtras,
  });
  // Run the start-scheduled advance: it dispatches the first step.
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  return { ctx, t, user, project, profile, asUser, workflowId, runId, containerThreadId };
}

type Harness = Awaited<ReturnType<typeof setupStartedRun>>;

function stepById(steps: Doc<"workflowRunSteps">[], definitionStepId: string): Doc<"workflowRunSteps"> {
  return steps.find((step) => step.definitionStepId === definitionStepId)!;
}

async function stepsOf(h: Harness): Promise<Doc<"workflowRunSteps">[]> {
  return h.t.run(async (runCtx) =>
    runCtx.db
      .query("workflowRunSteps")
      .withIndex("by_run_and_stageOrder_and_laneOrder_and_stepOrder", (q) => q.eq("runId", h.runId))
      .collect()
  );
}

async function messagesOf(h: Harness, threadId: Id<"cliThreads">): Promise<Doc<"cliMessages">[]> {
  return h.t.run(async (runCtx) =>
    runCtx.db
      .query("cliMessages")
      .withIndex("by_thread_and_createdAt", (q) => q.eq("threadId", threadId))
      .collect()
  );
}

/** Simulate the CLI finishing a thread run through the real write seam, then run the scheduled advance. */
async function endThreadRun(h: Harness, threadId: Id<"cliThreads">, status: Doc<"cliThreads">["status"]): Promise<void> {
  await h.t.run(async (runCtx) => {
    await markThreadStreamEnded(runCtx, threadId, {
      status,
      hasPendingUserMessages: false,
      processingState: "idle",
      lastActivityAt: Date.now(),
    });
  });
  await h.t.finishAllScheduledFunctions(() => vi.runAllTimers());
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("workflow run engine (advance)", () => {
  test("start dispatches the first prompt into a lazily-created lane thread", async () => {
    const h = await setupStartedRun({
      startExtras: { worktree: { parentPathId: "path-1", branch: "feat/run-1" } },
    });

    const steps = await stepsOf(h);
    const first = steps.find((step) => step.definitionStepId === "step-1");
    expect(first).toMatchObject({ status: "running", attemptCount: 1 });
    expect(first?.startedAt).toBeDefined();
    expect(first?.threadId).toBeDefined();
    expect(first?.userMessageId).toBeDefined();
    // The second stage stays untouched until the first completes.
    expect(steps.find((step) => step.definitionStepId === "step-2")?.status).toBe("pending");

    await h.t.run(async (runCtx) => {
      const thread = (await runCtx.db.get("cliThreads", first!.threadId!))!;
      expect(thread).toMatchObject({
        parentThreadId: h.containerThreadId,
        workflowRunId: h.runId,
        workflowLaneId: "lane-1",
        title: "Release Train — Executor",
        status: "pending",
        hasPendingUserMessages: true,
        userId: h.user._id,
      });
      // The run's one shared checkout travels to the lane thread.
      expect(thread.git?.worktree).toMatchObject({ branch: "feat/run-1", status: "pending" });

      const lane = await runCtx.db
        .query("workflowRunLanes")
        .withIndex("by_run_and_laneId", (q) => q.eq("runId", h.runId).eq("laneId", "lane-1"))
        .unique();
      expect(lane?.threadId).toBe(first!.threadId);

      const container = (await runCtx.db.get("cliThreads", h.containerThreadId))!;
      expect(container.childCount).toBe(1);
      expect(container.aggregateStatus).toBe("running");
    });

    const messages = await messagesOf(h, first!.threadId!);
    expect(messages).toHaveLength(1);
    // Stamped with the step; the step's mode override wins over the lane default.
    expect(messages[0]).toMatchObject({
      workflowRunStepId: first!._id,
      content: [],
      cliMode: "plan",
      role: "user",
    });
  });

  test("a completed thread run advances the lane into the next stage, in the same thread", async () => {
    const h = await setupStartedRun();
    const [first] = await stepsOf(h);

    await endThreadRun(h, first.threadId!, "completed");

    const steps = await stepsOf(h);
    expect(steps.map((step) => [step.definitionStepId, step.status])).toEqual([
      ["step-1", "completed"],
      ["step-2", "running"],
    ]);
    expect(steps[0].finishedAt).toBeDefined();
    // The single lane keeps one conversation: the follow-up lands in the same thread.
    expect(steps[1].threadId).toBe(first.threadId);

    const messages = await messagesOf(h, first.threadId!);
    expect(messages).toHaveLength(2);
    // No mode override on step-2 — the lane default applies.
    expect(messages[1]).toMatchObject({ workflowRunStepId: steps[1]._id, cliMode: "act" });

    await h.t.run(async (runCtx) => {
      const thread = (await runCtx.db.get("cliThreads", first.threadId!))!;
      expect(thread.hasPendingUserMessages).toBe(true);
      expect(thread.status).toBe("pending");
      const run = (await runCtx.db.get("workflowRuns", h.runId))!;
      expect(run.status).toBe("running");
    });
  });

  test("the final step's completion completes the run and idles the container", async () => {
    const h = await setupStartedRun();
    const [first] = await stepsOf(h);

    await endThreadRun(h, first.threadId!, "completed");
    await endThreadRun(h, first.threadId!, "completed");

    const steps = await stepsOf(h);
    expect(steps.every((step) => step.status === "completed")).toBe(true);
    await h.t.run(async (runCtx) => {
      const run = (await runCtx.db.get("workflowRuns", h.runId))!;
      expect(run.status).toBe("completed");
      expect(run.completedAt).toBeDefined();
      const container = (await runCtx.db.get("cliThreads", h.containerThreadId))!;
      expect(container.aggregateStatus).toBe("idle");
    });
  });

  test("the first-prompt override is dispatched; later steps read the pinned version", async () => {
    const h = await setupStartedRun({
      startExtras: { firstPromptOverride: { displayContent: "plan it my way" } },
    });
    const [first] = await stepsOf(h);

    const chunksText = async (threadId: Id<"cliThreads">, messageId: Id<"cliMessages">) =>
      h.t.run(async (runCtx) => {
        const chunks = await runCtx.db
          .query("cliMessageChunks")
          .withIndex("by_thread_and_message_and_chunkOrder", (q) => q.eq("threadId", threadId).eq("messageId", messageId))
          .collect();
        return chunks.map((chunk) => chunk.data).join("");
      });

    expect(await chunksText(first.threadId!, first.userMessageId!)).toBe("plan it my way");

    await endThreadRun(h, first.threadId!, "completed");
    const second = (await stepsOf(h)).find((step) => step.definitionStepId === "step-2")!;
    expect(await chunksText(second.threadId!, second.userMessageId!)).toBe("build it");
  });

  test("a failed thread run parks the run for its starting user", async () => {
    const h = await setupStartedRun();
    const [first] = await stepsOf(h);

    await endThreadRun(h, first.threadId!, "failed");

    const steps = await stepsOf(h);
    expect(steps[0]).toMatchObject({ status: "failed", errorMessage: "The step's thread run failed" });
    expect(steps[1].status).toBe("pending");
    await h.t.run(async (runCtx) => {
      const run = (await runCtx.db.get("workflowRuns", h.runId))!;
      expect(run.status).toBe("needs_attention");
      const container = (await runCtx.db.get("cliThreads", h.containerThreadId))!;
      expect(container.aggregateStatus).toBe("needs_attention");
    });
    // Parked: nothing new was dispatched.
    expect(await messagesOf(h, first.threadId!)).toHaveLength(1);
  });

  test("retrying the failed thread revives its step and resumes the run", async () => {
    const h = await setupStartedRun();
    const [first] = await stepsOf(h);
    await endThreadRun(h, first.threadId!, "failed");

    // The user hits retry on the failed message — the requeue seam advances the run.
    await h.t.run(async (runCtx) => {
      await requeueThreadForRetry(runCtx, first.threadId!, first.userMessageId!, Date.now());
    });
    await h.t.finishAllScheduledFunctions(() => vi.runAllTimers());

    let steps = await stepsOf(h);
    expect(steps[0].status).toBe("running");
    expect(steps[0].errorMessage).toBeUndefined();
    await h.t.run(async (runCtx) => {
      const run = (await runCtx.db.get("workflowRuns", h.runId))!;
      expect(run.status).toBe("running");
      const container = (await runCtx.db.get("cliThreads", h.containerThreadId))!;
      expect(container.aggregateStatus).toBe("running");
    });

    // The recovered thread completing finishes the step and dispatches the next.
    await endThreadRun(h, first.threadId!, "completed");
    steps = await stepsOf(h);
    expect(steps.map((step) => step.status)).toEqual(["completed", "running"]);
  });

  test("a manual prompt into the failed lane thread revives its step and resumes the run", async () => {
    const h = await setupStartedRun();
    const [first] = await stepsOf(h);
    await endThreadRun(h, first.threadId!, "failed");

    await h.asUser.mutation(api.cli.messages.send, {
      threadId: first.threadId!,
      content: "fix the lint error and continue",
    });
    await h.t.finishAllScheduledFunctions(() => vi.runAllTimers());

    const steps = await stepsOf(h);
    expect(steps.map((step) => step.status)).toEqual(["running", "pending"]);
    await h.t.run(async (runCtx) => {
      // The recovery message is the fix, not steering — no lane hold.
      const lane = await runCtx.db
        .query("workflowRunLanes")
        .withIndex("by_run_and_laneId", (q) => q.eq("runId", h.runId).eq("laneId", "lane-1"))
        .unique();
      expect(lane?.hold).toBeUndefined();
      const run = (await runCtx.db.get("workflowRuns", h.runId))!;
      expect(run.status).toBe("running");
    });
  });

  test("an advance while the thread is still failed leaves the run parked", async () => {
    const h = await setupStartedRun();
    const [first] = await stepsOf(h);
    await endThreadRun(h, first.threadId!, "failed");

    await h.t.mutation(internal.workflows.runs.core.advance, { runId: h.runId });

    expect((await stepsOf(h))[0].status).toBe("failed");
    await h.t.run(async (runCtx) => {
      expect((await runCtx.db.get("workflowRuns", h.runId))!.status).toBe("needs_attention");
    });
  });

  test("an advance does not resume a wait-parked run", async () => {
    const definition = singleLaneDefinition();
    definition.stages[1].steps = [{ stepId: "step-2", laneId: "lane-1", action: { type: "wait" } }];
    const h = await setupStartedRun({ definition });
    const [first] = await stepsOf(h);
    await endThreadRun(h, first.threadId!, "completed");

    await h.t.mutation(internal.workflows.runs.core.advance, { runId: h.runId });

    await h.t.run(async (runCtx) => {
      expect((await runCtx.db.get("workflowRuns", h.runId))!.status).toBe("needs_attention");
    });
  });

  test("waiting_input keeps the step running until the user's answer completes it", async () => {
    const h = await setupStartedRun();
    const [first] = await stepsOf(h);

    await endThreadRun(h, first.threadId!, "waiting_input");

    let steps = await stepsOf(h);
    expect(steps.map((step) => step.status)).toEqual(["running", "pending"]);
    expect(await messagesOf(h, first.threadId!)).toHaveLength(1);

    // The user answers in-thread; that response's run completing finishes the same step.
    await endThreadRun(h, first.threadId!, "completed");
    steps = await stepsOf(h);
    expect(steps.map((step) => step.status)).toEqual(["completed", "running"]);
  });

  test("a lane thread waiting on the user flips the container dot to needs_attention, and the answer clears it", async () => {
    const h = await setupStartedRun();
    const [first] = await stepsOf(h);

    await endThreadRun(h, first.threadId!, "waiting_input");

    await h.t.run(async (runCtx) => {
      const container = (await runCtx.db.get("cliThreads", h.containerThreadId))!;
      expect(container.aggregateStatus).toBe("needs_attention");
      // The run itself is not parked — the step still finishes in-thread.
      const run = (await runCtx.db.get("workflowRuns", h.runId))!;
      expect(run.status).toBe("running");
    });

    // The user's answer puts the lane back to work — the dot clears.
    await h.asUser.mutation(api.cli.messages.send, {
      threadId: first.threadId!,
      content: "yes, use the staging config",
    });
    await h.t.finishAllScheduledFunctions(() => vi.runAllTimers());
    await h.t.run(async (runCtx) => {
      expect((await runCtx.db.get("cliThreads", h.containerThreadId))!.aggregateStatus).toBe("running");
    });
  });

  test("a mid-stream interaction request flips the container dot, and resolving it clears it", async () => {
    const h = await setupStartedRun();
    const [first] = await stepsOf(h);

    // The agent asks mid-stream (AskUserQuestion / approval) — no stream end.
    await h.t.run(async (runCtx) => {
      await setThreadHasPendingInteraction(runCtx, first.threadId!, true);
    });
    await h.t.finishAllScheduledFunctions(() => vi.runAllTimers());
    await h.t.run(async (runCtx) => {
      expect((await runCtx.db.get("cliThreads", h.containerThreadId))!.aggregateStatus).toBe("needs_attention");
    });

    await h.t.run(async (runCtx) => {
      await setThreadHasPendingInteraction(runCtx, first.threadId!, false);
    });
    await h.t.finishAllScheduledFunctions(() => vi.runAllTimers());
    await h.t.run(async (runCtx) => {
      expect((await runCtx.db.get("cliThreads", h.containerThreadId))!.aggregateStatus).toBe("running");
    });
  });

  test("a wait step parks the run instead of dispatching", async () => {
    const definition = singleLaneDefinition();
    definition.stages[1].steps = [{ stepId: "step-2", laneId: "lane-1", action: { type: "wait" } }];
    const h = await setupStartedRun({ definition });
    const [first] = await stepsOf(h);

    await endThreadRun(h, first.threadId!, "completed");

    const steps = await stepsOf(h);
    expect(steps.map((step) => step.status)).toEqual(["completed", "waiting"]);
    await h.t.run(async (runCtx) => {
      const run = (await runCtx.db.get("workflowRuns", h.runId))!;
      expect(run.status).toBe("needs_attention");
      const container = (await runCtx.db.get("cliThreads", h.containerThreadId))!;
      expect(container.aggregateStatus).toBe("needs_attention");
    });
    expect(await messagesOf(h, first.threadId!)).toHaveLength(1);
  });

  test("a canceled run dispatches nothing, even with an advance already scheduled", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, PATHS);
    const workflowId = await asUser.mutation(api.workflows.core.create, {
      projectId: project._id,
      name: "Release Train",
      definition: singleLaneDefinition(),
    });
    const { runId } = await asUser.mutation(api.workflows.runs.core.start, {
      workflowId,
      profileId: profile._id,
      pathId: "path-1",
    });
    // Cancel lands before the start-scheduled advance gets to run.
    await asUser.mutation(api.workflows.runs.core.cancel, { runId });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    await t.run(async (runCtx) => {
      const steps = await runCtx.db
        .query("workflowRunSteps")
        .withIndex("by_run_and_stageOrder_and_laneOrder_and_stepOrder", (q) => q.eq("runId", runId))
        .collect();
      expect(steps.every((step) => step.status === "pending")).toBe(true);
      const lane = await runCtx.db
        .query("workflowRunLanes")
        .withIndex("by_run_and_laneId", (q) => q.eq("runId", runId).eq("laneId", "lane-1"))
        .unique();
      expect(lane?.threadId).toBeUndefined();
    });
  });

  test("a follow-up dispatch after revoked project access fails the step and parks the run", async () => {
    const h = await setupStartedRun();
    const [first] = await stepsOf(h);

    // Revoke the starter's memberships between the first and second dispatch.
    await h.t.run(async (runCtx) => {
      for (const member of await runCtx.db.query("projectMembers").collect()) {
        if (member.userId === h.user._id) {
          await runCtx.db.delete("projectMembers", member._id);
        }
      }
      for (const member of await runCtx.db.query("organizationMembers").collect()) {
        if (member.userId === h.user._id) {
          await runCtx.db.delete("organizationMembers", member._id);
        }
      }
    });
    await endThreadRun(h, first.threadId!, "completed");

    const steps = await stepsOf(h);
    expect(steps[0].status).toBe("completed");
    expect(steps[1].status).toBe("failed");
    expect(steps[1].errorMessage).toBeDefined();
    await h.t.run(async (runCtx) => {
      const run = (await runCtx.db.get("workflowRuns", h.runId))!;
      expect(run.status).toBe("needs_attention");
    });
    // The refused dispatch rolled back: no second message reached the thread.
    expect(await messagesOf(h, first.threadId!)).toHaveLength(1);

    // A dispatch failure has nothing to recover in-thread — an advance leaves it parked.
    await h.t.mutation(internal.workflows.runs.core.advance, { runId: h.runId });
    expect((await stepsOf(h))[1].status).toBe("failed");
  });

  test("follow-up dispatches refresh the thread's last-used CLI selection", async () => {
    const h = await setupStartedRun();
    const [first] = await stepsOf(h);

    await endThreadRun(h, first.threadId!, "completed");

    await h.t.run(async (runCtx) => {
      const thread = (await runCtx.db.get("cliThreads", first.threadId!))!;
      // Step 2 dispatched with the lane default mode — the composer denorm follows (OS-1454).
      expect(thread.metadata?.cli?.lastUsedMode).toBe("act");
    });
  });

  test("deleting the lane thread fails its step and parks the run", async () => {
    const h = await setupStartedRun();
    const [first] = await stepsOf(h);

    await h.t.run(async (runCtx) => {
      await softDeleteThread(runCtx, first.threadId!, Date.now());
    });
    await h.t.finishAllScheduledFunctions(() => vi.runAllTimers());

    const steps = await stepsOf(h);
    expect(steps[0]).toMatchObject({ status: "failed", errorMessage: "The step's thread was deleted" });
    await h.t.run(async (runCtx) => {
      const run = (await runCtx.db.get("workflowRuns", h.runId))!;
      expect(run.status).toBe("needs_attention");
    });
  });

  test("cancel marks in-flight steps canceled so nothing reads as still running", async () => {
    const h = await setupStartedRun();

    await h.asUser.mutation(api.workflows.runs.core.cancel, { runId: h.runId });

    const steps = await stepsOf(h);
    expect(steps.map((step) => step.status)).toEqual(["canceled", "pending"]);
    expect(steps[0].finishedAt).toBeDefined();
    await h.t.run(async (runCtx) => {
      const run = (await runCtx.db.get("workflowRuns", h.runId))!;
      expect(run.status).toBe("canceled");
    });
  });

  test("a manual message holds the lane: the step settles but nothing else dispatches", async () => {
    const h = await setupStartedRun();
    const [first] = await stepsOf(h);

    const manualMessageId = await h.asUser.mutation(api.cli.messages.send, {
      threadId: first.threadId!,
      content: "actually, also check the tests",
    });
    await endThreadRun(h, first.threadId!, "completed");

    const steps = await stepsOf(h);
    expect(steps.map((step) => step.status)).toEqual(["completed", "pending"]);
    await h.t.run(async (runCtx) => {
      const lane = await runCtx.db
        .query("workflowRunLanes")
        .withIndex("by_run_and_laneId", (q) => q.eq("runId", h.runId).eq("laneId", "lane-1"))
        .unique();
      expect(lane?.hold?.triggeringMessageId).toBe(manualMessageId);
      const run = (await runCtx.db.get("workflowRuns", h.runId))!;
      expect(run.status).toBe("needs_attention");
    });
    // Step 1's prompt + the manual message; no step-2 prompt.
    expect(await messagesOf(h, first.threadId!)).toHaveLength(2);
  });

  test("resumeLane clears the hold and dispatches the next step", async () => {
    const h = await setupStartedRun();
    const [first] = await stepsOf(h);

    await h.asUser.mutation(api.cli.messages.send, {
      threadId: first.threadId!,
      content: "actually, also check the tests",
    });
    await endThreadRun(h, first.threadId!, "completed");

    await h.asUser.mutation(api.workflows.runs.core.resumeLane, { runId: h.runId, laneId: "lane-1" });
    await h.t.finishAllScheduledFunctions(() => vi.runAllTimers());

    const steps = await stepsOf(h);
    expect(steps.map((step) => step.status)).toEqual(["completed", "running"]);
    await h.t.run(async (runCtx) => {
      const lane = await runCtx.db
        .query("workflowRunLanes")
        .withIndex("by_run_and_laneId", (q) => q.eq("runId", h.runId).eq("laneId", "lane-1"))
        .unique();
      expect(lane?.hold).toBeUndefined();
      const run = (await runCtx.db.get("workflowRuns", h.runId))!;
      expect(run.status).toBe("running");
    });
    expect(await messagesOf(h, first.threadId!)).toHaveLength(3);
  });

  test("an answer during waiting_input does not hold the lane", async () => {
    const h = await setupStartedRun();
    const [first] = await stepsOf(h);

    await endThreadRun(h, first.threadId!, "waiting_input");
    await h.asUser.mutation(api.cli.messages.send, {
      threadId: first.threadId!,
      content: "yes, use the staging config",
    });
    await endThreadRun(h, first.threadId!, "completed");

    const steps = await stepsOf(h);
    expect(steps.map((step) => step.status)).toEqual(["completed", "running"]);
  });

  test("a retry requeue triggers an advance without double-dispatching", async () => {
    const h = await setupStartedRun();
    const [first] = await stepsOf(h);

    await h.t.run(async (runCtx) => {
      await requeueThreadForRetry(runCtx, first.threadId!, first.userMessageId!, Date.now());
    });
    await h.t.finishAllScheduledFunctions(() => vi.runAllTimers());

    const steps = await stepsOf(h);
    expect(steps.map((step) => step.status)).toEqual(["running", "pending"]);
    expect(await messagesOf(h, first.threadId!)).toHaveLength(1);
  });

  test("an attached task binds lane threads into the task's activity as workflow_run work", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id);
    const profile = await ctx.cliProfile(user._id, project._id, PATHS);
    const workflowId = await asUser.mutation(api.workflows.core.create, {
      projectId: project._id,
      name: "Release Train",
      definition: singleLaneDefinition(),
    });
    await asUser.mutation(api.workflows.runs.core.start, {
      workflowId,
      profileId: profile._id,
      pathId: "path-1",
      taskId: task._id,
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    await t.run(async (runCtx) => {
      const rows = await listAgentThreadWorkByTask(runCtx, task.projectId, task._id);
      const laneEntry = rows.find((entry) => entry.source === "workflow_run");
      expect(laneEntry).toBeDefined();
      const thread = (await runCtx.db.get("cliThreads", laneEntry!.threadId))!;
      expect(thread.associatedTaskId).toBe(task._id);
      expect(thread.workflowLaneId).toBe("lane-1");
    });
  });
});

describe("a run with an attached pull request (OS-2383)", () => {
  test("every lane thread and each step's message carry the PR", async () => {
    const h = await setupStartedRun({ startExtras: { pullRequestUrl: "https://github.com/Contoso/Convoy/pull/482" } });
    const attached = { owner: "Contoso", name: "Convoy", number: 482, ref: "contoso/convoy#482" };
    const [first] = await stepsOf(h);

    const thread = await h.t.run((runCtx) => runCtx.db.get("cliThreads", first.threadId!));
    expect(thread?.attachedPullRequest).toEqual(attached);

    // The next stage goes through the follow-up dispatch, not thread creation.
    await endThreadRun(h, first.threadId!, "completed");
    const messages = await messagesOf(h, first.threadId!);
    expect(messages).toHaveLength(2);
    expect(messages.map((message) => message.pullRequest)).toEqual([attached, attached]);
  });
});

describe("concurrent lanes and the stage barrier (OS-1869)", () => {
  test("start dispatches every lane's first step, each into its own thread", async () => {
    const h = await setupStartedRun({ definition: twoLaneDefinition() });

    const steps = await stepsOf(h);
    const a1 = stepById(steps, "step-a1");
    const b1 = stepById(steps, "step-b1");
    expect(a1.status).toBe("running");
    expect(b1.status).toBe("running");
    expect(a1.threadId).not.toBe(b1.threadId);
    expect(stepById(steps, "step-a2").status).toBe("pending");
    expect(stepById(steps, "step-b2").status).toBe("pending");
    await h.t.run(async (runCtx) => {
      const container = (await runCtx.db.get("cliThreads", h.containerThreadId))!;
      expect(container.childCount).toBe(2);
      expect(container.aggregateStatus).toBe("running");
    });
  });

  test("a finished lane waits at the stage barrier until every lane clears the stage", async () => {
    const h = await setupStartedRun({ definition: twoLaneDefinition() });
    let steps = await stepsOf(h);
    const a1 = stepById(steps, "step-a1");
    const b1 = stepById(steps, "step-b1");

    await endThreadRun(h, a1.threadId!, "completed");

    steps = await stepsOf(h);
    expect(stepById(steps, "step-a1").status).toBe("completed");
    // Lane B is still in stage 1 — lane A's stage-2 step waits on the barrier.
    expect(stepById(steps, "step-a2").status).toBe("pending");
    expect(await messagesOf(h, a1.threadId!)).toHaveLength(1);
    await h.t.run(async (runCtx) => {
      expect((await runCtx.db.get("workflowRuns", h.runId))!.status).toBe("running");
    });

    await endThreadRun(h, b1.threadId!, "completed");

    steps = await stepsOf(h);
    // The barrier opens: both stage-2 steps dispatch, each into its lane's thread.
    expect(stepById(steps, "step-a2")).toMatchObject({ status: "running", threadId: a1.threadId });
    expect(stepById(steps, "step-b2")).toMatchObject({ status: "running", threadId: b1.threadId });
  });

  test("a failed lane stops only itself; the run parks when the survivor hits the barrier", async () => {
    const h = await setupStartedRun({ definition: twoLaneDefinition() });
    let steps = await stepsOf(h);
    const a1 = stepById(steps, "step-a1");
    const b1 = stepById(steps, "step-b1");

    await endThreadRun(h, a1.threadId!, "failed");

    steps = await stepsOf(h);
    expect(stepById(steps, "step-a1").status).toBe("failed");
    expect(stepById(steps, "step-b1").status).toBe("running");
    await h.t.run(async (runCtx) => {
      // Lane B still works, so the run is not parked — but it is the user's turn somewhere.
      expect((await runCtx.db.get("workflowRuns", h.runId))!.status).toBe("running");
      expect((await runCtx.db.get("cliThreads", h.containerThreadId))!.aggregateStatus).toBe("needs_attention");
    });

    await endThreadRun(h, b1.threadId!, "completed");

    steps = await stepsOf(h);
    expect(stepById(steps, "step-b1").status).toBe("completed");
    // Stage 1 holds lane B's next step; nothing can move without the user.
    expect(stepById(steps, "step-b2").status).toBe("pending");
    await h.t.run(async (runCtx) => {
      expect((await runCtx.db.get("workflowRuns", h.runId))!.status).toBe("needs_attention");
    });
  });

  test("a recovery prompt into the failed lane takes no hold while the other lane still runs", async () => {
    const h = await setupStartedRun({ definition: twoLaneDefinition() });
    const a1 = stepById(await stepsOf(h), "step-a1");
    await endThreadRun(h, a1.threadId!, "failed");

    await h.asUser.mutation(api.cli.messages.send, {
      threadId: a1.threadId!,
      content: "fix the lint error and continue",
    });
    await h.t.finishAllScheduledFunctions(() => vi.runAllTimers());

    expect(stepById(await stepsOf(h), "step-a1").status).toBe("running");
    await h.t.run(async (runCtx) => {
      const lane = await runCtx.db
        .query("workflowRunLanes")
        .withIndex("by_run_and_laneId", (q) => q.eq("runId", h.runId).eq("laneId", "lane-a"))
        .unique();
      expect(lane?.hold).toBeUndefined();
    });
  });

  test("a held lane blocks only itself; Resume dispatches its blocked step", async () => {
    const h = await setupStartedRun({ definition: twoLaneDefinition() });
    let steps = await stepsOf(h);
    const a1 = stepById(steps, "step-a1");
    const b1 = stepById(steps, "step-b1");

    // Steering message into lane A while its step still runs — holds the lane.
    await h.asUser.mutation(api.cli.messages.send, { threadId: a1.threadId!, content: "also check the tests" });
    await endThreadRun(h, a1.threadId!, "completed");
    await endThreadRun(h, b1.threadId!, "completed");

    steps = await stepsOf(h);
    // The barrier opens for lane B; held lane A dispatches nothing.
    expect(stepById(steps, "step-a2").status).toBe("pending");
    expect(stepById(steps, "step-b2").status).toBe("running");
    await h.t.run(async (runCtx) => {
      expect((await runCtx.db.get("workflowRuns", h.runId))!.status).toBe("running");
      // The hold blocks a dispatch — the user's turn shows on the dot already.
      expect((await runCtx.db.get("cliThreads", h.containerThreadId))!.aggregateStatus).toBe("needs_attention");
    });

    // The run detail marks the blocked step so the Run view renders Resume on it.
    const detail = await h.asUser.query(api.workflows.runs.core.get, { runId: h.runId });
    const detailSteps = detail!.stages.flatMap((stage) => stage.steps);
    expect(detailSteps.filter((step) => step.held).map((step) => step.definitionStepId)).toEqual(["step-a2"]);

    await endThreadRun(h, b1.threadId!, "completed");
    await h.t.run(async (runCtx) => {
      // Lane B is done; the held lane is the last blocker — now the run parks.
      expect((await runCtx.db.get("workflowRuns", h.runId))!.status).toBe("needs_attention");
    });

    await h.asUser.mutation(api.workflows.runs.core.resumeLane, { runId: h.runId, laneId: "lane-a" });
    await h.t.finishAllScheduledFunctions(() => vi.runAllTimers());

    steps = await stepsOf(h);
    expect(stepById(steps, "step-a2")).toMatchObject({ status: "running", threadId: a1.threadId });
    await h.t.run(async (runCtx) => {
      expect((await runCtx.db.get("workflowRuns", h.runId))!.status).toBe("running");
    });

    await endThreadRun(h, a1.threadId!, "completed");
    await h.t.run(async (runCtx) => {
      expect((await runCtx.db.get("workflowRuns", h.runId))!.status).toBe("completed");
    });
  });

  test("a steering message into a healthy lane still holds while the run is parked on another lane", async () => {
    const h = await setupStartedRun({ definition: twoLaneDefinition() });
    const steps = await stepsOf(h);
    const a1 = stepById(steps, "step-a1");
    const b1 = stepById(steps, "step-b1");

    // Lane A fails, lane B finishes stage 1 — the run parks at the barrier.
    await endThreadRun(h, a1.threadId!, "failed");
    await endThreadRun(h, b1.threadId!, "completed");
    await h.t.run(async (runCtx) => {
      expect((await runCtx.db.get("workflowRuns", h.runId))!.status).toBe("needs_attention");
    });

    // Steering healthy lane B is steering, parked run or not.
    await h.asUser.mutation(api.cli.messages.send, { threadId: b1.threadId!, content: "also update the changelog" });
    await h.t.finishAllScheduledFunctions(() => vi.runAllTimers());
    await h.t.run(async (runCtx) => {
      const lane = await runCtx.db
        .query("workflowRunLanes")
        .withIndex("by_run_and_laneId", (q) => q.eq("runId", h.runId).eq("laneId", "lane-b"))
        .unique();
      expect(lane?.hold).toBeDefined();
    });

    // Lane A recovers and completes — the barrier opens, but held lane B gets nothing.
    await h.t.run(async (runCtx) => {
      await requeueThreadForRetry(runCtx, a1.threadId!, a1.userMessageId!, Date.now());
    });
    await h.t.finishAllScheduledFunctions(() => vi.runAllTimers());
    await endThreadRun(h, a1.threadId!, "completed");

    const after = await stepsOf(h);
    expect(stepById(after, "step-a2").status).toBe("running");
    expect(stepById(after, "step-b2").status).toBe("pending");
    // Lane B's thread holds its step-1 prompt + the steering message only.
    expect(await messagesOf(h, b1.threadId!)).toHaveLength(2);
  });

  test("a manual message between Resume and the rescheduled advance holds the lane again", async () => {
    const h = await setupStartedRun();
    const [first] = await stepsOf(h);

    await h.asUser.mutation(api.cli.messages.send, { threadId: first.threadId!, content: "also check the tests" });
    await endThreadRun(h, first.threadId!, "completed");

    // Resume, then steer again before the scheduled advance runs.
    await h.asUser.mutation(api.workflows.runs.core.resumeLane, { runId: h.runId, laneId: "lane-1" });
    await h.asUser.mutation(api.cli.messages.send, { threadId: first.threadId!, content: "wait, one more thing" });
    await h.t.finishAllScheduledFunctions(() => vi.runAllTimers());

    const steps = await stepsOf(h);
    expect(steps.map((step) => step.status)).toEqual(["completed", "pending"]);
    await h.t.run(async (runCtx) => {
      const lane = await runCtx.db
        .query("workflowRunLanes")
        .withIndex("by_run_and_laneId", (q) => q.eq("runId", h.runId).eq("laneId", "lane-1"))
        .unique();
      expect(lane?.hold).toBeDefined();
    });
  });

  test("a message into a lane parked on a wait step takes no hold", async () => {
    const definition = singleLaneDefinition();
    definition.stages[1].steps = [{ stepId: "step-2", laneId: "lane-1", action: { type: "wait" } }];
    const h = await setupStartedRun({ definition });
    const [first] = await stepsOf(h);
    await endThreadRun(h, first.threadId!, "completed");

    await h.asUser.mutation(api.cli.messages.send, { threadId: first.threadId!, content: "any update?" });
    await h.t.finishAllScheduledFunctions(() => vi.runAllTimers());

    await h.t.run(async (runCtx) => {
      const lane = await runCtx.db
        .query("workflowRunLanes")
        .withIndex("by_run_and_laneId", (q) => q.eq("runId", h.runId).eq("laneId", "lane-1"))
        .unique();
      expect(lane?.hold).toBeUndefined();
    });
  });

  test("the held marker sits only on the step the hold actually blocks", async () => {
    const h = await setupStartedRun({ definition: twoLaneDefinition() });
    const steps = await stepsOf(h);
    const a1 = stepById(steps, "step-a1");
    const b1 = stepById(steps, "step-b1");

    // Hold lane B while b1 still runs: its head is running, not pending — the
    // hold blocks nothing yet, so no row is marked.
    await h.asUser.mutation(api.cli.messages.send, { threadId: b1.threadId!, content: "hold on" });
    let detail = await h.asUser.query(api.workflows.runs.core.get, { runId: h.runId });
    expect(detail!.stages.flatMap((stage) => stage.steps).filter((step) => step.held)).toEqual([]);

    // b1 completes; a1 still runs, so held b2 waits on the barrier, not the hold.
    await endThreadRun(h, b1.threadId!, "completed");
    detail = await h.asUser.query(api.workflows.runs.core.get, { runId: h.runId });
    expect(detail!.stages.flatMap((stage) => stage.steps).filter((step) => step.held)).toEqual([]);

    // a1 fails: the frontier stays at stage 1, so the hold still blocks nothing.
    await endThreadRun(h, a1.threadId!, "failed");
    detail = await h.asUser.query(api.workflows.runs.core.get, { runId: h.runId });
    expect(detail!.stages.flatMap((stage) => stage.steps).filter((step) => step.held)).toEqual([]);

    // a1 recovers and completes: now b2 is dispatchable and the hold is the blocker.
    await h.t.run(async (runCtx) => {
      await requeueThreadForRetry(runCtx, a1.threadId!, a1.userMessageId!, Date.now());
    });
    await h.t.finishAllScheduledFunctions(() => vi.runAllTimers());
    await endThreadRun(h, a1.threadId!, "completed");
    detail = await h.asUser.query(api.workflows.runs.core.get, { runId: h.runId });
    const held = detail!.stages.flatMap((stage) => stage.steps).filter((step) => step.held);
    expect(held.map((step) => step.definitionStepId)).toEqual(["step-b2"]);
  });

  test("an unresolvable step fails its own lane instead of wedging the advance", async () => {
    const h = await setupStartedRun({ definition: twoLaneDefinition() });
    const steps = await stepsOf(h);
    const a1 = stepById(steps, "step-a1");
    const b1 = stepById(steps, "step-b1");

    // Corrupt one stage-2 row (never expected — a system bug, not user input).
    await h.t.run(async (runCtx) => {
      await runCtx.db.patch("workflowRunSteps", stepById(steps, "step-b2")._id, { resolvedExecution: undefined });
    });
    await endThreadRun(h, a1.threadId!, "completed");
    await endThreadRun(h, b1.threadId!, "completed");

    const after = await stepsOf(h);
    // Lane A's settle and dispatch survive; only the corrupt lane fails.
    expect(stepById(after, "step-a1").status).toBe("completed");
    expect(stepById(after, "step-a2").status).toBe("running");
    expect(stepById(after, "step-b2")).toMatchObject({ status: "failed", errorMessage: "The step could not be dispatched" });
    await h.t.run(async (runCtx) => {
      expect((await runCtx.db.get("workflowRuns", h.runId))!.status).toBe("running");
      expect((await runCtx.db.get("cliThreads", h.containerThreadId))!.aggregateStatus).toBe("needs_attention");
    });
  });

  test("a lane with no step in the frontier stage waits without blocking the others", async () => {
    const definition = twoLaneDefinition();
    // Lane B only exists in stage 2.
    definition.stages[0].steps = definition.stages[0].steps.filter((step) => step.laneId === "lane-a");
    const h = await setupStartedRun({ definition });

    let steps = await stepsOf(h);
    expect(stepById(steps, "step-a1").status).toBe("running");
    // No stage-1 step, no thread yet — lane B waits for its stage.
    expect(stepById(steps, "step-b2").status).toBe("pending");
    await h.t.run(async (runCtx) => {
      expect((await runCtx.db.get("cliThreads", h.containerThreadId))!.childCount).toBe(1);
    });

    await endThreadRun(h, stepById(steps, "step-a1").threadId!, "completed");

    steps = await stepsOf(h);
    expect(stepById(steps, "step-a2").status).toBe("running");
    // Lane B's thread is created lazily when its first step dispatches.
    expect(stepById(steps, "step-b2").status).toBe("running");
    expect(stepById(steps, "step-b2").threadId).toBeDefined();
    expect(stepById(steps, "step-b2").threadId).not.toBe(stepById(steps, "step-a1").threadId);
  });

  test("a wait step blocks only its own lane; the other lane keeps working", async () => {
    const definition = twoLaneDefinition();
    definition.stages[1].steps = [
      { stepId: "step-a2", laneId: "lane-a", action: { type: "wait" } },
      { stepId: "step-b2", laneId: "lane-b", action: { type: "prompt", content: { displayContent: "verify fixes" } } },
    ];
    const h = await setupStartedRun({ definition });
    const steps = await stepsOf(h);

    await endThreadRun(h, stepById(steps, "step-a1").threadId!, "completed");
    await endThreadRun(h, stepById(steps, "step-b1").threadId!, "completed");

    let after = await stepsOf(h);
    expect(stepById(after, "step-a2").status).toBe("waiting");
    expect(stepById(after, "step-b2").status).toBe("running");
    await h.t.run(async (runCtx) => {
      // Lane B still works; the wait is the user's turn on the dot only.
      expect((await runCtx.db.get("workflowRuns", h.runId))!.status).toBe("running");
      expect((await runCtx.db.get("cliThreads", h.containerThreadId))!.aggregateStatus).toBe("needs_attention");
    });

    await endThreadRun(h, stepById(steps, "step-b1").threadId!, "completed");
    after = await stepsOf(h);
    expect(stepById(after, "step-b2").status).toBe("completed");
    await h.t.run(async (runCtx) => {
      // Only the wait remains — now nothing moves without the user.
      expect((await runCtx.db.get("workflowRuns", h.runId))!.status).toBe("needs_attention");
    });
  });

  test("a head with no lane row fails its step instead of throwing the advance", async () => {
    const h = await setupStartedRun({ definition: twoLaneDefinition() });
    const steps = await stepsOf(h);

    await h.t.run(async (runCtx) => {
      const lane = await runCtx.db
        .query("workflowRunLanes")
        .withIndex("by_run_and_laneId", (q) => q.eq("runId", h.runId).eq("laneId", "lane-b"))
        .unique();
      await runCtx.db.delete("workflowRunLanes", lane!._id);
    });
    await endThreadRun(h, stepById(steps, "step-a1").threadId!, "completed");
    await endThreadRun(h, stepById(steps, "step-b1").threadId!, "completed");

    const after = await stepsOf(h);
    expect(stepById(after, "step-a2").status).toBe("running");
    expect(stepById(after, "step-b2")).toMatchObject({ status: "failed", errorMessage: "The step could not be dispatched" });
  });

  test("lanes finishing in the same instant converge on one dispatch per lane", async () => {
    const h = await setupStartedRun({ definition: twoLaneDefinition() });
    const steps = await stepsOf(h);
    const a1 = stepById(steps, "step-a1");
    const b1 = stepById(steps, "step-b1");

    // Both stream ends land before either scheduled advance runs.
    await h.t.run(async (runCtx) => {
      const end = {
        status: "completed" as const,
        hasPendingUserMessages: false,
        processingState: "idle" as const,
        lastActivityAt: Date.now(),
      };
      await markThreadStreamEnded(runCtx, a1.threadId!, end);
      await markThreadStreamEnded(runCtx, b1.threadId!, end);
    });
    await h.t.finishAllScheduledFunctions(() => vi.runAllTimers());

    const after = await stepsOf(h);
    expect(stepById(after, "step-a2").status).toBe("running");
    expect(stepById(after, "step-b2").status).toBe("running");
    // One prompt per step: the second advance re-derives, sees both steps
    // already running, and dispatches nothing. (convex-test runs the two
    // advances serially — real OCC serialization isn't exercisable here.)
    expect(await messagesOf(h, a1.threadId!)).toHaveLength(2);
    expect(await messagesOf(h, b1.threadId!)).toHaveLength(2);
  });
});

describe("retry and skip on failed steps (OS-1870)", () => {
  async function laneOf(h: Harness, laneId: string): Promise<Doc<"workflowRunLanes"> | null> {
    return h.t.run(async (runCtx) =>
      runCtx.db
        .query("workflowRunLanes")
        .withIndex("by_run_and_laneId", (q) => q.eq("runId", h.runId).eq("laneId", laneId))
        .unique()
    );
  }

  test("skipping a failed step satisfies the stage barrier and resumes the run", async () => {
    const h = await setupStartedRun();
    const [first] = await stepsOf(h);
    await endThreadRun(h, first.threadId!, "failed");

    await h.asUser.mutation(api.workflows.runs.core.skipStep, { runId: h.runId, stepId: first._id });
    await h.t.finishAllScheduledFunctions(() => vi.runAllTimers());

    const steps = await stepsOf(h);
    expect(steps.map((step) => step.status)).toEqual(["skipped", "running"]);
    expect(steps[0].finishedAt).toBeDefined();
    await h.t.run(async (runCtx) => {
      expect((await runCtx.db.get("workflowRuns", h.runId))!.status).toBe("running");
      expect((await runCtx.db.get("cliThreads", h.containerThreadId))!.aggregateStatus).toBe("running");
    });
  });

  test("skipping the final failed step completes the run", async () => {
    const h = await setupStartedRun();
    const [first] = await stepsOf(h);
    await endThreadRun(h, first.threadId!, "completed");
    const second = (await stepsOf(h))[1];
    await endThreadRun(h, second.threadId!, "failed");

    await h.asUser.mutation(api.workflows.runs.core.skipStep, { runId: h.runId, stepId: second._id });
    await h.t.finishAllScheduledFunctions(() => vi.runAllTimers());

    expect((await stepsOf(h)).map((step) => step.status)).toEqual(["completed", "skipped"]);
    await h.t.run(async (runCtx) => {
      expect((await runCtx.db.get("workflowRuns", h.runId))!.status).toBe("completed");
      expect((await runCtx.db.get("cliThreads", h.containerThreadId))!.aggregateStatus).toBe("idle");
    });
  });

  test("retryStep rides the thread retry: failed assistant deleted, prompt requeued, step revived", async () => {
    const h = await setupStartedRun();
    const [first] = await stepsOf(h);
    // Simulate the CLI having claimed the prompt and failed its run.
    await h.t.run(async (runCtx) => {
      await runCtx.db.patch("cliMessages", first.userMessageId!, { runId: "run-1", processedAt: Date.now() });
    });
    await h.ctx.cliMessage(first.threadId!, h.profile._id, { role: "assistant", status: "failed", runId: "run-1" });
    await endThreadRun(h, first.threadId!, "failed");

    await h.asUser.mutation(api.workflows.runs.core.retryStep, { runId: h.runId, stepId: first._id });
    await h.t.finishAllScheduledFunctions(() => vi.runAllTimers());

    // The failed assistant message is gone and the prompt is back in the queue.
    const messages = await messagesOf(h, first.threadId!);
    expect(messages.map((message) => message.role)).toEqual(["user"]);
    expect(messages[0].processedAt).toBeUndefined();
    expect(messages[0].runId).toBeUndefined();
    const steps = await stepsOf(h);
    expect(steps[0].status).toBe("running");
    expect(steps[0].errorMessage).toBeUndefined();
    await h.t.run(async (runCtx) => {
      const thread = (await runCtx.db.get("cliThreads", first.threadId!))!;
      expect(thread.status).toBe("pending");
      expect(thread.hasPendingUserMessages).toBe(true);
      expect((await runCtx.db.get("workflowRuns", h.runId))!.status).toBe("running");
    });
  });

  test("retryStep re-dispatches a step whose dispatch was refused", async () => {
    const h = await setupStartedRun();
    const [first, second] = await stepsOf(h);
    const execution = second.resolvedExecution!;
    await h.t.run(async (runCtx) => {
      await runCtx.db.patch("workflowRunSteps", second._id, { resolvedExecution: undefined });
    });
    await endThreadRun(h, first.threadId!, "completed");
    expect((await stepsOf(h))[1]).toMatchObject({ status: "failed", errorMessage: "The step could not be dispatched" });

    // The user fixes the cause (here: the runtime is restored) and retries.
    await h.t.run(async (runCtx) => {
      await runCtx.db.patch("workflowRunSteps", second._id, { resolvedExecution: execution });
    });
    await h.asUser.mutation(api.workflows.runs.core.retryStep, { runId: h.runId, stepId: second._id });
    await h.t.finishAllScheduledFunctions(() => vi.runAllTimers());

    const steps = await stepsOf(h);
    expect(steps[1].status).toBe("running");
    expect(steps[1].errorMessage).toBeUndefined();
    // Re-dispatched into the same lane thread.
    expect(steps[1].threadId).toBe(first.threadId);
    expect(await messagesOf(h, first.threadId!)).toHaveLength(2);
    await h.t.run(async (runCtx) => {
      expect((await runCtx.db.get("workflowRuns", h.runId))!.status).toBe("running");
    });
  });

  test("retryStep replaces a deleted lane thread with a fresh one", async () => {
    const h = await setupStartedRun();
    const [first] = await stepsOf(h);
    await h.t.run(async (runCtx) => {
      await softDeleteThread(runCtx, first.threadId!, Date.now());
    });
    await h.t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect((await stepsOf(h))[0]).toMatchObject({ status: "failed", errorMessage: "The step's thread was deleted" });

    await h.asUser.mutation(api.workflows.runs.core.retryStep, { runId: h.runId, stepId: first._id });
    await h.t.finishAllScheduledFunctions(() => vi.runAllTimers());

    const steps = await stepsOf(h);
    expect(steps[0].status).toBe("running");
    expect(steps[0].threadId).toBeDefined();
    expect(steps[0].threadId).not.toBe(first.threadId);
    expect(steps[0].attemptCount).toBe(2);
    const lane = await laneOf(h, "lane-1");
    expect(lane?.threadId).toBe(steps[0].threadId);
    await h.t.run(async (runCtx) => {
      const fresh = (await runCtx.db.get("cliThreads", steps[0].threadId!))!;
      expect(fresh.parentThreadId).toBe(h.containerThreadId);
      // The deleted child left the count; the fresh thread is the one child.
      expect((await runCtx.db.get("cliThreads", h.containerThreadId))!.childCount).toBe(1);
      expect((await runCtx.db.get("workflowRuns", h.runId))!.status).toBe("running");
    });
  });

  test("retry and skip refuse non-failed steps and non-starters", async () => {
    const h = await setupStartedRun();
    const [first] = await stepsOf(h);

    // Still running: neither applies.
    await expect(h.asUser.mutation(api.workflows.runs.core.skipStep, { runId: h.runId, stepId: first._id })).rejects.toThrow(
      "Only a failed step can be retried or skipped"
    );
    await expect(h.asUser.mutation(api.workflows.runs.core.retryStep, { runId: h.runId, stepId: first._id })).rejects.toThrow(
      "Only a failed step can be retried or skipped"
    );

    await endThreadRun(h, first.threadId!, "failed");
    const member = await h.ctx.user();
    const orgId = await h.t.run(async (runCtx) => (await runCtx.db.get("projects", h.project._id))!.organizationId);
    await h.ctx.orgMember(orgId, member._id, "member");
    await h.ctx.projectMember(h.project._id, member._id, "member");
    await expect(
      h.ctx.asUser(member).mutation(api.workflows.runs.core.skipStep, { runId: h.runId, stepId: first._id })
    ).rejects.toThrow("Only the user who started the run can do that");
    await expect(
      h.ctx.asUser(member).mutation(api.workflows.runs.core.retryStep, { runId: h.runId, stepId: first._id })
    ).rejects.toThrow("Only the user who started the run can do that");
  });

  test("a waiting_input answer is stamped with the active step; steering is not", async () => {
    const h = await setupStartedRun();
    const [first] = await stepsOf(h);
    await endThreadRun(h, first.threadId!, "waiting_input");

    await h.asUser.mutation(api.cli.messages.send, {
      threadId: first.threadId!,
      content: "yes, use the staging config",
    });
    await h.t.finishAllScheduledFunctions(() => vi.runAllTimers());

    let messages = await messagesOf(h, first.threadId!);
    expect(messages[1].workflowRunStepId).toBe(first._id);
    expect((await laneOf(h, "lane-1"))?.hold).toBeUndefined();

    // A message into the working lane is steering: no stamp, and the hold applies.
    await endThreadRun(h, first.threadId!, "completed");
    await h.asUser.mutation(api.cli.messages.send, {
      threadId: first.threadId!,
      content: "actually, also check the tests",
    });
    messages = await messagesOf(h, first.threadId!);
    expect(messages.at(-1)?.workflowRunStepId).toBeUndefined();
    expect((await laneOf(h, "lane-1"))?.hold).toBeDefined();
  });
});

describe("wait steps and full cancel (OS-1871)", () => {
  /** prompt → wait (→ optional trailing prompt) in one lane. */
  function waitDefinition(withTrailingPrompt = false): WorkflowDefinition {
    const definition = singleLaneDefinition();
    definition.stages[1].steps = [{ stepId: "step-2", laneId: "lane-1", action: { type: "wait" } }];
    if (withTrailingPrompt) {
      definition.stages.push({
        stageId: "stage-3",
        name: "Ship",
        steps: [{ stepId: "step-3", laneId: "lane-1", action: { type: "prompt", content: { displayContent: "ship it" } } }],
      });
    }
    return definition;
  }

  async function threadOf(h: Harness, threadId: Id<"cliThreads">): Promise<Doc<"cliThreads">> {
    return h.t.run(async (runCtx) => (await runCtx.db.get("cliThreads", threadId))!);
  }

  test("a wait step parks its lane thread as waiting_input", async () => {
    const h = await setupStartedRun({ definition: waitDefinition() });
    const [first] = await stepsOf(h);
    await endThreadRun(h, first.threadId!, "completed");

    const [, wait] = await stepsOf(h);
    expect(wait.status).toBe("waiting");
    // The waiting step carries its lane's thread — the Run view row links there.
    expect(wait.threadId).toBe(first.threadId);
    const thread = await threadOf(h, first.threadId!);
    expect(thread.status).toBe("waiting_input");
    expect(thread.statusProjection?.watchTowerStatus).toBe("waiting_input");
  });

  test("approveStep completes the wait and dispatches the next step in the same thread", async () => {
    const h = await setupStartedRun({ definition: waitDefinition(true) });
    const [first] = await stepsOf(h);
    await endThreadRun(h, first.threadId!, "completed");
    const [, wait] = await stepsOf(h);

    await h.asUser.mutation(api.workflows.runs.core.approveStep, { runId: h.runId, stepId: wait._id });
    await h.t.finishAllScheduledFunctions(() => vi.runAllTimers());

    const steps = await stepsOf(h);
    expect(steps.map((step) => step.status)).toEqual(["completed", "completed", "running"]);
    expect(await messagesOf(h, first.threadId!)).toHaveLength(2);
    const thread = await threadOf(h, first.threadId!);
    expect(thread.status).toBe("pending");
    await h.t.run(async (runCtx) => {
      expect((await runCtx.db.get("workflowRuns", h.runId))!.status).toBe("running");
    });
  });

  test("approving the final wait completes the run and un-parks the thread", async () => {
    const h = await setupStartedRun({ definition: waitDefinition() });
    const [first] = await stepsOf(h);
    await endThreadRun(h, first.threadId!, "completed");
    const [, wait] = await stepsOf(h);

    await h.asUser.mutation(api.workflows.runs.core.approveStep, { runId: h.runId, stepId: wait._id });
    await h.t.finishAllScheduledFunctions(() => vi.runAllTimers());

    expect((await threadOf(h, first.threadId!)).status).toBe("completed");
    await h.t.run(async (runCtx) => {
      expect((await runCtx.db.get("workflowRuns", h.runId))!.status).toBe("completed");
      expect((await runCtx.db.get("cliThreads", h.containerThreadId))!.aggregateStatus).toBe("idle");
    });
  });

  test("a steer turn during a wait re-parks the thread when it completes", async () => {
    const h = await setupStartedRun({ definition: waitDefinition() });
    const [first] = await stepsOf(h);
    await endThreadRun(h, first.threadId!, "completed");

    // Steer-then-approve: the message runs a normal turn, no hold, no stamp.
    await h.asUser.mutation(api.cli.messages.send, { threadId: first.threadId!, content: "tighten the copy first" });
    await h.t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect((await threadOf(h, first.threadId!)).status).toBe("pending");

    await endThreadRun(h, first.threadId!, "completed");
    const [, wait] = await stepsOf(h);
    expect(wait.status).toBe("waiting");
    expect((await threadOf(h, first.threadId!)).status).toBe("waiting_input");
  });

  test("approveStep refuses non-waiting steps and non-starters", async () => {
    const h = await setupStartedRun({ definition: waitDefinition() });
    const [first] = await stepsOf(h);

    await expect(h.asUser.mutation(api.workflows.runs.core.approveStep, { runId: h.runId, stepId: first._id })).rejects.toThrow(
      "Only a waiting step can be approved"
    );

    await endThreadRun(h, first.threadId!, "completed");
    const [, wait] = await stepsOf(h);
    const member = await h.ctx.user();
    const orgId = await h.t.run(async (runCtx) => (await runCtx.db.get("projects", h.project._id))!.organizationId);
    await h.ctx.orgMember(orgId, member._id, "member");
    await h.ctx.projectMember(h.project._id, member._id, "member");
    await expect(
      h.ctx.asUser(member).mutation(api.workflows.runs.core.approveStep, { runId: h.runId, stepId: wait._id })
    ).rejects.toThrow("Only the user who started the run can do that");
  });

  test("the advance leaves a genuine waiting_input alone on a held lane", async () => {
    // No wait step in play: the lane is held on a pending head, and the steer
    // turn ends with an agent question. The engine must not flip the thread
    // to completed — the agent is genuinely waiting on the user.
    const h = await setupStartedRun();
    const [first] = await stepsOf(h);

    await h.asUser.mutation(api.cli.messages.send, { threadId: first.threadId!, content: "also check the tests" });
    await endThreadRun(h, first.threadId!, "completed");
    expect((await stepsOf(h)).map((step) => step.status)).toEqual(["completed", "pending"]);

    // The steer turn ends parked on a question (AskUserQuestion-style).
    await endThreadRun(h, first.threadId!, "waiting_input");

    const thread = await threadOf(h, first.threadId!);
    expect(thread.status).toBe("waiting_input");
    await h.t.run(async (runCtx) => {
      expect((await runCtx.db.get("cliThreads", h.containerThreadId))!.aggregateStatus).toBe("needs_attention");
    });
  });

  test("cancel applies the stop treatment to an in-flight lane thread", async () => {
    const h = await setupStartedRun();
    const [first] = await stepsOf(h);

    await h.asUser.mutation(api.workflows.runs.core.cancel, { runId: h.runId });
    await h.t.finishAllScheduledFunctions(() => vi.runAllTimers());

    // The queued prompt was the sent run: stamped behind a synthetic stopped assistant.
    const thread = await threadOf(h, first.threadId!);
    expect(thread.status).toBe("failed");
    expect(thread.hasPendingUserMessages).toBe(false);
    const messages = await messagesOf(h, first.threadId!);
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(messages[1].errorMessage).toBe("Response stopped by user");
    const [step] = await stepsOf(h);
    expect(step.status).toBe("canceled");
    await h.t.run(async (runCtx) => {
      expect((await runCtx.db.get("workflowRuns", h.runId))!.status).toBe("canceled");
      expect((await runCtx.db.get("cliThreads", h.containerThreadId))!.aggregateStatus).toBe("idle");
    });
  });

  test("cancel stops workflow threads while manual threads in the container keep running", async () => {
    const h = await setupStartedRun();
    const [first] = await stepsOf(h);
    const manual = await h.asUser.mutation(api.cli.threads.groups.addThreadToGroup, {
      sourceThreadId: first.threadId!,
      profileId: h.profile._id,
      pathId: "path-1",
      cliType: "claude-code",
      content: "Investigate independently",
    });
    await h.t.run((ctx) => ctx.db.patch("cliThreads", manual.threadId, {
      status: "streaming",
      processingState: "streaming",
    }));
    const before = await threadOf(h, manual.threadId);
    const messagesBefore = await messagesOf(h, manual.threadId);

    await h.asUser.mutation(api.workflows.runs.core.cancel, { runId: h.runId });
    await h.t.finishAllScheduledFunctions(() => vi.runAllTimers());

    expect((await threadOf(h, first.threadId!)).status).toBe("failed");
    expect((await stepsOf(h))[0].status).toBe("canceled");
    expect(await threadOf(h, manual.threadId)).toEqual(before);
    expect(await messagesOf(h, manual.threadId)).toEqual(messagesBefore);
    const followup = await h.asUser.mutation(api.cli.threads.groups.addThreadToGroup, {
      sourceThreadId: manual.threadId,
      profileId: h.profile._id,
      pathId: "path-1",
      cliType: "claude-code",
      content: "Continue after cancellation",
    });
    expect(followup.containerId).toBe(h.containerThreadId);
  });

  test("cancel un-parks a wait-parked lane thread", async () => {
    const h = await setupStartedRun({ definition: waitDefinition() });
    const [first] = await stepsOf(h);
    await endThreadRun(h, first.threadId!, "completed");
    expect((await threadOf(h, first.threadId!)).status).toBe("waiting_input");

    await h.asUser.mutation(api.workflows.runs.core.cancel, { runId: h.runId });
    await h.t.finishAllScheduledFunctions(() => vi.runAllTimers());

    // The wait card is gone and the thread reads as the finished thread it is.
    expect((await threadOf(h, first.threadId!)).status).toBe("completed");
    const [, wait] = await stepsOf(h);
    expect(wait.status).toBe("canceled");
  });

  test("a lane whose thread never existed waits threadless; the Run view's Approve completes it", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, PATHS);
    const workflowId = await asUser.mutation(api.workflows.core.create, {
      projectId: project._id,
      name: "Release Train",
      definition: waitDefinition(),
    });
    const { runId } = await asUser.mutation(api.workflows.runs.core.start, {
      workflowId,
      profileId: profile._id,
      pathId: "path-1",
    });
    const allSteps = async () =>
      t.run(async (runCtx) =>
        runCtx.db
          .query("workflowRunSteps")
          .withIndex("by_run_and_stageOrder_and_laneOrder_and_stepOrder", (q) => q.eq("runId", runId))
          .collect()
      );
    // Break step-1's dispatch before the start-scheduled advance: no lane thread is ever created.
    await t.run(async (runCtx) => {
      const steps = await runCtx.db
        .query("workflowRunSteps")
        .withIndex("by_run_and_stageOrder_and_laneOrder_and_stepOrder", (q) => q.eq("runId", runId))
        .collect();
      await runCtx.db.patch("workflowRunSteps", steps[0]._id, { resolvedExecution: undefined });
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect((await allSteps())[0].status).toBe("failed");

    await asUser.mutation(api.workflows.runs.core.skipStep, { runId, stepId: (await allSteps())[0]._id });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    const [, wait] = await allSteps();
    expect(wait.status).toBe("waiting");
    // No thread to park or render the card in — only the Run view's Approve remains.
    expect(wait.threadId).toBeUndefined();
    await t.run(async (runCtx) => {
      expect((await runCtx.db.get("workflowRuns", runId))!.status).toBe("needs_attention");
    });

    await asUser.mutation(api.workflows.runs.core.approveStep, { runId, stepId: wait._id });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    await t.run(async (runCtx) => {
      expect((await runCtx.db.get("workflowRuns", runId))!.status).toBe("completed");
    });
  });

  test("deleting one workflow leaves a sibling workflow's live run alone", async () => {
    const h = await setupStartedRun();
    const siblingId = await h.asUser.mutation(api.workflows.core.create, {
      projectId: h.project._id,
      name: "Sibling",
      definition: singleLaneDefinition(),
    });
    const sibling = await h.asUser.mutation(api.workflows.runs.core.start, {
      workflowId: siblingId,
      profileId: h.profile._id,
      pathId: "path-1",
    });
    await h.t.finishAllScheduledFunctions(() => vi.runAllTimers());

    await h.asUser.mutation(api.workflows.core.remove, { workflowId: h.workflowId });
    await h.t.finishAllScheduledFunctions(() => vi.runAllTimers());

    await h.t.run(async (runCtx) => {
      expect((await runCtx.db.get("workflowRuns", h.runId))!.status).toBe("canceled");
      expect((await runCtx.db.get("workflowRuns", sibling.runId))!.status).toBe("running");
    });
  });

  test("a teammate's workflow delete names the deleter as actor, so the starter is notified", async () => {
    const h = await setupStartedRun();
    const [first] = await stepsOf(h);

    const member = await h.ctx.user();
    const orgId = await h.t.run(async (runCtx) => (await runCtx.db.get("projects", h.project._id))!.organizationId);
    await h.ctx.orgMember(orgId, member._id, "member");
    await h.ctx.projectMember(h.project._id, member._id, "member");

    await h.ctx.asUser(member).mutation(api.workflows.core.remove, { workflowId: h.workflowId });
    await h.t.finishAllScheduledFunctions(() => vi.runAllTimers());

    await h.t.run(async (runCtx) => {
      const rows = await runCtx.db.query("notifications").collect();
      const failed = rows.find((row) => row.subject.id === first.threadId);
      // Attributed to the starter, the fan-out would self-suppress this row.
      expect(failed).toMatchObject({ userId: h.user._id, actorUserId: member._id });
    });
  });

  test("deleting the workflow cancels its active runs", async () => {
    const h = await setupStartedRun();

    await h.asUser.mutation(api.workflows.core.remove, { workflowId: h.workflowId });
    await h.t.finishAllScheduledFunctions(() => vi.runAllTimers());

    const [first] = await stepsOf(h);
    expect(first.status).toBe("canceled");
    await h.t.run(async (runCtx) => {
      expect((await runCtx.db.get("workflowRuns", h.runId))!.status).toBe("canceled");
      expect((await runCtx.db.get("cliThreads", h.containerThreadId))!.aggregateStatus).toBe("idle");
    });
  });
});

describe("parallel lanes (OS-1885)", () => {
  /** One single lane beside one parallel lane, two stages; the parallel lane's steps each carry their own settings. */
  function parallelDefinition(): WorkflowDefinition {
    return {
      lanes: [
        { laneId: "lane-s", name: "Executor", type: "single", defaults: { cliType: "claude-code", mode: "act" } },
        { laneId: "lane-p", name: "Reviewers", type: "parallel" },
      ],
      stages: [
        {
          stageId: "stage-1",
          name: "Review",
          steps: [
            { stepId: "step-s1", laneId: "lane-s", action: { type: "prompt", content: { displayContent: "build it" } } },
            {
              stepId: "step-p1",
              laneId: "lane-p",
              action: {
                type: "prompt",
                content: { displayContent: "review security" },
                overrides: { cliType: "claude-code", cliModel: "opus", mode: "plan" },
              },
            },
            {
              stepId: "step-p2",
              laneId: "lane-p",
              action: {
                type: "prompt",
                content: { displayContent: "review performance" },
                // A different runtime than its sibling — the cross-runtime panel case.
                overrides: { cliType: "codex" },
              },
            },
          ],
        },
        {
          stageId: "stage-2",
          name: "Fix",
          steps: [
            { stepId: "step-s2", laneId: "lane-s", action: { type: "prompt", content: { displayContent: "fix findings" } } },
            {
              stepId: "step-p3",
              laneId: "lane-p",
              action: { type: "prompt", content: { displayContent: "re-review" }, overrides: { cliType: "claude-code" } },
            },
          ],
        },
      ],
    };
  }

  async function laneOf(h: Harness, laneId: string): Promise<Doc<"workflowRunLanes"> | null> {
    return h.t.run(async (runCtx) =>
      runCtx.db
        .query("workflowRunLanes")
        .withIndex("by_run_and_laneId", (q) => q.eq("runId", h.runId).eq("laneId", laneId))
        .unique()
    );
  }

  async function threadOf(h: Harness, threadId: Id<"cliThreads">): Promise<Doc<"cliThreads">> {
    return h.t.run(async (runCtx) => (await runCtx.db.get("cliThreads", threadId))!);
  }

  test("start dispatches every parallel-lane step of the stage, each into a fresh thread with its own settings", async () => {
    const h = await setupStartedRun({ definition: parallelDefinition() });

    const steps = await stepsOf(h);
    const s1 = stepById(steps, "step-s1");
    const p1 = stepById(steps, "step-p1");
    const p2 = stepById(steps, "step-p2");
    expect([s1.status, p1.status, p2.status]).toEqual(["running", "running", "running"]);
    expect(new Set([s1.threadId, p1.threadId, p2.threadId]).size).toBe(3);
    expect(stepById(steps, "step-p3").status).toBe("pending");
    // Each step's overrides are its settings — no lane defaults to inherit;
    // sibling steps run different runtimes in one panel.
    expect(p1.resolvedExecution).toEqual({ cliType: "claude-code", cliModel: "opus", mode: "plan" });
    expect(p2.resolvedExecution).toEqual({ cliType: "codex" });
    expect((await threadOf(h, p2.threadId!)).cliType).toBe("codex");
    const [p1Prompt] = await messagesOf(h, p1.threadId!);
    expect(p1Prompt).toMatchObject({ cliMode: "plan", cliModel: "opus", workflowRunStepId: p1._id });
    // The lane serves no thread of its own; each one-shot thread is titled by
    // its step and knows the one step it serves — the single lane's doesn't.
    expect((await laneOf(h, "lane-p"))?.threadId).toBeUndefined();
    expect((await threadOf(h, p1.threadId!)).workflowRunStepId).toBe(p1._id);
    expect((await threadOf(h, s1.threadId!)).workflowRunStepId).toBeUndefined();
    expect((await threadOf(h, p1.threadId!)).title).not.toBe((await threadOf(h, p2.threadId!)).title);
    await h.t.run(async (runCtx) => {
      expect((await runCtx.db.get("cliThreads", h.containerThreadId))!.childCount).toBe(3);
    });
  });

  test("the barrier waits for every parallel step; the next stage opens fresh threads, never reusing one", async () => {
    const h = await setupStartedRun({ definition: parallelDefinition() });
    let steps = await stepsOf(h);
    const s1 = stepById(steps, "step-s1");
    const p1 = stepById(steps, "step-p1");
    const p2 = stepById(steps, "step-p2");

    await endThreadRun(h, s1.threadId!, "completed");
    await endThreadRun(h, p1.threadId!, "completed");
    steps = await stepsOf(h);
    expect(stepById(steps, "step-p3").status).toBe("pending");
    expect(stepById(steps, "step-s2").status).toBe("pending");

    await endThreadRun(h, p2.threadId!, "completed");
    steps = await stepsOf(h);
    expect(stepById(steps, "step-s2")).toMatchObject({ status: "running", threadId: s1.threadId });
    const p3 = stepById(steps, "step-p3");
    expect(p3.status).toBe("running");
    expect([s1.threadId, p1.threadId, p2.threadId]).not.toContain(p3.threadId);
  });

  test("a failed parallel step stops only itself; skipping it opens the barrier", async () => {
    const h = await setupStartedRun({ definition: parallelDefinition() });
    let steps = await stepsOf(h);
    const p1 = stepById(steps, "step-p1");

    await endThreadRun(h, p1.threadId!, "failed");
    await endThreadRun(h, stepById(steps, "step-p2").threadId!, "completed");
    await endThreadRun(h, stepById(steps, "step-s1").threadId!, "completed");
    steps = await stepsOf(h);
    expect(stepById(steps, "step-p2").status).toBe("completed");
    expect(stepById(steps, "step-p3").status).toBe("pending");
    await h.t.run(async (runCtx) => {
      expect((await runCtx.db.get("workflowRuns", h.runId))!.status).toBe("needs_attention");
    });

    await h.asUser.mutation(api.workflows.runs.core.skipStep, { runId: h.runId, stepId: p1._id });
    await h.t.finishAllScheduledFunctions(() => vi.runAllTimers());
    steps = await stepsOf(h);
    expect(stepById(steps, "step-p3").status).toBe("running");
    expect(stepById(steps, "step-s2").status).toBe("running");
  });

  test("cancel stops every per-step thread", async () => {
    const h = await setupStartedRun({ definition: parallelDefinition() });
    const steps = await stepsOf(h);

    await h.asUser.mutation(api.workflows.runs.core.cancel, { runId: h.runId });
    await h.t.finishAllScheduledFunctions(() => vi.runAllTimers());

    for (const stepId of ["step-s1", "step-p1", "step-p2"]) {
      const thread = await threadOf(h, stepById(steps, stepId).threadId!);
      expect(thread.status).toBe("failed");
      expect(thread.hasPendingUserMessages).toBe(false);
    }
    expect((await stepsOf(h)).map((step) => step.status)).toEqual(["canceled", "canceled", "canceled", "pending", "pending"]);
  });

  test("cancel is terminal in its own transaction; the stop treatment runs in scheduled batches", async () => {
    const h = await setupStartedRun({ definition: parallelDefinition() });
    const steps = await stepsOf(h);

    await h.asUser.mutation(api.workflows.runs.core.cancel, { runId: h.runId });

    // Already terminal before any thread is touched — a wide run's thread
    // stops must not decide whether the cancel lands.
    await h.t.run(async (runCtx) => {
      expect((await runCtx.db.get("workflowRuns", h.runId))!.status).toBe("canceled");
    });
    expect((await threadOf(h, stepById(steps, "step-p1").threadId!)).hasPendingUserMessages).toBe(true);

    await h.t.finishAllScheduledFunctions(() => vi.runAllTimers());
    for (const stepId of ["step-s1", "step-p1", "step-p2"]) {
      expect((await threadOf(h, stepById(steps, stepId).threadId!)).hasPendingUserMessages).toBe(false);
    }
  });

  test("a dispatch insert folds into the container's stored denorms instead of rescanning the group", async () => {
    const h = await setupStartedRun({ definition: parallelDefinition() });
    const steps = await stepsOf(h);
    await endThreadRun(h, stepById(steps, "step-s1").threadId!, "completed");
    await endThreadRun(h, stepById(steps, "step-p1").threadId!, "completed");
    await h.t.run(async (runCtx) => {
      await markThreadStreamEnded(runCtx, stepById(steps, "step-p2").threadId!, {
        status: "completed",
        hasPendingUserMessages: false,
        processingState: "idle",
        lastActivityAt: Date.now(),
      });
    });
    // Seeded drift pins the fold's O(1) shape: the insert must extend the
    // stored count, not re-collect every sibling — a wide stage would re-read
    // each child's agent snapshot on every one of its inserts. Membership
    // changes still recompute and heal.
    await h.t.run(async (runCtx) => {
      await runCtx.db.patch("cliThreads", h.containerThreadId, { childCount: 7 });
    });
    await h.t.finishAllScheduledFunctions(() => vi.runAllTimers());

    // Stage 2 dispatched: the single lane reused its thread, step-p3 inserted one.
    expect(stepById(await stepsOf(h), "step-p3").status).toBe("running");
    await h.t.run(async (runCtx) => {
      expect((await runCtx.db.get("cliThreads", h.containerThreadId))!.childCount).toBe(8);
    });
  });

  test("cancel of a run wider than the stop batch stops every thread", async () => {
    const definition: WorkflowDefinition = {
      lanes: [{ laneId: "lane-p", name: "Panel", type: "parallel" }],
      stages: [
        {
          stageId: "stage-1",
          name: "Fan out",
          steps: Array.from({ length: 12 }, (_, i) => ({
            stepId: `step-${i}`,
            laneId: "lane-p",
            action: { type: "prompt" as const, content: { displayContent: `review area ${i}` }, overrides: { cliType: "codex" as const } },
          })),
        },
      ],
    };
    const h = await setupStartedRun({ definition });
    const steps = await stepsOf(h);
    expect(steps.map((step) => step.status)).toEqual(Array(12).fill("running"));

    await h.asUser.mutation(api.workflows.runs.core.cancel, { runId: h.runId });
    await h.t.finishAllScheduledFunctions(() => vi.runAllTimers());

    for (const step of await stepsOf(h)) {
      expect(step.status).toBe("canceled");
      const thread = await threadOf(h, step.threadId!);
      expect(thread.hasPendingUserMessages).toBe(false);
    }
  });

  test("a message into a parallel thread is judged by that thread's step: recovery takes no hold, steering does", async () => {
    const h = await setupStartedRun({ definition: parallelDefinition() });
    const steps = await stepsOf(h);
    const p1 = stepById(steps, "step-p1");
    const p2 = stepById(steps, "step-p2");

    await endThreadRun(h, p1.threadId!, "failed");
    await h.asUser.mutation(api.cli.messages.send, { threadId: p1.threadId!, content: "try again with the diff" });
    expect((await laneOf(h, "lane-p"))?.hold).toBeUndefined();

    await h.asUser.mutation(api.cli.messages.send, { threadId: p2.threadId!, content: "also look at the tests" });
    expect((await laneOf(h, "lane-p"))?.hold).toBeDefined();
  });

  test("long but valid names dispatch: every one-shot title fits the thread cap and keeps its step suffix", async () => {
    const definition = parallelDefinition();
    definition.lanes[1].name = "Long-Form Security and Performance Review Panel for the Whole Release Train";
    definition.stages[0].steps[1].name =
      "Check every authentication and authorization boundary against the threat model from the quarterly review";
    const h = await setupStartedRun({ definition });

    const steps = await stepsOf(h);
    const p1 = stepById(steps, "step-p1");
    const p2 = stepById(steps, "step-p2");
    expect([p1.status, p2.status]).toEqual(["running", "running"]);
    const [p1Title, p2Title] = [(await threadOf(h, p1.threadId!)).title, (await threadOf(h, p2.threadId!)).title];
    expect(p1Title.length).toBeLessThanOrEqual(120);
    expect(p2Title.length).toBeLessThanOrEqual(120);
    // The step part survives the clipping — sibling titles stay distinct.
    expect(p1Title).not.toBe(p2Title);
  });

  test("a finished parallel thread still holds the lane, but its answer stamps no sibling step", async () => {
    const h = await setupStartedRun({ definition: parallelDefinition() });
    const steps = await stepsOf(h);
    const p1 = stepById(steps, "step-p1");

    await endThreadRun(h, p1.threadId!, "completed");
    await h.asUser.mutation(api.cli.messages.send, { threadId: p1.threadId!, content: "one more angle: race conditions" });
    // Steering the run's shared checkout from a finished one-shot still holds the lane…
    expect((await laneOf(h, "lane-p"))?.hold).toBeDefined();

    await endThreadRun(h, p1.threadId!, "waiting_input");
    await h.asUser.mutation(api.cli.messages.send, { threadId: p1.threadId!, content: "yes" });
    // …but no step runs in this thread (its own is done), so the answer stamps none.
    expect((await messagesOf(h, p1.threadId!)).at(-1)?.workflowRunStepId).toBeUndefined();
  });

  test("a parallel lane's wait step dispatches with its stage siblings and blocks only the barrier", async () => {
    const definition = parallelDefinition();
    definition.stages[1].steps.push({ stepId: "step-w", laneId: "lane-p", action: { type: "wait" } });
    const h = await setupStartedRun({ definition });
    let steps = await stepsOf(h);
    for (const stepId of ["step-s1", "step-p1", "step-p2"]) {
      await endThreadRun(h, stepById(steps, stepId).threadId!, "completed");
    }

    // A parallel lane has no intra-stage order: the wait goes out threadless
    // beside its running sibling (docs/specs/workflows.md → Wait steps).
    steps = await stepsOf(h);
    const w = stepById(steps, "step-w");
    expect(w.status).toBe("waiting");
    expect(w.threadId).toBeUndefined();
    expect(stepById(steps, "step-p3").status).toBe("running");

    await h.asUser.mutation(api.workflows.runs.core.approveStep, { runId: h.runId, stepId: w._id });
    await h.t.finishAllScheduledFunctions(() => vi.runAllTimers());
    steps = await stepsOf(h);
    expect(stepById(steps, "step-w").status).toBe("completed");
    // Approval alone doesn't finish the run — the sibling still runs.
    await h.t.run(async (runCtx) => {
      expect((await runCtx.db.get("workflowRuns", h.runId))!.status).toBe("running");
    });
  });

  test("a runtime the online session does not advertise fails only its step at dispatch; siblings run and the barrier holds", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, PATHS);
    const apiKey = await asUser.mutation(api.apiKeys.core.create, { name: "CLI Key", expiresAt: Date.now() + 86_400_000 });
    // The machine has Claude Code only — the codex review step cannot run here.
    const session = await ctx.cliSession(profile._id, apiKey.id, { availableClis: [{ type: "claude-code", version: "1.0.0" }] });
    const workflowId = await asUser.mutation(api.workflows.core.create, { projectId: project._id, name: "Release Train", definition: parallelDefinition() });
    const { runId } = await asUser.mutation(api.workflows.runs.core.start, { workflowId, profileId: profile._id, pathId: "path-1" });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    const allSteps = () =>
      t.run((runCtx) =>
        runCtx.db
          .query("workflowRunSteps")
          .withIndex("by_run_and_stageOrder_and_laneOrder_and_stepOrder", (q) => q.eq("runId", runId))
          .collect()
      );
    const byId = (steps: Doc<"workflowRunSteps">[], id: string) => steps.find((step) => step.definitionStepId === id)!;
    let steps = await allSteps();
    expect(byId(steps, "step-s1").status).toBe("running");
    expect(byId(steps, "step-p1").status).toBe("running");
    expect(byId(steps, "step-p2")).toMatchObject({ status: "failed", errorMessage: errors.workflowStepRuntimeUnavailable("codex") });
    expect(byId(steps, "step-p2").threadId).toBeUndefined();
    expect(byId(steps, "step-s2").status).toBe("pending");
    expect(byId(steps, "step-p3").status).toBe("pending");

    // Codex gets installed; Retry re-dispatches against the session's current runtimes.
    await t.run((runCtx) =>
      runCtx.db.patch("cliSessions", session._id, {
        availableClis: [
          { type: "claude-code", version: "1.0.0" },
          { type: "codex", version: "1.0.0" },
        ],
      })
    );
    await asUser.mutation(api.workflows.runs.core.retryStep, { runId, stepId: byId(steps, "step-p2")._id });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    steps = await allSteps();
    expect(byId(steps, "step-p2").status).toBe("running");
    expect(byId(steps, "step-p2").threadId).toBeDefined();
  });

  test("a per-step dispatch refusal fails only that step; siblings dispatch and the barrier holds the run", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, PATHS);
    const agentId = await asUser.mutation(api.agents.projectAgents.create, {
      projectId: project._id,
      name: "Reviewer",
      prompt: "Review the diff.",
      appearance: { color: "#3b82f6" },
    });
    const definition = parallelDefinition();
    definition.stages[1].steps.push({
      stepId: "step-p4",
      laneId: "lane-p",
      action: { type: "prompt", content: { displayContent: "agent re-review" }, overrides: { cliType: "claude-code", projectAgentId: agentId } },
    });
    const workflowId = await asUser.mutation(api.workflows.core.create, { projectId: project._id, name: "Release Train", definition });
    const { runId, containerThreadId } = await asUser.mutation(api.workflows.runs.core.start, {
      workflowId,
      profileId: profile._id,
      pathId: "path-1",
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const h: Harness = { ctx, t, user, project, profile, asUser, workflowId, runId, containerThreadId };

    // The agent passed the cut but is gone by the stage-2 dispatch: the cli
    // domain refuses only step-p4's thread.
    await t.run(async (runCtx) => {
      await runCtx.db.patch("projectAgents", agentId, { isDeleted: true });
    });
    let steps = await stepsOf(h);
    for (const stepId of ["step-s1", "step-p1", "step-p2"]) {
      await endThreadRun(h, stepById(steps, stepId).threadId!, "completed");
    }

    steps = await stepsOf(h);
    const p4 = stepById(steps, "step-p4");
    expect(p4.status).toBe("failed");
    expect(p4.errorMessage).toBeDefined();
    expect(stepById(steps, "step-p3").status).toBe("running");
    expect(stepById(steps, "step-s2").status).toBe("running");

    // The run cannot finish past the failed step — skip releases it.
    await endThreadRun(h, stepById(steps, "step-p3").threadId!, "completed");
    await endThreadRun(h, stepById(steps, "step-s2").threadId!, "completed");
    await h.t.run(async (runCtx) => {
      expect((await runCtx.db.get("workflowRuns", h.runId))!.status).toBe("needs_attention");
    });
    await h.asUser.mutation(api.workflows.runs.core.skipStep, { runId: h.runId, stepId: p4._id });
    await h.t.finishAllScheduledFunctions(() => vi.runAllTimers());
    await h.t.run(async (runCtx) => {
      expect((await runCtx.db.get("workflowRuns", h.runId))!.status).toBe("completed");
    });
  });

  test("a stage wider than the dispatch cap fans out fully across rescheduled advances", async () => {
    const definition: WorkflowDefinition = {
      lanes: [{ laneId: "lane-p", name: "Panel", type: "parallel" }],
      stages: [
        {
          stageId: "stage-1",
          name: "Fan out",
          steps: Array.from({ length: 12 }, (_, i) => ({
            stepId: `step-${i}`,
            laneId: "lane-p",
            action: { type: "prompt" as const, content: { displayContent: `review area ${i}` }, overrides: { cliType: "codex" as const } },
          })),
        },
      ],
    };
    const h = await setupStartedRun({ definition });

    const steps = await stepsOf(h);
    expect(steps.map((step) => step.status)).toEqual(Array(12).fill("running"));
    expect(new Set(steps.map((step) => step.threadId)).size).toBe(12);
    // A parallel first lane has no defaults — its first step's runtime labels the container.
    await h.t.run(async (runCtx) => {
      expect((await runCtx.db.get("cliThreads", h.containerThreadId))!.cliType).toBe("codex");
    });
  });

  test("a waiting_input answer in a parallel thread is stamped with that thread's step", async () => {
    const h = await setupStartedRun({ definition: parallelDefinition() });
    const steps = await stepsOf(h);
    const p2 = stepById(steps, "step-p2");

    await endThreadRun(h, p2.threadId!, "waiting_input");
    await h.asUser.mutation(api.cli.messages.send, { threadId: p2.threadId!, content: "yes, the whole suite" });

    const messages = await messagesOf(h, p2.threadId!);
    expect(messages.at(-1)?.workflowRunStepId).toBe(p2._id);
    expect((await laneOf(h, "lane-p"))?.hold).toBeUndefined();
  });
});

describe("kickoff step (OS-1921)", () => {
  function bashFirstDefinition(laneType: "single" | "parallel"): WorkflowDefinition {
    return {
      lanes: [
        laneType === "single"
          ? { laneId: "lane-1", name: "Executor", type: "single", defaults: { cliType: "claude-code", mode: "plan" } }
          : { laneId: "lane-1", name: "Checks", type: "parallel" },
      ],
      stages: [
        {
          stageId: "stage-1",
          name: "Check",
          steps: [
            { stepId: "step-1", laneId: "lane-1", name: "Lint", action: { type: "bash", script: "pnpm lint", timeoutMs: 60_000, reportOutput: "stop_on_failure" } },
            { stepId: "step-2", laneId: "lane-1", name: "Types", action: { type: "bash", script: "tsc", timeoutMs: 60_000, reportOutput: "stop_on_failure" } },
          ],
        },
      ],
    };
  }

  test("a single lane's kickoff opens the lane thread with the composer text; the held bash step then waits in that thread", async () => {
    const h = await setupStartedRun({
      definition: bashFirstDefinition("single"),
      startExtras: { firstPromptOverride: { displayContent: "here is the context" } },
    });

    let steps = await stepsOf(h);
    const kickoff = stepById(steps, KICKOFF_STEP_ID);
    expect(kickoff).toMatchObject({ status: "running", attemptCount: 1 });
    expect(kickoff.threadId).toBeDefined();
    // The barrier holds Stage 1 behind the kickoff.
    expect(stepById(steps, "step-1").status).toBe("pending");
    expect(stepById(steps, "step-2").status).toBe("pending");

    const messages = await messagesOf(h, kickoff.threadId!);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ workflowRunStepId: kickoff._id, cliMode: "plan", role: "user" });
    expect(messages[0].scriptRequest).toBeUndefined();
    await h.t.run(async (runCtx) => {
      const thread = (await runCtx.db.get("cliThreads", kickoff.threadId!))!;
      expect(thread).toMatchObject({ title: "Release Train — Executor", workflowLaneId: "lane-1" });
      const lane = await runCtx.db
        .query("workflowRunLanes")
        .withIndex("by_run_and_laneId", (q) => q.eq("runId", h.runId).eq("laneId", "lane-1"))
        .unique();
      expect(lane?.threadId).toBe(kickoff.threadId);
    });

    await endThreadRun(h, kickoff.threadId!, "completed");

    steps = await stepsOf(h);
    expect(stepById(steps, KICKOFF_STEP_ID).status).toBe("completed");
    // Plan mode holds the script for approval — now inside the lane thread.
    expect(stepById(steps, "step-1")).toMatchObject({ status: "waiting", threadId: kickoff.threadId });
  });

  test("a parallel-only workflow's kickoff is one one-shot thread; the bash steps follow once it completes", async () => {
    const h = await setupStartedRun({
      definition: bashFirstDefinition("parallel"),
      startExtras: { firstPromptOverride: { displayContent: "here is the context" } },
    });

    let steps = await stepsOf(h);
    const kickoff = stepById(steps, KICKOFF_STEP_ID);
    expect(kickoff.status).toBe("running");
    expect(steps.filter((step) => step.status === "running")).toHaveLength(1);
    await h.t.run(async (runCtx) => {
      const thread = (await runCtx.db.get("cliThreads", kickoff.threadId!))!;
      expect(thread).toMatchObject({
        title: "Release Train — Checks — here is the context",
        workflowRunStepId: kickoff._id,
        cliType: "claude-code",
      });
    });

    await endThreadRun(h, kickoff.threadId!, "completed");

    steps = await stepsOf(h);
    expect(steps.map((step) => [step.definitionStepId, step.status])).toEqual([
      [KICKOFF_STEP_ID, "completed"],
      ["step-1", "running"],
      ["step-2", "running"],
    ]);
    // Each bash step runs in its own fresh thread, never the kickoff's.
    expect(new Set(steps.map((step) => step.threadId)).size).toBe(3);
  });
});

describe("Stop in a lane thread", () => {
  test("stopping a step's turn while it waits on an approval fails the step; it never parks as the user's turn", async () => {
    const h = await setupStartedRun();
    const [first] = await stepsOf(h);

    // The CLI claims the lane thread, starts the turn, and parks on a tool approval.
    const apiKey = await h.asUser.mutation(api.apiKeys.core.create, { name: "CLI Key", expiresAt: Date.now() + 86_400_000 });
    const session = await h.ctx.cliSession(h.profile._id, apiKey.id);
    await h.t.mutation(api.cli.threads.runControl.claimThread, {
      threadId: first.threadId!,
      sessionId: session._id,
      leaseMs: 60_000,
      apiKey: apiKey.key,
    });
    const started = await h.t.mutation(api.cli.messages.startRunResponse, {
      threadId: first.threadId!,
      sessionId: session._id,
      userMessageIds: [first.userMessageId!],
      apiKey: apiKey.key,
    });
    await h.t.mutation(api.cli.interactionRequests.create, {
      threadId: first.threadId!,
      messageId: started.assistantMessageId,
      sessionId: session._id,
      requestId: "req-tool",
      kind: "tool-approval",
      payloadJson: JSON.stringify({ toolName: "Bash" }),
      expiresAt: Date.now() + 120_000,
      apiKey: apiKey.key,
    });

    // The starting user hits Stop instead of answering.
    await h.asUser.mutation(api.cli.threads.runControl.cancelProcessing, { threadId: first.threadId! });
    await h.t.finishAllScheduledFunctions(() => vi.runAllTimers());

    const steps = await stepsOf(h);
    expect(steps[0]).toMatchObject({ status: "failed", errorMessage: errors.WORKFLOW_STEP_THREAD_FAILED });
    expect(steps[1].status).toBe("pending");
    await h.t.run(async (runCtx) => {
      const thread = (await runCtx.db.get("cliThreads", first.threadId!))!;
      expect(thread.status).toBe("failed");
      expect((await runCtx.db.get("cliMessages", started.assistantMessageId))!.errorMessage).toBe("Response stopped by user");
      expect((await runCtx.db.get("workflowRuns", h.runId))!.status).toBe("needs_attention");
    });

    // In-thread recovery still applies: a retry revives the step.
    await h.t.run(async (runCtx) => {
      await requeueThreadForRetry(runCtx, first.threadId!, first.userMessageId!, Date.now());
    });
    await h.t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect((await stepsOf(h))[0].status).toBe("running");
  });
});

describe("bash steps (OS-1886)", () => {
  type ReportOutput = "always" | "on_failure" | "stop_on_failure";

  /** One single lane: a bash step, then a prompt — the script runs before the agent's first turn. */
  function bashDefinition(reportOutput: ReportOutput, mode = "agent", laneType: "single" | "parallel" = "single"): WorkflowDefinition {
    return {
      lanes: [
        laneType === "single"
          ? { laneId: "lane-1", name: "Executor", type: "single", defaults: { cliType: "claude-code", mode } }
          : { laneId: "lane-1", name: "Checks", type: "parallel" },
      ],
      stages: [
        {
          stageId: "stage-1",
          name: "Check",
          steps: [
            {
              stepId: "step-1",
              laneId: "lane-1",
              name: "Lint",
              action: { type: "bash", script: "pnpm lint", timeoutMs: 60_000, reportOutput },
            },
          ],
        },
        {
          stageId: "stage-2",
          name: "Fix",
          steps: [
            {
              stepId: "step-2",
              laneId: "lane-1",
              action: {
                type: "prompt",
                content: { displayContent: "fix it" },
                overrides: laneType === "parallel" ? { cliType: "claude-code" } : undefined,
              },
            },
          ],
        },
      ],
    };
  }

  /** Simulate the CLI running a script message: stamp the run, land the result on its assistant message, end the stream. */
  async function endScriptRun(
    h: Harness,
    threadId: Id<"cliThreads">,
    userMessageId: Id<"cliMessages">,
    result: { exitCode: number; timedOut?: boolean; outputTail?: string }
  ): Promise<void> {
    await h.t.run(async (runCtx) => {
      const userMessage = (await runCtx.db.get("cliMessages", userMessageId))!;
      const now = Date.now();
      await runCtx.db.patch("cliMessages", userMessageId, { processedAt: now, runId: "run-1" });
      await runCtx.db.insert("cliMessages", {
        threadId,
        role: "assistant",
        profileId: userMessage.profileId,
        cliType: userMessage.cliType,
        content: [],
        status: "completed",
        runId: "run-1",
        scriptResult: { exitCode: result.exitCode, timedOut: result.timedOut ?? false, outputTail: result.outputTail ?? "" },
        createdAt: now,
        updatedAt: now,
      });
      await markThreadStreamEnded(runCtx, threadId, {
        status: "completed",
        hasPendingUserMessages: false,
        processingState: "idle",
        lastActivityAt: now,
      });
    });
    await h.t.finishAllScheduledFunctions(() => vi.runAllTimers());
  }

  async function firstChunkText(h: Harness, threadId: Id<"cliThreads">, messageId: Id<"cliMessages">): Promise<string | undefined> {
    const chunks = await h.t.run((runCtx) =>
      runCtx.db
        .query("cliMessageChunks")
        .withIndex("by_thread_and_message_and_chunkOrder", (q) => q.eq("threadId", threadId).eq("messageId", messageId))
        .collect()
    );
    return chunks[0]?.data;
  }

  test("a first bash step opens the lane thread with a script request; act mode runs it unprompted", async () => {
    const h = await setupStartedRun({ definition: bashDefinition("on_failure") });
    const step = stepById(await stepsOf(h), "step-1");
    expect(step.status).toBe("running");
    expect(step.approvedAt).toBeUndefined();

    const [message] = await messagesOf(h, step.threadId!);
    expect(message.scriptRequest).toEqual({ script: "pnpm lint", timeoutMs: 60_000 });
    expect(message.workflowRunStepId).toBe(step._id);
    expect(message._id).toBe(step.userMessageId);
    const thread = await h.t.run((runCtx) => runCtx.db.get("cliThreads", step.threadId!));
    expect(thread?.workflowRunId).toBe(h.runId);
    expect(thread?.hasPendingUserMessages).toBe(true);
  });

  test("stop_on_failure: a non-zero exit fails the step with the code; a timeout says so", async () => {
    const h = await setupStartedRun({ definition: bashDefinition("stop_on_failure") });
    const step = stepById(await stepsOf(h), "step-1");
    await endScriptRun(h, step.threadId!, step.userMessageId!, { exitCode: 2 });

    const failed = stepById(await stepsOf(h), "step-1");
    expect(failed.status).toBe("failed");
    expect(failed.errorMessage).toBe(errors.workflowStepScriptExited(2));
    expect((await messagesOf(h, step.threadId!)).filter((message) => message.role === "user")).toHaveLength(1);
    const run = await h.t.run((runCtx) => runCtx.db.get("workflowRuns", h.runId));
    expect(run?.status).toBe("needs_attention");

    const timedOut = await setupStartedRun({ definition: bashDefinition("stop_on_failure") });
    const t1 = stepById(await stepsOf(timedOut), "step-1");
    await endScriptRun(timedOut, t1.threadId!, t1.userMessageId!, { exitCode: 143, timedOut: true });
    expect(stepById(await stepsOf(timedOut), "step-1").errorMessage).toBe(errors.WORKFLOW_STEP_SCRIPT_TIMED_OUT);
  });

  test("on_failure: a passing script completes the step silently and the next stage dispatches", async () => {
    const h = await setupStartedRun({ definition: bashDefinition("on_failure") });
    const step = stepById(await stepsOf(h), "step-1");
    await endScriptRun(h, step.threadId!, step.userMessageId!, { exitCode: 0, outputTail: "all green" });

    const steps = await stepsOf(h);
    expect(stepById(steps, "step-1").status).toBe("completed");
    expect(stepById(steps, "step-2").status).toBe("running");
    const userMessages = (await messagesOf(h, step.threadId!)).filter((message) => message.role === "user");
    expect(userMessages.map((message) => message.scriptRequest !== undefined)).toEqual([true, false]);
    expect(userMessages[1].workflowRunStepId).toBe(stepById(steps, "step-2")._id);
  });

  test("on_failure: a failing script reports its output to the lane's agent and the step finishes with that turn", async () => {
    const h = await setupStartedRun({ definition: bashDefinition("on_failure") });
    const step = stepById(await stepsOf(h), "step-1");
    await endScriptRun(h, step.threadId!, step.userMessageId!, { exitCode: 1, outputTail: "src/a.ts: unused import" });

    const reporting = stepById(await stepsOf(h), "step-1");
    expect(reporting.status).toBe("running");
    expect(reporting.userMessageId).not.toBe(step.userMessageId);
    const report = await h.t.run((runCtx) => runCtx.db.get("cliMessages", reporting.userMessageId!));
    expect(report?.scriptRequest).toBeUndefined();
    expect(report?.workflowRunStepId).toBe(step._id);
    const text = await firstChunkText(h, step.threadId!, reporting.userMessageId!);
    expect(text).toContain('Workflow script "Lint" exited with code 1.');
    // The agent never saw the script request, so the report carries the script itself.
    expect(text).toContain("```bash\npnpm lint\n```");
    expect(text).toContain("src/a.ts: unused import");
    expect(stepById(await stepsOf(h), "step-2").status).toBe("pending");

    // The agent's turn on the report finishes the bash step; the barrier lifts.
    await endThreadRun(h, step.threadId!, "completed");
    const steps = await stepsOf(h);
    expect(stepById(steps, "step-1").status).toBe("completed");
    expect(stepById(steps, "step-2").status).toBe("running");
  });

  test("always: a passing script still reports", async () => {
    const h = await setupStartedRun({ definition: bashDefinition("always") });
    const step = stepById(await stepsOf(h), "step-1");
    await endScriptRun(h, step.threadId!, step.userMessageId!, { exitCode: 0, outputTail: "" });

    const reporting = stepById(await stepsOf(h), "step-1");
    expect(reporting.status).toBe("running");
    expect(await firstChunkText(h, step.threadId!, reporting.userMessageId!)).toBe('Workflow script "Lint" exited with code 0.\n\n```bash\npnpm lint\n```\n\n(no output)');
  });

  test("an approval mode holds the script as a waiting step in a fresh, empty lane thread; Approve dispatches it there", async () => {
    const h = await setupStartedRun({ definition: bashDefinition("on_failure", "default") });
    const waiting = stepById(await stepsOf(h), "step-1");
    expect(waiting.status).toBe("waiting");
    // Bash first (OS-1920): the gate opens the lane thread with no message so
    // Approve lives in a transcript, not on the bare Run view.
    const threadId = waiting.threadId!;
    expect(threadId).toBeDefined();
    const lane = await h.t.run((runCtx) =>
      runCtx.db
        .query("workflowRunLanes")
        .withIndex("by_run_and_laneId", (q) => q.eq("runId", h.runId).eq("laneId", "lane-1"))
        .unique()
    );
    expect(lane?.threadId).toBe(threadId);
    expect(lane?.waitParkedAt).toBeDefined();
    const thread = await h.t.run((runCtx) => runCtx.db.get("cliThreads", threadId));
    expect(thread).toMatchObject({
      title: "Release Train — Executor",
      parentThreadId: h.containerThreadId,
      workflowRunId: h.runId,
      workflowLaneId: "lane-1",
      status: "waiting_input",
      processingState: "idle",
      hasPendingUserMessages: false,
    });
    expect(thread?.workflowRunStepId).toBeUndefined();
    expect(await messagesOf(h, threadId)).toEqual([]);
    const run = await h.t.run((runCtx) => runCtx.db.get("workflowRuns", h.runId));
    expect(run?.status).toBe("needs_attention");
    // The approver sees the pinned script, not the editor's mutable draft.
    const detail = await h.asUser.query(api.workflows.runs.core.get, { runId: h.runId });
    expect(detail?.stages[0].steps[0]).toMatchObject({ status: "waiting", threadId, script: { script: "pnpm lint", timeoutMs: 60_000 } });

    await h.asUser.mutation(api.workflows.runs.core.approveStep, { runId: h.runId, stepId: waiting._id });
    await h.t.finishAllScheduledFunctions(() => vi.runAllTimers());

    const running = stepById(await stepsOf(h), "step-1");
    expect(running.status).toBe("running");
    expect(running.approvedAt).toBeDefined();
    expect(running.threadId).toBe(threadId);
    // The script bubble is the thread's first message; the park lifted for the run.
    const [message] = await messagesOf(h, threadId);
    expect(message.scriptRequest).toEqual({ script: "pnpm lint", timeoutMs: 60_000 });
    expect(message.cliMode).toBe("default");
    const dispatched = await h.t.run((runCtx) => runCtx.db.get("cliThreads", threadId));
    expect(dispatched?.status).toBe("pending");
    const unparked = await h.t.run((runCtx) => runCtx.db.get("workflowRunLanes", lane!._id));
    expect(unparked?.waitParkedAt).toBeUndefined();
  });

  test("a steer message into the empty parked thread runs as an ordinary turn; Approve then sends the script as the second message", async () => {
    const h = await setupStartedRun({ definition: bashDefinition("on_failure", "default") });
    const held = stepById(await stepsOf(h), "step-1");
    const threadId = held.threadId!;
    const laneRow = () =>
      h.t.run((runCtx) =>
        runCtx.db
          .query("workflowRunLanes")
          .withIndex("by_run_and_laneId", (q) => q.eq("runId", h.runId).eq("laneId", "lane-1"))
          .unique()
      );

    await h.asUser.mutation(api.cli.messages.send, { threadId, content: "look at the lint config first" });
    await h.t.finishAllScheduledFunctions(() => vi.runAllTimers());
    // Steering a waiting head neither holds the lane nor stamps the step.
    expect((await laneRow())?.hold).toBeUndefined();
    const [steer] = await messagesOf(h, threadId);
    expect(steer.workflowRunStepId).toBeUndefined();
    expect(stepById(await stepsOf(h), "step-1").status).toBe("waiting");

    await endThreadRun(h, threadId, "completed");
    // The turn settled: the park is back for the still-waiting head.
    expect((await laneRow())?.waitParkedAt).toBeDefined();
    expect((await h.t.run((runCtx) => runCtx.db.get("cliThreads", threadId)))?.status).toBe("waiting_input");

    await h.asUser.mutation(api.workflows.runs.core.approveStep, { runId: h.runId, stepId: held._id });
    await h.t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const running = stepById(await stepsOf(h), "step-1");
    expect(running.status).toBe("running");
    expect(running.threadId).toBe(threadId);
    const messages = await messagesOf(h, threadId);
    expect(messages.map((message) => message.scriptRequest?.script)).toEqual([undefined, "pnpm lint"]);
  });

  test("removing the profile during the hold fails the step on Approve instead of stranding the run", async () => {
    const h = await setupStartedRun({ definition: bashDefinition("on_failure", "default") });
    const held = stepById(await stepsOf(h), "step-1");
    await h.asUser.mutation(api.cli.profiles.remove, { profileId: h.profile._id });

    await h.asUser.mutation(api.workflows.runs.core.approveStep, { runId: h.runId, stepId: held._id });
    await h.t.finishAllScheduledFunctions(() => vi.runAllTimers());

    const failed = stepById(await stepsOf(h), "step-1");
    expect(failed.status).toBe("failed");
    expect(failed.errorMessage).toBe("Profile not found");
    // The refused dispatch rolled back: nothing for a CLI that no longer exists.
    expect(await messagesOf(h, held.threadId!)).toEqual([]);
    const run = await h.t.run((runCtx) => runCtx.db.get("workflowRuns", h.runId));
    expect(run?.status).toBe("needs_attention");
  });

  test("removing the profile between two steps of one lane fails the next dispatch", async () => {
    const h = await setupStartedRun();
    const [first] = await stepsOf(h);
    await h.asUser.mutation(api.cli.profiles.remove, { profileId: h.profile._id });
    await endThreadRun(h, first.threadId!, "completed");

    const steps = await stepsOf(h);
    expect(steps[0].status).toBe("completed");
    expect(steps[1].status).toBe("failed");
    expect(steps[1].errorMessage).toBe("Profile not found");
    expect(await messagesOf(h, first.threadId!)).toHaveLength(1);
  });

  test("a refused empty-thread creation fails the held step instead of leaving it threadless", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, PATHS);
    const workflowId = await asUser.mutation(api.workflows.core.create, {
      projectId: project._id,
      name: "Release Train",
      definition: bashDefinition("on_failure", "default"),
    });
    const { runId } = await asUser.mutation(api.workflows.runs.core.start, { workflowId, profileId: profile._id, pathId: "path-1" });
    // The profile vanishes before the start-scheduled advance opens the lane thread.
    await t.run((runCtx) => runCtx.db.patch("cliProfiles", profile._id, { isDeleted: true }));
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    const [step] = await t.run((runCtx) =>
      runCtx.db
        .query("workflowRunSteps")
        .withIndex("by_run_and_stageOrder_and_laneOrder_and_stepOrder", (q) => q.eq("runId", runId))
        .collect()
    );
    expect(step.status).toBe("failed");
    expect(step.threadId).toBeUndefined();
    expect(step.errorMessage).toBeDefined();

    // The profile comes back; Retry re-runs the gate, which now opens and stamps the lane thread.
    await t.run((runCtx) => runCtx.db.patch("cliProfiles", profile._id, { isDeleted: false }));
    await asUser.mutation(api.workflows.runs.core.retryStep, { runId, stepId: step._id });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const [retried] = await t.run((runCtx) =>
      runCtx.db
        .query("workflowRunSteps")
        .withIndex("by_run_and_stageOrder_and_laneOrder_and_stepOrder", (q) => q.eq("runId", runId))
        .collect()
    );
    expect(retried.status).toBe("waiting");
    expect(retried.threadId).toBeDefined();
    const lane = await t.run((runCtx) =>
      runCtx.db
        .query("workflowRunLanes")
        .withIndex("by_run_and_laneId", (q) => q.eq("runId", runId).eq("laneId", "lane-1"))
        .unique()
    );
    expect(lane?.threadId).toBe(retried.threadId);
  });

  test("a parallel lane's bash step has no mode and runs unprompted in its own thread on the run's runtime", async () => {
    const h = await setupStartedRun({ definition: bashDefinition("stop_on_failure", "agent", "parallel") });
    const running = stepById(await stepsOf(h), "step-1");
    expect(running.status).toBe("running");
    expect(running.approvedAt).toBeUndefined();
    expect(running.resolvedExecution).toEqual({ cliType: "claude-code" });
    const thread = await h.t.run((runCtx) => runCtx.db.get("cliThreads", running.threadId!));
    expect(thread?.workflowRunStepId).toBe(running._id);
    expect(thread?.cliType).toBe("claude-code");
    expect(thread?.title).toBe("Release Train — Checks — Lint");
  });
});

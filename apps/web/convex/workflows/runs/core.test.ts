import { describe, expect, test } from "vitest";
import { listAgentThreadWorkByTask } from "../../tasks/lib/agentThreadWorkRepo";
import { api, internal } from "../../_generated/api";
import { createTestContext } from "../../../convex-testing";
import type { StepOverrides, WorkflowDefinition } from "../../lib/contracts/workflowDefinition";
import { insertCliThread, markThreadPending } from "../../cli/threads/lib/cliThreadsRepo";
import { errors } from "../errors";
import { assertDefinitionRunnable } from "../lib/invariants";
import { KICKOFF_STAGE_ID, KICKOFF_STEP_ID } from "./lib/resolution";

const PATHS = { paths: [{ id: "path-1", path: "/repo/path-1", label: "path-1" }] };

/** One single lane, two stages, one non-first wait step — passes the version cut. */
function runnableDefinition(): WorkflowDefinition {
  return {
    lanes: [{ laneId: "lane-1", name: "Executor", type: "single", defaults: { cliType: "claude-code", mode: "act" } }],
    stages: [
      {
        stageId: "stage-1",
        name: "Plan",
        steps: [
          { stepId: "step-1", laneId: "lane-1", action: { type: "prompt", content: { displayContent: "plan it" } } },
          {
            stepId: "step-2",
            laneId: "lane-1",
            action: { type: "prompt", content: { displayContent: "review the plan" }, overrides: { mode: "plan" } },
          },
        ],
      },
      {
        stageId: "stage-2",
        name: "Build",
        steps: [{ stepId: "step-3", laneId: "lane-1", action: { type: "wait" } }],
      },
    ],
  };
}

async function setupRunnableWorkflow(definition: WorkflowDefinition = runnableDefinition()) {
  const ctx = createTestContext();
  const { user, project, asUser, t } = await ctx.setupProject();
  const profile = await ctx.cliProfile(user._id, project._id, PATHS);
  const workflowId = await asUser.mutation(api.workflows.core.create, {
    projectId: project._id,
    name: "Release Train",
    definition,
  });
  const startArgs = { workflowId, profileId: profile._id, pathId: "path-1" };
  return { ctx, t, user, project, profile, asUser, workflowId, startArgs };
}

describe("workflows.runs.core.start", () => {
  test("cuts a version, creates run + lane + step rows, and the container thread", async () => {
    const { t, user, project, profile, asUser, workflowId, startArgs } = await setupRunnableWorkflow();

    const { runId, containerThreadId } = await asUser.mutation(api.workflows.runs.core.start, startArgs);

    await t.run(async (runCtx) => {
      const workflow = await runCtx.db.get("workflows", workflowId);
      expect(workflow?.dirtySinceLastVersion).toBe(false);
      const version = await runCtx.db.get("workflowVersions", workflow!.latestVersionId!);
      expect(version).toMatchObject({ workflowId, projectId: project._id, versionNumber: 1, createdBy: user._id });

      const run = await runCtx.db.get("workflowRuns", runId);
      expect(run).toMatchObject({
        workflowId,
        workflowVersionId: version!._id,
        projectId: project._id,
        startedBy: user._id,
        status: "running",
        selection: {
          profileId: profile._id,
          workspace: { pathId: "path-1", pathSnapshot: "/repo/path-1" },
        },
      });

      const lanes = await runCtx.db
        .query("workflowRunLanes")
        .withIndex("by_run_and_laneId", (q) => q.eq("runId", runId))
        .collect();
      expect(lanes.map((lane) => [lane.laneId, lane.laneType, lane.laneOrder])).toEqual([["lane-1", "single", 0]]);

      const steps = await runCtx.db
        .query("workflowRunSteps")
        .withIndex("by_run_and_stageOrder_and_laneOrder_and_stepOrder", (q) => q.eq("runId", runId))
        .collect();
      expect(steps).toHaveLength(3);
      expect(steps.every((step) => step.status === "pending" && step.attemptCount === 0)).toBe(true);
      const first = steps.find((step) => step.definitionStepId === "step-1");
      // Lane defaults fold into resolvedExecution; the step's mode override wins.
      expect(first?.resolvedExecution).toMatchObject({ cliType: "claude-code", mode: "act" });
      const second = steps.find((step) => step.definitionStepId === "step-2");
      expect(second?.resolvedExecution).toMatchObject({ cliType: "claude-code", mode: "plan" });
      const wait = steps.find((step) => step.definitionStepId === "step-3");
      expect(wait?.resolvedExecution).toBeUndefined();

      const container = await runCtx.db.get("cliThreads", containerThreadId);
      expect(container).toMatchObject({
        kind: "group",
        workflowRunId: runId,
        title: "Release Train",
        aggregateStatus: "running",
        childCount: 0,
        userId: user._id,
      });
    });
  });

  test("pins the latest version while clean, cuts a new one after an edit", async () => {
    const { t, asUser, workflowId, startArgs } = await setupRunnableWorkflow();

    const firstRun = await asUser.mutation(api.workflows.runs.core.start, startArgs);
    const secondRun = await asUser.mutation(api.workflows.runs.core.start, startArgs);

    const edited = runnableDefinition();
    edited.stages[0].steps[0].action = { type: "prompt", content: { displayContent: "plan it differently" } };
    await asUser.mutation(api.workflows.core.update, { workflowId, definition: edited });
    const thirdRun = await asUser.mutation(api.workflows.runs.core.start, startArgs);

    await t.run(async (runCtx) => {
      const versions = await runCtx.db
        .query("workflowVersions")
        .withIndex("by_workflow_and_versionNumber", (q) => q.eq("workflowId", workflowId))
        .collect();
      expect(versions.map((version) => version.versionNumber)).toEqual([1, 2]);

      const [first, second, third] = await Promise.all(
        [firstRun.runId, secondRun.runId, thirdRun.runId].map((runId) => runCtx.db.get("workflowRuns", runId))
      );
      expect(first?.workflowVersionId).toBe(second?.workflowVersionId);
      expect(third?.workflowVersionId).not.toBe(first?.workflowVersionId);
    });
  });

  test("stores the first-prompt override on the first lane's first prompt step only", async () => {
    const { t, asUser, startArgs } = await setupRunnableWorkflow();

    const { runId } = await asUser.mutation(api.workflows.runs.core.start, {
      ...startArgs,
      firstPromptOverride: { displayContent: "plan it my way" },
    });

    await t.run(async (runCtx) => {
      const steps = await runCtx.db
        .query("workflowRunSteps")
        .withIndex("by_run_and_stageOrder_and_laneOrder_and_stepOrder", (q) => q.eq("runId", runId))
        .collect();
      const overridden = steps.filter((step) => step.promptOverride !== undefined);
      expect(overridden.map((step) => step.definitionStepId)).toEqual(["step-1"]);
      expect(overridden[0].promptOverride).toEqual({ displayContent: "plan it my way" });
    });
  });

  test("a first lane without a prompt step gets a run-local Kickoff step carrying the composer text (OS-1921)", async () => {
    const bashOnly: WorkflowDefinition = {
      lanes: [{ laneId: "lane-1", name: "Executor", type: "single", defaults: { cliType: "codex", mode: "plan" } }],
      stages: [
        {
          stageId: "stage-1",
          name: "Check",
          steps: [{ stepId: "step-1", laneId: "lane-1", action: { type: "bash", script: "pnpm lint", timeoutMs: 60_000, reportOutput: "on_failure" } }],
        },
      ],
    };
    const { t, asUser, startArgs } = await setupRunnableWorkflow(bashOnly);

    const { runId } = await asUser.mutation(api.workflows.runs.core.start, {
      ...startArgs,
      firstPromptOverride: { displayContent: "look at the lint output first" },
    });

    await t.run(async (runCtx) => {
      const steps = await runCtx.db
        .query("workflowRunSteps")
        .withIndex("by_run_and_stageOrder_and_laneOrder_and_stepOrder", (q) => q.eq("runId", runId))
        .collect();
      // Ordered ahead of Stage 1, in the first lane, on the lane's runtime and mode.
      expect(steps.map((step) => step.definitionStepId)).toEqual([KICKOFF_STEP_ID, "step-1"]);
      expect(steps[0]).toMatchObject({
        stageId: KICKOFF_STAGE_ID,
        laneId: "lane-1",
        promptOverride: { displayContent: "look at the lint output first" },
        resolvedExecution: { cliType: "codex", mode: "plan" },
        status: "pending",
      });
      expect(steps[0].stageOrder).toBeLessThan(steps[1].stageOrder);
    });

    // Without text there is nothing to kick off with.
    const { runId: plainRunId } = await asUser.mutation(api.workflows.runs.core.start, startArgs);
    await t.run(async (runCtx) => {
      const steps = await runCtx.db
        .query("workflowRunSteps")
        .withIndex("by_run_and_stageOrder_and_laneOrder_and_stepOrder", (q) => q.eq("runId", plainRunId))
        .collect();
      expect(steps.map((step) => step.definitionStepId)).toEqual(["step-1"]);
    });
  });

  test("a parallel-only workflow's Kickoff step resolves the run's runtime, like a parallel bash step (OS-1921)", async () => {
    const parallelOnly: WorkflowDefinition = {
      lanes: [{ laneId: "lane-p", name: "Checks", type: "parallel" }],
      stages: [
        {
          stageId: "stage-1",
          name: "Check",
          steps: [
            { stepId: "step-1", laneId: "lane-p", action: { type: "bash", script: "pnpm lint", timeoutMs: 60_000, reportOutput: "stop_on_failure" } },
            { stepId: "step-2", laneId: "lane-p", action: { type: "bash", script: "tsc", timeoutMs: 60_000, reportOutput: "stop_on_failure" } },
          ],
        },
      ],
    };
    const { t, asUser, startArgs } = await setupRunnableWorkflow(parallelOnly);

    const { runId } = await asUser.mutation(api.workflows.runs.core.start, {
      ...startArgs,
      firstPromptOverride: { displayContent: "context for the reviewers" },
    });

    await t.run(async (runCtx) => {
      const steps = await runCtx.db
        .query("workflowRunSteps")
        .withIndex("by_run_and_stageOrder_and_laneOrder_and_stepOrder", (q) => q.eq("runId", runId))
        .collect();
      expect(steps.map((step) => [step.definitionStepId, step.promptOverride?.displayContent])).toEqual([
        [KICKOFF_STEP_ID, "context for the reviewers"],
        ["step-1", undefined],
        ["step-2", undefined],
      ]);
      // A parallel lane has no defaults and the kickoff no overrides: the run's
      // runtime, which a bash-only run falls back to the app default.
      expect(steps[0].resolvedExecution).toEqual({ cliType: "claude-code" });
    });
  });

  test("rejects definitions the engine cannot run yet", async () => {
    const cases: Array<{ mutate: (definition: WorkflowDefinition) => void; error: string }> = [
      {
        mutate: (definition) => {
          definition.stages[1].steps.push({
            stepId: "step-4",
            laneId: "lane-1",
            action: { type: "bash", script: "true", timeoutMs: 0, reportOutput: "on_failure" },
          });
        },
        error: errors.WORKFLOW_DEFINITION_BASH_TIMEOUT_INVALID,
      },
      {
        mutate: (definition) => {
          definition.stages[1].steps.push({
            stepId: "step-4",
            laneId: "lane-1",
            action: { type: "bash", script: "true", timeoutMs: 7 * 60 * 60 * 1000, reportOutput: "on_failure" },
          });
        },
        error: errors.WORKFLOW_DEFINITION_BASH_TIMEOUT_INVALID,
      },
      {
        mutate: (definition) => {
          definition.stages[0].steps.unshift({ stepId: "step-0", laneId: "lane-1", action: { type: "wait" } });
        },
        error: errors.WORKFLOW_DEFINITION_WAIT_FIRST,
      },
      // No lanes / no stages are Save-time errors now (workflows.core tests);
      // a single lane without defaults gets the app default runtime pinned by
      // normalization (the legacy-draft test below), not rejected.
      {
        mutate: (definition) => {
          definition.stages[1].steps = [];
        },
        error: errors.WORKFLOW_DEFINITION_EMPTY_STAGE,
      },
    ];

    for (const { mutate, error } of cases) {
      const definition = runnableDefinition();
      mutate(definition);
      const { asUser, startArgs } = await setupRunnableWorkflow(definition);
      await expect(asUser.mutation(api.workflows.runs.core.start, startArgs)).rejects.toThrow(error);
    }
  });

  test("the cut rejects a reporting bash step in a parallel lane (data written past Save's normalization)", async () => {
    const { t, project } = await setupRunnableWorkflow();
    const definition = runnableDefinition();
    definition.lanes.push({ laneId: "lane-2", name: "Checks", type: "parallel" });
    definition.stages[0].steps.push({
      stepId: "step-4",
      laneId: "lane-2",
      action: { type: "bash", script: "pnpm test", timeoutMs: 60_000, reportOutput: "on_failure" },
    });
    await expect(t.run((runCtx) => assertDefinitionRunnable(runCtx, project._id, definition))).rejects.toThrow(
      errors.WORKFLOW_DEFINITION_PARALLEL_BASH_MUST_STOP
    );
  });

  test("bash steps pass the cut; a parallel lane's bash step resolves the run's runtime (OS-1886)", async () => {
    const definition = runnableDefinition();
    definition.lanes.push({ laneId: "lane-2", name: "Checks", type: "parallel" });
    definition.stages[0].steps.push(
      { stepId: "step-4", laneId: "lane-1", action: { type: "bash", script: "pnpm lint", timeoutMs: 60_000, reportOutput: "always" } },
      { stepId: "step-5", laneId: "lane-2", action: { type: "bash", script: "pnpm test", timeoutMs: 60_000, reportOutput: "stop_on_failure" } }
    );
    const { t, asUser, startArgs } = await setupRunnableWorkflow(definition);
    const { runId } = await asUser.mutation(api.workflows.runs.core.start, startArgs);
    await t.run(async (runCtx) => {
      const steps = await runCtx.db
        .query("workflowRunSteps")
        .withIndex("by_run_and_stageOrder_and_laneOrder_and_stepOrder", (q) => q.eq("runId", runId))
        .collect();
      // Single lane: the lane's defaults, mode included; parallel: the run's runtime, no mode.
      expect(steps.find((step) => step.definitionStepId === "step-4")?.resolvedExecution).toEqual({ cliType: "claude-code", mode: "act" });
      expect(steps.find((step) => step.definitionStepId === "step-5")?.resolvedExecution).toEqual({ cliType: "claude-code" });
    });
  });

  test("the version cut validates a parallel lane's step overrides like lane defaults", async () => {
    const withParallelStep = (overrides: StepOverrides | undefined) => {
      const definition = runnableDefinition();
      definition.lanes.push({ laneId: "lane-2", name: "Reviewer", type: "parallel" });
      definition.stages[0].steps.push({
        stepId: "step-4",
        laneId: "lane-2",
        action: { type: "prompt", content: { displayContent: "review it" }, overrides },
      });
      return definition;
    };
    const cases: Array<{ overrides: StepOverrides | undefined; error: string }> = [
      { overrides: undefined, error: errors.WORKFLOW_DEFINITION_STEP_RUNTIME_REQUIRED },
      { overrides: { cliType: "claude-code", cliModel: "gpt-5" }, error: errors.WORKFLOW_DEFINITION_LANE_MODEL_UNSUPPORTED },
    ];
    for (const { overrides, error } of cases) {
      const { asUser, startArgs } = await setupRunnableWorkflow(withParallelStep(overrides));
      await expect(asUser.mutation(api.workflows.runs.core.start, startArgs)).rejects.toThrow(error);
    }

    // Valid overrides pass the cut and fold into the step's own resolvedExecution.
    const valid = await setupRunnableWorkflow(withParallelStep({ cliType: "claude-code", cliModel: "opus", mode: "plan" }));
    const { runId } = await valid.asUser.mutation(api.workflows.runs.core.start, valid.startArgs);
    await valid.t.run(async (runCtx) => {
      const steps = await runCtx.db
        .query("workflowRunSteps")
        .withIndex("by_run_and_stageOrder_and_laneOrder_and_stepOrder", (q) => q.eq("runId", runId))
        .collect();
      expect(steps.find((step) => step.definitionStepId === "step-4")?.resolvedExecution).toEqual({
        cliType: "claude-code",
        cliModel: "opus",
        mode: "plan",
      });
    });

    const { ctx, user, project, asUser, workflowId, startArgs } = await setupRunnableWorkflow();
    const otherProject = await ctx.project(project.organizationId, user._id);
    const foreignAgentId = await asUser.mutation(api.agents.projectAgents.create, {
      projectId: otherProject._id,
      name: "Reviewer",
      prompt: "Review the diff.",
      appearance: { color: "#3b82f6" },
    });
    await asUser.mutation(api.workflows.core.update, {
      workflowId,
      definition: withParallelStep({ cliType: "claude-code", projectAgentId: foreignAgentId }),
    });
    await expect(asUser.mutation(api.workflows.runs.core.start, startArgs)).rejects.toThrow(
      errors.WORKFLOW_DEFINITION_AGENT_DIFFERENT_PROJECT
    );
  });

  test("a legacy draft with no lane runtime starts with the app default pinned at the cut", async () => {
    const { t, asUser, workflowId, startArgs } = await setupRunnableWorkflow();
    // Simulate a draft saved before Save normalization pinned lane runtimes:
    // write it past the save mutation, straight into the row.
    await t.run(async (runCtx) => {
      const workflow = (await runCtx.db.get("workflows", workflowId))!;
      const draft = workflow.draftDefinition;
      delete draft.lanes[0].defaults;
      await runCtx.db.patch("workflows", workflowId, { draftDefinition: draft, dirtySinceLastVersion: true });
    });

    const { runId } = await asUser.mutation(api.workflows.runs.core.start, startArgs);

    await t.run(async (runCtx) => {
      const steps = await runCtx.db
        .query("workflowRunSteps")
        .withIndex("by_run_and_stageOrder_and_laneOrder_and_stepOrder", (q) => q.eq("runId", runId))
        .collect();
      const first = steps.find((step) => step.definitionStepId === "step-1");
      expect(first?.resolvedExecution).toMatchObject({ cliType: "claude-code" });
      expect(first?.resolvedExecution?.mode).toBeUndefined();
    });
  });

  test("an attached task binds the container into the task's activity", async () => {
    const { ctx, t, user, project, asUser, startArgs } = await setupRunnableWorkflow();
    const task = await ctx.task(project._id, user._id);

    const { containerThreadId } = await asUser.mutation(api.workflows.runs.core.start, {
      ...startArgs,
      taskId: task._id,
    });

    await t.run(async (runCtx) => {
      const container = await runCtx.db.get("cliThreads", containerThreadId);
      expect(container?.associatedTaskId).toBe(task._id);
      const rows = await listAgentThreadWorkByTask(runCtx, task.projectId, task._id);
      expect(rows.map((entry) => entry.threadId)).toContain(containerThreadId);
    });
  });

  test("an attached pull request lands on the run and its container, ref lowercased (OS-2383)", async () => {
    const { t, asUser, startArgs } = await setupRunnableWorkflow();
    const attached = { owner: "Contoso", name: "Convoy", number: 482, ref: "contoso/convoy#482" };

    const { runId, containerThreadId } = await asUser.mutation(api.workflows.runs.core.start, {
      ...startArgs,
      pullRequestUrl: "https://github.com/Contoso/Convoy/pull/482",
    });

    await t.run(async (runCtx) => {
      expect((await runCtx.db.get("workflowRuns", runId))?.attachedPullRequest).toEqual(attached);
      expect((await runCtx.db.get("cliThreads", containerThreadId))?.attachedPullRequest).toEqual(attached);
    });
    await expect(
      asUser.mutation(api.workflows.runs.core.start, { ...startArgs, pullRequestUrl: "https://example.com/pull/1" })
    ).rejects.toThrow("Not a GitHub pull request URL");
  });

  test("a run started in an existing group stamps the group with the PR (OS-2383)", async () => {
    const { ctx, t, user, project, profile, asUser, startArgs } = await setupRunnableWorkflow();
    const container = await ctx.cliThread(user._id, project._id, profile._id, { kind: "group", title: "My group" });

    await asUser.mutation(api.workflows.runs.core.start, {
      ...startArgs,
      sourceThreadId: container._id,
      expectedContainerId: container._id,
      pullRequestUrl: "contoso/convoy#482",
    });

    const group = await t.run((runCtx) => runCtx.db.get("cliThreads", container._id));
    expect(group?.attachedPullRequest?.ref).toBe("contoso/convoy#482");
  });

  test("start guards: outsider, foreign profile, cross-project profile", async () => {
    const { ctx, project, asUser, startArgs } = await setupRunnableWorkflow();

    const outsider = await ctx.user();
    await expect(ctx.asUser(outsider).mutation(api.workflows.runs.core.start, startArgs)).rejects.toThrow();

    const other = await ctx.user();
    await ctx.orgMember((await ctx.t.run(async (runCtx) => (await runCtx.db.get("projects", project._id))!.organizationId)), other._id, "member");
    await ctx.projectMember(project._id, other._id, "member");
    // The starter must own the machine the run executes on.
    await expect(ctx.asUser(other).mutation(api.workflows.runs.core.start, startArgs)).rejects.toThrow();
  });
});

describe("workflows.runs.core.cancel", () => {
  test("starter cancels: run flips terminal, container mirrors, repeat is a no-op", async () => {
    const { ctx, t, asUser, startArgs } = await setupRunnableWorkflow();
    const { runId, containerThreadId } = await asUser.mutation(api.workflows.runs.core.start, startArgs);

    // An outsider learns nothing about the run: project access is checked
    // before the starter identity, so they never see the starter-only error.
    const outsider = await ctx.user();
    const outsiderError = await ctx
      .asUser(outsider)
      .mutation(api.workflows.runs.core.cancel, { runId })
      .then(() => null, (error: unknown) => String(error));
    expect(outsiderError).not.toBeNull();
    expect(outsiderError).not.toContain(errors.WORKFLOW_RUN_NOT_STARTER);

    const member = await ctx.user();
    await ctx.orgMember(
      await t.run(async (runCtx) => (await runCtx.db.get("projects", (await runCtx.db.get("workflowRuns", runId))!.projectId))!.organizationId),
      member._id,
      "member"
    );
    await ctx.projectMember((await t.run(async (runCtx) => (await runCtx.db.get("workflowRuns", runId))!.projectId)), member._id, "member");
    await expect(ctx.asUser(member).mutation(api.workflows.runs.core.cancel, { runId })).rejects.toThrow(
      errors.WORKFLOW_RUN_NOT_STARTER
    );

    await asUser.mutation(api.workflows.runs.core.cancel, { runId });
    await t.run(async (runCtx) => {
      const run = await runCtx.db.get("workflowRuns", runId);
      expect(run?.status).toBe("canceled");
      expect(run?.canceledAt).toBeDefined();
      const container = await runCtx.db.get("cliThreads", containerThreadId);
      expect(container?.aggregateStatus).toBe("idle");
    });

    // Idempotent: canceling a canceled run answers quietly.
    await expect(asUser.mutation(api.workflows.runs.core.cancel, { runId })).resolves.toBeNull();
  });
});

describe("workflows.runs.core.get", () => {
  test.each(["opus-5", "opus-5-5"])("returns grouped steps using %s for the starter, null for anyone else", async (cliModel) => {
    const definition = runnableDefinition();
    definition.lanes[0].defaults = { cliType: "claude-code", cliModel, cliEffort: "high", mode: "act" };
    const { ctx, asUser, startArgs } = await setupRunnableWorkflow(definition);
    const { runId } = await asUser.mutation(api.workflows.runs.core.start, startArgs);

    const detail = await asUser.query(api.workflows.runs.core.get, { runId });
    expect(detail).toMatchObject({ workflowName: "Release Train", status: "running", versionNumber: 1 });
    expect(detail?.stages.map((stage) => stage.name)).toEqual(["Plan", "Build"]);
    expect(detail?.stages[0].steps.map((step) => [step.title, step.status, step.laneName])).toEqual([
      ["plan it", "pending", "Executor"],
      ["review the plan", "pending", "Executor"],
    ]);
    // Prompt steps expose their resolved runtime for the Run view's lane label.
    expect(detail?.stages[0].steps.map((step) => [step.cliType, step.cliModel, step.cliEffort])).toEqual([
      ["claude-code", cliModel, "high"],
      ["claude-code", cliModel, "high"],
    ]);
    expect(detail?.stages[1].steps.map((step) => [step.title, step.type])).toEqual([["Wait for human", "wait"]]);
    expect(detail?.stages[1].steps[0].cliType).toBeUndefined();

    const outsider = await ctx.user();
    expect(await ctx.asUser(outsider).query(api.workflows.runs.core.get, { runId })).toBeNull();
  });

  test("a starter demoted to viewer reads null and every run control is refused (OS-2195)", async () => {
    const { ctx, t, project, workflowId } = await setupRunnableWorkflow();
    const organizationId = await t.run(async (runCtx) => (await runCtx.db.get("projects", project._id))!.organizationId);
    const starter = await ctx.user();
    await ctx.orgMember(organizationId, starter._id, "member");
    const membership = await ctx.projectMember(project._id, starter._id, "member");
    const profile = await ctx.cliProfile(starter._id, project._id, PATHS);
    const asStarter = ctx.asUser(starter);
    const { runId } = await asStarter.mutation(api.workflows.runs.core.start, { workflowId, profileId: profile._id, pathId: "path-1" });
    const stepId = await t.run(async (runCtx) => (await runCtx.db.query("workflowRunSteps").first())!._id);

    await t.run((runCtx) => runCtx.db.patch("projectMembers", membership._id, { role: "viewer" }));

    // The panel, rail, and wait card render controls only from this query.
    expect(await asStarter.query(api.workflows.runs.core.get, { runId })).toBeNull();
    await expect(asStarter.mutation(api.workflows.runs.core.cancel, { runId })).rejects.toThrow("Permission denied");
    await expect(asStarter.mutation(api.workflows.runs.core.resumeLane, { runId, laneId: "lane-1" })).rejects.toThrow("Permission denied");
    for (const action of ["retryStep", "skipStep", "approveStep"] as const) {
      await expect(asStarter.mutation(api.workflows.runs.core[action], { runId, stepId })).rejects.toThrow("Permission denied");
    }
  });

  test("a Kickoff step renders as its own stage ahead of the version's stages (OS-1921)", async () => {
    const bashOnly: WorkflowDefinition = {
      lanes: [{ laneId: "lane-1", name: "Executor", type: "single", defaults: { cliType: "claude-code", mode: "plan" } }],
      stages: [
        {
          stageId: "stage-1",
          name: "Check",
          steps: [{ stepId: "step-1", laneId: "lane-1", action: { type: "bash", script: "pnpm lint", timeoutMs: 60_000, reportOutput: "on_failure" } }],
        },
      ],
    };
    const { asUser, startArgs } = await setupRunnableWorkflow(bashOnly);
    const { runId } = await asUser.mutation(api.workflows.runs.core.start, {
      ...startArgs,
      firstPromptOverride: { displayContent: "look at the lint output first" },
    });

    const detail = await asUser.query(api.workflows.runs.core.get, { runId });
    expect(detail?.stages.map((stage) => [stage.stageId, stage.name])).toEqual([
      [KICKOFF_STAGE_ID, "Kickoff"],
      ["stage-1", "Check"],
    ]);
    expect(detail?.stages[0].steps.map((step) => [step.title, step.type, step.laneName, step.cliType])).toEqual([
      ["look at the lint output first", "prompt", "Executor", "claude-code"],
    ]);
  });
});

describe("workflows.runs.core.listByWorkflow", () => {
  test("lists the caller's runs newest first", async () => {
    const { asUser, workflowId, startArgs } = await setupRunnableWorkflow();
    const first = await asUser.mutation(api.workflows.runs.core.start, startArgs);
    const second = await asUser.mutation(api.workflows.runs.core.start, startArgs);

    const runs = await asUser.query(api.workflows.runs.core.listByWorkflow, { workflowId });
    expect(runs.map((run) => run._id)).toEqual([second.runId, first.runId]);
  });

  test("the caller's runs are not hidden behind teammates' newer runs", async () => {
    const { ctx, t, workflowId, asUser, startArgs } = await setupRunnableWorkflow();
    const mine = await asUser.mutation(api.workflows.runs.core.start, startArgs);

    // 50 newer runs by a teammate — enough to fill an unscoped take(50).
    const teammate = await ctx.user();
    await t.run(async (runCtx) => {
      const run = (await runCtx.db.get("workflowRuns", mine.runId))!;
      for (let i = 0; i < 50; i++) {
        await runCtx.db.insert("workflowRuns", {
          workflowId,
          workflowVersionId: run.workflowVersionId,
          projectId: run.projectId,
          startedBy: teammate._id,
          selection: run.selection,
          status: "running",
          startedAt: run.startedAt + 1 + i,
          lastActivityAt: run.startedAt + 1 + i,
        });
      }
    });

    const runs = await asUser.query(api.workflows.runs.core.listByWorkflow, { workflowId });
    expect(runs.map((run) => run._id)).toEqual([mine.runId]);
  });
});

describe("run container lifecycle", () => {
  test("marking the empty container read neither deletes it nor drops its mirrored status", async () => {
    const { t, asUser, startArgs } = await setupRunnableWorkflow();
    const { containerThreadId } = await asUser.mutation(api.workflows.runs.core.start, startArgs);

    // The empty-group dissolve rule and the child-fold aggregate both run at
    // this seam — a run container must survive with its mirror intact.
    await asUser.mutation(api.cli.threads.core.markRead, { threadId: containerThreadId });

    await t.run(async (runCtx) => {
      const container = await runCtx.db.get("cliThreads", containerThreadId);
      expect(container?.isDeleted).toBe(false);
      expect(container?.aggregateStatus).toBe("running");
    });
  });

  test("a child's rising activity never overwrites the run-status mirror (escalate path)", async () => {
    const { t, user, project, profile, asUser, startArgs } = await setupRunnableWorkflow();
    const { runId, containerThreadId } = await asUser.mutation(api.workflows.runs.core.start, startArgs);
    // Cancel drops the mirror to idle; a lane child that keeps acting (as in
    // OS-1868, where children exist) must not escalate it back up.
    await asUser.mutation(api.workflows.runs.core.cancel, { runId });

    await t.run(async (runCtx) => {
      const childId = await insertCliThread(
        runCtx,
        {
          userId: user._id,
          projectId: project._id,
          profileId: profile._id,
          pathId: "path-1",
          path: "/repo/path-1",
          cliType: "claude-code",
          title: "Lane thread",
          parentThreadId: containerThreadId,
        },
        Date.now()
      );
      await markThreadPending(runCtx, childId, { now: Date.now(), flipToPending: true });

      const container = await runCtx.db.get("cliThreads", containerThreadId);
      expect(container?.aggregateStatus).toBe("idle");
    });
  });
});

// The CLI's `workflows start` / `workflows runs` calls carry `apiKey` (OS-1915).
describe("workflows.runs.core with an API key", () => {
  test("a project-scoped key starts, reads, and cancels its user's run; an out-of-scope key is refused", async () => {
    const { ctx, t, user, asUser, project, workflowId, startArgs } = await setupRunnableWorkflow();
    const { org } = await t.run(async (runCtx) => ({ org: (await runCtx.db.get("projects", project._id))!.organizationId }));
    const otherProject = await ctx.project(org, user._id, { name: "Other Project", alias: "OTHR" });
    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const { key: apiKey } = await asUser.mutation(api.apiKeys.core.create, {
      name: "Project key",
      expiresAt,
      scope: { organizationId: org, projectIds: [project._id] },
    });
    const { key: otherKey } = await asUser.mutation(api.apiKeys.core.create, {
      name: "Other key",
      expiresAt,
      scope: { organizationId: org, projectIds: [otherProject._id] },
    });

    await expect(t.mutation(api.workflows.runs.core.start, { ...startArgs, apiKey: otherKey })).rejects.toThrow();

    const { runId } = await t.mutation(api.workflows.runs.core.start, { ...startArgs, apiKey });
    await expect(t.query(api.workflows.runs.core.listByWorkflow, { workflowId, apiKey })).resolves.toHaveLength(1);
    await expect(t.query(api.workflows.runs.core.get, { runId, apiKey })).resolves.toMatchObject({ _id: runId });
    await expect(t.query(api.workflows.runs.core.get, { runId, apiKey: otherKey })).resolves.toBeNull();
    await expect(t.query(api.workflows.runs.core.listByWorkflow, { workflowId, apiKey: otherKey })).resolves.toEqual([]);
    await expect(t.mutation(api.workflows.runs.core.cancel, { runId, apiKey: otherKey })).rejects.toThrow();

    // Status-gated controls reach their status check, past authentication.
    const stepId = await t.run(async (runCtx) => (await runCtx.db.query("workflowRunSteps").first())!._id);
    await expect(t.mutation(api.workflows.runs.core.skipStep, { runId, stepId, apiKey })).rejects.toThrow(errors.WORKFLOW_STEP_NOT_FAILED);
    await expect(t.mutation(api.workflows.runs.core.retryStep, { runId, stepId, apiKey })).rejects.toThrow(errors.WORKFLOW_STEP_NOT_FAILED);
    await expect(t.mutation(api.workflows.runs.core.approveStep, { runId, stepId, apiKey })).rejects.toThrow(errors.WORKFLOW_STEP_NOT_WAITING);
    await expect(t.mutation(api.workflows.runs.core.resumeLane, { runId, laneId: "lane-1", apiKey })).resolves.toBeNull();

    await t.mutation(api.workflows.runs.core.cancel, { runId, apiKey });
    await expect(t.query(api.workflows.runs.core.get, { runId, apiKey })).resolves.toMatchObject({ status: "canceled" });
  });
});


describe("starting a workflow beside existing threads", () => {
  test("wraps a standalone thread, preserves its pin and messages, and creates fresh lane threads", async () => {
    const { ctx, t, user, project, profile, asUser, startArgs } = await setupRunnableWorkflow();
    const source = await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Original conversation", isPinned: true, pinnedAt: 123,
    });
    const message = await ctx.cliMessage(source._id, profile._id, { content: [{ type: "text", data: "Existing context", timestamp: 123 }] });
    const task = await ctx.task(project._id, user._id);
    const { runId, containerThreadId } = await asUser.mutation(api.workflows.runs.core.start, {
      ...startArgs, sourceThreadId: source._id, taskId: task._id,
    });
    await t.mutation(internal.workflows.runs.core.advance, { runId });
    await t.run(async (dbCtx) => {
      const original = await dbCtx.db.get("cliThreads", source._id);
      expect(original).toMatchObject({ parentThreadId: containerThreadId, title: source.title, cliType: source.cliType, isPinned: false });
      expect(original?.workflowRunId).toBeUndefined();
      expect(await dbCtx.db.get("cliMessages", message._id)).toMatchObject({ threadId: source._id, content: message.content });
      const container = await dbCtx.db.get("cliThreads", containerThreadId);
      expect(container).toMatchObject({ kind: "group", workflowRunId: runId, title: source.title, isPinned: true, pinnedAt: 123, associatedTaskId: task._id, childCount: 2 });
      const lane = await dbCtx.db.query("workflowRunLanes").withIndex("by_run_and_laneId", q => q.eq("runId", runId)).unique();
      expect(lane?.threadId).toBeDefined();
      expect(lane?.threadId).not.toBe(source._id);
      expect(await dbCtx.db.get("cliThreads", lane!.threadId!)).toMatchObject({ parentThreadId: containerThreadId, workflowRunId: runId });
      expect((await listAgentThreadWorkByTask(dbCtx, task.projectId, task._id)).map(entry => entry.threadId)).toContain(containerThreadId);
    });
  });

  test.each(["child", "container"])("reuses an existing group when started from its %s", async (target) => {
    const { ctx, t, user, project, profile, asUser, startArgs } = await setupRunnableWorkflow();
    const container = await ctx.cliThread(user._id, project._id, profile._id, { kind: "group", title: "My group", isPinned: true });
    const source = await ctx.cliThread(user._id, project._id, profile._id, { parentThreadId: container._id });
    const sourceBefore = await t.run(dbCtx => dbCtx.db.get("cliThreads", source._id));
    const { runId, containerThreadId } = await asUser.mutation(api.workflows.runs.core.start, {
      ...startArgs, sourceThreadId: target === "child" ? source._id : container._id, expectedContainerId: container._id,
    });
    expect(containerThreadId).toBe(container._id);
    await t.run(async (dbCtx) => {
      expect(await dbCtx.db.get("cliThreads", container._id)).toMatchObject({ workflowRunId: runId, title: "My group", isPinned: true, aggregateStatus: "running" });
      expect(await dbCtx.db.get("cliThreads", source._id)).toEqual(sourceBefore);
    });
  });

  test("reopens a done group it starts in (OS-2176)", async () => {
    const { ctx, t, user, project, profile, asUser, startArgs } = await setupRunnableWorkflow();
    const container = await ctx.cliThread(user._id, project._id, profile._id, { kind: "group", status: "completed", childCount: 1 });
    const source = await ctx.cliThread(user._id, project._id, profile._id, { parentThreadId: container._id, status: "completed" });
    await asUser.mutation(api.cli.threads.core.markDone, { threadId: container._id });
    await asUser.mutation(api.workflows.runs.core.start, { ...startArgs, sourceThreadId: source._id, expectedContainerId: container._id });
    expect((await t.run(dbCtx => dbCtx.db.get("cliThreads", container._id)))?.statusProjection?.isDone).toBe(false);
  });

  test.each(["running", "canceled"])("rejects another run from a manual child of a %s run", async (status) => {
    const { ctx, t, user, project, profile, asUser, startArgs } = await setupRunnableWorkflow();
    const { runId, containerThreadId } = await asUser.mutation(api.workflows.runs.core.start, startArgs);
    const source = await ctx.cliThread(user._id, project._id, profile._id, { parentThreadId: containerThreadId });
    if (status === "canceled") await asUser.mutation(api.workflows.runs.core.cancel, { runId });
    await expect(asUser.mutation(api.workflows.runs.core.start, { ...startArgs, sourceThreadId: source._id }))
      .rejects.toThrow("This thread group already has a workflow run");
    await t.run(async (dbCtx) => { expect(await dbCtx.db.query("workflowRuns").collect()).toHaveLength(1); });
  });

  test.each(["source", "container"])("rejects a shared %s without changing its sharing", async (shared) => {
    const { ctx, t, user, project, profile, asUser, startArgs } = await setupRunnableWorkflow();
    const container = shared === "container" ? await ctx.cliThread(user._id, project._id, profile._id, { kind: "group", sharedAt: 123 }) : undefined;
    const source = await ctx.cliThread(user._id, project._id, profile._id, { parentThreadId: container?._id, sharedAt: container ? undefined : 123 });
    await expect(asUser.mutation(api.workflows.runs.core.start, { ...startArgs, sourceThreadId: source._id }))
      .rejects.toThrow("Unshare this thread or group before starting a workflow");
    await t.run(async (dbCtx) => {
      expect((await dbCtx.db.get("cliThreads", container?._id ?? source._id))?.sharedAt).toBe(123);
      expect(await dbCtx.db.query("workflowRuns").collect()).toHaveLength(0);
    });
  });

  test("rejects a group at the manual-thread limit before creating a run", async () => {
    const { ctx, t, user, project, profile, asUser, startArgs } = await setupRunnableWorkflow();
    const container = await ctx.cliThread(user._id, project._id, profile._id, { kind: "group" });
    const source = await ctx.cliThread(user._id, project._id, profile._id, { parentThreadId: container._id });
    await t.run(async dbCtx => {
      for (let i = 1; i < 100; i++) {
        const { _id, ...fields } = source;
        void _id;
        await dbCtx.db.insert("cliThreads", { ...fields, isDeleted: true });
      }
    });
    await expect(asUser.mutation(api.workflows.runs.core.start, { ...startArgs, sourceThreadId: source._id }))
      .rejects.toThrow("A thread group can contain at most 100 threads");
    await t.run(async dbCtx => { expect(await dbCtx.db.query("workflowRuns").collect()).toHaveLength(0); });
  });

  test("rejects a formerly standalone source that joined a group while the draft was open", async () => {
    const { ctx, user, project, profile, asUser, startArgs } = await setupRunnableWorkflow();
    const container = await ctx.cliThread(user._id, project._id, profile._id, { kind: "group" });
    const source = await ctx.cliThread(user._id, project._id, profile._id, { parentThreadId: container._id });
    await expect(asUser.mutation(api.workflows.runs.core.start, { ...startArgs, sourceThreadId: source._id, expectedContainerId: null }))
      .rejects.toThrow("changed groups");
  });

  test("a repeated start from a formerly standalone source cannot create a second run", async () => {
    const { ctx, t, user, project, profile, asUser, startArgs } = await setupRunnableWorkflow();
    const source = await ctx.cliThread(user._id, project._id, profile._id);
    const first = await asUser.mutation(api.workflows.runs.core.start, { ...startArgs, sourceThreadId: source._id });
    await expect(asUser.mutation(api.workflows.runs.core.start, { ...startArgs, sourceThreadId: source._id }))
      .rejects.toThrow("already has a workflow run");
    await t.run(async dbCtx => {
      expect(await dbCtx.db.query("workflowRuns").collect()).toHaveLength(1);
      expect((await dbCtx.db.get("cliThreads", source._id))?.parentThreadId).toBe(first.containerThreadId);
    });
  });

  test.each(["deleted", "foreign owner", "foreign project", "deleted parent", "foreign parent", "moved"])("rejects a %s source", async (invalid) => {
    const { ctx, t, user, project, profile, asUser, startArgs } = await setupRunnableWorkflow();
    const other = await ctx.user();
    const otherProject = await ctx.project(project.organizationId, user._id);
    const parent = await ctx.cliThread(invalid === "foreign parent" ? other._id : user._id, project._id, profile._id, { kind: "group", isDeleted: invalid === "deleted parent" });
    const source = await ctx.cliThread(invalid === "foreign owner" ? other._id : user._id, invalid === "foreign project" ? otherProject._id : project._id, profile._id, {
      isDeleted: invalid === "deleted", parentThreadId: invalid.endsWith("parent") ? parent._id : undefined,
    });
    await expect(asUser.mutation(api.workflows.runs.core.start, {
      ...startArgs, sourceThreadId: source._id, ...(invalid === "moved" ? { expectedContainerId: parent._id } : {}),
    })).rejects.toThrow();
    await t.run(async (dbCtx) => { expect(await dbCtx.db.query("workflowRuns").collect()).toHaveLength(0); });
  });
});

import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import { createTestContext } from "../../convex-testing";
import type { LaneDefinition, StageDefinition, WorkflowDefinition, WorkflowStep } from "../lib/contracts/workflowDefinition";
import { errors } from "./errors";

const validWorkflowInput = {
  name: "Release Train",
  description: "Ship a release end to end",
  category: "Delivery",
  color: "#3b82f6",
  definition: minimalDefinition(),
};

describe("workflows.core", () => {
  test("member can create a workflow with normalized fields, its draft, and the dirty flag set", async () => {
    const ctx = createTestContext();
    const { org, project } = await ctx.setupProject();
    const member = await ctx.user();
    await ctx.orgMember(org._id, member._id, "member");
    await ctx.projectMember(project._id, member._id, "member");
    const asMember = ctx.asUser(member);

    const workflowId = await asMember.mutation(api.workflows.core.create, {
      projectId: project._id,
      name: "  Release   Train  ",
      description: "   ",
      category: "  Delivery  ",
      color: "#3b82f6",
      definition: minimalDefinition(),
    });

    await ctx.t.run(async (runCtx) => {
      const workflow = await runCtx.db.get("workflows", workflowId);
      expect(workflow).toMatchObject({
        projectId: project._id,
        name: "Release Train",
        category: "Delivery",
        color: "#3b82f6",
        draftDefinition: minimalDefinition(),
        dirtySinceLastVersion: true,
        createdBy: member._id,
        updatedBy: member._id,
        isDeleted: false,
      });
      expect(workflow?.description).toBeUndefined();
    });
  });

  test("create requires a definition, so the lane/stage floor has no way around it", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject();

    await expect(
      // @ts-expect-error — definition is a required arg.
      asUser.mutation(api.workflows.core.create, { projectId: project._id, name: "No draft" })
    ).rejects.toThrow();
  });

  test("create validates name, color, and field lengths", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject();

    await expect(
      asUser.mutation(api.workflows.core.create, { projectId: project._id, name: "   ", definition: minimalDefinition() })
    ).rejects.toThrow(errors.WORKFLOW_NAME_REQUIRED);
    await expect(
      asUser.mutation(api.workflows.core.create, {
        projectId: project._id,
        name: "x".repeat(121),
        definition: minimalDefinition(),
      })
    ).rejects.toThrow(errors.WORKFLOW_NAME_TOO_LONG);
    await expect(
      asUser.mutation(api.workflows.core.create, {
        projectId: project._id,
        name: "Ok",
        category: "x".repeat(61),
        definition: minimalDefinition(),
      })
    ).rejects.toThrow(errors.WORKFLOW_CATEGORY_TOO_LONG);
    await expect(
      asUser.mutation(api.workflows.core.create, {
        projectId: project._id,
        name: "Ok",
        description: "x".repeat(2001),
        definition: minimalDefinition(),
      })
    ).rejects.toThrow(errors.WORKFLOW_DESCRIPTION_TOO_LONG);
    await expect(
      asUser.mutation(api.workflows.core.create, {
        projectId: project._id,
        name: "Ok",
        color: "#123456",
        definition: minimalDefinition(),
      })
    ).rejects.toThrow(errors.WORKFLOW_COLOR_INVALID);
  });

  test("listByProject returns identity summaries newest-edited-first without the draft definition", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject();

    const definition = minimalDefinition();
    const firstId = await asUser.mutation(api.workflows.core.create, { projectId: project._id, name: "First", definition });
    const secondId = await asUser.mutation(api.workflows.core.create, {
      projectId: project._id,
      name: "Second",
      definition,
    });
    // Pin updatedAt into the past so the rename's Date.now() can't tie with
    // the creations inside one millisecond (that tie made this test flaky).
    await ctx.t.run(async (runCtx) => {
      await runCtx.db.patch("workflows", firstId, { updatedAt: 1_000 });
      await runCtx.db.patch("workflows", secondId, { updatedAt: 2_000 });
    });
    // Renaming bumps updatedAt, so the first workflow moves to the top.
    await asUser.mutation(api.workflows.core.update, { workflowId: firstId, name: "First Renamed" });

    const list = await asUser.query(api.workflows.core.listByProject, { projectId: project._id });

    expect(list.map((workflow) => workflow._id)).toEqual([firstId, secondId]);
    expect(list[0].name).toBe("First Renamed");
    expect(list.every((workflow) => !("draftDefinition" in workflow))).toBe(true);
  });

  test("get returns the workflow with its draft definition", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject();

    const workflowId = await asUser.mutation(api.workflows.core.create, {
      projectId: project._id,
      ...validWorkflowInput,
    });

    const workflow = await asUser.query(api.workflows.core.get, { workflowId });

    expect(workflow).toMatchObject({
      _id: workflowId,
      name: "Release Train",
      draftDefinition: minimalDefinition(),
    });
  });

  test("update patches identity fields, clears nullable fields, and leaves the dirty flag alone", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject();

    const workflowId = await asUser.mutation(api.workflows.core.create, {
      projectId: project._id,
      ...validWorkflowInput,
    });
    // Clear the flag directly so the test can see that update never sets it.
    await ctx.t.run(async (runCtx) => {
      await runCtx.db.patch("workflows", workflowId, { dirtySinceLastVersion: false });
    });

    await asUser.mutation(api.workflows.core.update, {
      workflowId,
      name: "  Renamed  Train ",
      description: null,
      category: null,
      color: null,
    });

    await ctx.t.run(async (runCtx) => {
      const workflow = await runCtx.db.get("workflows", workflowId);
      expect(workflow?.name).toBe("Renamed Train");
      expect(workflow?.description).toBeUndefined();
      expect(workflow?.category).toBeUndefined();
      expect(workflow?.color).toBeUndefined();
      expect(workflow?.dirtySinceLastVersion).toBe(false);
    });
  });

  test("remove soft deletes: gone from the list, get returns null, update rejects", async () => {
    const ctx = createTestContext();
    const { project, asUser, user } = await ctx.setupProject();

    const workflowId = await asUser.mutation(api.workflows.core.create, {
      projectId: project._id,
      ...validWorkflowInput,
    });

    await asUser.mutation(api.workflows.core.remove, { workflowId });

    await expect(asUser.query(api.workflows.core.listByProject, { projectId: project._id })).resolves.toEqual([]);
    await expect(asUser.query(api.workflows.core.get, { workflowId })).resolves.toBeNull();
    await expect(asUser.mutation(api.workflows.core.update, { workflowId, name: "Nope" })).rejects.toThrow(
      errors.WORKFLOW_NOT_FOUND
    );
    await ctx.t.run(async (runCtx) => {
      const workflow = await runCtx.db.get("workflows", workflowId);
      expect(workflow).toMatchObject({ isDeleted: true, deletedBy: user._id });
      expect(workflow?.deletedAt).toEqual(expect.any(Number));
    });
  });

  test("viewer can read but not write; outsider gets empty reads and denied writes", async () => {
    const ctx = createTestContext();
    const { org, project, asUser } = await ctx.setupProject();
    const viewer = await ctx.user();
    await ctx.orgMember(org._id, viewer._id, "member");
    await ctx.projectMember(project._id, viewer._id, "viewer");
    const asViewer = ctx.asUser(viewer);
    const outsider = await ctx.user();
    const asOutsider = ctx.asUser(outsider);

    const workflowId = await asUser.mutation(api.workflows.core.create, {
      projectId: project._id,
      ...validWorkflowInput,
    });

    const viewerList = await asViewer.query(api.workflows.core.listByProject, { projectId: project._id });
    expect(viewerList.map((workflow) => workflow._id)).toEqual([workflowId]);
    await expect(asViewer.query(api.workflows.core.get, { workflowId })).resolves.toMatchObject({ _id: workflowId });

    await expect(
      asViewer.mutation(api.workflows.core.create, {
        projectId: project._id,
        name: "Viewer Workflow",
        definition: minimalDefinition(),
      })
    ).rejects.toThrow();
    await expect(asViewer.mutation(api.workflows.core.update, { workflowId, name: "Viewer Rename" })).rejects.toThrow();
    await expect(asViewer.mutation(api.workflows.core.remove, { workflowId })).rejects.toThrow();

    await expect(asOutsider.query(api.workflows.core.listByProject, { projectId: project._id })).resolves.toEqual([]);
    await expect(asOutsider.query(api.workflows.core.get, { workflowId })).resolves.toBeNull();
    await expect(asOutsider.mutation(api.workflows.core.remove, { workflowId })).rejects.toThrow();
  });
});

// Single lanes carry the defaults Save normalization would pin, so
// round-trip `toEqual(definition)` assertions hold as written.
function lane(laneId: string, type: LaneDefinition["type"] = "single"): LaneDefinition {
  return type === "single" ? { laneId, name: laneId, type, defaults: { cliType: "claude-code" } } : { laneId, name: laneId, type };
}

function promptStep(stepId: string, laneId: string): WorkflowStep {
  return { stepId, laneId, action: { type: "prompt", content: { displayContent: `do ${stepId}` } } };
}

function stage(stageId: string, steps: WorkflowStep[] = []): StageDefinition {
  return { stageId, name: stageId, steps };
}

// The smallest definition Save accepts: one lane, one stage.
function minimalDefinition(): WorkflowDefinition {
  return { lanes: [lane("lane-1")], stages: [stage("stage-1")] };
}

function validDefinition(): WorkflowDefinition {
  return {
    lanes: [lane("lane-1"), lane("lane-2")],
    stages: [
      stage("stage-1", [promptStep("step-1", "lane-1"), promptStep("step-2", "lane-2")]),
      stage("stage-2", [promptStep("step-3", "lane-1")]),
    ],
  };
}

describe("workflows.core definition saves", () => {
  async function setupWorkflowWithCleanFlag() {
    const ctx = createTestContext();
    const { org, project, asUser } = await ctx.setupProject();
    const workflowId = await asUser.mutation(api.workflows.core.create, { projectId: project._id, ...validWorkflowInput });
    await ctx.t.run(async (runCtx) => {
      await runCtx.db.patch("workflows", workflowId, { dirtySinceLastVersion: false });
    });
    return { ctx, asUser, org, project, workflowId };
  }

  async function readWorkflow(ctx: ReturnType<typeof createTestContext>, workflowId: Awaited<ReturnType<typeof setupWorkflowWithCleanFlag>>["workflowId"]) {
    return ctx.t.run(async (runCtx) => {
      const workflow = await runCtx.db.get("workflows", workflowId);
      if (!workflow) throw new Error("workflow missing");
      return workflow;
    });
  }

  test("create persists a provided definition and validates its structure", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject();

    const definition = validDefinition();
    const workflowId = await asUser.mutation(api.workflows.core.create, {
      projectId: project._id,
      name: "Seeded",
      definition,
    });
    await ctx.t.run(async (runCtx) => {
      const workflow = await runCtx.db.get("workflows", workflowId);
      expect(workflow?.draftDefinition).toEqual(definition);
    });

    await expect(
      asUser.mutation(api.workflows.core.create, {
        projectId: project._id,
        name: "Broken",
        definition: { lanes: [lane("lane-1"), lane("lane-1")], stages: [stage("stage-1")] },
      })
    ).rejects.toThrow(errors.WORKFLOW_DEFINITION_DUPLICATE_LANE_ID);
  });

  test("saving a changed definition patches the draft and sets the dirty flag", async () => {
    const { ctx, asUser, workflowId } = await setupWorkflowWithCleanFlag();

    const definition = validDefinition();
    await asUser.mutation(api.workflows.core.update, { workflowId, definition });

    const workflow = await readWorkflow(ctx, workflowId);
    expect(workflow.draftDefinition).toEqual(definition);
    expect(workflow.dirtySinceLastVersion).toBe(true);
  });

  test("rename-only save with the unchanged definition re-sent leaves the flag clear", async () => {
    const { ctx, asUser, workflowId } = await setupWorkflowWithCleanFlag();

    // The editor re-sends every field on every save.
    await asUser.mutation(api.workflows.core.update, {
      workflowId,
      name: "Renamed",
      definition: minimalDefinition(),
    });

    const workflow = await readWorkflow(ctx, workflowId);
    expect(workflow.name).toBe("Renamed");
    expect(workflow.dirtySinceLastVersion).toBe(false);
  });

  test("reordered object keys do not set the flag; reordering a stage's steps does", async () => {
    const { ctx, asUser, workflowId } = await setupWorkflowWithCleanFlag();
    const definition = validDefinition();
    await asUser.mutation(api.workflows.core.update, { workflowId, definition });
    await ctx.t.run(async (runCtx) => {
      await runCtx.db.patch("workflows", workflowId, { dirtySinceLastVersion: false });
    });

    // Same definition, keys spelled in a different order.
    const reorderedKeys: WorkflowDefinition = JSON.parse(JSON.stringify(definition));
    reorderedKeys.stages = reorderedKeys.stages.map(({ steps, name, stageId }) => ({ stageId, name, steps }));
    await asUser.mutation(api.workflows.core.update, { workflowId, definition: reorderedKeys });
    expect((await readWorkflow(ctx, workflowId)).dirtySinceLastVersion).toBe(false);

    const reorderedSteps = validDefinition();
    reorderedSteps.stages[0].steps.reverse();
    await asUser.mutation(api.workflows.core.update, { workflowId, definition: reorderedSteps });
    expect((await readWorkflow(ctx, workflowId)).dirtySinceLastVersion).toBe(true);
  });

  test("a fully unchanged save skips the patch entirely", async () => {
    const { ctx, asUser, workflowId } = await setupWorkflowWithCleanFlag();
    const before = await readWorkflow(ctx, workflowId);

    await asUser.mutation(api.workflows.core.update, {
      workflowId,
      name: before.name,
      definition: minimalDefinition(),
    });

    const after = await readWorkflow(ctx, workflowId);
    expect(after.updatedAt).toBe(before.updatedAt);
  });

  test("a half-built workflow is a legal draft", async () => {
    const { ctx, asUser, workflowId } = await setupWorkflowWithCleanFlag();

    // A lane with no steps anywhere, a stage with no steps, unnamed stage.
    const definition: WorkflowDefinition = {
      lanes: [lane("lane-1")],
      stages: [{ stageId: "stage-1", name: "", steps: [] }],
    };
    await asUser.mutation(api.workflows.core.update, { workflowId, definition });

    expect((await readWorkflow(ctx, workflowId)).draftDefinition).toEqual(definition);
  });

  test("rejects a saved definition with no lanes or no stages", async () => {
    const { asUser, project, workflowId } = await setupWorkflowWithCleanFlag();

    await expect(
      asUser.mutation(api.workflows.core.update, { workflowId, definition: { lanes: [], stages: [stage("stage-1")] } })
    ).rejects.toThrow(errors.WORKFLOW_DEFINITION_NO_LANES);

    await expect(
      asUser.mutation(api.workflows.core.update, { workflowId, definition: { lanes: [lane("lane-1")], stages: [] } })
    ).rejects.toThrow(errors.WORKFLOW_DEFINITION_NO_STAGES);

    await expect(
      asUser.mutation(api.workflows.core.create, {
        projectId: project._id,
        name: "Laneless",
        definition: { lanes: [], stages: [] },
      })
    ).rejects.toThrow(errors.WORKFLOW_DEFINITION_NO_LANES);
  });

  test("rejects duplicate lane, stage, and per-stage step IDs and unknown step lanes", async () => {
    const { asUser, workflowId } = await setupWorkflowWithCleanFlag();

    await expect(
      asUser.mutation(api.workflows.core.update, {
        workflowId,
        definition: { lanes: [lane("lane-1"), lane("lane-1")], stages: [stage("stage-1")] },
      })
    ).rejects.toThrow(errors.WORKFLOW_DEFINITION_DUPLICATE_LANE_ID);

    await expect(
      asUser.mutation(api.workflows.core.update, {
        workflowId,
        definition: { lanes: [lane("lane-1")], stages: [stage("stage-1"), stage("stage-1")] },
      })
    ).rejects.toThrow(errors.WORKFLOW_DEFINITION_DUPLICATE_STAGE_ID);

    await expect(
      asUser.mutation(api.workflows.core.update, {
        workflowId,
        definition: {
          lanes: [lane("lane-1")],
          stages: [stage("stage-1", [promptStep("step-1", "lane-1"), promptStep("step-1", "lane-1")])],
        },
      })
    ).rejects.toThrow(errors.WORKFLOW_DEFINITION_DUPLICATE_STEP_ID);

    await expect(
      asUser.mutation(api.workflows.core.update, {
        workflowId,
        definition: { lanes: [lane("lane-1")], stages: [stage("stage-1", [promptStep("step-1", "lane-2")])] },
      })
    ).rejects.toThrow(errors.WORKFLOW_DEFINITION_UNKNOWN_LANE);

    // Step IDs are unique within their stage only — reuse across stages is legal.
    await expect(
      asUser.mutation(api.workflows.core.update, {
        workflowId,
        definition: {
          lanes: [lane("lane-1")],
          stages: [stage("stage-1", [promptStep("step-1", "lane-1")]), stage("stage-2", [promptStep("step-1", "lane-1")])],
        },
      })
    ).resolves.toBeNull();
  });

  test("rejects definitions over the count and size limits", async () => {
    const { asUser, workflowId } = await setupWorkflowWithCleanFlag();

    await expect(
      asUser.mutation(api.workflows.core.update, {
        workflowId,
        definition: { lanes: Array.from({ length: 13 }, (_, i) => lane(`lane-${i}`)), stages: [stage("stage-1")] },
      })
    ).rejects.toThrow(errors.WORKFLOW_DEFINITION_TOO_MANY_LANES);

    await expect(
      asUser.mutation(api.workflows.core.update, {
        workflowId,
        definition: { lanes: [lane("lane-1")], stages: Array.from({ length: 51 }, (_, i) => stage(`stage-${i}`)) },
      })
    ).rejects.toThrow(errors.WORKFLOW_DEFINITION_TOO_MANY_STAGES);

    await expect(
      asUser.mutation(api.workflows.core.update, {
        workflowId,
        definition: {
          lanes: [lane("lane-1")],
          stages: [stage("stage-1", Array.from({ length: 51 }, (_, i) => promptStep(`step-${i}`, "lane-1")))],
        },
      })
    ).rejects.toThrow(errors.WORKFLOW_DEFINITION_TOO_MANY_STEPS);

    // Every field under its own cap, so only the aggregate JSON cap can fire.
    const oversized: WorkflowDefinition = {
      lanes: [lane("lane-1")],
      stages: [
        stage(
          "stage-1",
          Array.from({ length: 9 }, (_, i) => ({
            stepId: `step-${i}`,
            laneId: "lane-1",
            action: { type: "prompt" as const, content: { displayContent: "x".repeat(30_000) } },
          }))
        ),
      ],
    };
    await expect(asUser.mutation(api.workflows.core.update, { workflowId, definition: oversized })).rejects.toThrow(
      errors.WORKFLOW_DEFINITION_TOO_LARGE
    );
  });

  test("wait and bash steps round-trip; oversized bash scripts are rejected", async () => {
    const { ctx, asUser, workflowId } = await setupWorkflowWithCleanFlag();

    const definition: WorkflowDefinition = {
      lanes: [lane("lane-1")],
      stages: [
        stage("stage-1", [
          { stepId: "step-1", laneId: "lane-1", name: "Wait for approval", action: { type: "wait" } },
          {
            stepId: "step-2",
            laneId: "lane-1",
            action: { type: "bash", script: "pnpm web:lint", timeoutMs: 600_000, reportOutput: "always" },
          },
          {
            stepId: "step-3",
            laneId: "lane-1",
            action: { type: "bash", script: "pnpm web:test:once", timeoutMs: 600_000, reportOutput: "stop_on_failure" },
          },
        ]),
      ],
    };
    await asUser.mutation(api.workflows.core.update, { workflowId, definition });
    expect((await readWorkflow(ctx, workflowId)).draftDefinition).toEqual(definition);

    await expect(
      asUser.mutation(api.workflows.core.update, {
        workflowId,
        definition: {
          lanes: [lane("lane-1")],
          stages: [
            stage("stage-1", [
              {
                stepId: "step-1",
                laneId: "lane-1",
                action: { type: "bash", script: "x".repeat(32_001), timeoutMs: 600_000, reportOutput: "on_failure" },
              },
            ]),
          ],
        },
      })
    ).rejects.toThrow(errors.WORKFLOW_DEFINITION_SCRIPT_TOO_LONG);
  });

  test("prompt steps round-trip with overrides; oversized prompts are rejected", async () => {
    const { ctx, asUser, workflowId } = await setupWorkflowWithCleanFlag();

    // A parallel lane: its steps legitimately carry the full override set.
    const definition: WorkflowDefinition = {
      lanes: [lane("lane-1", "parallel")],
      stages: [
        stage("stage-1", [
          {
            stepId: "step-1",
            laneId: "lane-1",
            action: {
              type: "prompt",
              content: { displayContent: "Review the open PRs" },
              overrides: { cliType: "claude-code", cliModel: "opus", cliEffort: "high", mode: "agent" },
            },
          },
        ]),
      ],
    };
    await asUser.mutation(api.workflows.core.update, { workflowId, definition });
    expect((await readWorkflow(ctx, workflowId)).draftDefinition).toEqual(definition);

    await expect(
      asUser.mutation(api.workflows.core.update, {
        workflowId,
        definition: {
          lanes: [lane("lane-1")],
          stages: [
            stage("stage-1", [
              {
                stepId: "step-1",
                laneId: "lane-1",
                action: { type: "prompt", content: { displayContent: "x".repeat(32_001) } },
              },
            ]),
          ],
        },
      })
    ).rejects.toThrow(errors.WORKFLOW_DEFINITION_PROMPT_TOO_LONG);
  });

  test("save moves runtime settings where the lane type says they live (Lane override rules)", async () => {
    const { asUser, ctx, project, workflowId } = await setupWorkflowWithCleanFlag();
    const agentId = await asUser.mutation(api.agents.projectAgents.create, {
      projectId: project._id,
      name: "Reviewer",
      prompt: "Review the current diff.",
      appearance: { color: "#3b82f6" },
    });

    await asUser.mutation(api.workflows.core.update, {
      workflowId,
      definition: {
        lanes: [
          // A single lane keeps its defaults; a parallel lane stores none.
          { ...lane("lane-1"), defaults: { cliType: "codex", cliModel: "gpt-5", mode: "agent" } },
          { ...lane("lane-2", "parallel"), defaults: { cliType: "codex" } },
        ],
        stages: [
          stage("stage-1", [
            {
              stepId: "step-1",
              laneId: "lane-1",
              action: {
                type: "prompt",
                content: { displayContent: "do it" },
                // A single lane's step keeps only mode; the rest is the lane's.
                overrides: { projectAgentId: agentId, cliType: "codex", cliModel: "gpt-5", cliEffort: "high", mode: "plan" },
              },
            },
            {
              stepId: "step-2",
              laneId: "lane-2",
              action: {
                type: "prompt",
                content: { displayContent: "do it too" },
                overrides: { projectAgentId: agentId, cliType: "codex", mode: "plan" },
              },
            },
          ]),
        ],
      },
    });

    const stored = (await readWorkflow(ctx, workflowId)).draftDefinition;
    expect(stored.lanes[0].defaults).toEqual({ cliType: "codex", cliModel: "gpt-5", mode: "agent" });
    expect(stored.lanes[1].defaults).toBeUndefined();
    expect(stored.stages[0].steps[0].action).toMatchObject({ overrides: { mode: "plan" } });
    expect((stored.stages[0].steps[0].action as { overrides?: object }).overrides).toEqual({ mode: "plan" });
    expect((stored.stages[0].steps[1].action as { overrides?: object }).overrides).toEqual({
      projectAgentId: agentId,
      cliType: "codex",
      mode: "plan",
    });
  });

  test("save forces a parallel lane's bash step to stop on failure (OS-1886)", async () => {
    const { asUser, ctx, workflowId } = await setupWorkflowWithCleanFlag();
    const bash = (laneId: string, stepId: string) => ({
      stepId,
      laneId,
      action: { type: "bash" as const, script: "pnpm test", timeoutMs: 60_000, reportOutput: "on_failure" as const },
    });

    await asUser.mutation(api.workflows.core.update, {
      workflowId,
      definition: {
        lanes: [lane("lane-1"), lane("lane-2", "parallel")],
        stages: [stage("stage-1", [bash("lane-1", "step-1"), bash("lane-2", "step-2")])],
      },
    });

    const stored = (await readWorkflow(ctx, workflowId)).draftDefinition;
    expect(stored.stages[0].steps.map((step) => (step.action as { reportOutput: string }).reportOutput)).toEqual(["on_failure", "stop_on_failure"]);
  });

  test("save pins the app default runtime on a single lane with none", async () => {
    const { asUser, ctx, workflowId } = await setupWorkflowWithCleanFlag();

    // The editor header shows the fallback runtime on such a lane; the stored
    // draft must carry it, or the version cut rejects what the UI calls runnable.
    await asUser.mutation(api.workflows.core.update, {
      workflowId,
      definition: { lanes: [{ laneId: "lane-1", name: "Lane 1", type: "single" }], stages: [stage("stage-1")] },
    });

    const stored = (await readWorkflow(ctx, workflowId)).draftDefinition;
    expect(stored.lanes[0].defaults).toEqual({ cliType: "claude-code" });
  });

  test("a composer document with a slash-command ref round-trips unexpanded", async () => {
    const { ctx, asUser, org, workflowId } = await setupWorkflowWithCleanFlag();
    const slashCommandId = await asUser.mutation(api.slashCommands.core.createInOrganization, {
      organizationId: org._id,
      key: "review",
      content: "Review the open PRs.",
    });
    const composerDocument = {
      version: 1 as const,
      refs: [
        {
          type: "slash-command" as const,
          id: slashCommandId,
          scope: "organization" as const,
          key: "review",
          canonicalKey: "org:review",
          displayLabel: "/review",
        },
      ],
    };

    const definition: WorkflowDefinition = {
      lanes: [lane("lane-1")],
      stages: [
        stage("stage-1", [
          {
            stepId: "step-1",
            laneId: "lane-1",
            action: {
              type: "prompt",
              content: { displayContent: "[/review](convoy://command/org:review) please", composerDocument },
            },
          },
        ]),
      ],
    };
    await asUser.mutation(api.workflows.core.update, { workflowId, definition });

    expect((await readWorkflow(ctx, workflowId)).draftDefinition).toEqual(definition);
  });

  test("a composer document with no refs is dropped on the way to storage", async () => {
    const { ctx, asUser, workflowId } = await setupWorkflowWithCleanFlag();

    await asUser.mutation(api.workflows.core.update, {
      workflowId,
      definition: {
        lanes: [lane("lane-1")],
        stages: [
          stage("stage-1", [
            {
              stepId: "step-1",
              laneId: "lane-1",
              action: {
                type: "prompt",
                content: { displayContent: "Plan the work", composerDocument: { version: 1, refs: [] } },
              },
            },
          ]),
        ],
      },
    });

    const step = (await readWorkflow(ctx, workflowId)).draftDefinition.stages[0].steps[0];
    expect(step.action).toEqual({ type: "prompt", content: { displayContent: "Plan the work" } });
  });

  test("lane and stage names are trimmed on the way to storage", async () => {
    const { ctx, asUser, workflowId } = await setupWorkflowWithCleanFlag();

    await asUser.mutation(api.workflows.core.update, {
      workflowId,
      definition: {
        lanes: [{ laneId: "lane-1", name: "  Main   lane ", type: "single" }],
        stages: [{ stageId: "stage-1", name: " Plan ", steps: [] }],
      },
    });

    const stored = (await readWorkflow(ctx, workflowId)).draftDefinition;
    expect(stored.lanes[0].name).toBe("Main lane");
    expect(stored.stages[0].name).toBe("Plan");
  });

  test("step names are trimmed on the way to storage, and the trim doesn't fake a change", async () => {
    const { ctx, asUser, workflowId } = await setupWorkflowWithCleanFlag();

    const untrimmed: WorkflowDefinition = {
      lanes: [lane("lane-1")],
      stages: [
        stage("stage-1", [
          { stepId: "step-1", laneId: "lane-1", name: "  Wait for   QA  ", action: { type: "wait" } },
          { stepId: "step-2", laneId: "lane-1", name: "   ", action: { type: "wait" } },
        ]),
      ],
    };
    await asUser.mutation(api.workflows.core.update, { workflowId, definition: untrimmed });

    const steps = (await readWorkflow(ctx, workflowId)).draftDefinition.stages[0].steps;
    expect(steps[0].name).toBe("Wait for QA");
    expect(steps[1].name).toBeUndefined();

    // Re-sending the untrimmed original compares equal to the stored trim.
    await ctx.t.run(async (runCtx) => {
      await runCtx.db.patch("workflows", workflowId, { dirtySinceLastVersion: false });
    });
    await asUser.mutation(api.workflows.core.update, { workflowId, definition: untrimmed });
    expect((await readWorkflow(ctx, workflowId)).dirtySinceLastVersion).toBe(false);
  });
});

describe("workflows.core.validate", () => {
  function runnableDefinition(): WorkflowDefinition {
    return {
      lanes: [{ laneId: "lane-1", name: "Executor", type: "single", defaults: { cliType: "claude-code", mode: "act" } }],
      stages: [
        {
          stageId: "stage-1",
          name: "Plan",
          steps: [{ stepId: "step-1", laneId: "lane-1", action: { type: "prompt", content: { displayContent: "plan it" } } }],
        },
      ],
    };
  }

  test("reports a runnable stored draft as ok without cutting a version", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject();
    const workflowId = await asUser.mutation(api.workflows.core.create, {
      projectId: project._id,
      name: "Runnable",
      definition: runnableDefinition(),
    });

    await expect(asUser.query(api.workflows.core.validate, { workflowId })).resolves.toEqual({ ok: true });

    await ctx.t.run(async (runCtx) => {
      const workflow = await runCtx.db.get("workflows", workflowId);
      expect(workflow?.dirtySinceLastVersion).toBe(true);
      expect(workflow?.latestVersionId).toBeUndefined();
    });
  });

  test("reports the version-cut error for a draft Save tolerated", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject();
    const workflowId = await asUser.mutation(api.workflows.core.create, {
      projectId: project._id,
      name: "Half built",
      definition: minimalDefinition(),
    });

    await expect(asUser.query(api.workflows.core.validate, { workflowId })).resolves.toEqual({
      ok: false,
      error: errors.WORKFLOW_DEFINITION_EMPTY_STAGE,
    });
  });

  test("checks a supplied definition in the workflow's project instead of the stored draft", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject();
    const workflowId = await asUser.mutation(api.workflows.core.create, {
      projectId: project._id,
      name: "Half built",
      definition: minimalDefinition(),
    });

    await expect(asUser.query(api.workflows.core.validate, { workflowId, definition: runnableDefinition() })).resolves.toEqual({ ok: true });
  });

  test("rejects a workflow the caller cannot see", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject();
    const workflowId = await asUser.mutation(api.workflows.core.create, {
      projectId: project._id,
      name: "Private",
      definition: minimalDefinition(),
    });
    const outsider = ctx.asUser(await ctx.user());

    await expect(outsider.query(api.workflows.core.validate, { workflowId })).rejects.toThrow(errors.WORKFLOW_NOT_FOUND);
  });
});

// The CLI authenticates every call with `apiKey` (OS-1915); a key scoped to one
// project must not reach another's workflows.
describe("workflows.core with an API key", () => {
  test("a project-scoped key manages its own project's workflows only", async () => {
    const ctx = createTestContext();
    const { org, project, user, asUser, t } = await ctx.setupProject();
    const otherProject = await ctx.project(org._id, user._id, { name: "Other Project", alias: "OTHR" });
    const { key: apiKey } = await asUser.mutation(api.apiKeys.core.create, {
      name: "Project key",
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      scope: { organizationId: org._id, projectIds: [project._id] },
    });

    const workflowId = await t.mutation(api.workflows.core.create, { projectId: project._id, ...validWorkflowInput, apiKey });
    await expect(t.query(api.workflows.core.listByProject, { projectId: project._id, apiKey })).resolves.toHaveLength(1);
    await expect(t.query(api.workflows.core.get, { workflowId, apiKey })).resolves.toMatchObject({ name: "Release Train" });
    await expect(t.query(api.workflows.core.validate, { workflowId, apiKey })).resolves.toMatchObject({ ok: false });
    await t.mutation(api.workflows.core.update, { workflowId, name: "Keyed", apiKey });

    const otherWorkflowId = await asUser.mutation(api.workflows.core.create, { projectId: otherProject._id, ...validWorkflowInput });
    await expect(t.mutation(api.workflows.core.create, { projectId: otherProject._id, ...validWorkflowInput, apiKey })).rejects.toThrow();
    await expect(t.query(api.workflows.core.listByProject, { projectId: otherProject._id, apiKey })).resolves.toEqual([]);
    await expect(t.query(api.workflows.core.get, { workflowId: otherWorkflowId, apiKey })).resolves.toBeNull();
    await expect(t.mutation(api.workflows.core.remove, { workflowId: otherWorkflowId, apiKey })).rejects.toThrow();

    await t.mutation(api.workflows.core.remove, { workflowId, apiKey });
    await expect(t.query(api.workflows.core.get, { workflowId, apiKey })).resolves.toBeNull();
  });
});

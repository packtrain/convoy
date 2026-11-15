import type { Id } from "@/convex/_generated/dataModel";
import type { WorkflowRunDetail, WorkflowRunStepItem } from "@/convex/workflows/runs/lib/validators";

/** Local stand-in for `api.workflows.runs.core.get` (OS-1368 rail playground). */
export const THREAD_ID = "t1" as Id<"cliThreads">;

type StepSeed = Partial<WorkflowRunStepItem> & { id: string; title: string };

const executor = { laneId: "lane-1", laneName: "Executor" };
const reviewer = { laneId: "lane-2", laneName: "Reviewer" };

function step(seed: StepSeed): WorkflowRunStepItem {
  const { id, ...rest } = seed;
  return {
    _id: id as Id<"workflowRunSteps">,
    definitionStepId: id,
    type: "prompt",
    status: "pending",
    ...executor,
    ...rest,
  };
}

function run(name: string, versionNumber: number, status: WorkflowRunDetail["status"], stages: WorkflowRunDetail["stages"]): WorkflowRunDetail {
  return {
    _id: "run_1" as Id<"workflowRuns">,
    workflowId: "wf_1" as Id<"workflows">,
    workflowName: name,
    workflowDeleted: false,
    status,
    versionNumber,
    startedAt: 1,
    lastActivityAt: 1,
    stages,
  };
}

function build(overrides: Partial<Record<string, Partial<WorkflowRunStepItem>>>, status: WorkflowRunDetail["status"]): WorkflowRunDetail {
  const steps: WorkflowRunStepItem[] = [
    step({ id: "s1", title: "Investigate the bug report", status: "completed", threadId: THREAD_ID, cliType: "claude-code", cliModel: "haiku" }),
    step({ id: "s2", title: "Write the failing test", status: "completed", threadId: THREAD_ID, cliType: "claude-code", cliModel: "haiku" }),
    step({ id: "s3", title: "Lint & typecheck", type: "bash", status: "running", threadId: THREAD_ID, script: { script: "pnpm web:lint\ncd apps/web && npx tsc --noEmit", timeoutMs: 600_000 } }),
    step({ id: "s4", title: "Review the diff for regressions", cliType: "codex", cliModel: "gpt-5-codex", ...reviewer }),
    step({ id: "s5", title: "Ship it?", type: "wait" }),
    step({ id: "s6", title: "Open the pull request", cliType: "claude-code", cliModel: "haiku" }),
  ].map((item) => ({ ...item, ...overrides[item._id] }));
  return run("Bugfix loop", 5, status, [
    { stageId: "st1", name: "Stage 1", steps: steps.slice(0, 2) },
    { stageId: "st2", name: "Stage 2", steps: steps.slice(2, 4) },
    { stageId: "st3", name: "Stage 3", steps: steps.slice(4) },
  ]);
}

const LONG_STAGE_SIZES = [2, 3, 2, 2, 3, 2, 2, 3, 2];
export const LONG_STEP_COUNT = LONG_STAGE_SIZES.reduce((sum, size) => sum + size, 0);

/** Many stages, one running step at `playhead` (past the end = all done), to exercise the rail's capped height. */
export function buildLongRun(playhead: number): WorkflowRunDetail {
  let index = 0;
  const stages = LONG_STAGE_SIZES.map((size, stageIndex) => ({
    stageId: `long-st${stageIndex + 1}`,
    name: `Stage ${stageIndex + 1}`,
    steps: Array.from({ length: size }, (_, stepIndex) => {
      const position = index++;
      const status = position < playhead ? "completed" : position === playhead ? "running" : "pending";
      return step({
        id: `long-s${position}`,
        title: `Step ${stageIndex + 1}.${stepIndex + 1}: ${["Investigate", "Implement", "Verify"][stepIndex]}`,
        status,
        threadId: status === "pending" ? undefined : THREAD_ID,
        cliType: "claude-code",
        cliModel: "haiku",
        ...(stepIndex === 0 ? executor : reviewer),
      });
    }),
  }));
  return run("Release train", 12, playhead >= LONG_STEP_COUNT ? "completed" : "running", stages);
}

export const SCENARIOS: Record<string, { label: string; run: WorkflowRunDetail }> = {
  long: { label: "Long run", run: buildLongRun(9) },
  running: { label: "Running", run: build({}, "running") },
  approve: { label: "Bash held for approval", run: build({ s3: { status: "waiting" } }, "needs_attention") },
  wait: {
    label: "Wait step",
    run: build({ s3: { status: "completed" }, s4: { status: "completed", threadId: "t2" as Id<"cliThreads"> }, s5: { status: "waiting", threadId: THREAD_ID } }, "needs_attention"),
  },
  held: {
    label: "Lane held",
    run: build({ s3: { status: "completed" }, s4: { status: "running", threadId: "t2" as Id<"cliThreads"> }, s5: { held: true } }, "running"),
  },
  failed: {
    label: "Failed step",
    run: build({ s3: { status: "failed", errorMessage: "Script: Exited with code 1" }, s4: { status: "running", threadId: "t2" as Id<"cliThreads"> } }, "needs_attention"),
  },
  completed: {
    label: "Completed",
    run: build(
      { s3: { status: "completed" }, s4: { status: "completed", threadId: "t2" as Id<"cliThreads"> }, s5: { status: "completed", threadId: THREAD_ID }, s6: { status: "completed", threadId: THREAD_ID } },
      "completed"
    ),
  },
};

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Command } from "commander";

const { confirmMock, runOneShotCommandMock } = vi.hoisted(() => ({
  confirmMock: vi.fn(),
  runOneShotCommandMock: vi.fn(),
}));

vi.mock("@inquirer/prompts", () => ({ confirm: confirmMock }));

vi.mock("../../../lib/one-shot-command.js", () => ({
  runOneShotCommand: runOneShotCommandMock,
}));

vi.mock("../../../cli.js", () => ({
  addGlobalOptions: <T extends { option: (...args: string[]) => T }>(cmd: T) =>
    cmd
      .option("--profile <name>", "Profile key (for profile lookup)")
      .option("--url <url>", "Convex backend URL (overrides config)")
      .option("--api-key <key>", "API key (overrides config)")
      .option("--project <id>", "Project ID (overrides config)"),
}));

import { api } from "../../../convex/_generated/api.js";
import { resetCommandOptions } from "../../test-helpers.js";
import { cancelRunCommand } from "./cancel.js";
import { getRunCommand } from "./get.js";
import { listRunsCommand } from "./list.js";
import { resumeRunLaneCommand } from "./resume.js";
import { approveStepCommand, retryStepCommand, skipStepCommand } from "./steps.js";

const runSummary = {
  _id: "run_1",
  workflowId: "wf_1",
  status: "running",
  startedAt: 1_700_000_000_000,
  lastActivityAt: 1_700_000_100_000,
};

const runDetail = {
  ...runSummary,
  workflowName: "Release train",
  workflowDeleted: false,
  versionNumber: 3,
  attachedTaskId: "task_1",
  stages: [
    {
      stageId: "build",
      name: "Build",
      steps: [
        { _id: "step_a", definitionStepId: "a", laneId: "main", laneName: "Main", title: "Implement", type: "prompt", status: "completed", threadId: "thr_a", cliType: "claude-code" },
        { _id: "step_b", definitionStepId: "b", laneId: "main", laneName: "Main", title: "pnpm test", type: "bash", status: "failed", errorMessage: "exit 1" },
      ],
    },
    {
      stageId: "review",
      name: "Review",
      steps: [{ _id: "step_c", definitionStepId: "c", laneId: "main", laneName: "Main", title: "Approve", type: "wait", status: "pending", held: true }],
    },
  ],
};

const commands = [listRunsCommand, getRunCommand, cancelRunCommand, resumeRunLaneCommand, approveStepCommand, retryStepCommand, skipStepCommand];

function invoke(command: Command, args: unknown[]) {
  Reflect.set(command, "optsWithGlobals", () => ({ project: "WEB" }));
  return Reflect.get(command, "_actionHandler").call(command, args);
}

function output(): string {
  return vi.mocked(console.log).mock.calls.flat().join("\n");
}

describe("workflows runs commands", () => {
  const query = vi.fn();
  const mutation = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    for (const command of commands) {
      resetCommandOptions(command);
    }
    mutation.mockResolvedValue(null);
    runOneShotCommandMock.mockImplementation(async (_cmd, run) => {
      await run({
        client: { query, mutation, subscribe: vi.fn(), close: vi.fn(), client: {} as never },
        config: { convexUrl: "https://example.convex.cloud", apiKey: "sk_user_test", projectId: "proj_web_1" },
      });
    });
  });

  it("lists a workflow's runs, newest first as returned", async () => {
    query.mockResolvedValueOnce([runSummary, { ...runSummary, _id: "run_0", status: "completed", completedAt: 1_700_000_200_000 }]);

    await invoke(listRunsCommand, ["wf_1"]);

    expect(query).toHaveBeenCalledWith(api.workflows.runs.core.listByWorkflow, { workflowId: "wf_1" });
    expect(output()).toContain("Runs (2)");
    expect(output()).toContain("run_1");
    expect(output()).toContain("completed");
  });

  it("prints an empty state", async () => {
    query.mockResolvedValueOnce([]);
    await invoke(listRunsCommand, ["wf_1"]);
    expect(output()).toContain("No runs found.");
  });

  it("shows a run's stages with step ids, threads, errors, and holds", async () => {
    query.mockResolvedValueOnce(runDetail);

    await invoke(getRunCommand, ["run_1"]);

    expect(query).toHaveBeenCalledWith(api.workflows.runs.core.get, { runId: "run_1" });
    const text = output();
    expect(text).toContain("Release train");
    expect(text).toContain("v3");
    expect(text).toContain("step_a");
    expect(text).toContain("thr_a");
    expect(text).toContain("exit 1");
    expect(text).toContain("held");
  });

  it("errors when the run is not found", async () => {
    query.mockResolvedValueOnce(null);
    await expect(invoke(getRunCommand, ["run_x"])).rejects.toThrow("Run not found or not accessible.");
  });

  it("asks before canceling and stops on no", async () => {
    confirmMock.mockResolvedValueOnce(false);

    await invoke(cancelRunCommand, ["run_1"]);

    expect(confirmMock).toHaveBeenCalledWith({ message: "Cancel run run_1? Its lane threads are stopped.", default: false });
    expect(mutation).not.toHaveBeenCalled();
    expect(output()).toContain("Cancelled.");
  });

  it("cancels without asking with --yes", async () => {
    cancelRunCommand.setOptionValue("yes", true);

    await invoke(cancelRunCommand, ["run_1"]);

    expect(confirmMock).not.toHaveBeenCalled();
    expect(mutation).toHaveBeenCalledWith(api.workflows.runs.core.cancel, { runId: "run_1" });
    expect(output()).toContain("Run canceled");
  });

  it("approves, retries, and skips a step by its run-step id", async () => {
    await invoke(approveStepCommand, ["run_1", "step_c"]);
    await invoke(retryStepCommand, ["run_1", "step_b"]);
    await invoke(skipStepCommand, ["run_1", "step_b"]);

    expect(mutation).toHaveBeenCalledWith(api.workflows.runs.core.approveStep, { runId: "run_1", stepId: "step_c" });
    expect(mutation).toHaveBeenCalledWith(api.workflows.runs.core.retryStep, { runId: "run_1", stepId: "step_b" });
    expect(mutation).toHaveBeenCalledWith(api.workflows.runs.core.skipStep, { runId: "run_1", stepId: "step_b" });
    expect(output()).toContain("Step approved");
    expect(output()).toContain("Step retried");
    expect(output()).toContain("Step skipped");
  });

  it("resumes a held lane", async () => {
    resumeRunLaneCommand.setOptionValue("lane", "main");

    await invoke(resumeRunLaneCommand, ["run_1"]);

    expect(mutation).toHaveBeenCalledWith(api.workflows.runs.core.resumeLane, { runId: "run_1", laneId: "main" });
    expect(output()).toContain("Lane resumed");
  });
});

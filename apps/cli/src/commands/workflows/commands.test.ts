import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Command } from "commander";

const { runOneShotCommandMock } = vi.hoisted(() => ({
  runOneShotCommandMock: vi.fn(),
}));

vi.mock("../../lib/one-shot-command.js", () => ({
  runOneShotCommand: runOneShotCommandMock,
}));

vi.mock("../../cli.js", () => ({
  addGlobalOptions: <T extends { option: (...args: string[]) => T }>(cmd: T) =>
    cmd
      .option("--profile <name>", "Profile key (for profile lookup)")
      .option("--url <url>", "Convex backend URL (overrides config)")
      .option("--api-key <key>", "API key (overrides config)")
      .option("--project <id>", "Project ID (overrides config)"),
}));

import { api } from "../../convex/_generated/api.js";
import { resetCommandOptions } from "../test-helpers.js";
import { getWorkflowCommand } from "./get.js";
import { listWorkflowsCommand } from "./list.js";
import { validateWorkflowCommand } from "./validate.js";

const accessibleProjects = [
  {
    _id: "proj_web_1",
    name: "Web",
    alias: "WEB",
    organizationId: "org_acme",
    organizationName: "Acme",
    organizationSlug: "acme",
    role: { name: "org-owner", permissions: ["*"] },
  },
];

const summary = {
  _id: "wf_release",
  _creationTime: 1,
  projectId: "proj_web_1",
  name: "Release train",
  description: "Ship a release",
  category: "Release",
  color: "blue",
  dirtySinceLastVersion: true,
  createdBy: "user_1",
  updatedBy: "user_1",
  createdAt: 1,
  updatedAt: 1_700_000_000_000,
};

const workflow = {
  ...summary,
  draftDefinition: {
    lanes: [
      { laneId: "main", name: "Main", type: "single", defaults: { cliType: "claude-code", cliModel: "opus" } },
      { laneId: "review", name: "Review", type: "parallel" },
    ],
    stages: [
      {
        stageId: "s1",
        name: "Build",
        steps: [
          { stepId: "a", laneId: "main", name: "Implement", action: { type: "prompt", content: { type: "doc", content: [] } } },
          { stepId: "b", laneId: "main", action: { type: "bash", script: "pnpm test", timeoutMs: 60_000, reportOutput: "always" } },
        ],
      },
      {
        stageId: "s2",
        name: "Review",
        steps: [{ stepId: "c", laneId: "review", name: "Approve", action: { type: "wait" } }],
      },
    ],
  },
};

const dir = mkdtempSync(join(tmpdir(), "convoy-workflows-"));
function writeJson(name: string, value: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

function invoke(command: Command, args: unknown[] = [], globals: Record<string, unknown> = { project: "WEB" }) {
  Reflect.set(command, "optsWithGlobals", () => globals);
  return Reflect.get(command, "_actionHandler").call(command, args);
}

function output(): string {
  return vi.mocked(console.log).mock.calls.flat().join("\n");
}

describe("workflows commands", () => {
  const query = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    for (const command of [listWorkflowsCommand, getWorkflowCommand, validateWorkflowCommand]) {
      resetCommandOptions(command);
    }

    runOneShotCommandMock.mockImplementation(async (_cmd, run) => {
      await run({
        client: { query, mutation: vi.fn(), subscribe: vi.fn(), close: vi.fn(), client: {} as never },
        config: { convexUrl: "https://example.convex.cloud", apiKey: "sk_user_test", projectId: undefined },
      });
    });
  });

  it("lists the resolved project's workflows", async () => {
    query.mockResolvedValueOnce(accessibleProjects).mockResolvedValueOnce([summary]);

    await invoke(listWorkflowsCommand);

    expect(query).toHaveBeenCalledWith(api.workflows.core.listByProject, { projectId: "proj_web_1" });
    expect(output()).toContain("Release train");
    expect(output()).toContain("[Release]");
    expect(output()).toContain("draft changed");
    expect(output()).toContain("wf_release");
  });

  it("prints an empty state when the project has no workflows", async () => {
    query.mockResolvedValueOnce(accessibleProjects).mockResolvedValueOnce([]);

    await invoke(listWorkflowsCommand);

    expect(output()).toContain("No workflows found");
  });

  it("emits the summaries as JSON", async () => {
    query.mockResolvedValueOnce(accessibleProjects).mockResolvedValueOnce([summary]);
    listWorkflowsCommand.setOptionValue("output", "json");

    await invoke(listWorkflowsCommand);

    expect(JSON.parse(output())).toEqual([summary]);
  });

  it("gets a workflow and summarizes its lanes and stages", async () => {
    query.mockResolvedValueOnce(workflow);

    await invoke(getWorkflowCommand, ["wf_release"]);

    expect(query).toHaveBeenCalledWith(api.workflows.core.get, { workflowId: "wf_release" });
    const text = output();
    expect(text).toContain("Release train");
    expect(text).toContain("Main (single, claude-code opus)");
    expect(text).toContain("Review (parallel)");
    expect(text).toContain("Build");
    expect(text).toContain("[prompt] Implement");
    expect(text).toContain("[bash] pnpm test");
    expect(text).toContain("[wait] Approve");
  });

  it("emits the full workflow as JSON so the draft definition round-trips", async () => {
    query.mockResolvedValueOnce(workflow);
    getWorkflowCommand.setOptionValue("output", "json");

    await invoke(getWorkflowCommand, ["wf_release"]);

    expect(JSON.parse(output())).toEqual(workflow);
  });

  it("fails when the workflow is missing or inaccessible", async () => {
    query.mockResolvedValueOnce(null);

    await expect(invoke(getWorkflowCommand, ["wf_missing"])).rejects.toThrow("Workflow not found or not accessible.");
  });

  it("validate reports a runnable stored draft", async () => {
    query.mockResolvedValueOnce({ ok: true });

    await invoke(validateWorkflowCommand, ["wf_release"]);

    expect(query).toHaveBeenCalledWith(api.workflows.core.validate, { workflowId: "wf_release" });
    expect(output()).toContain("Workflow is runnable");
  });

  it("validate checks a definition file against the workflow's project and fails on errors", async () => {
    query.mockResolvedValueOnce({ ok: false, error: "Every stage needs at least one step to run" });
    validateWorkflowCommand.setOptionValue("definitionFile", writeJson("def.json", workflow.draftDefinition));

    await expect(invoke(validateWorkflowCommand, ["wf_release"])).rejects.toThrow("Every stage needs at least one step to run");

    expect(query).toHaveBeenCalledWith(api.workflows.core.validate, { workflowId: "wf_release", definition: workflow.draftDefinition });
  });

  it("validate --json prints the verdict as JSON and still fails on an unrunnable draft", async () => {
    query.mockResolvedValueOnce({ ok: false, error: "Wait cannot be the first step" });
    validateWorkflowCommand.setOptionValue("json", true);

    await expect(invoke(validateWorkflowCommand, ["wf_release"])).rejects.toThrow("Wait cannot be the first step");

    expect(JSON.parse(output())).toEqual({ ok: false, error: "Wait cannot be the first step" });
  });
});

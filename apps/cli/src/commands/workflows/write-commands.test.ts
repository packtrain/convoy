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
import { createWorkflowCommand } from "./create.js";
import { deleteWorkflowCommand } from "./delete.js";
import { startWorkflowCommand } from "./start.js";
import { updateWorkflowCommand } from "./update.js";

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

const definition = {
  lanes: [{ laneId: "main", name: "Main", type: "single", defaults: { cliType: "claude-code" } }],
  stages: [{ stageId: "s1", name: "Build", steps: [] }],
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

describe("workflows write commands", () => {
  const query = vi.fn();
  const mutation = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    for (const command of [createWorkflowCommand, updateWorkflowCommand, deleteWorkflowCommand, startWorkflowCommand]) {
      resetCommandOptions(command);
    }

    runOneShotCommandMock.mockImplementation(async (_cmd, run) => {
      await run({
        client: { query, mutation, subscribe: vi.fn(), close: vi.fn(), client: {} as never },
        config: { convexUrl: "https://example.convex.cloud", apiKey: "sk_user_test", projectId: undefined },
      });
    });
  });

  describe("create", () => {
    it("creates from a definition file with identity fields", async () => {
      query.mockResolvedValueOnce(accessibleProjects);
      mutation.mockResolvedValueOnce("wf_new");
      createWorkflowCommand.setOptionValue("name", "Release train");
      createWorkflowCommand.setOptionValue("definitionFile", writeJson("def.json", definition));
      createWorkflowCommand.setOptionValue("description", "Ship it");
      createWorkflowCommand.setOptionValue("category", "Release");
      createWorkflowCommand.setOptionValue("color", "blue");

      await invoke(createWorkflowCommand);

      expect(mutation).toHaveBeenCalledWith(api.workflows.core.create, {
        projectId: "proj_web_1",
        name: "Release train",
        description: "Ship it",
        category: "Release",
        color: "blue",
        definition,
      });
      expect(output()).toContain("wf_new");
    });

    it("accepts a `workflows get` dump and unwraps its draftDefinition", async () => {
      query.mockResolvedValueOnce(accessibleProjects);
      mutation.mockResolvedValueOnce("wf_new");
      createWorkflowCommand.setOptionValue("name", "Copy");
      createWorkflowCommand.setOptionValue("definitionFile", writeJson("dump.json", { _id: "wf_old", name: "Old", draftDefinition: definition }));

      await invoke(createWorkflowCommand);

      expect(mutation).toHaveBeenCalledWith(api.workflows.core.create, expect.objectContaining({ definition }));
    });

    it("clones another workflow's draft with --from", async () => {
      query.mockResolvedValueOnce(accessibleProjects).mockResolvedValueOnce({ _id: "wf_old", draftDefinition: definition });
      mutation.mockResolvedValueOnce("wf_new");
      createWorkflowCommand.setOptionValue("name", "Copy");
      createWorkflowCommand.setOptionValue("from", "wf_old");

      await invoke(createWorkflowCommand);

      expect(query).toHaveBeenCalledWith(api.workflows.core.get, { workflowId: "wf_old" });
      expect(mutation).toHaveBeenCalledWith(api.workflows.core.create, expect.objectContaining({ name: "Copy", definition }));
    });

    it("requires exactly one definition source", async () => {
      createWorkflowCommand.setOptionValue("name", "X");
      await expect(invoke(createWorkflowCommand)).rejects.toThrow("Pass --definition-file or --from.");

      createWorkflowCommand.setOptionValue("definitionFile", writeJson("def.json", definition));
      createWorkflowCommand.setOptionValue("from", "wf_old");
      await expect(invoke(createWorkflowCommand)).rejects.toThrow("Cannot use --definition-file and --from together");
    });

    it("rejects a file that is not a definition", async () => {
      createWorkflowCommand.setOptionValue("name", "X");
      createWorkflowCommand.setOptionValue("definitionFile", writeJson("bad.json", { lanes: "nope" }));

      await expect(invoke(createWorkflowCommand)).rejects.toThrow("needs `lanes` and `stages` arrays");
    });
  });

  describe("update", () => {
    it("sends only the given fields, mapping --clear-* to null", async () => {
      mutation.mockResolvedValueOnce(null);
      updateWorkflowCommand.setOptionValue("name", "Renamed");
      updateWorkflowCommand.setOptionValue("clearDescription", true);
      updateWorkflowCommand.setOptionValue("color", "green");
      updateWorkflowCommand.setOptionValue("clearCategory", true);

      await invoke(updateWorkflowCommand, ["wf_release"]);

      expect(mutation).toHaveBeenCalledWith(api.workflows.core.update, {
        workflowId: "wf_release",
        name: "Renamed",
        description: null,
        category: null,
        color: "green",
      });
      expect(output()).toContain("Workflow updated");
    });

    it("replaces the draft from --definition-file", async () => {
      mutation.mockResolvedValueOnce(null);
      updateWorkflowCommand.setOptionValue("definitionFile", writeJson("def.json", definition));

      await invoke(updateWorkflowCommand, ["wf_release"]);

      expect(mutation).toHaveBeenCalledWith(api.workflows.core.update, { workflowId: "wf_release", definition });
    });

    it("rejects conflicting flags and empty updates", async () => {
      await expect(invoke(updateWorkflowCommand, ["wf_release"])).rejects.toThrow("No updates provided");

      updateWorkflowCommand.setOptionValue("color", "red");
      updateWorkflowCommand.setOptionValue("clearColor", true);
      await expect(invoke(updateWorkflowCommand, ["wf_release"])).rejects.toThrow("Cannot use --color and --clear-color together");
      expect(mutation).not.toHaveBeenCalled();
    });
  });

  describe("delete", () => {
    it("soft-deletes and warns that active runs are canceled", async () => {
      mutation.mockResolvedValueOnce(null);

      await invoke(deleteWorkflowCommand, ["wf_release"]);

      expect(mutation).toHaveBeenCalledWith(api.workflows.core.remove, { workflowId: "wf_release" });
      expect(output()).toContain("Workflow deleted");
      expect(output()).toContain("active runs were canceled");
    });
  });

  describe("--validate", () => {
    it("create runs the version-cut checks after saving and fails when the draft is not runnable", async () => {
      query.mockResolvedValueOnce(accessibleProjects).mockResolvedValueOnce({ ok: false, error: "Every stage needs at least one step to run" });
      mutation.mockResolvedValueOnce("wf_new");
      createWorkflowCommand.setOptionValue("name", "X");
      createWorkflowCommand.setOptionValue("definitionFile", writeJson("def.json", definition));
      createWorkflowCommand.setOptionValue("validate", true);

      await expect(invoke(createWorkflowCommand)).rejects.toThrow("Every stage needs at least one step to run");

      expect(query).toHaveBeenCalledWith(api.workflows.core.validate, { workflowId: "wf_new" });
      expect(output()).toContain("wf_new");
    });

    it("update reports a runnable draft", async () => {
      mutation.mockResolvedValueOnce(null);
      query.mockResolvedValueOnce({ ok: true });
      updateWorkflowCommand.setOptionValue("definitionFile", writeJson("def.json", definition));
      updateWorkflowCommand.setOptionValue("validate", true);

      await invoke(updateWorkflowCommand, ["wf_release"]);

      expect(query).toHaveBeenCalledWith(api.workflows.core.validate, { workflowId: "wf_release" });
      expect(output()).toContain("Workflow is runnable");
    });
  });

  describe("--validate --json", () => {
    it("create emits one JSON object carrying the verdict, and fails when not runnable", async () => {
      query.mockResolvedValueOnce(accessibleProjects).mockResolvedValueOnce({ ok: false, error: "Wait cannot be the first step" });
      mutation.mockResolvedValueOnce("wf_new");
      createWorkflowCommand.setOptionValue("name", "X");
      createWorkflowCommand.setOptionValue("definitionFile", writeJson("def.json", definition));
      createWorkflowCommand.setOptionValue("validate", true);
      createWorkflowCommand.setOptionValue("json", true);

      await expect(invoke(createWorkflowCommand)).rejects.toThrow("Wait cannot be the first step");

      expect(JSON.parse(output())).toEqual({ workflowId: "wf_new", validation: { ok: false, error: "Wait cannot be the first step" } });
    });

    it("update emits one JSON object carrying the verdict", async () => {
      mutation.mockResolvedValueOnce(null);
      query.mockResolvedValueOnce({ ok: true });
      updateWorkflowCommand.setOptionValue("definitionFile", writeJson("def.json", definition));
      updateWorkflowCommand.setOptionValue("validate", true);
      updateWorkflowCommand.setOptionValue("json", true);

      await invoke(updateWorkflowCommand, ["wf_release"]);

      expect(JSON.parse(output())).toEqual({ workflowId: "wf_release", validation: { ok: true } });
    });
  });

  describe("workflows start", () => {
    it("starts a run on an explicit target with a worktree, task, and first-prompt override", async () => {
      mutation.mockResolvedValueOnce({ runId: "run_1", containerThreadId: "thr_run" });
      startWorkflowCommand.setOptionValue("profileId", "prof_1");
      startWorkflowCommand.setOptionValue("pathId", "path_1");
      startWorkflowCommand.setOptionValue("worktreeBranch", "os-1930");
      startWorkflowCommand.setOptionValue("worktreeBase", "main");
      startWorkflowCommand.setOptionValue("task", "task_1");
      startWorkflowCommand.setOptionValue("firstPrompt", "plan it my way");

      await invoke(startWorkflowCommand, ["wf_1"]);

      expect(mutation).toHaveBeenCalledWith(api.workflows.runs.core.start, {
        workflowId: "wf_1",
        profileId: "prof_1",
        pathId: "path_1",
        worktree: { parentPathId: "path_1", branch: "os-1930", baseRef: "main" },
        taskId: "task_1",
        firstPromptOverride: { displayContent: "plan it my way" },
      });
      expect(output()).toContain("run_1");
      expect(output()).toContain("thr_run");
    });

    it("sends only the required target when nothing else is given", async () => {
      mutation.mockResolvedValueOnce({ runId: "run_1", containerThreadId: "thr_run" });
      startWorkflowCommand.setOptionValue("profileId", "prof_1");
      startWorkflowCommand.setOptionValue("pathId", "path_1");

      await invoke(startWorkflowCommand, ["wf_1"]);

      expect(mutation).toHaveBeenCalledWith(api.workflows.runs.core.start, { workflowId: "wf_1", profileId: "prof_1", pathId: "path_1" });
    });

    it("requires the target and rejects --worktree-base without a branch", async () => {
      startWorkflowCommand.setOptionValue("profileId", "prof_1");
      await expect(invoke(startWorkflowCommand, ["wf_1"])).rejects.toThrow("--path-id is required");

      startWorkflowCommand.setOptionValue("pathId", "path_1");
      startWorkflowCommand.setOptionValue("worktreeBase", "main");
      await expect(invoke(startWorkflowCommand, ["wf_1"])).rejects.toThrow("--worktree-base needs --worktree-branch");
      expect(mutation).not.toHaveBeenCalled();
    });
  });
});

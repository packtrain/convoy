import type { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
import { createProjectAgentCommand } from "./create.js";
import { listProjectAgentsCommand } from "./list.js";
import { updateProjectAgentCommand } from "./update.js";

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

const projectAgent = {
  _id: "agent_1",
  _creationTime: 1,
  projectId: "proj_web_1",
  name: "Reviewer",
  description: "Reviews changes",
  prompt: "Review the diff",
  category: "Quality",
  appearance: { color: "#3b82f6" },
  automation: {
    enabled: true,
    cliType: "codex",
    workspace: "worktree",
  },
  createdBy: "user_1",
  updatedBy: "user_1",
  createdAt: 1,
  updatedAt: 1,
  isDeleted: false,
};

function invoke(command: Command, args: unknown[] = []): Promise<void> {
  Reflect.set(command, "optsWithGlobals", () => ({ project: "WEB" }));
  return Reflect.get(command, "_actionHandler").call(command, args);
}

describe("project-agents commands", () => {
  const query = vi.fn();
  const mutation = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    for (const command of [
      listProjectAgentsCommand,
      createProjectAgentCommand,
      updateProjectAgentCommand,
    ]) {
      resetCommandOptions(command);
    }

    runOneShotCommandMock.mockImplementation(async (_cmd, run) => {
      await run({
        client: {
          query,
          mutation,
          subscribe: vi.fn(),
          close: vi.fn(),
          client: {} as never,
        },
        config: {
          convexUrl: "https://example.convex.cloud",
          apiKey: "sk_user_test",
          projectId: undefined,
        },
      });
    });
  });

  it("lists Project agents with strict JSON output", async () => {
    query
      .mockResolvedValueOnce(accessibleProjects)
      .mockResolvedValueOnce([projectAgent]);
    listProjectAgentsCommand.setOptionValue("json", true);

    await invoke(listProjectAgentsCommand);

    expect(query).toHaveBeenNthCalledWith(
      2,
      api.agents.projectAgents.listByProject,
      { projectId: "proj_web_1" }
    );
    const output = vi.mocked(console.log).mock.calls.at(-1)?.[0];
    expect(JSON.parse(String(output))).toEqual([projectAgent]);
  });

  it("creates a Project agent with the complete automation value", async () => {
    query.mockResolvedValueOnce(accessibleProjects);
    mutation.mockResolvedValueOnce("agent_new");
    createProjectAgentCommand.setOptionValue("name", "Reviewer");
    createProjectAgentCommand.setOptionValue("color", "#3b82f6");
    createProjectAgentCommand.setOptionValue("description", "Reviews changes");
    createProjectAgentCommand.setOptionValue("automation", "enabled");
    createProjectAgentCommand.setOptionValue(
      "automationPrompt",
      "Review the diff"
    );
    createProjectAgentCommand.setOptionValue("automationCliType", "codex");
    createProjectAgentCommand.setOptionValue(
      "automationWorkspace",
      "worktree"
    );

    await invoke(createProjectAgentCommand);

    expect(mutation).toHaveBeenCalledWith(api.agents.projectAgents.create, {
      projectId: "proj_web_1",
      name: "Reviewer",
      description: "Reviews changes",
      appearance: { color: "#3b82f6" },
      automation: {
        enabled: true,
        prompt: { displayContent: "Review the diff" },
        cliType: "codex",
        workspace: "worktree",
      },
    });
  });

  it("updates nullable fields and clears automation explicitly", async () => {
    mutation.mockResolvedValueOnce(null);
    updateProjectAgentCommand.setOptionValue("clearDescription", true);
    updateProjectAgentCommand.setOptionValue("clearPrompt", true);
    updateProjectAgentCommand.setOptionValue("clearCategory", true);
    updateProjectAgentCommand.setOptionValue("clearAutomation", true);

    await invoke(updateProjectAgentCommand, ["agent_1"]);

    expect(mutation).toHaveBeenCalledWith(api.agents.projectAgents.update, {
      projectAgentId: "agent_1",
      description: null,
      prompt: null,
      category: null,
      automation: null,
    });
  });

  it("requires --automation when an automation detail is provided", async () => {
    query.mockResolvedValueOnce(accessibleProjects);
    createProjectAgentCommand.setOptionValue("name", "Reviewer");
    createProjectAgentCommand.setOptionValue("color", "#3b82f6");
    createProjectAgentCommand.setOptionValue("automationCliType", "codex");

    await expect(invoke(createProjectAgentCommand)).rejects.toThrow(
      "require --automation"
    );
    expect(mutation).not.toHaveBeenCalled();
  });

  it("rejects empty updates", async () => {
    await expect(
      invoke(updateProjectAgentCommand, ["agent_1"])
    ).rejects.toThrow("No updates provided");
    expect(mutation).not.toHaveBeenCalled();
  });
});

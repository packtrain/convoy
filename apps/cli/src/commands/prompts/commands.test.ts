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
import { listPromptsCommand } from "./list.js";
import { createPromptCommand } from "./create.js";
import { updatePromptCommand } from "./update.js";

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
  {
    _id: "proj_app_1",
    name: "App",
    alias: "APP",
    organizationId: "org_other",
    organizationName: "Other",
    organizationSlug: "other",
    role: { name: "org-owner", permissions: ["*"] },
  },
];

const prompts = [
  {
    _id: "prompt_review",
    scope: "project",
    key: "review",
    description: "Review a contract",
    content: "Review this contract.",
    autoExpand: false,
    autoSubmit: false,
  },
];

function invoke(
  command: Command,
  args: unknown[] = [],
  globals: Record<string, unknown> = { project: "WEB" }
) {
  Reflect.set(command, "optsWithGlobals", () => globals);
  return Reflect.get(command, "_actionHandler").call(command, args);
}

describe("prompts commands", () => {
  const query = vi.fn();
  const mutation = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    for (const command of [listPromptsCommand, createPromptCommand, updatePromptCommand]) {
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

  it("lists project prompts by default", async () => {
    query.mockResolvedValueOnce(accessibleProjects).mockResolvedValueOnce(prompts);

    await invoke(listPromptsCommand);

    expect(query).toHaveBeenCalledWith(api.slashCommands.core.listByProject, {
      projectId: "proj_web_1",
    });
    const output = vi.mocked(console.log).mock.calls.flat().join("\n");
    expect(output).toContain("/review");
  });

  it("lists organization prompts using the resolved project's organization", async () => {
    query.mockResolvedValueOnce(accessibleProjects).mockResolvedValueOnce([]);
    listPromptsCommand.setOptionValue("scope", "organization");

    await invoke(listPromptsCommand);

    expect(query).toHaveBeenCalledWith(api.slashCommands.core.listByOrganization, {
      organizationId: "org_acme",
    });
  });

  it("creates an organization prompt in the organization named by --org", async () => {
    query.mockResolvedValueOnce({ _id: "org_other", slug: "other" });
    mutation.mockResolvedValueOnce("prompt_new");
    createPromptCommand.setOptionValue("scope", "organization");
    createPromptCommand.setOptionValue("org", "other");
    createPromptCommand.setOptionValue("key", "handoff");
    createPromptCommand.setOptionValue("content", "Write a handoff doc.");
    createPromptCommand.setOptionValue("autoSubmit", true);

    await invoke(createPromptCommand);

    expect(mutation).toHaveBeenCalledWith(api.slashCommands.core.createInOrganization, {
      organizationId: "org_other",
      key: "handoff",
      content: "Write a handoff doc.",
      autoSubmit: true,
    });
  });

  it("creates a project prompt for the resolved project", async () => {
    query.mockResolvedValueOnce(accessibleProjects);
    mutation.mockResolvedValueOnce("prompt_new");
    createPromptCommand.setOptionValue("key", "review");
    createPromptCommand.setOptionValue("content", "Review this contract.");

    await invoke(createPromptCommand);

    expect(mutation).toHaveBeenCalledWith(api.slashCommands.core.createInProject, {
      projectId: "proj_web_1",
      key: "review",
      content: "Review this contract.",
    });
  });

  it("rejects an unknown organization", async () => {
    query.mockResolvedValueOnce(null);
    createPromptCommand.setOptionValue("scope", "organization");
    createPromptCommand.setOptionValue("org", "nope");
    createPromptCommand.setOptionValue("key", "handoff");
    createPromptCommand.setOptionValue("content", "Write a handoff doc.");

    await expect(invoke(createPromptCommand)).rejects.toThrow(
      'Organization "nope" was not found'
    );
    expect(mutation).not.toHaveBeenCalled();
  });

  it("rejects an invalid scope", async () => {
    listPromptsCommand.setOptionValue("scope", "personal");

    await expect(invoke(listPromptsCommand)).rejects.toThrow(
      "Scope must be one of: project, organization"
    );
  });

  it("rejects --org without --project in project scope", async () => {
    listPromptsCommand.setOptionValue("org", "acme");

    await expect(invoke(listPromptsCommand, [], {})).rejects.toThrow("--org needs --project");
    expect(query).not.toHaveBeenCalled();
  });

  it("updates a prompt and clears the category", async () => {
    mutation.mockResolvedValueOnce(null);
    updatePromptCommand.setOptionValue("key", "review-v2");
    updatePromptCommand.setOptionValue("clearCategory", true);
    updatePromptCommand.setOptionValue("autoExpand", false);

    await invoke(updatePromptCommand, ["prompt_review"]);

    expect(mutation).toHaveBeenCalledWith(api.slashCommands.core.update, {
      slashCommandId: "prompt_review",
      key: "review-v2",
      category: null,
      autoExpand: false,
    });
  });

  it("rejects an update with no fields", async () => {
    await expect(invoke(updatePromptCommand, ["prompt_review"])).rejects.toThrow(
      "No updates provided"
    );
    expect(mutation).not.toHaveBeenCalled();
  });
});

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
import { createTaskListCommand } from "./create.js";
import { updateTaskListCommand } from "./update.js";

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

const resolvedList = {
  type: "list",
  _id: "list_sprint",
  _creationTime: 1,
  projectId: "proj_web_1",
  name: "Sprint 1",
  ref: "SPRINT-1",
  isArchived: false,
  isDefault: false,
  isPinned: false,
  createdBy: "user_1",
  updatedBy: "user_1",
  createdAt: 1,
  updatedAt: 1,
};

function invoke(command: Command, args: unknown[] = []) {
  Reflect.set(command, "optsWithGlobals", () => ({ project: "WEB" }));
  return Reflect.get(command, "_actionHandler").call(command, args);
}

describe("lists create/update commands", () => {
  const query = vi.fn();
  const mutation = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    for (const command of [createTaskListCommand, updateTaskListCommand]) {
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

  it("creates a List with name, ref, and color", async () => {
    query.mockResolvedValueOnce(accessibleProjects);
    mutation.mockResolvedValueOnce("list_new");
    createTaskListCommand.setOptionValue("name", "Sprint 1");
    createTaskListCommand.setOptionValue("ref", "SPRINT-1");
    createTaskListCommand.setOptionValue("color", "#ef4444");

    await invoke(createTaskListCommand);

    expect(mutation).toHaveBeenCalledWith(api.tasks.lists.create, {
      projectId: "proj_web_1",
      name: "Sprint 1",
      ref: "SPRINT-1",
      color: "#ef4444",
    });
    const output = vi.mocked(console.log).mock.calls.flatMap((call) => call).join("\n");
    expect(output).toContain("List created");
    expect(output).toContain("list_new");
  });

  it("creates a List with only a name and prints json output", async () => {
    query.mockResolvedValueOnce(accessibleProjects);
    mutation.mockResolvedValueOnce("list_new");
    createTaskListCommand.setOptionValue("name", "Sprint 1");
    createTaskListCommand.setOptionValue("json", true);

    await invoke(createTaskListCommand);

    expect(mutation).toHaveBeenCalledWith(api.tasks.lists.create, {
      projectId: "proj_web_1",
      name: "Sprint 1",
    });
    const output = vi.mocked(console.log).mock.calls.at(-1)?.[0];
    expect(JSON.parse(String(output))).toEqual({ listId: "list_new" });
  });

  it("updates a List resolved by bare ref, sending only the changed field", async () => {
    query.mockResolvedValueOnce(accessibleProjects).mockResolvedValueOnce(resolvedList);
    mutation.mockResolvedValueOnce(null);
    updateTaskListCommand.setOptionValue("color", "#3b82f6");

    await invoke(updateTaskListCommand, ["sprint-1"]);

    expect(query).toHaveBeenCalledWith(api.tasks.lists.resolve, {
      projectId: "proj_web_1",
      identifier: "sprint-1",
    });
    // Name is omitted, so the mutation keeps the stored name.
    expect(mutation).toHaveBeenCalledWith(api.tasks.lists.update, {
      id: "list_sprint",
      color: "#3b82f6",
    });
  });

  it("clears the color with --clear-color", async () => {
    query.mockResolvedValueOnce(accessibleProjects).mockResolvedValueOnce(resolvedList);
    mutation.mockResolvedValueOnce(null);
    updateTaskListCommand.setOptionValue("name", "Sprint Ten");
    updateTaskListCommand.setOptionValue("clearColor", true);

    await invoke(updateTaskListCommand, ["list_sprint"]);

    expect(mutation).toHaveBeenCalledWith(api.tasks.lists.update, {
      id: "list_sprint",
      name: "Sprint Ten",
      color: null,
    });
  });

  it("rejects --color together with --clear-color", async () => {
    updateTaskListCommand.setOptionValue("color", "#3b82f6");
    updateTaskListCommand.setOptionValue("clearColor", true);

    await expect(invoke(updateTaskListCommand, ["SPRINT-1"])).rejects.toThrow(
      "not both"
    );
    expect(mutation).not.toHaveBeenCalled();
  });

  it("rejects updates with no flags", async () => {
    await expect(invoke(updateTaskListCommand, ["SPRINT-1"])).rejects.toThrow(
      "No updates provided"
    );
    expect(mutation).not.toHaveBeenCalled();
  });

  it("creates a List with a Board default view override", async () => {
    query.mockResolvedValueOnce(accessibleProjects);
    mutation.mockResolvedValueOnce("list_new");
    createTaskListCommand.setOptionValue("name", "Sprint 1");
    createTaskListCommand.setOptionValue("defaultView", "board");
    createTaskListCommand.setOptionValue("boardGroupBy", "priority");

    await invoke(createTaskListCommand);

    expect(mutation).toHaveBeenCalledWith(api.tasks.lists.create, {
      projectId: "proj_web_1",
      name: "Sprint 1",
      defaultViewMode: "board",
      defaultBoardGroupBy: "priority",
    });
  });

  it("rejects an unknown --default-view value", async () => {
    query.mockResolvedValueOnce(accessibleProjects);
    createTaskListCommand.setOptionValue("name", "Sprint 1");
    createTaskListCommand.setOptionValue("defaultView", "gantt");

    await expect(invoke(createTaskListCommand)).rejects.toThrow(
      "Default view must be one of"
    );
    expect(mutation).not.toHaveBeenCalled();
  });

  it("sends --default-view in the same mutation", async () => {
    query.mockResolvedValueOnce(accessibleProjects).mockResolvedValueOnce(resolvedList);
    mutation.mockResolvedValue(null);
    updateTaskListCommand.setOptionValue("defaultView", "board");
    updateTaskListCommand.setOptionValue("boardGroupBy", "label");

    await invoke(updateTaskListCommand, ["SPRINT-1"]);

    // One transaction, so a rename can't land without its view change.
    expect(mutation).toHaveBeenCalledTimes(1);
    expect(mutation).toHaveBeenCalledWith(api.tasks.lists.update, {
      id: "list_sprint",
      defaultViewMode: "board",
      defaultBoardGroupBy: "label",
    });
  });

  it("clears the default view with --clear-default-view", async () => {
    query.mockResolvedValueOnce(accessibleProjects).mockResolvedValueOnce(resolvedList);
    mutation.mockResolvedValue(null);
    updateTaskListCommand.setOptionValue("clearDefaultView", true);

    await invoke(updateTaskListCommand, ["SPRINT-1"]);

    expect(mutation).toHaveBeenCalledWith(api.tasks.lists.update, {
      id: "list_sprint",
      defaultViewMode: null,
    });
  });

  it("rejects --board-group-by without --default-view board", async () => {
    updateTaskListCommand.setOptionValue("name", "Renamed");
    updateTaskListCommand.setOptionValue("boardGroupBy", "priority");

    await expect(invoke(updateTaskListCommand, ["SPRINT-1"])).rejects.toThrow(
      "--board-group-by only applies with --default-view board."
    );
    expect(mutation).not.toHaveBeenCalled();
  });

  it("rejects --default-view together with --clear-default-view", async () => {
    updateTaskListCommand.setOptionValue("defaultView", "list");
    updateTaskListCommand.setOptionValue("clearDefaultView", true);

    await expect(invoke(updateTaskListCommand, ["SPRINT-1"])).rejects.toThrow(
      "not both"
    );
    expect(mutation).not.toHaveBeenCalled();
  });

  it("rejects scoped List refs without a server round-trip", async () => {
    query.mockResolvedValueOnce(accessibleProjects);
    updateTaskListCommand.setOptionValue("name", "New");

    await expect(invoke(updateTaskListCommand, ["OTHER/SPRINT-1"])).rejects.toThrow(
      "bare List ref"
    );
    expect(query).toHaveBeenCalledTimes(1);
    expect(mutation).not.toHaveBeenCalled();
  });

  it("rejects unknown List identifiers", async () => {
    query.mockResolvedValueOnce(accessibleProjects).mockResolvedValueOnce(null);
    updateTaskListCommand.setOptionValue("name", "New");

    await expect(invoke(updateTaskListCommand, ["NOPE-1"])).rejects.toThrow(
      "did not match any List"
    );
    expect(mutation).not.toHaveBeenCalled();
  });
});

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
import { listLabelsCommand } from "./list.js";
import { createLabelCommand } from "./create.js";
import { updateLabelCommand } from "./update.js";
import { deleteLabelCommand } from "./delete.js";

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

const labels = [
  {
    _id: "label_bug",
    _creationTime: 1,
    projectId: "proj_web_1",
    name: "Bug",
    color: "#ef4444",
    rank: "0|hzzzzz:",
  },
  {
    _id: "label_chore",
    _creationTime: 2,
    projectId: "proj_web_1",
    name: "Chore fix",
    color: "#3b82f6",
    rank: "0|i00007:",
  },
];

function invoke(command: Command, args: unknown[] = []) {
  Reflect.set(command, "optsWithGlobals", () => ({ project: "WEB" }));
  return Reflect.get(command, "_actionHandler").call(command, args);
}

describe("labels commands", () => {
  const query = vi.fn();
  const mutation = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    for (const command of [
      listLabelsCommand,
      createLabelCommand,
      updateLabelCommand,
      deleteLabelCommand,
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

  it("lists labels for the resolved project", async () => {
    query.mockResolvedValueOnce(accessibleProjects).mockResolvedValueOnce(labels);

    await invoke(listLabelsCommand);

    expect(query).toHaveBeenNthCalledWith(1, api.projects.core.listAccessible, {});
    expect(query).toHaveBeenCalledWith(api.tasks.labels.list, { projectId: "proj_web_1" });
    const output = vi.mocked(console.log).mock.calls.flatMap((call) => call).join("\n");
    expect(output).toContain("Bug");
    expect(output).toContain("label_chore");
  });

  it("creates a label with name and color", async () => {
    query.mockResolvedValueOnce(accessibleProjects);
    mutation.mockResolvedValueOnce("label_new");
    createLabelCommand.setOptionValue("name", "Design");
    createLabelCommand.setOptionValue("color", "#ef4444");

    await invoke(createLabelCommand);

    expect(mutation).toHaveBeenCalledWith(api.tasks.labels.create, {
      projectId: "proj_web_1",
      name: "Design",
      color: "#ef4444",
    });
  });

  it("resolves a label by case-insensitive name when updating", async () => {
    query.mockResolvedValueOnce(accessibleProjects).mockResolvedValueOnce(labels);
    mutation.mockResolvedValueOnce(null);
    updateLabelCommand.setOptionValue("name", "Chores");

    await invoke(updateLabelCommand, ["chore  FIX"]);

    expect(mutation).toHaveBeenCalledWith(api.tasks.labels.update, {
      labelId: "label_chore",
      name: "Chores",
    });
  });

  it("rejects an update with no fields", async () => {
    query.mockResolvedValue(accessibleProjects);

    await expect(invoke(updateLabelCommand, ["Bug"])).rejects.toThrow(/No updates/);
    expect(mutation).not.toHaveBeenCalled();
  });

  it("deletes with the default clear resolution", async () => {
    query.mockResolvedValueOnce(accessibleProjects).mockResolvedValueOnce(labels);
    mutation.mockResolvedValueOnce({ affectedTaskIds: [] });

    await invoke(deleteLabelCommand, ["label_bug"]);

    expect(mutation).toHaveBeenCalledWith(api.tasks.labels.remove, {
      labelId: "label_bug",
      resolution: "clear",
    });
  });

  it("maps 'archive' to the backend archiveTasks resolution", async () => {
    query.mockResolvedValueOnce(accessibleProjects).mockResolvedValueOnce(labels);
    mutation.mockResolvedValueOnce({ affectedTaskIds: ["task_1"] });
    deleteLabelCommand.setOptionValue("resolution", "archive");

    await invoke(deleteLabelCommand, ["Bug"]);

    expect(mutation).toHaveBeenCalledWith(api.tasks.labels.remove, {
      labelId: "label_bug",
      resolution: "archiveTasks",
    });
  });

  it("requires --reassign-to for the reassign resolution", async () => {
    deleteLabelCommand.setOptionValue("resolution", "reassign");

    await expect(invoke(deleteLabelCommand, ["Bug"])).rejects.toThrow(/reassign-to/);
    expect(mutation).not.toHaveBeenCalled();
  });

  it("resolves the reassign target by name", async () => {
    query.mockResolvedValueOnce(accessibleProjects).mockResolvedValue(labels);
    mutation.mockResolvedValueOnce({ affectedTaskIds: ["task_1"] });
    deleteLabelCommand.setOptionValue("resolution", "reassign");
    deleteLabelCommand.setOptionValue("reassignTo", "chore fix");

    await invoke(deleteLabelCommand, ["Bug"]);

    expect(mutation).toHaveBeenCalledWith(api.tasks.labels.remove, {
      labelId: "label_bug",
      resolution: "reassign",
      reassignToLabelId: "label_chore",
    });
  });

  it("rejects an unknown label identifier", async () => {
    query.mockResolvedValueOnce(accessibleProjects).mockResolvedValueOnce(labels);

    await expect(invoke(deleteLabelCommand, ["Nope"])).rejects.toThrow(/did not match/);
    expect(mutation).not.toHaveBeenCalled();
  });
});

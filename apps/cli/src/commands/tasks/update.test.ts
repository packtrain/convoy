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
import { updateTaskCommand } from "./update.js";

describe("tasks update command", () => {
  const query = vi.fn();
  const mutation = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    resetCommandOptions(updateTaskCommand);

    query.mockResolvedValueOnce({
      _id: "task_123",
      refId: "WEB-1",
      name: "Updated task name",
    });

    mutation.mockResolvedValueOnce(null);

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
          projectId: "proj_default",
        },
      });
    });
  });

  it("passes only changed fields to tasks.update", async () => {
    updateTaskCommand.setOptionValue("name", "Updated task name");
    updateTaskCommand.setOptionValue("taskTypeKey", "feature");
    updateTaskCommand.setOptionValue("status", "Plan Review");
    updateTaskCommand.setOptionValue("clearDueDate", true);
    updateTaskCommand.setOptionValue("json", true);

    await Reflect.get(updateTaskCommand, "_actionHandler").call(updateTaskCommand, [
      "task_123",
    ]);

    expect(mutation).toHaveBeenCalledTimes(1);
    expect(mutation).toHaveBeenCalledWith(api.tasks.core.update, {
      id: "task_123",
      name: "Updated task name",
      taskTypeKey: "feature",
      status: "Plan Review",
      dueDate: null,
    });
    expect(query).toHaveBeenCalledWith(api.tasks.core.getById, { id: "task_123" });
  });

  it("clears the label with --clear-label", async () => {
    updateTaskCommand.setOptionValue("clearLabel", true);

    await Reflect.get(updateTaskCommand, "_actionHandler").call(updateTaskCommand, [
      "task_123",
    ]);

    expect(mutation).toHaveBeenCalledWith(
      api.tasks.core.update,
      expect.objectContaining({ id: "task_123", labelId: null })
    );
  });

  it("resolves --label by name via the task's project", async () => {
    query.mockReset();
    query
      .mockResolvedValueOnce({ _id: "task_123", projectId: "proj_web_1", refId: "WEB-1", name: "T" })
      .mockResolvedValueOnce([
        { _id: "label_bug", _creationTime: 1, projectId: "proj_web_1", name: "Bug", color: "#ef4444", rank: "0|h:" },
      ])
      .mockResolvedValueOnce({ _id: "task_123", refId: "WEB-1", name: "T" });
    updateTaskCommand.setOptionValue("label", "bug");

    await Reflect.get(updateTaskCommand, "_actionHandler").call(updateTaskCommand, [
      "task_123",
    ]);

    expect(query).toHaveBeenCalledWith(api.tasks.labels.list, { projectId: "proj_web_1" });
    expect(mutation).toHaveBeenCalledWith(
      api.tasks.core.update,
      expect.objectContaining({ id: "task_123", labelId: "label_bug" })
    );
  });

  it("resolves --checklist by name and sets only the checklist", async () => {
    query.mockReset();
    query
      .mockResolvedValueOnce({ _id: "task_123", projectId: "proj_web_1", refId: "WEB-1", name: "T" })
      .mockResolvedValueOnce([{ _id: "checklist_bug", name: "Bug  fix", checkKeys: [], taskTypeKeys: [] }])
      .mockResolvedValueOnce({ _id: "task_123", refId: "WEB-1", name: "T" });
    updateTaskCommand.setOptionValue("checklist", "bug fix");

    await Reflect.get(updateTaskCommand, "_actionHandler").call(updateTaskCommand, ["task_123"]);

    expect(query).toHaveBeenCalledWith(api.checks.checklists.list, { projectId: "proj_web_1" });
    expect(mutation).toHaveBeenCalledTimes(1);
    expect(mutation).toHaveBeenCalledWith(api.tasks.core.setChecklist, {
      taskId: "task_123",
      checklistId: "checklist_bug",
    });
  });

  it("--no-checks stores no checks alongside other updates", async () => {
    updateTaskCommand.setOptionValue("checks", false);
    updateTaskCommand.setOptionValue("name", "Renamed");

    await Reflect.get(updateTaskCommand, "_actionHandler").call(updateTaskCommand, ["task_123"]);

    expect(mutation).toHaveBeenCalledWith(api.tasks.core.setChecklist, { taskId: "task_123", checklistId: null });
    expect(mutation).toHaveBeenCalledWith(api.tasks.core.update, { id: "task_123", name: "Renamed" });
  });

  it("rejects an unknown --checklist name", async () => {
    query.mockReset();
    query
      .mockResolvedValueOnce({ _id: "task_123", projectId: "proj_web_1", refId: "WEB-1", name: "T" })
      .mockResolvedValueOnce([]);
    updateTaskCommand.setOptionValue("checklist", "Nope");

    await expect(
      Reflect.get(updateTaskCommand, "_actionHandler").call(updateTaskCommand, ["task_123"])
    ).rejects.toThrow(/did not match any checklist/);
    expect(mutation).not.toHaveBeenCalled();
  });

  it("rejects using --checklist and --no-checks together", async () => {
    updateTaskCommand.setOptionValue("checklist", "Feature");
    updateTaskCommand.setOptionValue("checks", false);

    await expect(
      Reflect.get(updateTaskCommand, "_actionHandler").call(updateTaskCommand, ["task_123"])
    ).rejects.toThrow(/--checklist and --no-checks/);
    expect(mutation).not.toHaveBeenCalled();
  });

  it("rejects using --label and --clear-label together", async () => {
    updateTaskCommand.setOptionValue("label", "bug");
    updateTaskCommand.setOptionValue("clearLabel", true);

    await expect(
      Reflect.get(updateTaskCommand, "_actionHandler").call(updateTaskCommand, ["task_123"])
    ).rejects.toThrow(/--label and --clear-label/);
    expect(mutation).not.toHaveBeenCalled();
  });
});

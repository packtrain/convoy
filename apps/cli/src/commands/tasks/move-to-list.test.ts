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
import { moveTasksToListCommand } from "./move-to-list.js";

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

describe("tasks move-to-list command", () => {
  const query = vi.fn();
  const mutation = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    resetCommandOptions(moveTasksToListCommand);
    Reflect.set(moveTasksToListCommand, "optsWithGlobals", () => ({
      project: "WEB",
    }));

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

  it("resolves refs and moves all roots in one mutation", async () => {
    query
      .mockResolvedValueOnce(accessibleProjects)
      .mockResolvedValueOnce({
        results: [{ ref: "WEB-1", task: { _id: "task_1" } }],
      })
      .mockResolvedValueOnce({
        results: [{ ref: "WEB-2", task: { _id: "task_2" } }],
      });
    mutation.mockResolvedValueOnce({
      taskIds: ["task_1", "task_2"],
      list: {
        type: "list",
        id: "list_sprint",
        ref: "SPRINT-1",
        name: "Sprint 1",
        isDefault: false,
        isArchived: false,
      },
    });
    moveTasksToListCommand.setOptionValue("list", "SPRINT-1");

    await Reflect.get(moveTasksToListCommand, "_actionHandler").call(
      moveTasksToListCommand,
      [["WEB-1", "WEB-2"]]
    );

    expect(mutation).toHaveBeenCalledTimes(1);
    expect(mutation).toHaveBeenCalledWith(api.tasks.core.move.toList, {
      rootIds: ["task_1", "task_2"],
      listId: "SPRINT-1",
    });
  });

  it("supports raw IDs, Backlog, and strict JSON output", async () => {
    query.mockResolvedValueOnce(accessibleProjects);
    const result = {
      taskIds: ["task_1"],
      list: {
        type: "system",
        key: "backlog",
        ref: "BACKLOG",
        name: "Backlog",
      },
    };
    mutation.mockResolvedValueOnce(result);
    moveTasksToListCommand.setOptionValue("list", "BACKLOG");
    moveTasksToListCommand.setOptionValue("json", true);

    await Reflect.get(moveTasksToListCommand, "_actionHandler").call(
      moveTasksToListCommand,
      [["task_1"]]
    );

    expect(mutation).toHaveBeenCalledWith(api.tasks.core.move.toList, {
      rootIds: ["task_1"],
      listId: "BACKLOG",
    });
    const output = vi.mocked(console.log).mock.calls.at(-1)?.[0];
    expect(JSON.parse(String(output))).toEqual(result);
  });

  it("rejects more than 25 roots before querying", async () => {
    moveTasksToListCommand.setOptionValue("list", "SPRINT-1");
    const tasks = Array.from({ length: 26 }, (_, index) => `task_${index}`);

    await expect(
      Reflect.get(moveTasksToListCommand, "_actionHandler").call(
        moveTasksToListCommand,
        [tasks]
      )
    ).rejects.toThrow("between 1 and 25");
    expect(query).not.toHaveBeenCalled();
    expect(mutation).not.toHaveBeenCalled();
  });

  it("rejects scoped List refs before querying", async () => {
    moveTasksToListCommand.setOptionValue("list", "other/SPRINT-1");

    await expect(
      Reflect.get(moveTasksToListCommand, "_actionHandler").call(
        moveTasksToListCommand,
        [["task_1"]]
      )
    ).rejects.toThrow("bare List ref");
    expect(query).not.toHaveBeenCalled();
  });
});

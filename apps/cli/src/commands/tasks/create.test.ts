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
import { createTaskCommand } from "./create.js";

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

describe("tasks create command", () => {
  const query = vi.fn();
  const mutation = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    resetCommandOptions(createTaskCommand);

    query.mockResolvedValueOnce(accessibleProjects);

    mutation.mockResolvedValueOnce({
      taskId: "task_created_1",
      projectId: "proj_web_1",
      organizationId: "org_acme",
      projectAlias: "WEB",
      refNumber: 1,
      refId: "WEB-1",
    });

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

  it("passes parsed create args to tasks.create", async () => {
    createTaskCommand.setOptionValue("name", "CLI manual test");
    createTaskCommand.setOptionValue("org", "acme");
    createTaskCommand.setOptionValue("taskTypeKey", "bug");
    createTaskCommand.setOptionValue("status", "Triage");
    createTaskCommand.setOptionValue("dueDate", "2026-03-31");
    createTaskCommand.setOptionValue("tags", ["cli,test"]);
    createTaskCommand.setOptionValue("json", true);
    Reflect.set(createTaskCommand, "optsWithGlobals", () => ({ project: "WEB" }));

    await Reflect.get(createTaskCommand, "_actionHandler").call(createTaskCommand, []);

    expect(mutation).toHaveBeenCalledTimes(1);
    expect(mutation).toHaveBeenCalledWith(
      api.tasks.core.create,
      expect.objectContaining({
        projectId: "proj_web_1",
        name: "CLI manual test",
        taskTypeKey: "bug",
        priority: "None",
        status: "Triage",
        dueDate: Date.parse("2026-03-31"),
        tags: ["cli", "test"],
      })
    );
    expect(typeof mutation.mock.calls[0]?.[1]?.clientId).toBe("string");
    expect(query).toHaveBeenNthCalledWith(1, api.projects.core.listAccessible, {});
    expect(query).toHaveBeenCalledTimes(1);
    const jsonOutput = vi.mocked(console.log).mock.calls.find(
      ([value]) => typeof value === "string" && value.includes('"taskId"')
    )?.[0];
    expect(JSON.parse(String(jsonOutput))).toEqual({
      taskId: "task_created_1",
      task: {
        _id: "task_created_1",
        projectId: "proj_web_1",
        organizationId: "org_acme",
        projectAlias: "WEB",
        refNumber: 1,
        refId: "WEB-1",
        name: "CLI manual test",
      },
    });
  });

  it("prints created task ref in text output", async () => {
    createTaskCommand.setOptionValue("name", "CLI manual test");
    Reflect.set(createTaskCommand, "optsWithGlobals", () => ({ project: "WEB" }));

    await Reflect.get(createTaskCommand, "_actionHandler").call(createTaskCommand, []);

    expect(console.log).toHaveBeenCalledWith("  WEB-1 CLI manual test");
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("passes --list as listId without normalizing refs", async () => {
    createTaskCommand.setOptionValue("name", "Listed task");
    createTaskCommand.setOptionValue("list", "SPRINT-1");
    Reflect.set(createTaskCommand, "optsWithGlobals", () => ({ project: "WEB" }));

    await Reflect.get(createTaskCommand, "_actionHandler").call(createTaskCommand, []);

    expect(mutation).toHaveBeenCalledWith(
      api.tasks.core.create,
      expect.objectContaining({
        projectId: "proj_web_1",
        listId: "SPRINT-1",
      })
    );
  });

  it("passes raw List IDs unchanged", async () => {
    createTaskCommand.setOptionValue("name", "Listed task");
    createTaskCommand.setOptionValue("list", "nx7b79ahee74yeq64gtx2wxbr1879rnv");
    Reflect.set(createTaskCommand, "optsWithGlobals", () => ({ project: "WEB" }));

    await Reflect.get(createTaskCommand, "_actionHandler").call(createTaskCommand, []);

    expect(mutation).toHaveBeenCalledWith(
      api.tasks.core.create,
      expect.objectContaining({
        listId: "nx7b79ahee74yeq64gtx2wxbr1879rnv",
      })
    );
  });

  it("does not pass listId for subtasks when --list is omitted", async () => {
    createTaskCommand.setOptionValue("name", "Child task");
    createTaskCommand.setOptionValue("parentId", "parent_task_1");
    Reflect.set(createTaskCommand, "optsWithGlobals", () => ({ project: "WEB" }));

    await Reflect.get(createTaskCommand, "_actionHandler").call(createTaskCommand, []);

    expect(mutation).toHaveBeenCalledWith(
      api.tasks.core.create,
      expect.not.objectContaining({ listId: expect.anything() })
    );
    expect(mutation).toHaveBeenCalledWith(
      api.tasks.core.create,
      expect.objectContaining({ parentId: "parent_task_1" })
    );
  });

  it("resolves --label by name to a labelId", async () => {
    query.mockResolvedValueOnce([
      { _id: "label_bug", _creationTime: 1, projectId: "proj_web_1", name: "Bug", color: "#ef4444", rank: "0|h:" },
    ]);
    createTaskCommand.setOptionValue("name", "Labeled task");
    createTaskCommand.setOptionValue("label", "bug");
    Reflect.set(createTaskCommand, "optsWithGlobals", () => ({ project: "WEB" }));

    await Reflect.get(createTaskCommand, "_actionHandler").call(createTaskCommand, []);

    expect(query).toHaveBeenCalledWith(api.tasks.labels.list, { projectId: "proj_web_1" });
    expect(mutation).toHaveBeenCalledWith(
      api.tasks.core.create,
      expect.objectContaining({ labelId: "label_bug" })
    );
  });

  it("rejects scoped List refs before creating a task", async () => {
    createTaskCommand.setOptionValue("name", "Bad list task");
    createTaskCommand.setOptionValue("list", "OTHER/SPRINT-1");
    Reflect.set(createTaskCommand, "optsWithGlobals", () => ({ project: "WEB" }));

    await expect(
      Reflect.get(createTaskCommand, "_actionHandler").call(createTaskCommand, [])
    ).rejects.toThrow(/Cross-project List refs/);

    expect(mutation).not.toHaveBeenCalled();
  });
});

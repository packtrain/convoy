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
import { moveTaskCommand } from "./move.js";

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
    _id: "proj_ops_1",
    name: "Ops",
    alias: "OPS",
    organizationId: "org_acme",
    organizationName: "Acme",
    organizationSlug: "acme",
    role: { name: "org-owner", permissions: ["*"] },
  },
];

describe("tasks move command", () => {
  const query = vi.fn();
  const mutation = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    moveTaskCommand.setOptionValue("json", false);
    moveTaskCommand.setOptionValue("output", "text");
    moveTaskCommand.setOptionValue("parent", undefined);
    moveTaskCommand.setOptionValue("topLevel", false);

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

    Reflect.set(moveTaskCommand, "optsWithGlobals", () => ({ project: "WEB" }));
  });

  it("resolves bare refs and moves under a new parent", async () => {
    query
      .mockResolvedValueOnce(accessibleProjects)
      .mockResolvedValueOnce({
        results: [{ ref: "WEB-1", task: { _id: "task_1" } }],
      })
      .mockResolvedValueOnce({
        results: [{ ref: "WEB-2", task: { _id: "task_2" } }],
      });
    mutation.mockResolvedValueOnce(null);

    moveTaskCommand.setOptionValue("parent", "WEB-2");
    moveTaskCommand.setOptionValue("json", true);

    await Reflect.get(moveTaskCommand, "_actionHandler").call(moveTaskCommand, [
      "WEB-1",
    ]);

    expect(query).toHaveBeenNthCalledWith(1, api.projects.core.listAccessible, {});
    expect(query).toHaveBeenNthCalledWith(2, api.tasks.core.getByRefs, {
      refs: ["WEB-1"],
      projectId: "proj_web_1",
    });
    expect(query).toHaveBeenNthCalledWith(3, api.tasks.core.getByRefs, {
      refs: ["WEB-2"],
      projectId: "proj_web_1",
    });
    expect(mutation).toHaveBeenCalledWith(api.tasks.core.move.toParent, {
      id: "task_1",
      parentId: "task_2",
    });

    const output = vi
      .mocked(console.log)
      .mock.calls.flatMap((call) => call)
      .join("\n");
    expect(output).toContain('"taskId": "task_1"');
    expect(output).toContain('"parentId": "task_2"');
  });

  it("supports top-level moves", async () => {
    query.mockResolvedValueOnce(accessibleProjects).mockResolvedValueOnce({
      results: [{ ref: "WEB-1", task: { _id: "task_1" } }],
    });
    mutation.mockResolvedValueOnce(null);

    moveTaskCommand.setOptionValue("topLevel", true);

    await Reflect.get(moveTaskCommand, "_actionHandler").call(moveTaskCommand, [
      "WEB-1",
    ]);

    expect(mutation).toHaveBeenCalledWith(api.tasks.core.move.toParent, {
      id: "task_1",
      parentId: null,
    });
  });

  it("resolves scoped refs without requiring project context", async () => {
    query
      .mockResolvedValueOnce(accessibleProjects)
      .mockResolvedValueOnce({
        results: [{ ref: "WEB-1", task: { _id: "task_1" } }],
      })
      .mockResolvedValueOnce({
        results: [{ ref: "OPS-2", task: { _id: "task_2" } }],
      });
    mutation.mockResolvedValueOnce(null);

    moveTaskCommand.setOptionValue("parent", "acme/OPS-2");

    await Reflect.get(moveTaskCommand, "_actionHandler").call(moveTaskCommand, [
      "acme/WEB-1",
    ]);

    expect(query).toHaveBeenNthCalledWith(1, api.projects.core.listAccessible, {});
    expect(query).toHaveBeenNthCalledWith(2, api.tasks.core.getByRefs, {
      refs: ["WEB-1"],
      projectId: "proj_web_1",
    });
    expect(query).toHaveBeenNthCalledWith(3, api.tasks.core.getByRefs, {
      refs: ["OPS-2"],
      projectId: "proj_ops_1",
    });
    expect(mutation).toHaveBeenCalledWith(api.tasks.core.move.toParent, {
      id: "task_1",
      parentId: "task_2",
    });
  });

  it("requires exactly one of --parent or --top-level", async () => {
    moveTaskCommand.setOptionValue("parent", "WEB-2");
    moveTaskCommand.setOptionValue("topLevel", true);

    await expect(
      Reflect.get(moveTaskCommand, "_actionHandler").call(moveTaskCommand, [
        "WEB-1",
      ]),
    ).rejects.toThrow(/exactly one of --parent or --top-level/i);
  });

  it("requires either --parent or --top-level", async () => {
    await expect(
      Reflect.get(moveTaskCommand, "_actionHandler").call(moveTaskCommand, [
        "WEB-1",
      ]),
    ).rejects.toThrow(/exactly one of --parent or --top-level/i);
  });
});

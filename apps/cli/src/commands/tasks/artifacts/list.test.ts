import { beforeEach, describe, expect, it, vi } from "vitest";

const { runOneShotCommandMock } = vi.hoisted(() => ({
  runOneShotCommandMock: vi.fn(),
}));

vi.mock("../../../lib/one-shot-command.js", () => ({
  runOneShotCommand: runOneShotCommandMock,
}));

vi.mock("../../../cli.js", () => ({
  addGlobalOptions: <T extends { option: (...args: string[]) => T }>(cmd: T) =>
    cmd
      .option("--profile <name>", "Profile key (for profile lookup)")
      .option("--url <url>", "Convex backend URL (overrides config)")
      .option("--api-key <key>", "API key (overrides config)")
      .option("--project <id>", "Project ID (overrides config)"),
}));

import { api } from "../../../convex/_generated/api.js";
import { listTaskArtifactsCommand } from "./list.js";

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

describe("tasks artifacts list command", () => {
  const query = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    query.mockResolvedValueOnce([
      {
        _id: "artifact_1",
        _creationTime: 1,
        taskId: "task_1",
        name: "Plan",
        fileName: "plan.md",
        source: "user",
        createdBy: "user_1",
        updatedBy: "user_1",
        createdAt: 1,
        updatedAt: 2,
      },
    ]);

    runOneShotCommandMock.mockImplementation(async (_cmd, run) => {
      await run({
        client: {
          query,
          mutation: vi.fn(),
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

  it("lists task artifacts by task id", async () => {
    listTaskArtifactsCommand.setOptionValue("json", true);

    await Reflect.get(listTaskArtifactsCommand, "_actionHandler").call(
      listTaskArtifactsCommand,
      ["task_1"]
    );

    expect(query).toHaveBeenCalledWith(api.tasks.artifacts.listTaskArtifactsByTask, {
      taskId: "task_1",
    });
  });

  it("resolves a bare task ref before listing", async () => {
    Reflect.set(listTaskArtifactsCommand, "optsWithGlobals", () => ({ project: "WEB" }));
    query.mockReset();
    query
      .mockResolvedValueOnce(accessibleProjects)
      .mockResolvedValueOnce({ results: [{ ref: "WEB-12", task: { _id: "task_12" } }] })
      .mockResolvedValueOnce([]);
    listTaskArtifactsCommand.setOptionValue("json", true);

    await Reflect.get(listTaskArtifactsCommand, "_actionHandler").call(
      listTaskArtifactsCommand,
      ["WEB-12"]
    );

    expect(query.mock.calls[2]?.[1]).toEqual({ taskId: "task_12" });
    Reflect.deleteProperty(listTaskArtifactsCommand, "optsWithGlobals");
  });
});

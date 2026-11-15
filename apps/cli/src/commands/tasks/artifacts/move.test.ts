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
import { moveTaskArtifactCommand } from "./move.js";

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

describe("tasks artifacts move command", () => {
  const query = vi.fn();
  const mutation = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);

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

  it("moves an artifact to the target task", async () => {
    moveTaskArtifactCommand.setOptionValue("json", true);
    moveTaskArtifactCommand.setOptionValue("toTask", "task_2");

    await Reflect.get(moveTaskArtifactCommand, "_actionHandler").call(
      moveTaskArtifactCommand,
      ["artifact_1"]
    );

    expect(mutation).toHaveBeenCalledWith(api.tasks.artifacts.moveTaskArtifact, {
      artifactId: "artifact_1",
      taskId: "task_2",
    });
  });

  it("resolves a --to-task ref before moving", async () => {
    Reflect.set(moveTaskArtifactCommand, "optsWithGlobals", () => ({ project: "WEB" }));
    query
      .mockResolvedValueOnce(accessibleProjects)
      .mockResolvedValueOnce({ results: [{ ref: "WEB-12", task: { _id: "task_12" } }] });
    moveTaskArtifactCommand.setOptionValue("json", true);
    moveTaskArtifactCommand.setOptionValue("toTask", "WEB-12");

    await Reflect.get(moveTaskArtifactCommand, "_actionHandler").call(
      moveTaskArtifactCommand,
      ["artifact_1"]
    );

    expect(mutation).toHaveBeenCalledWith(api.tasks.artifacts.moveTaskArtifact, {
      artifactId: "artifact_1",
      taskId: "task_12",
    });
    Reflect.deleteProperty(moveTaskArtifactCommand, "optsWithGlobals");
  });
});

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
import { getTaskArtifactCommand } from "./get.js";

describe("tasks artifacts get command", () => {
  const query = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    query.mockResolvedValueOnce({
      _id: "artifact_1",
      _creationTime: 1,
      taskId: "task_1",
      name: "Plan",
      fileName: "plan.md",
      content: "# Plan",
      source: "user",
      createdBy: "user_1",
      updatedBy: "user_1",
      createdAt: 1,
      updatedAt: 2,
    });

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

  it("loads a single artifact by id", async () => {
    getTaskArtifactCommand.setOptionValue("json", true);

    await Reflect.get(getTaskArtifactCommand, "_actionHandler").call(
      getTaskArtifactCommand,
      ["artifact_1"]
    );

    expect(query).toHaveBeenCalledWith(api.tasks.artifacts.getTaskArtifact, {
      artifactId: "artifact_1",
    });
  });
});

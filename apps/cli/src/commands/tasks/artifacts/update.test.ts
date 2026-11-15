import { beforeEach, describe, expect, it, vi } from "vitest";

const { runOneShotCommandMock, readFileSyncMock } = vi.hoisted(() => ({
  runOneShotCommandMock: vi.fn(),
  readFileSyncMock: vi.fn(),
}));

vi.mock("node:fs", () => ({
  readFileSync: readFileSyncMock,
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
import { updateTaskArtifactCommand } from "./update.js";

describe("tasks artifacts update command", () => {
  const query = vi.fn();
  const mutation = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    mutation.mockResolvedValueOnce(null);
    query.mockResolvedValueOnce({
      _id: "artifact_1",
      _creationTime: 1,
      taskId: "task_1",
      name: "Updated Plan",
      fileName: "updated-plan.md",
      content: "",
      source: "user",
      createdBy: "user_1",
      updatedBy: "user_1",
      createdAt: 1,
      updatedAt: 2,
    });
    readFileSyncMock.mockReturnValue("# File plan");

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

    updateTaskArtifactCommand.setOptionValue("name", undefined);
    updateTaskArtifactCommand.setOptionValue("content", undefined);
    updateTaskArtifactCommand.setOptionValue("contentFile", undefined);
    updateTaskArtifactCommand.setOptionValue("clearContent", false);
    updateTaskArtifactCommand.setOptionValue("runId", undefined);
    updateTaskArtifactCommand.setOptionValue("clearRunId", false);
    updateTaskArtifactCommand.setOptionValue("json", false);
    updateTaskArtifactCommand.setOptionValue("output", "text");
  });

  it("updates an artifact and refetches it", async () => {
    updateTaskArtifactCommand.setOptionValue("name", "Updated Plan");
    updateTaskArtifactCommand.setOptionValue("contentFile", "/tmp/plan.md");
    updateTaskArtifactCommand.setOptionValue("clearContent", false);
    updateTaskArtifactCommand.setOptionValue("runId", undefined);
    updateTaskArtifactCommand.setOptionValue("clearRunId", true);
    updateTaskArtifactCommand.setOptionValue("json", true);

    await Reflect.get(updateTaskArtifactCommand, "_actionHandler").call(
      updateTaskArtifactCommand,
      ["artifact_1"]
    );

    expect(readFileSyncMock).toHaveBeenCalledWith("/tmp/plan.md", "utf-8");
    expect(mutation).toHaveBeenCalledWith(api.tasks.artifacts.updateTaskArtifact, {
      artifactId: "artifact_1",
      name: "Updated Plan",
      content: "# File plan",
      runId: null,
    });
    expect(query).toHaveBeenCalledWith(api.tasks.artifacts.getTaskArtifact, {
      artifactId: "artifact_1",
    });
  });

  it("rejects conflicting content options", async () => {
    updateTaskArtifactCommand.setOptionValue("content", "# inline");
    updateTaskArtifactCommand.setOptionValue("contentFile", "/tmp/plan.md");

    await expect(
      Reflect.get(updateTaskArtifactCommand, "_actionHandler").call(
        updateTaskArtifactCommand,
        ["artifact_1"]
      )
    ).rejects.toThrow(/Cannot use --content and --content-file together/);
  });

  it("rejects conflicting run id options", async () => {
    updateTaskArtifactCommand.setOptionValue("content", undefined);
    updateTaskArtifactCommand.setOptionValue("contentFile", undefined);
    updateTaskArtifactCommand.setOptionValue("runId", "run_1");
    updateTaskArtifactCommand.setOptionValue("clearRunId", true);

    await expect(
      Reflect.get(updateTaskArtifactCommand, "_actionHandler").call(
        updateTaskArtifactCommand,
        ["artifact_1"]
      )
    ).rejects.toThrow(/Cannot use --run-id and --clear-run-id together/);
  });

  it("rejects empty updates", async () => {
    updateTaskArtifactCommand.setOptionValue("runId", undefined);
    updateTaskArtifactCommand.setOptionValue("clearRunId", false);
    updateTaskArtifactCommand.setOptionValue("name", undefined);
    updateTaskArtifactCommand.setOptionValue("content", undefined);
    updateTaskArtifactCommand.setOptionValue("contentFile", undefined);
    updateTaskArtifactCommand.setOptionValue("clearContent", false);

    await expect(
      Reflect.get(updateTaskArtifactCommand, "_actionHandler").call(
        updateTaskArtifactCommand,
        ["artifact_1"]
      )
    ).rejects.toThrow(/No updates provided/);
  });
});

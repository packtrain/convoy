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
import { deleteTaskArtifactCommand } from "./delete.js";

describe("tasks artifacts delete command", () => {
  const mutation = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    mutation.mockResolvedValueOnce(null);

    runOneShotCommandMock.mockImplementation(async (_cmd, run) => {
      await run({
        client: {
          query: vi.fn(),
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

  it("deletes an artifact by id", async () => {
    deleteTaskArtifactCommand.setOptionValue("json", true);

    await Reflect.get(deleteTaskArtifactCommand, "_actionHandler").call(
      deleteTaskArtifactCommand,
      ["artifact_1"]
    );

    expect(mutation).toHaveBeenCalledWith(api.tasks.artifacts.deleteTaskArtifact, {
      artifactId: "artifact_1",
    });
  });
});

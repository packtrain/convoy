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
import { replaceTaskArtifactCommand } from "./replace.js";

describe("tasks artifacts replace command", () => {
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
      name: "Plan",
      fileName: "plan.md",
      content: "# Updated",
      source: "user",
      createdBy: "user_1",
      updatedBy: "user_1",
      createdAt: 1,
      updatedAt: 2,
    });
    readFileSyncMock.mockImplementation((path: string) => {
      if (path === "/tmp/old.txt") {
        return "old\nvalue";
      }
      if (path === "/tmp/new.txt") {
        return "new\nvalue";
      }
      return "";
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
          projectId: "proj_default",
        },
      });
    });

    replaceTaskArtifactCommand.setOptionValue("oldString", undefined);
    replaceTaskArtifactCommand.setOptionValue("oldStringFile", undefined);
    replaceTaskArtifactCommand.setOptionValue("newString", undefined);
    replaceTaskArtifactCommand.setOptionValue("newStringFile", undefined);
    replaceTaskArtifactCommand.setOptionValue("replaceAll", false);
    replaceTaskArtifactCommand.setOptionValue("json", false);
    replaceTaskArtifactCommand.setOptionValue("output", "text");
  });

  it("replaces inline strings and refetches the artifact", async () => {
    replaceTaskArtifactCommand.setOptionValue("oldString", "old");
    replaceTaskArtifactCommand.setOptionValue("newString", "new");
    replaceTaskArtifactCommand.setOptionValue("replaceAll", true);
    replaceTaskArtifactCommand.setOptionValue("json", true);

    await Reflect.get(replaceTaskArtifactCommand, "_actionHandler").call(
      replaceTaskArtifactCommand,
      ["artifact_1"]
    );

    expect(mutation).toHaveBeenCalledWith(api.tasks.artifacts.replaceInTaskArtifact, {
      artifactId: "artifact_1",
      oldString: "old",
      newString: "new",
      replaceAll: true,
    });
    expect(query).toHaveBeenCalledWith(api.tasks.artifacts.getTaskArtifact, {
      artifactId: "artifact_1",
    });
  });

  it("loads multiline old and new strings from files", async () => {
    replaceTaskArtifactCommand.setOptionValue("oldStringFile", "/tmp/old.txt");
    replaceTaskArtifactCommand.setOptionValue("newStringFile", "/tmp/new.txt");
    replaceTaskArtifactCommand.setOptionValue("json", true);

    await Reflect.get(replaceTaskArtifactCommand, "_actionHandler").call(
      replaceTaskArtifactCommand,
      ["artifact_1"]
    );

    expect(readFileSyncMock).toHaveBeenCalledWith("/tmp/old.txt", "utf-8");
    expect(readFileSyncMock).toHaveBeenCalledWith("/tmp/new.txt", "utf-8");
    expect(mutation).toHaveBeenCalledWith(api.tasks.artifacts.replaceInTaskArtifact, {
      artifactId: "artifact_1",
      oldString: "old\nvalue",
      newString: "new\nvalue",
      replaceAll: false,
    });
  });

  it("rejects conflicting old string sources", async () => {
    replaceTaskArtifactCommand.setOptionValue("oldString", "old");
    replaceTaskArtifactCommand.setOptionValue("oldStringFile", "/tmp/old.txt");
    replaceTaskArtifactCommand.setOptionValue("newString", "new");

    await expect(
      Reflect.get(replaceTaskArtifactCommand, "_actionHandler").call(
        replaceTaskArtifactCommand,
        ["artifact_1"]
      )
    ).rejects.toThrow(/Cannot use --old-string and --old-string-file together/);
  });

  it("rejects missing new string source", async () => {
    replaceTaskArtifactCommand.setOptionValue("oldString", "old");

    await expect(
      Reflect.get(replaceTaskArtifactCommand, "_actionHandler").call(
        replaceTaskArtifactCommand,
        ["artifact_1"]
      )
    ).rejects.toThrow(/Pass --new-string or --new-string-file/);
  });

  it("rejects empty oldString", async () => {
    replaceTaskArtifactCommand.setOptionValue("oldString", "");
    replaceTaskArtifactCommand.setOptionValue("newString", "new");

    await expect(
      Reflect.get(replaceTaskArtifactCommand, "_actionHandler").call(
        replaceTaskArtifactCommand,
        ["artifact_1"]
      )
    ).rejects.toThrow(/oldString must be non-empty/);
  });
});

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
import { createTaskArtifactCommand } from "./create.js";

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

describe("tasks artifacts create command", () => {
  const query = vi.fn();
  const mutation = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    mutation.mockResolvedValueOnce("artifact_1");
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

    createTaskArtifactCommand.setOptionValue("name", undefined);
    createTaskArtifactCommand.setOptionValue("content", undefined);
    createTaskArtifactCommand.setOptionValue("contentFile", undefined);
    createTaskArtifactCommand.setOptionValue("contentType", undefined);
    createTaskArtifactCommand.setOptionValue("runId", undefined);
    createTaskArtifactCommand.setOptionValue("json", false);
    createTaskArtifactCommand.setOptionValue("output", "text");
  });

  it("creates an artifact with inline content and refetches it", async () => {
    createTaskArtifactCommand.setOptionValue("name", "Plan");
    createTaskArtifactCommand.setOptionValue("content", "# Plan");
    createTaskArtifactCommand.setOptionValue("runId", "run_1");
    createTaskArtifactCommand.setOptionValue("json", true);

    await Reflect.get(createTaskArtifactCommand, "_actionHandler").call(
      createTaskArtifactCommand,
      ["task_1"]
    );

    expect(mutation).toHaveBeenCalledWith(api.tasks.artifacts.createTaskArtifact, {
      taskId: "task_1",
      name: "Plan",
      content: "# Plan",
      runId: "run_1",
    });
    expect(query).toHaveBeenCalledWith(api.tasks.artifacts.getTaskArtifact, {
      artifactId: "artifact_1",
    });
  });

  it("resolves a bare task ref before creating the artifact", async () => {
    Reflect.set(createTaskArtifactCommand, "optsWithGlobals", () => ({ project: "WEB" }));
    query.mockReset();
    query
      .mockResolvedValueOnce(accessibleProjects)
      .mockResolvedValueOnce({ results: [{ ref: "WEB-12", task: { _id: "task_12" } }] })
      .mockResolvedValueOnce({ _id: "artifact_1", name: "Plan" });
    createTaskArtifactCommand.setOptionValue("name", "Plan");
    createTaskArtifactCommand.setOptionValue("content", "# Plan");
    createTaskArtifactCommand.setOptionValue("json", true);

    await Reflect.get(createTaskArtifactCommand, "_actionHandler").call(
      createTaskArtifactCommand,
      ["WEB-12"]
    );

    expect(query.mock.calls[1]?.[1]).toEqual({ refs: ["WEB-12"], projectId: "proj_web_1" });
    expect(mutation.mock.calls[0]?.[1]).toEqual({
      taskId: "task_12",
      name: "Plan",
      content: "# Plan",
    });
    Reflect.deleteProperty(createTaskArtifactCommand, "optsWithGlobals");
  });

  it("passes --content-type html through to the mutation", async () => {
    createTaskArtifactCommand.setOptionValue("name", "Preview");
    createTaskArtifactCommand.setOptionValue("content", "<p>hi</p>");
    createTaskArtifactCommand.setOptionValue("contentType", "html");
    createTaskArtifactCommand.setOptionValue("json", true);

    await Reflect.get(createTaskArtifactCommand, "_actionHandler").call(
      createTaskArtifactCommand,
      ["task_1"]
    );

    expect(mutation).toHaveBeenCalledWith(api.tasks.artifacts.createTaskArtifact, {
      taskId: "task_1",
      name: "Preview",
      content: "<p>hi</p>",
      contentType: "html",
    });
  });

  it("rejects unknown --content-type values", async () => {
    createTaskArtifactCommand.setOptionValue("name", "Preview");
    createTaskArtifactCommand.setOptionValue("contentType", "pdf");
    createTaskArtifactCommand.setOptionValue("json", true);

    await expect(
      Reflect.get(createTaskArtifactCommand, "_actionHandler").call(
        createTaskArtifactCommand,
        ["task_1"]
      )
    ).rejects.toThrow("--content-type must be one of: markdown, html");
    expect(mutation).not.toHaveBeenCalled();
  });

  it("loads content from a file when --content-file is used", async () => {
    createTaskArtifactCommand.setOptionValue("name", "Plan");
    createTaskArtifactCommand.setOptionValue("content", undefined);
    createTaskArtifactCommand.setOptionValue("contentFile", "/tmp/plan.md");
    createTaskArtifactCommand.setOptionValue("json", true);

    await Reflect.get(createTaskArtifactCommand, "_actionHandler").call(
      createTaskArtifactCommand,
      ["task_1"]
    );

    expect(readFileSyncMock).toHaveBeenCalledWith("/tmp/plan.md", "utf-8");
    expect(mutation).toHaveBeenCalledWith(
      api.tasks.artifacts.createTaskArtifact,
      expect.objectContaining({
        content: "# File plan",
      })
    );
  });
});

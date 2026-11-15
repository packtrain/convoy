import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import { resetCommandOptions } from "../../test-helpers.js";
import { addTaskCommentCommand } from "./add.js";

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

describe("tasks comments add command", () => {
  const query = vi.fn();
  const mutation = vi.fn();
  let tempDirectory: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    resetCommandOptions(addTaskCommentCommand);
    Reflect.set(addTaskCommentCommand, "optsWithGlobals", () => ({
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

  afterEach(() => {
    if (tempDirectory) {
      rmSync(tempDirectory, { recursive: true, force: true });
      tempDirectory = undefined;
    }
  });

  it("creates a comment on a bare task ref", async () => {
    query
      .mockResolvedValueOnce(accessibleProjects)
      .mockResolvedValueOnce({
        results: [{ ref: "WEB-12", task: { _id: "task_12" } }],
      });
    mutation.mockResolvedValueOnce("comment_1");
    addTaskCommentCommand.setOptionValue("message", "  Ready to review.  ");

    await Reflect.get(addTaskCommentCommand, "_actionHandler").call(
      addTaskCommentCommand,
      ["WEB-12"]
    );

    expect(mutation).toHaveBeenCalledWith(api.tasks.comments.create, {
      taskId: "task_12",
      content: "Ready to review.",
    });
  });

  it("reads a comment from a file and emits strict JSON", async () => {
    tempDirectory = mkdtempSync(join(tmpdir(), "convoy-comment-"));
    const messageFile = join(tempDirectory, "comment.md");
    writeFileSync(messageFile, "Comment from a file.\n", "utf-8");
    mutation.mockResolvedValueOnce("comment_2");
    addTaskCommentCommand.setOptionValue("messageFile", messageFile);
    addTaskCommentCommand.setOptionValue("json", true);

    await Reflect.get(addTaskCommentCommand, "_actionHandler").call(
      addTaskCommentCommand,
      ["task_2"]
    );

    const output = vi.mocked(console.log).mock.calls.at(-1)?.[0];
    expect(JSON.parse(String(output))).toEqual({
      taskId: "task_2",
      commentId: "comment_2",
    });
  });

  it("rejects conflicting or empty message input", async () => {
    addTaskCommentCommand.setOptionValue("message", "message");
    addTaskCommentCommand.setOptionValue("messageFile", "/tmp/comment.md");
    await expect(
      Reflect.get(addTaskCommentCommand, "_actionHandler").call(
        addTaskCommentCommand,
        ["task_1"]
      )
    ).rejects.toThrow("Cannot use --message and --message-file together");

    resetCommandOptions(addTaskCommentCommand);
    addTaskCommentCommand.setOptionValue("message", "   ");
    await expect(
      Reflect.get(addTaskCommentCommand, "_actionHandler").call(
        addTaskCommentCommand,
        ["task_1"]
      )
    ).rejects.toThrow("Comment content must be non-empty");
    expect(mutation).not.toHaveBeenCalled();
  });
});

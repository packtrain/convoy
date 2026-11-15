import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Command } from "commander";

const { runOneShotCommandMock } = vi.hoisted(() => ({
  runOneShotCommandMock: vi.fn(),
}));

vi.mock("../../../../lib/one-shot-command.js", () => ({
  runOneShotCommand: runOneShotCommandMock,
}));

vi.mock("../../../../cli.js", () => ({
  addGlobalOptions: <T extends { option: (...args: string[]) => T }>(cmd: T) =>
    cmd
      .option("--profile <name>", "Profile key (for profile lookup)")
      .option("--url <url>", "Convex backend URL (overrides config)")
      .option("--api-key <key>", "API key (overrides config)")
      .option("--project <id>", "Project ID (overrides config)"),
}));

import { api } from "../../../../convex/_generated/api.js";
import { listArtifactCommentsCommand } from "./list.js";
import { addArtifactCommentCommand } from "./add.js";
import { replyArtifactCommentCommand } from "./reply.js";
import { resolveArtifactCommentsCommand, unresolveArtifactCommentsCommand } from "./resolve.js";

const ROOT = {
  _id: "comment_root",
  _creationTime: 1,
  artifactId: "artifact_1",
  taskId: "task_1",
  authorId: "user_1",
  content: "Why before?",
  anchor: { text: "before launch", prefix: "", suffix: "", startOffset: 0, endOffset: 13 },
  status: "open",
  createdAt: 100,
  updatedAt: 100,
  isEdited: false,
  authorName: "Robin",
  authorAvatarUrl: null,
  canEdit: true,
  canDelete: true,
};
const REPLY = {
  ...ROOT,
  _id: "comment_reply",
  parentId: "comment_root",
  anchor: undefined,
  status: undefined,
  content: "Agreed",
};

function runAction(command: Command, args: unknown[]): Promise<void> {
  return Reflect.get(command, "_actionHandler").call(command, args);
}

describe("tasks artifacts comments commands", () => {
  const query = vi.fn();
  const mutation = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);

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

  it("list passes the status filter and groups replies under roots", async () => {
    query.mockResolvedValueOnce([ROOT, REPLY]);
    listArtifactCommentsCommand.setOptionValue("json", true);
    listArtifactCommentsCommand.setOptionValue("status", "open");

    await runAction(listArtifactCommentsCommand, ["artifact_1"]);

    expect(query).toHaveBeenCalledWith(api.tasks.artifactComments.listByArtifact, {
      artifactId: "artifact_1",
      status: "open",
    });
    const printed = vi.mocked(console.log).mock.calls.map((call) => call[0]).join("\n");
    const threads = JSON.parse(printed);
    expect(threads).toHaveLength(1);
    expect(threads[0].root._id).toBe("comment_root");
    expect(threads[0].replies.map((r: { _id: string }) => r._id)).toEqual(["comment_reply"]);
  });

  it("add creates an anchored comment with occurrence", async () => {
    mutation.mockResolvedValueOnce("comment_new");
    addArtifactCommentCommand.setOptionValue("anchor", "rollout");
    addArtifactCommentCommand.setOptionValue("occurrence", "2");
    addArtifactCommentCommand.setOptionValue("message", "Needs work");

    await runAction(addArtifactCommentCommand, ["artifact_1"]);

    expect(mutation).toHaveBeenCalledWith(api.tasks.artifactComments.create, {
      artifactId: "artifact_1",
      content: "Needs work",
      anchorText: "rollout",
      anchorOccurrence: 2,
    });
  });

  it("add rejects a non-positive occurrence", async () => {
    addArtifactCommentCommand.setOptionValue("anchor", "x");
    addArtifactCommentCommand.setOptionValue("occurrence", "0");
    addArtifactCommentCommand.setOptionValue("message", "c");

    // runOneShotCommand is mocked without a catch, so the error surfaces here.
    await expect(runAction(addArtifactCommentCommand, ["artifact_1"])).rejects.toThrow(
      "--occurrence must be a positive integer"
    );
    expect(mutation).not.toHaveBeenCalled();
  });

  it("add rejects a malformed occurrence instead of truncating it", async () => {
    for (const value of ["2x", "2.5"]) {
      addArtifactCommentCommand.setOptionValue("anchor", "x");
      addArtifactCommentCommand.setOptionValue("occurrence", value);
      addArtifactCommentCommand.setOptionValue("message", "c");

      await expect(runAction(addArtifactCommentCommand, ["artifact_1"])).rejects.toThrow(
        "--occurrence must be a positive integer"
      );
    }
    expect(mutation).not.toHaveBeenCalled();
  });

  it("reply maps the comment id to parentId", async () => {
    mutation.mockResolvedValueOnce("comment_reply_new");
    replyArtifactCommentCommand.setOptionValue("message", "On it");

    await runAction(replyArtifactCommentCommand, ["comment_root"]);

    expect(mutation).toHaveBeenCalledWith(api.tasks.artifactComments.reply, {
      parentId: "comment_root",
      content: "On it",
    });
  });

  it("resolve and unresolve send the batch with the right status", async () => {
    mutation.mockResolvedValue(null);

    await runAction(resolveArtifactCommentsCommand, [["comment_a", "comment_b"]]);
    expect(mutation).toHaveBeenCalledWith(api.tasks.artifactComments.setStatus, {
      commentIds: ["comment_a", "comment_b"],
      status: "resolved",
    });

    await runAction(unresolveArtifactCommentsCommand, [["comment_a"]]);
    expect(mutation).toHaveBeenCalledWith(api.tasks.artifactComments.setStatus, {
      commentIds: ["comment_a"],
      status: "open",
    });
  });
});

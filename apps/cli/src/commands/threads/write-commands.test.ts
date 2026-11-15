import { beforeEach, describe, expect, it, vi } from "vitest";
import chalk from "chalk";
import type { Command } from "commander";
import { getFunctionName, type FunctionReference } from "convex/server";

const { oraMock, readFileMock, runOneShotCommandMock, statMock } = vi.hoisted(() => ({
  oraMock: vi.fn(),
  readFileMock: vi.fn(),
  runOneShotCommandMock: vi.fn(),
  statMock: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  readFile: readFileMock,
  stat: statMock,
}));

vi.mock("ora", () => ({ default: oraMock }));

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
import { resetCommandOptions } from "../test-helpers.js";
import { createThreadCommand } from "./create.js";
import { markThreadDoneCommand } from "./done.js";
import { sendThreadMessageCommand } from "./send.js";
import { attachToResponseCommand } from "./attach.js";
import { attachTaskToThreadCommand } from "./attach-task.js";
import { attachPullRequestToThreadCommand } from "./attach-pr.js";
import { listThreadChecksCommand } from "./checks.js";

const threadRow = {
  threadId: "thr_1",
  projectId: "proj_web_1",
  title: "Fix billing",
  isDone: false,
  createdAt: 1,
  lastActivityAt: 4,
  status: "streaming",
  profileId: "prof_1",
  pathId: "path_1",
  cliType: "claude-code",
};

const containerRow = {
  threadId: "thr_group",
  projectId: "proj_web_1",
  title: "Billing review",
  isDone: false,
  createdAt: 1,
  lastActivityAt: 5,
  kind: "group",
  childCount: 2,
  originThreadId: "thr_1",
};

function invoke(cmd: Command, args: unknown[]): Promise<void> {
  Reflect.set(cmd, "optsWithGlobals", () => ({ project: "WEB" }));
  return Reflect.get(cmd, "_actionHandler").call(cmd, args);
}

/** `api.x.y !== api.x.y` — each access is a fresh proxy, so compare by name. */
function isFunction(reference: unknown, expected: FunctionReference<"query" | "mutation">): boolean {
  return getFunctionName(reference as FunctionReference<"query" | "mutation">) === getFunctionName(expected);
}

describe("threads write commands", () => {
  const query = vi.fn();
  const mutation = vi.fn();
  const spinner = { fail: vi.fn(), start: vi.fn(), succeed: vi.fn() };

  const queriedFunctions = () =>
    query.mock.calls.map(([reference]) => getFunctionName(reference as FunctionReference<"query">));

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    resetCommandOptions(createThreadCommand);
    resetCommandOptions(sendThreadMessageCommand);
    resetCommandOptions(markThreadDoneCommand);
    resetCommandOptions(attachToResponseCommand);
    resetCommandOptions(attachTaskToThreadCommand);
    resetCommandOptions(listThreadChecksCommand);

    spinner.start.mockReturnValue(spinner);
    oraMock.mockReturnValue(spinner);
    statMock.mockResolvedValue({ isFile: () => true, size: 5 });
    readFileMock.mockResolvedValue(Buffer.from("hello"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ storageId: "storage_1" }), text: async () => "" }))
    );

    runOneShotCommandMock.mockImplementation(async (_cmd: unknown, run: (ctx: unknown) => Promise<void>) => {
      await run({
        client: { query, mutation, subscribe: vi.fn(), close: vi.fn(), client: {} as never },
        config: { convexUrl: "https://example.convex.cloud", apiKey: "sk_user_test", projectId: "proj_web_1" },
      });
    });
  });

  describe("threads create", () => {
    it("creates a plain thread from an explicit target, resolving the project once", async () => {
      query.mockResolvedValueOnce([
        { _id: "proj_web_1", name: "Web", alias: "WEB", organizationId: "org_acme", organizationName: "Acme", organizationSlug: "acme", role: { name: "org-owner", permissions: ["*"] } },
      ]);
      mutation.mockResolvedValueOnce("thr_new");
      createThreadCommand.setOptionValue("profileId", "prof_1");
      createThreadCommand.setOptionValue("pathId", "path_1");
      createThreadCommand.setOptionValue("cliType", "claude-code");
      createThreadCommand.setOptionValue("content", "Review the invoice rounding");

      await invoke(createThreadCommand, []);

      expect(mutation).toHaveBeenCalledWith(api.cli.threads.core.create, {
        profileId: "prof_1",
        pathId: "path_1",
        cliType: "claude-code",
        content: "Review the invoice rounding",
      });
      expect(vi.mocked(console.log).mock.calls.flat().join("\n")).toContain("thr_new");
    });

    it("adds a Group child from --source, inheriting the target", async () => {
      query.mockResolvedValueOnce(threadRow);
      mutation.mockResolvedValueOnce({ threadId: "thr_new", containerId: "thr_group" });
      createThreadCommand.setOptionValue("source", "thr_1");
      createThreadCommand.setOptionValue("content", "Review my work");

      await invoke(createThreadCommand, []);

      // No project resolution: the source thread's own project is authoritative.
      expect(query).toHaveBeenCalledTimes(1);
      expect(mutation).toHaveBeenCalledWith(api.cli.threads.groups.addThreadToGroup, {
        profileId: "prof_1",
        pathId: "path_1",
        cliType: "claude-code",
        content: "Review my work",
        sourceThreadId: "thr_1",
        spawnedByThreadId: "thr_1",
      });
      expect(vi.mocked(console.log).mock.calls.flat().join("\n")).toContain("thr_group");
    });

    it("joins an existing group when --source names a container", async () => {
      query.mockResolvedValueOnce(containerRow).mockResolvedValueOnce([threadRow]);
      mutation.mockResolvedValueOnce({ threadId: "thr_new", containerId: "thr_group" });
      createThreadCommand.setOptionValue("source", "thr_group");
      createThreadCommand.setOptionValue("content", "Another angle");

      await invoke(createThreadCommand, []);

      expect(query).toHaveBeenCalledWith(api.cli.threads.summaries.listGroupSummaries, {
        parentThreadId: "thr_group",
        includeDone: true,
      });
      // The container is `expectedContainerId`; `addThreadToGroup` needs a child.
      expect(mutation).toHaveBeenCalledWith(
        api.cli.threads.groups.addThreadToGroup,
        expect.objectContaining({
          sourceThreadId: "thr_1",
          spawnedByThreadId: "thr_group",
          expectedContainerId: "thr_group",
        })
      );
    });

    it("creates in an empty workflow container with an explicit target", async () => {
      query.mockResolvedValueOnce({ ...containerRow, workflowRunId: "run_1", childCount: 0 }).mockResolvedValueOnce([]);
      mutation.mockResolvedValueOnce({ threadId: "thr_new", containerId: "thr_group" });
      createThreadCommand.setOptionValue("source", "thr_group");
      createThreadCommand.setOptionValue("profileId", "prof_1");
      createThreadCommand.setOptionValue("pathId", "path_1");
      createThreadCommand.setOptionValue("cliType", "codex");
      createThreadCommand.setOptionValue("content", "Investigate independently");
      await invoke(createThreadCommand, []);
      expect(mutation).toHaveBeenCalledWith(api.cli.threads.groups.addThreadToGroup, expect.objectContaining({
        sourceThreadId: "thr_group", expectedContainerId: "thr_group", spawnedByThreadId: "thr_group",
        profileId: "prof_1", pathId: "path_1", cliType: "codex",
      }));
    });

    it("creates from --attach alone, with no content", async () => {
      query.mockResolvedValueOnce(threadRow);
      mutation
        .mockResolvedValueOnce("https://upload.example")
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ threadId: "thr_new", containerId: "thr_group" })
        .mockResolvedValueOnce(null);
      createThreadCommand.setOptionValue("source", "thr_1");
      createThreadCommand.setOptionValue("attach", ["note.txt"]);

      await invoke(createThreadCommand, []);

      // An attachment carries the message; requiring --content would reject it.
      expect(mutation).toHaveBeenCalledWith(
        api.cli.threads.groups.addThreadToGroup,
        expect.objectContaining({
          content: "",
          attachments: [
            { storageId: "storage_1", fileName: "note.txt", fileSize: 5, contentType: "text/plain" },
          ],
        })
      );
    });

    it("resolves a bare --task ref against the source's project, not the default", async () => {
      query
        .mockResolvedValueOnce(threadRow) // getSummary for --source
        .mockResolvedValueOnce({ results: [{ task: { _id: "task_9" } }] });
      mutation.mockResolvedValueOnce({ threadId: "thr_new", containerId: "thr_group" });
      createThreadCommand.setOptionValue("source", "thr_1");
      createThreadCommand.setOptionValue("content", "Look at this");
      createThreadCommand.setOptionValue("task", "OS-1634");

      await invoke(createThreadCommand, []);

      // Never `listAccessible`: the source thread's project is authoritative, so a
      // bare ref needs no configured default and cannot hit a different project.
      expect(queriedFunctions()).not.toContain("projects/core:listAccessible");
      expect(query).toHaveBeenCalledWith(api.tasks.core.getByRefs, {
        refs: ["OS-1634"],
        projectId: "proj_web_1",
      });
      expect(mutation).toHaveBeenCalledWith(
        api.cli.threads.groups.addThreadToGroup,
        expect.objectContaining({ taskId: "task_9" })
      );
    });

    it("rejects an unknown --cli-type by naming the valid runtimes", async () => {
      createThreadCommand.setOptionValue("cliType", "claude");
      createThreadCommand.setOptionValue("content", "hi");

      await expect(invoke(createThreadCommand, [])).rejects.toThrow("claude-code");
      expect(mutation).not.toHaveBeenCalled();
    });
  });

  describe("threads send", () => {
    it("queues a message into an existing thread", async () => {
      query.mockResolvedValueOnce(threadRow);
      mutation.mockResolvedValueOnce("msg_1");

      await invoke(sendThreadMessageCommand, ["thr_1", "Ship it"]);

      expect(mutation).toHaveBeenCalledWith(api.cli.messages.send, {
        threadId: "thr_1",
        content: "Ship it",
      });
    });

    it("uploads --attach files and passes the metadata to send", async () => {
      query.mockResolvedValueOnce(threadRow);
      mutation
        .mockResolvedValueOnce("https://upload.example") // generate URL
        .mockResolvedValueOnce(null) // register pending
        .mockResolvedValueOnce("msg_1") // send
        .mockResolvedValueOnce(null); // discard pending
      sendThreadMessageCommand.setOptionValue("attach", ["note.txt"]);

      await invoke(sendThreadMessageCommand, ["thr_1", "See attached"]);

      expect(mutation).toHaveBeenCalledWith(api.cli.messages.generateMessageAttachmentUploadUrl, {
        projectId: "proj_web_1",
      });
      expect(fetch).toHaveBeenCalledWith("https://upload.example", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: Buffer.from("hello"),
      });
      expect(mutation).toHaveBeenCalledWith(api.cli.messages.registerPendingUploadedAttachment, {
        projectId: "proj_web_1",
        storageId: "storage_1",
      });
      expect(mutation).toHaveBeenCalledWith(api.cli.messages.send, {
        threadId: "thr_1",
        content: "See attached",
        attachments: [
          { storageId: "storage_1", fileName: "note.txt", fileSize: 5, contentType: "text/plain" },
        ],
      });
    });

    it("discards the pending upload when send fails, so the blob has a reclaimer", async () => {
      query.mockResolvedValueOnce(threadRow);
      mutation
        .mockResolvedValueOnce("https://upload.example")
        .mockResolvedValueOnce(null)
        .mockRejectedValueOnce(new Error("Thread not found"))
        .mockResolvedValueOnce(null);
      sendThreadMessageCommand.setOptionValue("attach", ["note.txt"]);

      await expect(invoke(sendThreadMessageCommand, ["thr_1", "See attached"])).rejects.toThrow(
        "Thread not found"
      );

      // The leak this command's `finally` exists to prevent: there is no cron sweep.
      expect(mutation).toHaveBeenCalledWith(api.cli.messages.deletePendingUploadedAttachment, {
        projectId: "proj_web_1",
        storageId: "storage_1",
      });
    });

    it("discards every pending upload even when one discard fails", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      query.mockResolvedValueOnce(threadRow);
      let storageCounter = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          ok: true,
          json: async () => ({ storageId: `storage_${(storageCounter += 1)}` }),
          text: async () => "",
        }))
      );
      mutation.mockImplementation(async (fn: unknown, args: { storageId?: string }) => {
        if (isFunction(fn, api.cli.messages.generateMessageAttachmentUploadUrl)) return "https://upload.example";
        if (isFunction(fn, api.cli.messages.send)) return "msg_1";
        if (isFunction(fn, api.cli.messages.deletePendingUploadedAttachment) && args.storageId === "storage_1") {
          throw new Error("network blip");
        }
        return null;
      });
      sendThreadMessageCommand.setOptionValue("attach", ["a.txt", "b.txt"]);

      const result = await invoke(sendThreadMessageCommand, ["thr_1", "Two files"]);

      // The second blob is still reclaimed, and the committed send is not reported
      // as a failure — a retry would queue a duplicate message.
      expect(result).toBeUndefined();
      expect(mutation).toHaveBeenCalledWith(api.cli.messages.deletePendingUploadedAttachment, {
        projectId: "proj_web_1",
        storageId: "storage_2",
      });
      expect(vi.mocked(console.error).mock.calls.flat().join("\n")).toContain("storage_1");
    });

    it("rejects an oversized file before reading it into memory", async () => {
      query.mockResolvedValueOnce(threadRow);
      statMock.mockResolvedValue({ isFile: () => true, size: 51 * 1024 * 1024 });
      sendThreadMessageCommand.setOptionValue("attach", ["huge.bin"]);

      await expect(invoke(sendThreadMessageCommand, ["thr_1", "Big one"])).rejects.toThrow("50 MB");
      expect(readFileMock).not.toHaveBeenCalled();
      expect(mutation).not.toHaveBeenCalledWith(api.cli.messages.send, expect.anything());
    });

    it("requires content or an attachment", async () => {
      await expect(invoke(sendThreadMessageCommand, ["thr_1", "   "])).rejects.toThrow("--attach");
      expect(query).not.toHaveBeenCalled();
    });
  });

  describe("threads attach (OS-2091)", () => {
    it("uploads to the thread's project and commits the batch to the named reply", async () => {
      query.mockResolvedValueOnce(threadRow);
      mutation
        .mockResolvedValueOnce("https://upload.example")
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ messageId: "msg_reply", storageIds: ["storage_1"] })
        .mockResolvedValueOnce(null);
      attachToResponseCommand.setOptionValue("messageId", "msg_reply");
      attachToResponseCommand.setOptionValue("sessionId", "ses_1");

      await invoke(attachToResponseCommand, ["thr_1", ["shot.png"]]);

      expect(mutation).toHaveBeenCalledWith(api.cli.messages.generateMessageAttachmentUploadUrl, { projectId: "proj_web_1" });
      expect(mutation).toHaveBeenCalledWith(api.cli.messages.attachToResponse, {
        threadId: "thr_1",
        messageId: "msg_reply",
        sessionId: "ses_1",
        attachments: [{ storageId: "storage_1", fileName: "shot.png", fileSize: 5, contentType: "image/png" }],
      });
      expect(mutation).toHaveBeenLastCalledWith(api.cli.messages.deletePendingUploadedAttachment, {
        projectId: "proj_web_1",
        storageId: "storage_1",
      });
      expect(vi.mocked(console.log).mock.calls.flat().join("\n")).toContain("Attached 1 file");
    });

    it("marks every file inline with --inline (OS-2220)", async () => {
      query.mockResolvedValueOnce(threadRow);
      mutation
        .mockResolvedValueOnce("https://upload.example")
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ messageId: "msg_reply", storageIds: ["storage_1"] })
        .mockResolvedValueOnce(null);
      attachToResponseCommand.setOptionValue("messageId", "msg_reply");
      attachToResponseCommand.setOptionValue("sessionId", "ses_1");
      attachToResponseCommand.setOptionValue("inline", true);

      await invoke(attachToResponseCommand, ["thr_1", ["chart.html"]]);

      expect(mutation).toHaveBeenCalledWith(api.cli.messages.attachToResponse, {
        threadId: "thr_1",
        messageId: "msg_reply",
        sessionId: "ses_1",
        attachments: [{ storageId: "storage_1", fileName: "chart.html", fileSize: 5, contentType: "text/html", display: "inline" }],
      });
    });

    it("rejects --inline on a non-html file before uploading anything (OS-2220)", async () => {
      attachToResponseCommand.setOptionValue("messageId", "msg_reply");
      attachToResponseCommand.setOptionValue("sessionId", "ses_1");
      attachToResponseCommand.setOptionValue("inline", true);

      await expect(invoke(attachToResponseCommand, ["thr_1", ["chart.html", "run.log"]])).rejects.toThrow(
        "--inline works only on .html files: run.log"
      );
      expect(mutation).not.toHaveBeenCalled();
    });

    it("rejects when the thread is not accessible, before uploading anything", async () => {
      query.mockResolvedValueOnce(null);
      attachToResponseCommand.setOptionValue("messageId", "msg_reply");
      attachToResponseCommand.setOptionValue("sessionId", "ses_1");

      await expect(invoke(attachToResponseCommand, ["thr_1", ["shot.png"]])).rejects.toThrow("Thread not found");
      expect(mutation).not.toHaveBeenCalled();
    });
  });

  describe("threads attach --check (OS-2291)", () => {
    const setRun = () => {
      attachToResponseCommand.setOptionValue("messageId", "msg_reply");
      attachToResponseCommand.setOptionValue("sessionId", "ses_1");
    };

    it("reports a check with no files", async () => {
      query.mockResolvedValueOnce(threadRow);
      mutation.mockResolvedValueOnce({ messageId: "msg_reply", storageIds: [], checkResultId: "res_1" });
      setRun();
      attachToResponseCommand.setOptionValue("check", "spec");
      attachToResponseCommand.setOptionValue("notPerformed", true);
      attachToResponseCommand.setOptionValue("note", "User asked to skip");

      await invoke(attachToResponseCommand, ["thr_1", []]);

      expect(mutation).toHaveBeenCalledWith(api.cli.messages.attachToResponse, {
        threadId: "thr_1",
        messageId: "msg_reply",
        sessionId: "ses_1",
        attachments: [],
        check: { key: "spec", status: "not_performed", note: "User asked to skip" },
      });
      expect(vi.mocked(console.log).mock.calls.flat().join("\n")).toContain("Reported check spec: not performed");
    });

    it("passes files and a label for a key outside the catalog", async () => {
      query.mockResolvedValueOnce(threadRow);
      mutation
        .mockResolvedValueOnce("https://upload.example")
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ messageId: "msg_reply", storageIds: ["storage_1"], checkResultId: "res_1" })
        .mockResolvedValueOnce(null);
      setRun();
      attachToResponseCommand.setOptionValue("check", "mobile");
      attachToResponseCommand.setOptionValue("passed", true);
      attachToResponseCommand.setOptionValue("label", "Mobile layout");

      await invoke(attachToResponseCommand, ["thr_1", ["mobile.png"]]);

      expect(mutation).toHaveBeenCalledWith(
        api.cli.messages.attachToResponse,
        expect.objectContaining({ check: { key: "mobile", status: "passed", label: "Mobile layout" } })
      );
    });

    it("passes a trimmed value and an artifact ID with no files (OS-2385)", async () => {
      query.mockResolvedValueOnce(threadRow);
      mutation.mockResolvedValueOnce({ messageId: "msg_reply", storageIds: [], checkResultId: "res_1" });
      setRun();
      attachToResponseCommand.setOptionValue("check", "test-cases");
      attachToResponseCommand.setOptionValue("passed", true);
      attachToResponseCommand.setOptionValue("value", " 12 cases ");
      attachToResponseCommand.setOptionValue("artifact", "art_1");

      await invoke(attachToResponseCommand, ["thr_1", []]);

      expect(mutation).toHaveBeenCalledWith(
        api.cli.messages.attachToResponse,
        expect.objectContaining({ attachments: [], check: { key: "test-cases", status: "passed", value: "12 cases", artifactId: "art_1" } })
      );
    });

    it.each([
      [{ value: "High" }, ["shot.png"], "--value needs --check"],
      [{ artifact: "art_1" }, [], "--artifact needs --check"],
      [{ check: "ui" }, ["shot.png"], "--check needs exactly one of --passed, --warning, --failed, --not-performed."],
      [{ check: "ui", passed: true, failed: true }, ["shot.png"], "--check needs exactly one of"],
      [{ check: "ui", failed: true }, ["shot.png"], "--failed needs --note with the reason."],
      [{ check: "ui", warning: true, note: "  " }, [], "--warning needs --note with the reason."],
      [{ passed: true }, ["shot.png"], "need --check <key>"],
      [{}, [], "Pass at least one file, or --check <key> to report a check."],
    ])("rejects %o before uploading anything", async (flags, files, message) => {
      setRun();
      for (const [name, value] of Object.entries(flags)) attachToResponseCommand.setOptionValue(name, value);

      await expect(invoke(attachToResponseCommand, ["thr_1", files])).rejects.toThrow(message);
      expect(mutation).not.toHaveBeenCalled();
    });
  });

  describe("threads checks (OS-2291)", () => {
    it("lists the task's checks with their current status", async () => {
      query.mockResolvedValueOnce({ ...threadRow, associatedTaskId: "task_1" }).mockResolvedValueOnce({
        checklists: [],
        checklistId: null,
        checks: [
          { key: "tests", label: "All tests pass", instruction: "Run pnpm test", added: false, results: [] },
          { key: "ui", label: "UI verified", instruction: "", added: false, results: [{ status: "failed", note: "Overlap", value: "High" }] },
        ],
      });

      await invoke(listThreadChecksCommand, ["thr_1"]);

      expect(query).toHaveBeenLastCalledWith(api.checks.checklists.getForThread, { threadId: "thr_1" });
      const output = vi.mocked(console.log).mock.calls.flat().join("\n");
      expect(output).toContain("tests");
      expect(output).toContain("Run pnpm test");
      expect(output).toContain("[pending]");
      expect(output).toContain("[failed]");
      expect(output).toContain("Note: Overlap");
      expect(output).toContain("Value: High");
    });

    it("lists a thread's own checks when it has no task (OS-2293)", async () => {
      query.mockResolvedValueOnce(threadRow).mockResolvedValueOnce({
        checklists: [],
        checklistId: null,
        checks: [{ key: "tests", label: "All tests pass", instruction: "", added: false, results: [{ status: "passed" }] }],
      });

      await invoke(listThreadChecksCommand, ["thr_1"]);

      expect(vi.mocked(console.log).mock.calls.flat().join("\n")).toContain("[passed]");
    });
  });

  describe("threads attach-task (OS-1713)", () => {
    it("resolves a bare ref against the thread's project and attaches it", async () => {
      query
        .mockResolvedValueOnce(threadRow) // getSummary for the thread's project
        .mockResolvedValueOnce({ results: [{ task: { _id: "task_9" } }] });
      mutation.mockResolvedValueOnce(null);

      await invoke(attachTaskToThreadCommand, ["thr_1", "OS-1713"]);

      expect(query).toHaveBeenCalledWith(api.tasks.core.getByRefs, { refs: ["OS-1713"], projectId: "proj_web_1" });
      expect(mutation).toHaveBeenCalledWith(api.cli.threads.core.attachTask, { threadId: "thr_1", taskId: "task_9" });
      expect(console.log).toHaveBeenCalledWith(chalk.green("✓") + " Task attached to thread");
    });

    it("rejects an org-scoped ref before any request", async () => {
      await expect(invoke(attachTaskToThreadCommand, ["thr_1", "acme/OS-5"])).rejects.toThrow("bare ref like OS-5");
      expect(query).not.toHaveBeenCalled();
      expect(mutation).not.toHaveBeenCalled();
    });

    it("propagates attach errors without printing success", async () => {
      query.mockResolvedValueOnce(threadRow).mockResolvedValueOnce({ results: [{ task: { _id: "task_9" } }] });
      mutation.mockRejectedValueOnce(new Error("This thread already has an attached task"));
      await expect(invoke(attachTaskToThreadCommand, ["thr_1", "OS-1713"])).rejects.toThrow("already has an attached task");
      expect(console.log).not.toHaveBeenCalled();
    });
  });

  describe("threads attach-pr", () => {
    it("attaches the PR to the thread", async () => {
      mutation.mockResolvedValueOnce(null);
      await invoke(attachPullRequestToThreadCommand, ["thr_1", "contoso/convoy#482"]);
      expect(mutation).toHaveBeenCalledWith(api.cli.threads.core.attachPullRequest, { threadId: "thr_1", pullRequest: "contoso/convoy#482" });
      expect(console.log).toHaveBeenCalledWith(chalk.green("✓") + " Pull request attached to thread");
    });
  });

  describe("threads done", () => {
    it("prints the standard success marker and blank line for threads done", async () => {
      mutation.mockResolvedValue(null);
      await invoke(markThreadDoneCommand, ["thr_1"]);
      expect(console.log).toHaveBeenCalledWith(chalk.green("✓") + " Thread marked done");
      expect(console.log).toHaveBeenLastCalledWith();
    });

    it("marks a thread done and prints JSON after success", async () => {
      mutation.mockResolvedValue(null);
      markThreadDoneCommand.setOptionValue("json", true);
      await invoke(markThreadDoneCommand, ["thr_1"]);
      expect(isFunction(mutation.mock.calls[0][0], api.cli.threads.core.markDone)).toBe(true);
      expect(mutation.mock.calls[0][1]).toEqual({ threadId: "thr_1" });
      expect(console.log).toHaveBeenCalledWith(JSON.stringify({ threadId: "thr_1" }, null, 2));
      expect(query).not.toHaveBeenCalled();
    });

    it("propagates mark-done errors without printing success", async () => {
      mutation.mockRejectedValueOnce(new Error("Not authorized"));
      await expect(invoke(markThreadDoneCommand, ["thr_1"])).rejects.toThrow("Not authorized");
      expect(console.log).not.toHaveBeenCalled();
    });
  });
});

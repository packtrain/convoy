import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";

const { confirmMock, mkdirMock, oraMock, readFileMock, runOneShotCommandMock, statMock, writeFileMock } = vi.hoisted(() => ({
  confirmMock: vi.fn(),
  mkdirMock: vi.fn(),
  oraMock: vi.fn(),
  readFileMock: vi.fn(),
  runOneShotCommandMock: vi.fn(),
  statMock: vi.fn(),
  writeFileMock: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  mkdir: mkdirMock,
  readFile: readFileMock,
  stat: statMock,
  writeFile: writeFileMock,
}));

vi.mock("ora", () => ({
  default: oraMock,
}));

vi.mock("@inquirer/prompts", () => ({
  confirm: confirmMock,
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
import { attachTaskCommand } from "../attach.js";
import { deleteTaskAttachmentCommand } from "./delete.js";
import { downloadTaskAttachmentCommand } from "./download.js";
import { listTaskAttachmentsCommand } from "./list.js";
import { moveTaskAttachmentCommand } from "./move.js";

function attachmentNamed(fileName: string) {
  return {
    _id: "attachment_1",
    _creationTime: 1,
    taskId: "task_1",
    storageId: "storage_1",
    fileName,
    fileSize: 5,
    contentType: "text/plain",
    uploadedBy: "user_1",
    uploadedAt: 1700000000000,
    url: "https://files.example/note.txt",
  };
}

describe("task attachment commands", () => {
  const query = vi.fn();
  const mutation = vi.fn();
  const spinner = {
    fail: vi.fn(),
    start: vi.fn(),
    succeed: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    process.exitCode = undefined;

    spinner.start.mockReturnValue(spinner);
    oraMock.mockReturnValue(spinner);
    statMock.mockResolvedValue({
      isFile: () => true,
      size: 5,
    });
    readFileMock.mockResolvedValue(Buffer.from("hello"));
    mkdirMock.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);
    confirmMock.mockResolvedValue(true);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ storageId: "storage_1" }),
        text: async () => "",
        arrayBuffer: async () => Buffer.from("downloaded").buffer,
      }))
    );

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

    for (const command of [attachTaskCommand, listTaskAttachmentsCommand, downloadTaskAttachmentCommand, deleteTaskAttachmentCommand, moveTaskAttachmentCommand]) {
      command.setOptionValue("json", true);
      command.setOptionValue("output", "text");
      command.setOptionValue("org", undefined);
    }
    downloadTaskAttachmentCommand.setOptionValue("output", undefined);
    downloadTaskAttachmentCommand.setOptionValue("force", undefined);
    deleteTaskAttachmentCommand.setOptionValue("yes", undefined);
  });

  // Dispatch by function reference: the upload flow is three mutations per file,
  // so call-order queues drift as soon as one file fails.
  function mockUploadMutations(options: { failGenerateOnCall?: number; failSave?: boolean } = {}) {
    let generateCalls = 0;
    mutation.mockImplementation(async (ref: unknown) => {
      switch (getFunctionName(ref as Parameters<typeof getFunctionName>[0])) {
        case "tasks/attachments:generateTaskAttachmentUploadUrl":
          generateCalls += 1;
          if (generateCalls === options.failGenerateOnCall) {
            throw new Error("No such file");
          }
          return "https://upload.example";
        case "tasks/attachments:registerPendingUploadedAttachment":
          return "https://blob.example";
        case "tasks/attachments:saveTaskAttachment":
          if (options.failSave) {
            throw new Error("Attachment fileSize does not match the uploaded file");
          }
          return "attachment_1";
        case "tasks/comments:deletePendingUploadedAttachment":
          return null;
        default:
          throw new Error("Unexpected mutation");
      }
    });
  }

  it("uploads files through signed storage URLs and saves task attachments", async () => {
    mockUploadMutations();

    await Reflect.get(attachTaskCommand, "_actionHandler").call(attachTaskCommand, ["task_1", ["note.txt"]]);

    expect(mutation).toHaveBeenCalledWith(api.tasks.attachments.generateTaskAttachmentUploadUrl, {});
    expect(fetch).toHaveBeenCalledWith("https://upload.example", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: Buffer.from("hello"),
    });
    // Registered before save: the claim is what lets save accept the blob (OS-1901).
    expect(mutation).toHaveBeenCalledWith(api.tasks.attachments.registerPendingUploadedAttachment, {
      storageId: "storage_1",
    });
    expect(mutation).toHaveBeenCalledWith(api.tasks.attachments.saveTaskAttachment, {
      taskId: "task_1",
      storageId: "storage_1",
      fileName: "note.txt",
      fileSize: 5,
      contentType: "text/plain",
    });
  });

  it("refuses a file over the size cap before reading or uploading it (OS-1676)", async () => {
    mockUploadMutations();
    statMock.mockResolvedValue({ isFile: () => true, size: 50 * 1024 * 1024 + 1 });

    await Reflect.get(attachTaskCommand, "_actionHandler").call(attachTaskCommand, ["task_1", ["big.bin"]]);

    expect(readFileMock).not.toHaveBeenCalled();
    expect(mutation).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("discards the registered upload when save fails (OS-1676)", async () => {
    mockUploadMutations({ failSave: true });

    await Reflect.get(attachTaskCommand, "_actionHandler").call(attachTaskCommand, ["task_1", ["note.txt"]]);

    const discards = mutation.mock.calls.filter(
      ([ref]) => getFunctionName(ref as Parameters<typeof getFunctionName>[0]) === "tasks/comments:deletePendingUploadedAttachment"
    );
    expect(discards.map(([, args]) => args)).toEqual([{ taskId: "task_1", storageId: "storage_1" }]);
    expect(process.exitCode).toBe(1);
  });

  it("prints partial upload results and sets a nonzero exit code when one file fails", async () => {
    mockUploadMutations({ failGenerateOnCall: 2 });

    await Reflect.get(attachTaskCommand, "_actionHandler").call(attachTaskCommand, ["task_1", ["one.txt", "missing.txt"]]);

    const output = vi
      .mocked(console.log)
      .mock.calls.flatMap((call) => call)
      .join("\n");
    expect(output).toContain('"attachments"');
    expect(output).toContain('"fileName": "one.txt"');
    expect(output).toContain('"failures"');
    expect(output).toContain('"file": "missing.txt"');
    expect(output).toContain('"error": "No such file"');
    expect(process.exitCode).toBe(1);
  });

  it("lists task attachments", async () => {
    query.mockResolvedValueOnce([
      {
        _id: "attachment_1",
        _creationTime: 1,
        taskId: "task_1",
        storageId: "storage_1",
        fileName: "note.txt",
        fileSize: 5,
        contentType: "text/plain",
        uploadedBy: "user_1",
        uploadedAt: 1700000000000,
        url: "https://files.example/note.txt",
      },
    ]);

    await Reflect.get(listTaskAttachmentsCommand, "_actionHandler").call(listTaskAttachmentsCommand, ["task_1"]);

    expect(query).toHaveBeenCalledWith(api.tasks.attachments.listTaskAttachmentsByTask, { taskId: "task_1" });
  });

  it("downloads an attachment from the task file list", async () => {
    query.mockResolvedValueOnce([
      {
        _id: "attachment_1",
        _creationTime: 1,
        taskId: "task_1",
        storageId: "storage_1",
        fileName: "note.txt",
        fileSize: 5,
        contentType: "text/plain",
        uploadedBy: "user_1",
        uploadedAt: 1700000000000,
        url: "https://files.example/note.txt",
      },
    ]);
    downloadTaskAttachmentCommand.setOptionValue("output", "/tmp/note.txt");

    await Reflect.get(downloadTaskAttachmentCommand, "_actionHandler").call(downloadTaskAttachmentCommand, ["task_1", "attachment_1"]);

    expect(fetch).toHaveBeenCalledWith("https://files.example/note.txt");
    expect(writeFileMock).toHaveBeenCalledWith("/tmp/note.txt", expect.any(Buffer), { flag: "wx" });
  });

  it("downloads to a safe basename in the current directory by default", async () => {
    query.mockResolvedValueOnce([attachmentNamed("../outside.txt")]);

    await Reflect.get(downloadTaskAttachmentCommand, "_actionHandler").call(downloadTaskAttachmentCommand, ["task_1", "attachment_1"]);

    expect(writeFileMock).toHaveBeenCalledWith(path.resolve(process.cwd(), "outside.txt"), expect.any(Buffer), { flag: "wx" });
  });

  it("refuses to overwrite an existing file unless --force is passed", async () => {
    query.mockResolvedValueOnce([attachmentNamed("note.txt")]);
    writeFileMock.mockRejectedValueOnce(Object.assign(new Error("EEXIST"), { code: "EEXIST" }));

    await expect(
      Reflect.get(downloadTaskAttachmentCommand, "_actionHandler").call(downloadTaskAttachmentCommand, ["task_1", "attachment_1"])
    ).rejects.toThrow("already exists. Pass --force to overwrite it.");
  });

  it("overwrites an existing file with --force", async () => {
    query.mockResolvedValueOnce([attachmentNamed("note.txt")]);
    downloadTaskAttachmentCommand.setOptionValue("force", true);

    await Reflect.get(downloadTaskAttachmentCommand, "_actionHandler").call(downloadTaskAttachmentCommand, ["task_1", "attachment_1"]);

    expect(writeFileMock).toHaveBeenCalledWith(path.resolve(process.cwd(), "note.txt"), expect.any(Buffer), { flag: "w" });
  });

  it("confirms before deleting an attachment", async () => {
    query.mockResolvedValueOnce([
      {
        _id: "attachment_1",
        _creationTime: 1,
        taskId: "task_1",
        storageId: "storage_1",
        fileName: "note.txt",
        fileSize: 5,
        contentType: "text/plain",
        uploadedBy: "user_1",
        uploadedAt: 1700000000000,
        url: "https://files.example/note.txt",
      },
    ]);
    mutation.mockResolvedValueOnce(null);

    await Reflect.get(deleteTaskAttachmentCommand, "_actionHandler").call(deleteTaskAttachmentCommand, ["task_1", "attachment_1"]);

    expect(confirmMock).toHaveBeenCalledWith({
      message: 'Delete attachment "note.txt"?',
      default: false,
    });
    expect(mutation).toHaveBeenCalledWith(api.tasks.attachments.deleteTaskAttachment, { attachmentId: "attachment_1" });
  });

  it("moves an attachment to another task", async () => {
    query.mockResolvedValueOnce([
      {
        _id: "attachment_1",
        _creationTime: 1,
        taskId: "task_1",
        storageId: "storage_1",
        fileName: "note.txt",
        fileSize: 5,
        contentType: "text/plain",
        uploadedBy: "user_1",
        uploadedAt: 1700000000000,
        url: "https://files.example/note.txt",
      },
    ]);
    mutation.mockResolvedValueOnce(null);
    moveTaskAttachmentCommand.setOptionValue("toTask", "task_2");

    await Reflect.get(moveTaskAttachmentCommand, "_actionHandler").call(moveTaskAttachmentCommand, [
      "task_1",
      "attachment_1",
    ]);

    expect(mutation).toHaveBeenCalledWith(api.tasks.attachments.moveTaskAttachment, {
      attachmentId: "attachment_1",
      taskId: "task_2",
    });
  });

  it("fails before mutating when the attachment is not on the source task", async () => {
    query.mockResolvedValueOnce([]);
    moveTaskAttachmentCommand.setOptionValue("toTask", "task_2");

    await expect(
      Reflect.get(moveTaskAttachmentCommand, "_actionHandler").call(moveTaskAttachmentCommand, [
        "task_1",
        "attachment_1",
      ])
    ).rejects.toThrow("Attachment not found on task.");

    expect(mutation).not.toHaveBeenCalled();
  });
});

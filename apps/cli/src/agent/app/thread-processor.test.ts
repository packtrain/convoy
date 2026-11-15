import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { getFunctionName } from "convex/server";
import { api } from "../../convex/_generated/api.js";
import { mkdtempSync, mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createMessageHandler,
  sliceRunMessagesAtSoloRunBoundary,
  type PendingChat,
  type SteerRequestedUserMessage,
  type UnprocessedUserMessage,
} from "./thread-processor.js";
import type {
  CliRuntimeRunner,
  ContentChunk,
  RunnerExecutionResult,
  RunnerExecutionOptions,
} from "../runtimes/contracts.js";
import { RunnerExecutionError } from "../runtimes/contracts.js";
import { runGit } from "../../lib/git/exec.js";
import { resolveExecutionWorkspace } from "../../lib/git/worktrees.js";
import type { ConvoyClient } from "../../lib/config/convex-client.js";

const TEST_ROOT = mkdtempSync(join(tmpdir(), "convoy-thread-tests-"));
mkdirSync(join(TEST_ROOT, "repo"));
mkdirSync(join(TEST_ROOT, "repo-a"));
mkdirSync(join(TEST_ROOT, "repo-b"));
mkdirSync(join(TEST_ROOT, "repo-c"));
mkdirSync(join(TEST_ROOT, "repo-dedupe"));
mkdirSync(join(TEST_ROOT, "repo-deferred"));
mkdirSync(join(TEST_ROOT, "repo-seq-a"));
mkdirSync(join(TEST_ROOT, "repo-seq-b"));
mkdirSync(join(TEST_ROOT, "repo-shutdown-a"));
mkdirSync(join(TEST_ROOT, "repo-shutdown-b"));
afterAll(() => rm(TEST_ROOT, { recursive: true, force: true }));

vi.mock("../../lib/git/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/git/index.js")>();
  return { ...actual, getCurrentBranch: vi.fn().mockResolvedValue("feat/test") };
});

function makePendingChat(overrides: Partial<PendingChat> = {}): PendingChat {
  return {
    _id: "chat_test123" as PendingChat["_id"],
    profileId: "profile_test123" as PendingChat["profileId"],
    cliType: "claude-code",
    pathId: "path_test123",
    workingDirectory: join(TEST_ROOT, "repo"),
    status: "pending",
    processingState: "idle",
    hasPendingUserMessages: true,
    lastActivityAt: 1000,
    ...overrides,
  } as PendingChat;
}

function makeUserMessage(
  overrides: Partial<UnprocessedUserMessage> = {}
): UnprocessedUserMessage {
  return {
    _id: "msg_user_1" as UnprocessedUserMessage["_id"],
    threadId: "chat_test123" as UnprocessedUserMessage["threadId"],
    role: "user",
    profileId: "profile_test123" as UnprocessedUserMessage["profileId"],
    cliType: "claude-code",
    content: [{ type: "text", data: "hello", timestamp: 1000 }],
    attachments: [],
    status: "completed",
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  } as UnprocessedUserMessage;
}

function makeMockClient(): ConvoyClient {
  return {
    query: vi.fn(),
    mutation: vi.fn(),
    subscribe: vi.fn().mockReturnValue(() => {}),
    close: vi.fn().mockResolvedValue(undefined),
    client: {} as ConvoyClient["client"],
  } as unknown as ConvoyClient;
}

/**
 * `api.*` accessors return a fresh proxy per read, so subscriptions are matched
 * by function name rather than reference.
 */
function isSameFunction(fn: unknown, reference: unknown): boolean {
  return getFunctionName(fn as Parameters<typeof getFunctionName>[0]) === getFunctionName(reference as Parameters<typeof getFunctionName>[0]);
}

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = () => {
      res();
    };
  });
  return { promise, resolve };
}

describe("message-handler", () => {
  let mockRunner: CliRuntimeRunner;
  let mockClient: ConvoyClient;
  let mockMutation: ReturnType<typeof vi.fn>;
  let mockQuery: ReturnType<typeof vi.fn>;
  const sessionId = "session_test123";
  const attachmentCacheDirs: string[] = [];

  function setQueryResponses(params: {
    pendingRuns?: UnprocessedUserMessage[][];
    continuationIds?: Array<string | null | { continuationId: string; forkTurnId?: string }>;
  }): void {
    const sequence: Array<{ kind: "pending" | "continuation"; value: unknown }> = [];
    const pendingRuns = [...(params.pendingRuns ?? [])];
    const continuationIds = [...(params.continuationIds ?? [])];
    let continuationIndex = 0;

    for (const run of pendingRuns) {
      sequence.push({ kind: "pending", value: run });
      if (run.length > 0 && continuationIndex < continuationIds.length) {
        const handle = continuationIds[continuationIndex];
        sequence.push({
          kind: "continuation",
          value: typeof handle === "string" ? { continuationId: handle } : handle,
        });
        continuationIndex += 1;
      }
    }

    mockQuery.mockImplementation(async (_fn, args) => {
      if (args && "threadId" in args && "sessionId" in args) {
        return true;
      }

      const next = sequence.shift();
      if (!next) {
        return [];
      }
      return next.value;
    });
  }

  function setPerThreadQueryResponses(
    pendingByThread: Map<string, UnprocessedUserMessage[]>
  ): void {
    const threadQueryStage = new Map<string, number>();
    mockQuery.mockImplementation(async (_fn, args) => {
      if (args && "threadId" in args && "sessionId" in args) {
        return true;
      }
      if (!args || !("threadId" in args)) {
        return [];
      }

      const threadId = (args as { threadId: string }).threadId;
      const stage = threadQueryStage.get(threadId) ?? 0;
      const pending = pendingByThread.get(threadId) ?? [];

      if (stage === 0) {
        threadQueryStage.set(threadId, pending.length > 0 ? 1 : 2);
        pendingByThread.set(threadId, []);
        return pending;
      }

      if (stage === 1) {
        threadQueryStage.set(threadId, 2);
        return null;
      }

      return [];
    });
  }

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    const testChunks: ContentChunk[] = [{ type: "assistant", data: "chunk-1" }];

    mockRunner = {
      execute: vi.fn().mockImplementation(async function* () {
        for (const chunk of testChunks) {
          yield chunk;
        }
        return { continuationId: "session-new" } satisfies RunnerExecutionResult;
      }),
      abort: vi.fn(),
      shutdown: vi.fn().mockResolvedValue(undefined),
    };

    mockClient = makeMockClient();
    mockMutation = mockClient.mutation as ReturnType<typeof vi.fn>;
    mockQuery = mockClient.query as ReturnType<typeof vi.fn>;

    mockMutation.mockImplementation(async (_fn, args) => {
      if ("leaseMs" in args && "threadId" in args && "sessionId" in args) {
        return true;
      }
      if ("userMessageIds" in args) {
        return {
          assistantMessageId: "msg_assistant_1",
          runId: "run_1",
        };
      }
      return null;
    });

    setQueryResponses({ pendingRuns: [[]] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  afterEach(async () => {
    await Promise.all(
      attachmentCacheDirs.map(async (dir) => {
        await rm(dir, { recursive: true, force: true });
      })
    );
    attachmentCacheDirs.length = 0;
  });

  it.each(["before-run", "during-launch", "after-output", "silent-runtime-error"])("handles worktree deletion %s without replaying executed work", async (when) => {
    const parentPath = mkdtempSync(join(tmpdir(), "convoy-recovery-"));
    attachmentCacheDirs.push(parentPath);
    await runGit(parentPath, ["init", "-b", "main"]);
    await runGit(parentPath, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "initial"]);
    const worktreePath = join(parentPath, "checkout");
    await runGit(parentPath, ["worktree", "add", "-b", "feat/test", worktreePath]);
    if (when === "before-run") await runGit(parentPath, ["worktree", "remove", worktreePath]);
    if (when !== "before-run") {
      vi.mocked(mockRunner.execute).mockImplementationOnce(async function* () {
        if (when === "after-output") yield { type: "assistant", data: "Already started work" };
        await runGit(parentPath, ["worktree", "remove", worktreePath]);
        throw new RunnerExecutionError("Runtime failed", { launchFailed: when !== "silent-runtime-error" });
      });
    }
    const chat = makePendingChat({ workingDirectory: worktreePath, worktree: {
      parentPathId: "parent", parentPath, branch: "feat/test", status: "created",
    } });
    setQueryResponses({ pendingRuns: [[makeUserMessage()], []], continuationIds: ["session-prev"] });
    const mutate = mockMutation.getMockImplementation()!;
    mockMutation.mockImplementation(async (fn, args) => {
      const result = await Reflect.apply(mutate, undefined, [fn, args]);
      return getFunctionName(fn) === "cli/messages:startRunResponse"
        ? { ...result, workspace: { pathId: chat.pathId, path: worktreePath, worktree: chat.worktree } }
        : result;
    });
    const query = mockQuery.getMockImplementation()!;
    mockQuery.mockImplementation((fn, args) => getFunctionName(fn) === "cli/worktrees:getExecutionWorkspace"
      ? { pathId: chat.pathId, path: worktreePath, worktree: chat.worktree }
      : Reflect.apply(query, undefined, [fn, args]));
    const handler = createMessageHandler(() => mockRunner, mockClient, sessionId);
    handler.enqueueChat(chat);
    try {
      await vi.waitFor(() => expect(handler.isProcessing()).toBe(false), { timeout: 5000 });
      expect(mockQuery.mock.calls.filter(([fn]) => getFunctionName(fn) === "cli/worktrees:getExecutionWorkspace"))
        .toHaveLength(when === "during-launch" ? 1 : 0);
      if (when === "after-output" || when === "silent-runtime-error") {
        expect(mockRunner.execute).toHaveBeenCalledTimes(1);
        expect(mockRunner.execute).toHaveBeenCalledWith(worktreePath, expect.any(String), expect.anything());
        return;
      }
      expect(mockRunner.execute).toHaveBeenCalledWith(parentPath, expect.any(String), expect.objectContaining({
        continuationId: "session-prev", requireContinuation: true,
      }));
      expect(mockMutation.mock.calls.some(([fn, args]) => getFunctionName(fn) === "cli/worktrees:resolveExecutionWorkspace" && args.path === parentPath)).toBe(true);
      expect(mockRunner.execute).toHaveBeenCalledTimes(when === "before-run" ? 1 : 2);
    } finally {
      await handler.shutdown();
    }
  });

  it.each(["created", "pending"] as const)("uses the canonical run-start workspace over a %s snapshot without a separate query", async (status) => {
    const parent = mkdtempSync(join(tmpdir(), "convoy-dispatch-workspace-"));
    attachmentCacheDirs.push(parent);
    await runGit(parent, ["init", "-b", "main"]);
    await runGit(parent, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "initial"]);
    const checkout = join(parent, "checkout");
    await runGit(parent, ["worktree", "add", "-b", "feat/test", checkout]);
    const spec = { parentPathId: "parent", parentPath: parent, branch: "feat/test", status: "created" as const };
    const identity = await resolveExecutionWorkspace(checkout, spec);
    const worktree = { ...spec, repositoryId: identity.repositoryId, worktreeId: identity.worktreeId };
    const chat = makePendingChat({ workingDirectory: status === "pending" ? parent : checkout, worktree: { ...worktree, status } });
    setQueryResponses({ pendingRuns: [[makeUserMessage()], []], continuationIds: ["session"] });
    const mutate = mockMutation.getMockImplementation()!;
    mockMutation.mockImplementation(async (fn, args) => {
      const result = await Reflect.apply(mutate, undefined, [fn, args]);
      return getFunctionName(fn) === "cli/messages:startRunResponse"
        ? { ...result, workspace: { pathId: chat.pathId, path: checkout, worktree } }
        : result;
    });
    const query = mockQuery.getMockImplementation()!;
    mockQuery.mockImplementation((fn, args) => getFunctionName(fn) === "cli/worktrees:getExecutionWorkspace"
      ? { pathId: chat.pathId, path: checkout, worktree }
      : Reflect.apply(query, undefined, [fn, args]));
    const handler = createMessageHandler(() => mockRunner, mockClient, sessionId);
    handler.enqueueChat(chat);
    try {
      await vi.waitFor(() => expect(handler.isProcessing()).toBe(false), { timeout: 5000 });
      expect(mockRunner.execute).toHaveBeenCalledWith(checkout, expect.any(String), expect.anything());
      expect(mockQuery.mock.calls.filter(([fn]) => getFunctionName(fn) === "cli/worktrees:getExecutionWorkspace"))
        .toHaveLength(0);
      expect(mockMutation.mock.calls.filter(([fn]) => getFunctionName(fn).startsWith("cli/worktrees:")))
        .toHaveLength(0);
    } finally {
      await handler.shutdown();
    }
  });

  it.each(["claude-code", "codex"])("preserves interrupted %s input without consuming it", async (cliType) => {
    const history = makeUserMessage({ _id: "old-message" as UnprocessedUserMessage["_id"],
      content: [{ type: "text", data: "Use only one pill", timestamp: 1000 }],
      contextOnly: true });
    const followUp = makeUserMessage({ _id: "new-message" as UnprocessedUserMessage["_id"], createdAt: 2000,
      content: [{ type: "text", data: "What about this screenshot?", timestamp: 2000 }] });
    setQueryResponses({ pendingRuns: [[history, followUp], []], continuationIds: ["session-prev"] });
    const handler = createMessageHandler(() => mockRunner, mockClient, sessionId);
    handler.enqueueChat(makePendingChat({ cliType }));
    await vi.waitFor(() => expect(handler.isProcessing()).toBe(false));
    const prompt = vi.mocked(mockRunner.execute).mock.calls[0]?.[1];
    expect(prompt).toContain("Interrupted conversation history");
    expect(prompt).toContain("Use only one pill");
    expect(prompt).toContain("What about this screenshot?");
    const start = mockMutation.mock.calls.find(([fn]) => getFunctionName(fn) === "cli/messages:startRunResponse");
    expect(start?.[1].userMessageIds).toEqual([followUp._id]);
    await handler.shutdown();
  });

  it.each(["claude-code", "codex"])("keeps stopped text in the %s screenshot-only follow-up", async (cliType) => {
    const cacheDir = mkdtempSync(join(tmpdir(), "convoy-history-attachments-"));
    attachmentCacheDirs.push(cacheDir);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("image-bytes", { status: 200 })));
    const history = makeUserMessage({ contextOnly: true, _id: "stopped" as UnprocessedUserMessage["_id"],
      content: [{ type: "text", data: "Use only one pill", timestamp: 1000 }],
      attachments: [{ storageId: "old-image", fileName: "before.png", contentType: "image/png", fileSize: 10,
        uploadedAt: 1000, url: "https://example.test/before.png" }] });
    const followUp = makeUserMessage({ content: [], _id: "screenshot" as UnprocessedUserMessage["_id"],
      attachments: [{ storageId: "new-image", fileName: "after.png", contentType: "image/png", fileSize: 10,
        uploadedAt: 2000, url: "https://example.test/after.png" }] });
    setQueryResponses({ pendingRuns: [[history, followUp], []], continuationIds: ["existing-session"] });
    const handler = createMessageHandler(() => mockRunner, mockClient, sessionId, { attachmentCacheDir: cacheDir });
    handler.enqueueChat(makePendingChat({ cliType }));
    await vi.waitFor(() => expect(handler.isProcessing()).toBe(false));
    const call = vi.mocked(mockRunner.execute).mock.calls[0];
    expect(call[1]).toContain("Use only one pill");
    expect(call[1]).toContain("Interrupted conversation history");
    if (cliType === "claude-code") {
      const serialized = JSON.stringify(call[2].bootstrapInput);
      expect(serialized).toContain("Use only one pill");
      expect(serialized).toContain("Interrupted conversation history");
      expect(serialized.match(/"type":"image"/g)).toHaveLength(2);
    } else {
      expect(call[1]).toContain("before.png");
      expect(call[1]).toContain("after.png");
    }
    await handler.shutdown();
  });

  it.each(["claude-code", "codex"])("defers interrupted history across a %s runtime command", async (cliType) => {
    const history = makeUserMessage({ _id: "old" as UnprocessedUserMessage["_id"], contextOnly: true,
      runtimeCommand: true, content: [{ type: "text", data: "/old-command", timestamp: 1000 }] });
    const command = makeUserMessage({ runtimeCommand: true, content: [{ type: "text", data: "/compact", timestamp: 2000 }] });
    const next = makeUserMessage({ content: [{ type: "text", data: "Continue the conversation", timestamp: 3000 }] });
    setQueryResponses({ pendingRuns: [[history, command, next], [history, next], []], continuationIds: ["previous", "after-command"] });
    const handler = createMessageHandler(() => mockRunner, mockClient, sessionId);
    handler.enqueueChat(makePendingChat({ cliType }));
    await vi.waitFor(() => expect(handler.isProcessing()).toBe(false));
    const calls = vi.mocked(mockRunner.execute).mock.calls;
    expect(calls[0][1]).toBe("/compact");
    expect(calls[1][1]).toContain("Interrupted conversation history");
    expect(calls[1][1]).toContain("/old-command");
    expect(calls[1][2].runtimeCommand).toBeUndefined();
    const complete = mockMutation.mock.calls.filter(([fn]) => getFunctionName(fn) === "cli/messages:complete");
    expect(complete[0][1].cliContext.interruptedContextIncluded).toBeUndefined();
    expect(complete[1][1].cliContext.interruptedContextIncluded).toBe(true);
    await handler.shutdown();
  });

  it("refreshes the workspace once after creating a pending worktree", async () => {
    const root = mkdtempSync(join(tmpdir(), "convoy-create-workspace-"));
    attachmentCacheDirs.push(root);
    const parent = join(root, "repo");
    mkdirSync(parent);
    await runGit(parent, ["init", "-b", "main"]);
    await runGit(parent, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "initial"]);
    const chat = makePendingChat({ workingDirectory: parent, worktree: {
      parentPathId: "parent", parentPath: parent, branch: "feat/test", status: "pending",
    } });
    let workspace = { pathId: chat.pathId, path: parent, worktree: chat.worktree };
    setQueryResponses({ pendingRuns: [[makeUserMessage()], []], continuationIds: [null] });
    const mutate = mockMutation.getMockImplementation()!;
    mockMutation.mockImplementation(async (fn, args) => {
      const result = await Reflect.apply(mutate, undefined, [fn, args]);
      if (getFunctionName(fn) === "cli/messages:startRunResponse") return { ...result, workspace };
      if (getFunctionName(fn) === "cli/worktrees:resolveCreated") {
        workspace = { ...workspace, path: args.path, worktree: { ...chat.worktree!, status: "created" } };
      }
      return result;
    });
    const query = mockQuery.getMockImplementation()!;
    mockQuery.mockImplementation((fn, args) => getFunctionName(fn) === "cli/worktrees:getExecutionWorkspace"
      ? workspace : Reflect.apply(query, undefined, [fn, args]));
    const handler = createMessageHandler(() => mockRunner, mockClient, sessionId);
    handler.enqueueChat(chat);
    try {
      await vi.waitFor(() => expect(handler.isProcessing()).toBe(false), { timeout: 5000 });
      expect(mockRunner.execute).toHaveBeenCalledWith(join(root, "repo-worktrees", "feat-test"), expect.any(String), expect.anything());
      expect(mockQuery.mock.calls.filter(([fn]) => getFunctionName(fn) === "cli/worktrees:getExecutionWorkspace"))
        .toHaveLength(1);
    } finally {
      await handler.shutdown();
    }
  });

  it("defers recovery context for commands, delivers it once, and acknowledges completion", async () => {
    const chat = makePendingChat({ previousWorkingDirectory: "/removed" });
    setQueryResponses({ pendingRuns: [
      [makeUserMessage({ runtimeCommand: true, content: [{ type: "text", data: "/compact", timestamp: 1000 }] })],
      [makeUserMessage()], [makeUserMessage()], [],
    ], continuationIds: ["session", "session", "session"] });
    const handler = createMessageHandler(() => mockRunner, mockClient, sessionId);
    handler.enqueueChat(chat);
    try {
      await vi.waitFor(() => expect(handler.isProcessing()).toBe(false));
      const runs = vi.mocked(mockRunner.execute).mock.calls;
      expect(runs).toHaveLength(3);
      expect(runs[0][2].workspaceNotice).toBeUndefined();
      expect(runs[1][2].workspaceNotice).toContain("/removed");
      expect(runs[2][2].workspaceNotice).toBeUndefined();
      const completions = mockMutation.mock.calls.filter(([fn]) => getFunctionName(fn) === "cli/messages:complete");
      expect(completions.map(([, args]) => args.workspaceNotice)).toEqual([
        undefined, { previousPath: "/removed", path: chat.workingDirectory }, undefined,
      ]);
    } finally {
      await handler.shutdown();
    }
  });

  it("names this run's reply and session in the attach command, resumed runs included, but not for runtime commands (OS-2091)", async () => {
    setQueryResponses({ pendingRuns: [
      [makeUserMessage({ runtimeCommand: true, content: [{ type: "text", data: "/compact", timestamp: 1000 }] })],
      [makeUserMessage()], [],
    ], continuationIds: ["session", "session"] });
    const handler = createMessageHandler(() => mockRunner, mockClient, sessionId);
    handler.enqueueChat(makePendingChat());
    try {
      await vi.waitFor(() => expect(handler.isProcessing()).toBe(false));
      const runs = vi.mocked(mockRunner.execute).mock.calls;
      expect(runs).toHaveLength(2);
      expect(runs[0][1]).toBe("/compact");
      expect(runs[1][1]).toContain(`convoy threads attach chat_test123 <file...> --message-id msg_assistant_1 --session-id ${sessionId}`);
    } finally {
      await handler.shutdown();
    }
  });

  it("reports a missing parent before attempting pending worktree creation", async () => {
    const chat = makePendingChat({ workingDirectory: join(TEST_ROOT, "missing"), worktree: {
      parentPathId: "parent", branch: "new-feature", status: "pending",
    } });
    setQueryResponses({ pendingRuns: [[makeUserMessage()], []], continuationIds: [null] });
    const query = mockQuery.getMockImplementation()!;
    mockQuery.mockImplementation((fn, args) => getFunctionName(fn) === "cli/worktrees:getExecutionWorkspace"
      ? { pathId: chat.pathId, path: chat.workingDirectory, worktree: chat.worktree }
      : Reflect.apply(query, undefined, [fn, args]));
    const handler = createMessageHandler(() => mockRunner, mockClient, sessionId);
    handler.enqueueChat(chat);
    try {
      await vi.waitFor(() => expect(handler.isProcessing()).toBe(false));
      expect(mockRunner.execute).not.toHaveBeenCalled();
      const failure = mockMutation.mock.calls.find(([, args]) => "errorMessage" in args);
      expect(failure?.[1].errorMessage).toContain(`Working directory no longer exists: ${chat.workingDirectory}`);
    } finally {
      await handler.shutdown();
    }
  });

  it("processes a pending chat with all unprocessed user messages in one run", async () => {
    const msg1 = makeUserMessage({
      _id: "msg_user_1" as UnprocessedUserMessage["_id"],
      content: [{ type: "text", data: "first", timestamp: 1000 }],
      createdAt: 1000,
    });
    const msg2 = makeUserMessage({
      _id: "msg_user_2" as UnprocessedUserMessage["_id"],
      content: [{ type: "text", data: "second", timestamp: 2000 }],
      createdAt: 2000,
    });

    setQueryResponses({
      pendingRuns: [[msg1, msg2], []],
      continuationIds: ["session-prev"],
    });

    mockMutation.mockImplementation(async (_fn, args) => {
      if ("leaseMs" in args && "threadId" in args && "sessionId" in args) {
        return true;
      }
      if ("userMessageIds" in args) {
        return {
          assistantMessageId: "msg_assistant_1",
          runId: "run_1",
          resolvedCliModel: "claude-opus-4-6",
        };
      }
      return null;
    });

    const handler = createMessageHandler(() => mockRunner, mockClient, sessionId);
    handler.enqueueChat(makePendingChat());

    await vi.waitFor(() => {
      expect(mockMutation).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          userMessageIds: [msg1._id, msg2._id],
        })
      );
    });

    await vi.waitFor(() => {
      expect(mockMutation).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          messageId: "msg_assistant_1",
          sessionId,
          cliContext: { continuationId: "session-new", interruptedContextIncluded: true },
        })
      );
    });

    expect(mockRunner.execute).toHaveBeenCalledTimes(1);
    expect(mockRunner.execute).toHaveBeenCalledWith(
      join(TEST_ROOT, "repo"),
      expect.stringContaining("first"),
      expect.objectContaining({
        cliType: "claude-code",
        continuationId: "session-prev",
        requireContinuation: true,
      })
    );
    expect(mockRunner.execute).toHaveBeenCalledWith(
      join(TEST_ROOT, "repo"),
      expect.stringContaining("second"),
      expect.objectContaining({ cliType: "claude-code" })
    );

    expect(mockMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ threadId: "chat_test123", sessionId })
    );
  });

  it("looks up continuation before starting the next assistant run", async () => {
    const msg1 = makeUserMessage();
    let runStarted = false;
    let nonSessionThreadQueryCount = 0;

    mockQuery.mockImplementation(async (_fn, args) => {
      if (args && "threadId" in args && "sessionId" in args) {
        return true;
      }

      nonSessionThreadQueryCount += 1;
      if (nonSessionThreadQueryCount === 1) {
        return [msg1];
      }
      if (nonSessionThreadQueryCount === 2) {
        return runStarted ? null : { continuationId: "session-prev" };
      }
      return [];
    });

    mockMutation.mockImplementation(async (_fn, args) => {
      if ("leaseMs" in args && "threadId" in args && "sessionId" in args) {
        return true;
      }
      if ("userMessageIds" in args) {
        runStarted = true;
        return {
          assistantMessageId: "msg_assistant_1",
          runId: "run_1",
        };
      }
      return null;
    });

    const handler = createMessageHandler(() => mockRunner, mockClient, sessionId);
    handler.enqueueChat(makePendingChat());

    await vi.waitFor(() => {
      expect(mockRunner.execute).toHaveBeenCalledWith(
        join(TEST_ROOT, "repo"),
        expect.any(String),
        expect.objectContaining({
          continuationId: "session-prev",
          requireContinuation: true,
        })
      );
    });
  });

  it("reports the execution branch snapshot when a run starts (OS-1247)", async () => {
    const msg1 = makeUserMessage();
    setQueryResponses({ pendingRuns: [[msg1], []], continuationIds: [null] });

    const handler = createMessageHandler(() => mockRunner, mockClient, sessionId);
    handler.enqueueChat(makePendingChat());

    await vi.waitFor(() => {
      expect(mockMutation).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          threadId: "chat_test123",
          sessionId,
          branch: "feat/test",
        })
      );
    });
  });

  it("skips a chat when claim fails", async () => {
    mockMutation.mockImplementationOnce(async () => false);

    const handler = createMessageHandler(() => mockRunner, mockClient, sessionId);
    handler.enqueueChat(makePendingChat());

    await vi.waitFor(() => {
      expect(mockMutation).toHaveBeenCalledTimes(1);
    });

    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockRunner.execute).not.toHaveBeenCalled();
  });

  it("processes new user messages arriving during generation in the next loop iteration", async () => {
    const msg1 = makeUserMessage({ _id: "msg_user_1" as UnprocessedUserMessage["_id"] });
    const msg2 = makeUserMessage({ _id: "msg_user_2" as UnprocessedUserMessage["_id"] });

    setQueryResponses({
      pendingRuns: [[msg1], [msg2], []],
      continuationIds: [null, "session-1"],
    });

    let runCounter = 0;
    mockMutation.mockImplementation(async (_fn, args) => {
      if ("leaseMs" in args && "threadId" in args && "sessionId" in args) {
        return true;
      }
      if ("userMessageIds" in args) {
        runCounter += 1;
        return {
          assistantMessageId: `msg_assistant_${runCounter}`,
          runId: `run_${runCounter}`,
        };
      }
      return null;
    });

    const handler = createMessageHandler(() => mockRunner, mockClient, sessionId);
    handler.enqueueChat(makePendingChat());

    await vi.waitFor(() => {
      expect(mockRunner.execute).toHaveBeenCalledTimes(2);
    });

    const startRunCalls = mockMutation.mock.calls.filter(
      ([, args]) => args && "userMessageIds" in args
    );
    expect(startRunCalls).toHaveLength(2);
  });

  it("marks failed run and continues with later pending messages", async () => {
    const msg1 = makeUserMessage({ _id: "msg_user_1" as UnprocessedUserMessage["_id"] });
    const msg2 = makeUserMessage({ _id: "msg_user_2" as UnprocessedUserMessage["_id"] });

    setQueryResponses({
      pendingRuns: [[msg1], [msg2], []],
      continuationIds: [null, null],
    });

    let executeCall = 0;
    (mockRunner.execute as ReturnType<typeof vi.fn>).mockImplementation(
      async function* () {
        executeCall += 1;
        if (executeCall === 1) {
          throw new Error("runner boom");
        }
        yield { type: "assistant", data: "ok" };
        return { continuationId: "session-after-retry" };
      }
    );

    let runCounter = 0;
    mockMutation.mockImplementation(async (_fn, args) => {
      if ("leaseMs" in args && "threadId" in args && "sessionId" in args) {
        return true;
      }
      if ("userMessageIds" in args) {
        runCounter += 1;
        return {
          assistantMessageId: `msg_assistant_${runCounter}`,
          runId: `run_${runCounter}`,
        };
      }
      return null;
    });

    const handler = createMessageHandler(() => mockRunner, mockClient, sessionId);
    handler.enqueueChat(makePendingChat());

    await vi.waitFor(() => {
      expect(mockRunner.execute).toHaveBeenCalledTimes(2);
    });

    expect(mockMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        messageId: "msg_assistant_1",
        errorMessage: "runner boom",
      })
    );

    expect(mockMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        messageId: "msg_assistant_2",
        sessionId,
        cliContext: { continuationId: "session-after-retry", interruptedContextIncluded: true },
      })
    );
  });

  it("marks run as failed when runner rejects missing continuation id", async () => {
    const msg1 = makeUserMessage();
    setQueryResponses({
      pendingRuns: [[msg1], []],
      continuationIds: ["session-prev"],
    });

    (mockRunner.execute as ReturnType<typeof vi.fn>).mockImplementation(
      // eslint-disable-next-line require-yield
      async function* (_workingDirectory, _prompt, options) {
        if (options.requireContinuation) {
          throw new Error(
            "Claude run completed without session_id/sessionId in stream-json output"
          );
        }
        return {} satisfies RunnerExecutionResult;
      }
    );

    const handler = createMessageHandler(() => mockRunner, mockClient, sessionId);
    handler.enqueueChat(makePendingChat());

    await vi.waitFor(() => {
      expect(mockMutation).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          messageId: "msg_assistant_1",
          errorMessage: "Claude run completed without session_id/sessionId in stream-json output",
        })
      );
    });
  });

  it("persists the observed continuation when the runner fails after starting", async () => {
    const msg1 = makeUserMessage();
    setQueryResponses({
      pendingRuns: [[msg1], []],
      continuationIds: ["session-prev"],
    });

    (mockRunner.execute as ReturnType<typeof vi.fn>).mockImplementation(
      async function* () {
        // TypeScript needs at least one yield to keep this typed as an async generator.
        // eslint-disable-next-line no-constant-condition
        if (false) {
          yield { type: "assistant", data: "unreachable" };
        }
        throw new RunnerExecutionError("runner boom", {
          continuationId: "session-failed",
          turnId: "turn-9",
        });
      }
    );

    const handler = createMessageHandler(() => mockRunner, mockClient, sessionId);
    handler.enqueueChat(makePendingChat());

    await vi.waitFor(() => {
      expect(mockMutation).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          messageId: "msg_assistant_1",
          errorMessage: "runner boom",
          cliContext: { continuationId: "session-failed", turnId: "turn-9" },
        })
      );
    });
  });

  it("branches a Codex fork through the recorded turn and stores the new turn id (OS-2073)", async () => {
    setQueryResponses({
      pendingRuns: [[makeUserMessage()], []],
      continuationIds: [{ continuationId: "t-parent", forkTurnId: "turn-7" }],
    });
    (mockRunner.execute as ReturnType<typeof vi.fn>).mockImplementation(async function* () {
      yield { type: "assistant", data: "chunk-1" };
      return { continuationId: "t-fork", turnId: "turn-1" } satisfies RunnerExecutionResult;
    });

    const handler = createMessageHandler(() => mockRunner, mockClient, sessionId);
    handler.enqueueChat(makePendingChat({ cliType: "codex" }));

    const completeCall = () => mockMutation.mock.calls.find(([fn]) => getFunctionName(fn) === "cli/messages:complete");
    await vi.waitFor(() => expect(completeCall()).toBeDefined());
    expect(completeCall()![1].cliContext).toMatchObject({ continuationId: "t-fork", turnId: "turn-1" });
    expect(mockRunner.execute).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ continuationId: "t-parent", forkTurnId: "turn-7", requireContinuation: true })
    );
  });

  it("routes a script request to the script runner and completes with its result (OS-1886)", async () => {
    const script = makeUserMessage({ scriptRequest: { script: "pnpm lint", timeoutMs: 60_000 } });
    setQueryResponses({ pendingRuns: [[script], []], continuationIds: [null] });
    const scriptRunner: CliRuntimeRunner = {
      execute: vi.fn().mockImplementation(async function* () {
        yield { type: "convoy_script_output", data: "ok\n" };
        return { scriptResult: { exitCode: 0, timedOut: false, outputTail: "ok\n" } } satisfies RunnerExecutionResult;
      }),
      abort: vi.fn(),
      shutdown: vi.fn().mockResolvedValue(undefined),
    };

    const handler = createMessageHandler(() => mockRunner, mockClient, sessionId, { createScriptRunner: () => scriptRunner });
    handler.enqueueChat(makePendingChat());

    await vi.waitFor(() => {
      expect(mockMutation).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ messageId: "msg_assistant_1", scriptResult: { exitCode: 0, timedOut: false, outputTail: "ok\n" } })
      );
    });
    expect(scriptRunner.execute).toHaveBeenCalledWith(
      join(TEST_ROOT, "repo"),
      "pnpm lint",
      expect.objectContaining({ scriptRequest: { script: "pnpm lint", timeoutMs: 60_000 } })
    );
    expect(mockRunner.execute).not.toHaveBeenCalled();
  });

  it("creates a script runner per script run and shuts it down afterwards (OS-1886)", async () => {
    const first = makeUserMessage({ _id: "msg_1" as UnprocessedUserMessage["_id"], scriptRequest: { script: "pnpm lint", timeoutMs: 60_000 } });
    const second = makeUserMessage({ _id: "msg_2" as UnprocessedUserMessage["_id"], scriptRequest: { script: "pnpm test", timeoutMs: 60_000 } });
    setQueryResponses({ pendingRuns: [[first], [second], []], continuationIds: [null, null] });
    const runners: CliRuntimeRunner[] = [];
    const createScriptRunner = vi.fn(() => {
      const runner: CliRuntimeRunner = {
        execute: vi.fn().mockImplementation(async function* () {
          yield { type: "convoy_script_output", data: "ok\n" };
          return { scriptResult: { exitCode: 0, timedOut: false, outputTail: "ok\n" } } satisfies RunnerExecutionResult;
        }),
        abort: vi.fn(),
        shutdown: vi.fn().mockResolvedValue(undefined),
      };
      runners.push(runner);
      return runner;
    });

    const handler = createMessageHandler(() => mockRunner, mockClient, sessionId, { createScriptRunner });
    handler.enqueueChat(makePendingChat());

    await vi.waitFor(() => {
      const released = mockMutation.mock.calls.some(
        ([fn]) => getFunctionName(fn) === getFunctionName(api.cli.threads.runControl.releaseClaim)
      );
      expect(released).toBe(true);
    });
    expect(createScriptRunner).toHaveBeenCalledTimes(2);
    for (const runner of runners) {
      expect(runner.execute).toHaveBeenCalledTimes(1);
      expect(runner.shutdown).toHaveBeenCalledTimes(1);
    }
  });

  it("fails an undetected project runtime and releases its claim without breaking dispatch", async () => {
    const { createRunnerForCliType } = await import("../runtimes/registry.js");
    vi.stubEnv("CONVOY_PROJECT_IDENTITY", "a".repeat(64));
    vi.stubEnv("CONVOY_PROJECT_RUNTIMES", "codex");
    try {
      setQueryResponses({ pendingRuns: [[makeUserMessage()], []] });
      const handler = createMessageHandler((type) => createRunnerForCliType(type, {}), mockClient, sessionId);
      expect(() => handler.enqueueChat(makePendingChat())).not.toThrow();
      await vi.waitFor(() => expect(mockMutation).toHaveBeenCalledWith(api.cli.messages.fail,
        expect.objectContaining({ errorMessage: expect.stringContaining("is not available in this project") })));
      await vi.waitFor(() => expect(mockMutation).toHaveBeenCalledWith(api.cli.threads.runControl.releaseClaim, expect.anything()));
    } finally { vi.unstubAllEnvs(); }
  });

  it("fails unsupported cli types deterministically", async () => {
    const msg1 = makeUserMessage();
    setQueryResponses({
      pendingRuns: [[msg1], []],
    });

    const handler = createMessageHandler(() => null, mockClient, sessionId);
    handler.enqueueChat(makePendingChat({ cliType: "codex" }));

    await vi.waitFor(() => {
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Unsupported cliType "codex" in this CLI build.')
      );
    });

    expect(mockMutation).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userMessageIds: expect.anything() })
    );
    expect(mockRunner.execute).not.toHaveBeenCalled();
  });

  it("sends claim heartbeats during long streaming runs", async () => {
    const dateNowSpy = vi.spyOn(Date, "now");
    let now = 0;
    dateNowSpy.mockImplementation(() => {
      now += 31_000;
      return now;
    });

    const msg1 = makeUserMessage();
    setQueryResponses({
      pendingRuns: [[msg1], []],
      continuationIds: [null],
    });

    (mockRunner.execute as ReturnType<typeof vi.fn>).mockImplementation(
      async function* () {
        yield { type: "assistant", data: "chunk-1" };
        yield { type: "assistant", data: "chunk-2" };
        return { continuationId: "session-heartbeat" } satisfies RunnerExecutionResult;
      }
    );

    const handler = createMessageHandler(() => mockRunner, mockClient, sessionId);
    handler.enqueueChat(makePendingChat());

    await vi.waitFor(() => {
      const heartbeatCalls = mockMutation.mock.calls.filter(
        ([, args]) =>
          args && "leaseMs" in args && "threadId" in args && "sessionId" in args
      );
      expect(heartbeatCalls.length).toBeGreaterThanOrEqual(3);
    });
  });

  it("passes plan cliMode from the latest user message to runner execution", async () => {
    const msg1 = makeUserMessage({
      _id: "msg_user_1" as UnprocessedUserMessage["_id"],
      cliMode: "agent",
      createdAt: 1000,
    });
    const msg2 = makeUserMessage({
      _id: "msg_user_2" as UnprocessedUserMessage["_id"],
      cliMode: "plan",
      createdAt: 2000,
    });
    setQueryResponses({
      pendingRuns: [[msg1, msg2], []],
      continuationIds: ["session-prev"],
    });

    const handler = createMessageHandler(() => mockRunner, mockClient, sessionId);
    handler.enqueueChat(makePendingChat());

    await vi.waitFor(() => {
      expect(mockRunner.execute).toHaveBeenCalledWith(
        join(TEST_ROOT, "repo"),
        expect.any(String),
        expect.objectContaining({
          cliType: "claude-code",
          continuationId: "session-prev",
          cliMode: "plan",
        })
      );
    });
  });

  it("passes the thread's agent prompt snapshot and agent name to runner execution", async () => {
    setQueryResponses({
      pendingRuns: [[makeUserMessage()], []],
      continuationIds: [null],
    });

    const handler = createMessageHandler(() => mockRunner, mockClient, sessionId);
    handler.enqueueChat(
      makePendingChat({
        agentName: "Reviewer",
        agentPromptSnapshot: "You are a meticulous reviewer.",
      })
    );

    await vi.waitFor(() => {
      expect(mockRunner.execute).toHaveBeenCalledWith(
        join(TEST_ROOT, "repo"),
        expect.any(String),
        expect.objectContaining({
          agentPrompt: "You are a meticulous reviewer.",
          agentName: "Reviewer",
        })
      );
    });
  });

  it("passes no agent prompt for unbound threads", async () => {
    setQueryResponses({
      pendingRuns: [[makeUserMessage()], []],
      continuationIds: [null],
    });

    const handler = createMessageHandler(() => mockRunner, mockClient, sessionId);
    handler.enqueueChat(makePendingChat());

    await vi.waitFor(() => {
      expect(mockRunner.execute).toHaveBeenCalledWith(
        join(TEST_ROOT, "repo"),
        expect.any(String),
        expect.objectContaining({
          agentPrompt: undefined,
          agentName: undefined,
        })
      );
    });
  });

  it("passes the latest Claude model from user messages to runner execution", async () => {
    const msg1 = makeUserMessage({
      _id: "msg_user_1" as UnprocessedUserMessage["_id"],
      cliModel: "sonnet",
      createdAt: 1000,
    });
    const msg2 = makeUserMessage({
      _id: "msg_user_2" as UnprocessedUserMessage["_id"],
      cliModel: "opus",
      createdAt: 2000,
    });
    setQueryResponses({
      pendingRuns: [[msg1, msg2], []],
      continuationIds: ["session-prev"],
    });

    mockMutation.mockImplementation(async (_fn, args) => {
      if ("leaseMs" in args && "threadId" in args && "sessionId" in args) {
        return true;
      }
      if ("userMessageIds" in args) {
        return {
          assistantMessageId: "msg_assistant_1",
          runId: "run_1",
          resolvedCliModel: "claude-opus-4-6",
        };
      }
      return null;
    });

    const handler = createMessageHandler(() => mockRunner, mockClient, sessionId);
    handler.enqueueChat(makePendingChat());

    await vi.waitFor(() => {
      expect(mockRunner.execute).toHaveBeenCalledWith(
        join(TEST_ROOT, "repo"),
        expect.any(String),
        expect.objectContaining({
          cliType: "claude-code",
          continuationId: "session-prev",
          cliModel: "opus",
          resolvedCliModel: "claude-opus-4-6",
        })
      );
    });
  });

  it("injects the attached task ref into the runner prompt", async () => {
    const msg = makeUserMessage({
      _id: "msg_user_1" as UnprocessedUserMessage["_id"],
      content: [{ type: "text", data: "Please investigate", timestamp: 1000 }],
      task: {
        _id: "task_1" as NonNullable<UnprocessedUserMessage["task"]>["_id"],
        refId: "OS-123",
        name: "Investigate prompt injection",
        taskType: {
          key: "task",
          name: "Task",
          icon: "check-square",
          color: "#2563eb",
          isSystem: true,
        },
        isArchived: false,
      },
    });
    setQueryResponses({
      pendingRuns: [[msg], []],
      continuationIds: [null],
    });

    const handler = createMessageHandler(() => mockRunner, mockClient, sessionId);
    handler.enqueueChat(makePendingChat());

    await vi.waitFor(() => {
      expect(mockRunner.execute).toHaveBeenCalledWith(
        join(TEST_ROOT, "repo"),
        expect.stringContaining("task(convoy): OS-123"),
        expect.objectContaining({
          cliType: "claude-code",
        })
      );
    });
  });

  it("injects the attached pull request into the runner prompt", async () => {
    const msg = makeUserMessage({
      _id: "msg_user_1" as UnprocessedUserMessage["_id"],
      content: [{ type: "text", data: "Do you have access to this PR?", timestamp: 1000 }],
      pullRequest: { owner: "contoso", name: "convoy-sandbox", number: 1, ref: "contoso/convoy-sandbox#1" },
    });
    setQueryResponses({ pendingRuns: [[msg], []], continuationIds: [null] });

    const handler = createMessageHandler(() => mockRunner, mockClient, sessionId);
    handler.enqueueChat(makePendingChat());

    await vi.waitFor(() => {
      expect(mockRunner.execute).toHaveBeenCalledWith(
        join(TEST_ROOT, "repo"),
        expect.stringContaining("pr(github): contoso/convoy-sandbox#1 https://github.com/contoso/convoy-sandbox/pull/1"),
        expect.objectContaining({ cliType: "claude-code" })
      );
    });
  });

  it("includes non-image attachment local paths in prompt mode", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "convoy-thread-attachments-"));
    attachmentCacheDirs.push(cacheDir);
    const fetchMock = vi.fn(async () => new Response("notes", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const msg = makeUserMessage({
      _id: "msg_user_1" as UnprocessedUserMessage["_id"],
      attachments: [
        {
          storageId: "storage_1",
          fileName: "notes.txt",
          fileSize: 5,
          contentType: "text/plain",
          uploadedAt: 1000,
          url: "https://example.test/notes.txt",
        },
      ],
    });
    setQueryResponses({
      pendingRuns: [[msg], []],
      continuationIds: [null],
    });

    const handler = createMessageHandler(() => mockRunner, mockClient, sessionId, {
      attachmentCacheDir: cacheDir,
    });
    handler.enqueueChat(makePendingChat());

    await vi.waitFor(() => {
      expect(mockRunner.execute).toHaveBeenCalledWith(
        join(TEST_ROOT, "repo"),
        expect.stringContaining("notes.txt"),
        expect.objectContaining({
          inputFormat: "prompt",
          bootstrapInput: undefined,
        })
      );
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("continues run processing when one attachment download fails", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "convoy-thread-attachments-"));
    attachmentCacheDirs.push(cacheDir);
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => new Response("download failed", { status: 500 }))
      .mockImplementationOnce(async () => new Response("notes", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const msg = makeUserMessage({
      _id: "msg_user_1" as UnprocessedUserMessage["_id"],
      attachments: [
        {
          storageId: "storage_fail",
          fileName: "broken.txt",
          fileSize: 5,
          contentType: "text/plain",
          uploadedAt: 1000,
          url: "https://example.test/broken.txt",
        },
        {
          storageId: "storage_ok",
          fileName: "notes.txt",
          fileSize: 5,
          contentType: "text/plain",
          uploadedAt: 1000,
          url: "https://example.test/notes.txt",
        },
      ],
    });
    setQueryResponses({
      pendingRuns: [[msg], []],
      continuationIds: [null],
    });

    const handler = createMessageHandler(() => mockRunner, mockClient, sessionId, {
      attachmentCacheDir: cacheDir,
    });
    handler.enqueueChat(makePendingChat());

    await vi.waitFor(() => {
      expect(mockRunner.execute).toHaveBeenCalledWith(
        join(TEST_ROOT, "repo"),
        expect.stringContaining("notes.txt"),
        expect.objectContaining({
          inputFormat: "prompt",
        })
      );
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mockRunner.execute).toHaveBeenCalledTimes(1);

    const failedMutationCalls = mockMutation.mock.calls.filter(
      ([, args]) =>
        args &&
        "messageId" in args &&
        "sessionId" in args &&
        "errorMessage" in args
    );
    expect(failedMutationCalls).toHaveLength(0);
  });

  it("uses stream-json input with base64 image blocks and reuses cached files", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "convoy-thread-attachments-"));
    attachmentCacheDirs.push(cacheDir);
    const fetchMock = vi.fn(async () => new Response("image-bytes", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const imageAttachment = {
      storageId: "storage_img_1",
      fileName: "screenshot.png",
      fileSize: 10,
      contentType: "image/png",
      uploadedAt: 1000,
      url: "https://example.test/screenshot.png",
    };
    const msg1 = makeUserMessage({
      _id: "msg_user_1" as UnprocessedUserMessage["_id"],
      attachments: [imageAttachment],
    });
    const msg2 = makeUserMessage({
      _id: "msg_user_2" as UnprocessedUserMessage["_id"],
      attachments: [imageAttachment],
      createdAt: 2000,
      updatedAt: 2000,
    });

    setQueryResponses({
      pendingRuns: [[msg1], [msg2], []],
      continuationIds: [null, null],
    });

    const handler = createMessageHandler(() => mockRunner, mockClient, sessionId, {
      attachmentCacheDir: cacheDir,
    });
    handler.enqueueChat(makePendingChat());

    await vi.waitFor(() => {
      expect(mockRunner.execute).toHaveBeenCalledTimes(2);
    });

    const firstCall = (mockRunner.execute as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(firstCall?.[2]).toEqual(
      expect.objectContaining({
        inputFormat: "stream-json",
      })
    );
    const firstBootstrapInput = firstCall?.[2]?.bootstrapInput;
    expect(Array.isArray(firstBootstrapInput)).toBe(true);
    expect(firstBootstrapInput[0]).toEqual(
      expect.objectContaining({
        type: "user",
        message: expect.objectContaining({
          role: "user",
          content: expect.arrayContaining([
            expect.objectContaining({ type: "text" }),
            expect.objectContaining({
              type: "image",
              source: expect.objectContaining({
                type: "base64",
                media_type: "image/png",
                data: Buffer.from("image-bytes").toString("base64"),
              }),
            }),
          ]),
        }),
      })
    );

    expect(firstBootstrapInput[0].message.content.at(-1)).toEqual({
      type: "text",
      text: expect.stringContaining("--message-id msg_assistant_1"),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps image blocks associated with their message context in stream-json bootstrap input", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "convoy-thread-attachments-"));
    attachmentCacheDirs.push(cacheDir);
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => new Response("img-1", { status: 200 }))
      .mockImplementationOnce(async () => new Response("img-2", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const msg1 = makeUserMessage({
      _id: "msg_user_1" as UnprocessedUserMessage["_id"],
      content: [{ type: "text", data: "first prompt", timestamp: 1000 }],
      attachments: [
        {
          storageId: "storage_img_1",
          fileName: "first.png",
          fileSize: 10,
          contentType: "image/png",
          uploadedAt: 1000,
          url: "https://example.test/first.png",
        },
      ],
      createdAt: 1000,
      updatedAt: 1000,
    });
    const msg2 = makeUserMessage({
      _id: "msg_user_2" as UnprocessedUserMessage["_id"],
      content: [{ type: "text", data: "second prompt", timestamp: 2000 }],
      attachments: [
        {
          storageId: "storage_img_2",
          fileName: "second.png",
          fileSize: 12,
          contentType: "image/png",
          uploadedAt: 2000,
          url: "https://example.test/second.png",
        },
      ],
      createdAt: 2000,
      updatedAt: 2000,
    });

    setQueryResponses({
      pendingRuns: [[msg1, msg2], []],
      continuationIds: [null],
    });

    const handler = createMessageHandler(() => mockRunner, mockClient, sessionId, {
      attachmentCacheDir: cacheDir,
    });
    handler.enqueueChat(makePendingChat());

    await vi.waitFor(() => {
      expect(mockRunner.execute).toHaveBeenCalledTimes(1);
    });

    const firstCall = (mockRunner.execute as ReturnType<typeof vi.fn>).mock.calls[0];
    const firstBootstrapInput = firstCall?.[2]?.bootstrapInput as
      | Array<{ type: string; message: { role: string; content: unknown[] } }>
      | undefined;

    const contentBlocks = firstBootstrapInput?.[0]?.message?.content as Array<
      { type: string; text?: string }
    >;
    const textBlocks = contentBlocks.filter((block) => block.type === "text");
    expect(textBlocks.some((block) => block.text?.includes("id: msg_user_1"))).toBe(true);
    expect(textBlocks.some((block) => block.text?.includes("content:\nfirst prompt"))).toBe(
      true
    );
    expect(textBlocks.some((block) => block.text?.includes("id: msg_user_2"))).toBe(true);
    expect(textBlocks.some((block) => block.text?.includes("content:\nsecond prompt"))).toBe(
      true
    );

    const imagePositions = contentBlocks.flatMap((block, index) => block.type === "image" ? [index] : []);
    expect(imagePositions).toHaveLength(2);
    expect(contentBlocks[imagePositions[0] - 1].text).toBe('attachment: "first.png" (image/png)');
    expect(contentBlocks[imagePositions[1] - 1].text).toBe('attachment: "second.png" (image/png)');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("completes run without continuation when no prior continuation exists", async () => {
    const msg1 = makeUserMessage({
      _id: "msg_user_1" as UnprocessedUserMessage["_id"],
      cliMode: "agent",
    });
    setQueryResponses({
      pendingRuns: [[msg1], []],
      continuationIds: [null],
    });

    (mockRunner.execute as ReturnType<typeof vi.fn>).mockImplementation(
      async function* () {
        yield { type: "assistant", data: "chunk-1" };
        return {} satisfies RunnerExecutionResult;
      }
    );

    const handler = createMessageHandler(() => mockRunner, mockClient, sessionId);
    handler.enqueueChat(makePendingChat());

    await vi.waitFor(() => {
      expect(mockMutation).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          messageId: "msg_assistant_1",
          sessionId,
          cliContext: undefined,
        })
      );
    });

    expect(mockRunner.execute).toHaveBeenCalledWith(
      join(TEST_ROOT, "repo"),
      expect.any(String),
      expect.objectContaining({
        continuationId: undefined,
        requireContinuation: false,
      })
    );
  });

  it("processes chats in parallel up to maxConcurrentChats", async () => {
    const chatA = makePendingChat({
      _id: "chat_a" as PendingChat["_id"],
      workingDirectory: join(TEST_ROOT, "repo-a"),
    });
    const chatB = makePendingChat({
      _id: "chat_b" as PendingChat["_id"],
      workingDirectory: join(TEST_ROOT, "repo-b"),
    });
    const chatC = makePendingChat({
      _id: "chat_c" as PendingChat["_id"],
      workingDirectory: join(TEST_ROOT, "repo-c"),
    });

    const msgA = makeUserMessage({
      _id: "msg_user_a" as UnprocessedUserMessage["_id"],
      threadId: chatA._id as UnprocessedUserMessage["threadId"],
    });
    const msgB = makeUserMessage({
      _id: "msg_user_b" as UnprocessedUserMessage["_id"],
      threadId: chatB._id as UnprocessedUserMessage["threadId"],
    });
    const msgC = makeUserMessage({
      _id: "msg_user_c" as UnprocessedUserMessage["_id"],
      threadId: chatC._id as UnprocessedUserMessage["threadId"],
    });

    const pendingByThread = new Map<string, UnprocessedUserMessage[]>([
      [chatA._id as string, [msgA]],
      [chatB._id as string, [msgB]],
      [chatC._id as string, [msgC]],
    ]);

    setPerThreadQueryResponses(pendingByThread);

    mockMutation.mockImplementation(async (_fn, args) => {
      if (args && "leaseMs" in args && "threadId" in args && "sessionId" in args) {
        return true;
      }
      if (args && "threadId" in args && "userMessageIds" in args) {
        const threadId = (args as { threadId: string }).threadId;
        return {
          assistantMessageId: `msg_assistant_${threadId}`,
          runId: `run_${threadId}`,
        };
      }
      return null;
    });

    const gates = new Map<string, ReturnType<typeof createDeferred>>([
      [chatA.workingDirectory, createDeferred()],
      [chatB.workingDirectory, createDeferred()],
      [chatC.workingDirectory, createDeferred()],
    ]);
    const startedWorkingDirs: string[] = [];
    let activeRuns = 0;
    let maxActiveRuns = 0;

    const handler = createMessageHandler(
      () => {
        let activeWorkingDirectory: string | null = null;
        let aborted = false;
        return {
          execute: vi.fn().mockImplementation(
            async function* (workingDirectory: string) {
              activeWorkingDirectory = workingDirectory;
              startedWorkingDirs.push(workingDirectory);
              activeRuns += 1;
              maxActiveRuns = Math.max(maxActiveRuns, activeRuns);
              const gate = gates.get(workingDirectory);
              if (!gate) {
                throw new Error(`Missing gate for ${workingDirectory}`);
              }
              await gate.promise;
              if (aborted) {
                throw new Error("aborted");
              }
              yield { type: "assistant", data: `chunk-${workingDirectory}` };
              activeRuns -= 1;
              return {} satisfies RunnerExecutionResult;
            }
          ),
          abort: vi.fn(() => {
            aborted = true;
            if (activeWorkingDirectory) {
              gates.get(activeWorkingDirectory)?.resolve();
            }
          }),
          shutdown: vi.fn().mockResolvedValue(undefined),
        } satisfies CliRuntimeRunner;
      },
      mockClient,
      sessionId,
      { maxConcurrentChats: 2 }
    );

    handler.enqueueChat(chatA);
    handler.enqueueChat(chatB);
    handler.enqueueChat(chatC);

    await vi.waitFor(() => {
      expect(startedWorkingDirs).toEqual(
        expect.arrayContaining([chatA.workingDirectory, chatB.workingDirectory])
      );
    });
    expect(startedWorkingDirs).not.toContain(chatC.workingDirectory);
    expect(maxActiveRuns).toBeLessThanOrEqual(2);

    gates.get(chatA.workingDirectory)?.resolve();
    await vi.waitFor(() => {
      expect(startedWorkingDirs).toContain(chatC.workingDirectory);
    });

    gates.get(chatB.workingDirectory)?.resolve();
    gates.get(chatC.workingDirectory)?.resolve();

    await vi.waitFor(() => {
      expect(handler.isProcessing()).toBe(false);
    });
    expect(maxActiveRuns).toBe(2);
  });

  it("keeps sequential behavior when maxConcurrentChats is 1", async () => {
    const chatA = makePendingChat({
      _id: "chat_seq_a" as PendingChat["_id"],
      workingDirectory: join(TEST_ROOT, "repo-seq-a"),
    });
    const chatB = makePendingChat({
      _id: "chat_seq_b" as PendingChat["_id"],
      workingDirectory: join(TEST_ROOT, "repo-seq-b"),
    });

    const msgA = makeUserMessage({
      _id: "msg_seq_a" as UnprocessedUserMessage["_id"],
      threadId: chatA._id as UnprocessedUserMessage["threadId"],
    });
    const msgB = makeUserMessage({
      _id: "msg_seq_b" as UnprocessedUserMessage["_id"],
      threadId: chatB._id as UnprocessedUserMessage["threadId"],
    });

    const pendingByThread = new Map<string, UnprocessedUserMessage[]>([
      [chatA._id as string, [msgA]],
      [chatB._id as string, [msgB]],
    ]);
    setPerThreadQueryResponses(pendingByThread);
    mockMutation.mockImplementation(async (_fn, args) => {
      if (args && "leaseMs" in args && "threadId" in args && "sessionId" in args) {
        return true;
      }
      if (args && "userMessageIds" in args) {
        return {
          assistantMessageId: "msg_assistant_seq",
          runId: "run_seq",
        };
      }
      return null;
    });

    const gates = new Map<string, ReturnType<typeof createDeferred>>([
      [chatA.workingDirectory, createDeferred()],
      [chatB.workingDirectory, createDeferred()],
    ]);
    const startedWorkingDirs: string[] = [];
    let activeRuns = 0;
    let maxActiveRuns = 0;

    const handler = createMessageHandler(
      () => ({
        execute: vi.fn().mockImplementation(
          async function* (workingDirectory: string) {
            startedWorkingDirs.push(workingDirectory);
            activeRuns += 1;
            maxActiveRuns = Math.max(maxActiveRuns, activeRuns);
            const gate = gates.get(workingDirectory);
            if (!gate) {
              throw new Error(`Missing gate for ${workingDirectory}`);
            }
            await gate.promise;
            yield { type: "assistant", data: `chunk-${workingDirectory}` };
            activeRuns -= 1;
            return {} satisfies RunnerExecutionResult;
          }
        ),
        abort: vi.fn(),
        shutdown: vi.fn().mockResolvedValue(undefined),
      }),
      mockClient,
      sessionId,
      { maxConcurrentChats: 1 }
    );

    handler.enqueueChat(chatA);
    handler.enqueueChat(chatB);

    await vi.waitFor(() => {
      expect(startedWorkingDirs).toContain(chatA.workingDirectory);
    });
    expect(startedWorkingDirs).not.toContain(chatB.workingDirectory);
    expect(maxActiveRuns).toBe(1);

    gates.get(chatA.workingDirectory)?.resolve();
    await vi.waitFor(() => {
      expect(startedWorkingDirs).toContain(chatB.workingDirectory);
    });
    gates.get(chatB.workingDirectory)?.resolve();

    await vi.waitFor(() => {
      expect(handler.isProcessing()).toBe(false);
    });
    expect(maxActiveRuns).toBe(1);
  });

  it("dedupes enqueue for chats already active", async () => {
    const chat = makePendingChat({
      _id: "chat_dedupe" as PendingChat["_id"],
      workingDirectory: join(TEST_ROOT, "repo-dedupe"),
    });
    const msg = makeUserMessage({
      _id: "msg_dedupe" as UnprocessedUserMessage["_id"],
      threadId: chat._id as UnprocessedUserMessage["threadId"],
    });
    const gate = createDeferred();
    setPerThreadQueryResponses(
      new Map<string, UnprocessedUserMessage[]>([
        [chat._id as string, [msg]],
      ])
    );
    mockMutation.mockImplementation(async (_fn, args) => {
      if (args && "leaseMs" in args && "threadId" in args && "sessionId" in args) {
        return true;
      }
      if (args && "userMessageIds" in args) {
        return {
          assistantMessageId: "msg_assistant_dedupe",
          runId: "run_dedupe",
        };
      }
      return null;
    });

    const executeMock = vi.fn().mockImplementation(async function* () {
      await gate.promise;
      yield { type: "assistant", data: "chunk-dedupe" };
      return {} satisfies RunnerExecutionResult;
    });

    const handler = createMessageHandler(
      () => ({
        execute: executeMock,
        abort: vi.fn(),
        shutdown: vi.fn().mockResolvedValue(undefined),
      }),
      mockClient,
      sessionId,
      { maxConcurrentChats: 2 }
    );

    handler.enqueueChat(chat);
    handler.enqueueChat(chat);

    await vi.waitFor(() => {
      expect(executeMock).toHaveBeenCalledTimes(1);
    });

    gate.resolve();

    await vi.waitFor(() => {
      expect(handler.isProcessing()).toBe(false);
    });

    const startRunCalls = mockMutation.mock.calls.filter(
      ([, args]) => args && typeof args === "object" && "userMessageIds" in args
    );
    expect(startRunCalls).toHaveLength(1);
  });

  it("re-enqueues a chat that returned to pending while its worker was still active (OS-1374 edit-resend)", async () => {
    const chat = makePendingChat({
      _id: "chat_deferred" as PendingChat["_id"],
      workingDirectory: join(TEST_ROOT, "repo-deferred"),
    });
    const msg = makeUserMessage({
      _id: "msg_deferred" as UnprocessedUserMessage["_id"],
      threadId: chat._id as UnprocessedUserMessage["threadId"],
    });
    const gate = createDeferred();
    setPerThreadQueryResponses(
      new Map<string, UnprocessedUserMessage[]>([[chat._id as string, [msg]]])
    );
    mockMutation.mockImplementation(async (_fn, args) => {
      if (args && "leaseMs" in args && "threadId" in args && "sessionId" in args) {
        return true;
      }
      if (args && "userMessageIds" in args) {
        return {
          assistantMessageId: "msg_assistant_deferred",
          runId: "run_deferred",
        };
      }
      return null;
    });

    const executeMock = vi.fn().mockImplementation(async function* () {
      yield { type: "assistant", data: "chunk-deferred" };
      await gate.promise;
      // The edit-resend deleted the streaming assistant server-side; the
      // next append fails exactly like this.
      throw new Error("Message not found");
    });

    const handler = createMessageHandler(
      () => ({
        execute: executeMock,
        abort: vi.fn(),
        shutdown: vi.fn().mockResolvedValue(undefined),
      }),
      mockClient,
      sessionId,
      { maxConcurrentChats: 1 }
    );

    handler.enqueueChat(chat);
    await vi.waitFor(() => {
      expect(executeMock).toHaveBeenCalledTimes(1);
    });

    // editLastResend flips the thread back to pending mid-run: the pending
    // subscription fires now — while the worker is still active — and never
    // again afterwards.
    handler.enqueueChat(chat);

    gate.resolve();

    await vi.waitFor(() => {
      expect(handler.isProcessing()).toBe(false);
    });

    // The deferred enqueue must claim + release the chat a second time.
    const releaseCalls = mockMutation.mock.calls.filter(
      ([, args]) =>
        args &&
        "threadId" in args &&
        "sessionId" in args &&
        !("leaseMs" in args) &&
        !("userMessageIds" in args) &&
        !("messageId" in args) &&
        !("branch" in args) &&
        !("pullRequest" in args)
    );
    expect(releaseCalls).toHaveLength(2);
  });

  it("aborts active runners and prevents queued chats from starting during shutdown", async () => {
    const chatA = makePendingChat({
      _id: "chat_shutdown_a" as PendingChat["_id"],
      workingDirectory: join(TEST_ROOT, "repo-shutdown-a"),
    });
    const chatB = makePendingChat({
      _id: "chat_shutdown_b" as PendingChat["_id"],
      workingDirectory: join(TEST_ROOT, "repo-shutdown-b"),
    });
    const msgA = makeUserMessage({
      _id: "msg_shutdown_a" as UnprocessedUserMessage["_id"],
      threadId: chatA._id as UnprocessedUserMessage["threadId"],
    });

    const pendingByThread = new Map<string, UnprocessedUserMessage[]>([
      [chatA._id as string, [msgA]],
      [chatB._id as string, []],
    ]);
    setPerThreadQueryResponses(pendingByThread);
    mockMutation.mockImplementation(async (_fn, args) => {
      if (args && "leaseMs" in args && "threadId" in args && "sessionId" in args) {
        return true;
      }
      if (args && "userMessageIds" in args) {
        return {
          assistantMessageId: "msg_assistant_shutdown",
          runId: "run_shutdown",
        };
      }
      return null;
    });

    const startedWorkingDirs: string[] = [];
    const createdRunners: Array<{ abort: ReturnType<typeof vi.fn> }> = [];
    const gates = new Map<string, ReturnType<typeof createDeferred>>([
      [chatA.workingDirectory, createDeferred()],
      [chatB.workingDirectory, createDeferred()],
    ]);

    const handler = createMessageHandler(
      () => {
        let activeWorkingDirectory: string | null = null;
        let aborted = false;
        const abort = vi.fn(() => {
          aborted = true;
          if (activeWorkingDirectory) {
            gates.get(activeWorkingDirectory)?.resolve();
          }
        });
        createdRunners.push({ abort });
        return {
          execute: vi.fn().mockImplementation(
            async function* (workingDirectory: string) {
              activeWorkingDirectory = workingDirectory;
              startedWorkingDirs.push(workingDirectory);
              const gate = gates.get(workingDirectory);
              if (!gate) {
                throw new Error(`Missing gate for ${workingDirectory}`);
              }
              await gate.promise;
              if (aborted) {
                throw new Error("aborted");
              }
              yield { type: "assistant", data: `chunk-${workingDirectory}` };
              return {} satisfies RunnerExecutionResult;
            }
          ),
          abort,
          shutdown: vi.fn().mockResolvedValue(undefined),
        } satisfies CliRuntimeRunner;
      },
      mockClient,
      sessionId,
      { maxConcurrentChats: 1 }
    );

    handler.enqueueChat(chatA);
    handler.enqueueChat(chatB);

    await vi.waitFor(() => {
      expect(startedWorkingDirs).toContain(chatA.workingDirectory);
    });
    expect(startedWorkingDirs).not.toContain(chatB.workingDirectory);

    const shutdownPromise = handler.shutdown();

    await vi.waitFor(() => {
      expect(createdRunners[0]?.abort).toHaveBeenCalledTimes(1);
    });
    await shutdownPromise;

    expect(startedWorkingDirs).not.toContain(chatB.workingDirectory);
    expect(handler.isProcessing()).toBe(false);
  });

  it("fails a run that a shutdown interrupted cleanly instead of completing it (OS-2098)", async () => {
    setQueryResponses({ pendingRuns: [[makeUserMessage()], []], continuationIds: [null] });
    const gate = createDeferred();
    // Claude's graceful interrupt: the run ends with a normal return, not a throw.
    vi.mocked(mockRunner.execute).mockImplementation(async function* () {
      await gate.promise;
      // eslint-disable-next-line no-constant-condition
      if (false) yield { type: "assistant", data: "unreachable" };
      return { continuationId: "session-interrupted" } satisfies RunnerExecutionResult;
    });
    vi.mocked(mockRunner.abort).mockImplementation(() => gate.resolve());

    const handler = createMessageHandler(() => mockRunner, mockClient, sessionId);
    handler.enqueueChat(makePendingChat());
    await vi.waitFor(() => expect(mockRunner.execute).toHaveBeenCalledTimes(1));
    await handler.shutdown();

    const calledNames = mockMutation.mock.calls.map(([fn]) => getFunctionName(fn));
    expect(calledNames).not.toContain("cli/messages:complete");
    expect(mockMutation).toHaveBeenCalledWith(api.cli.messages.fail, expect.objectContaining({
      messageId: "msg_assistant_1",
      errorMessage: "CLI stopped during response generation",
      cliContext: { continuationId: "session-interrupted" },
    }));
  });

  describe("claim status watch", () => {
    it("watches the claim over a subscription and aborts the run when it drops", async () => {
      setQueryResponses({
        pendingRuns: [[makeUserMessage()], []],
        continuationIds: [null],
      });

      let claimOnUpdate: ((isActive: boolean) => void) | null = null;
      const unsubscribeClaim = vi.fn();
      (mockClient.subscribe as ReturnType<typeof vi.fn>).mockImplementation(
        (fn: unknown, _args: unknown, callbacks: { onUpdate: (value: unknown) => void }) => {
          if (isSameFunction(fn, api.cli.threads.runControl.isClaimActiveForSession)) {
            claimOnUpdate = callbacks.onUpdate as (isActive: boolean) => void;
            return unsubscribeClaim;
          }
          return () => {};
        }
      );

      const gate = createDeferred();
      const abort = vi.fn();
      const runner: CliRuntimeRunner = {
        execute: vi.fn().mockImplementation(async function* () {
          yield { type: "assistant", data: "chunk-1" };
          await gate.promise;
          return {} satisfies RunnerExecutionResult;
        }),
        abort,
        shutdown: vi.fn().mockResolvedValue(undefined),
      };

      const handler = createMessageHandler(() => runner, mockClient, sessionId);
      handler.enqueueChat(makePendingChat());

      // Read through a getter: a direct read narrows to `never` (assigned only
      // inside the closure), as the steering suite does.
      const getClaimOnUpdate = () => claimOnUpdate;
      await vi.waitFor(() => {
        expect(getClaimOnUpdate()).not.toBeNull();
      });

      getClaimOnUpdate()?.(false);

      await vi.waitFor(() => {
        expect(abort).toHaveBeenCalled();
      });

      gate.resolve();
      await vi.waitFor(() => {
        expect(handler.isProcessing()).toBe(false);
      });
      expect(unsubscribeClaim).toHaveBeenCalled();
    });
  });

  describe("steering", () => {
    function setupSteerableRun(params?: { steerReturns?: boolean; attachmentCacheDir?: string }) {
      const msg1 = makeUserMessage();
      setQueryResponses({
        pendingRuns: [[msg1], []],
        continuationIds: [null],
      });

      let steerOnUpdate: ((messages: SteerRequestedUserMessage[]) => void) | null = null;
      const unsubscribeMock = vi.fn();
      (mockClient.subscribe as ReturnType<typeof vi.fn>).mockImplementation(
        (fn: unknown, _args: unknown, callbacks: { onUpdate: (messages: SteerRequestedUserMessage[]) => void }) => {
          if (!isSameFunction(fn, api.cli.messages.listSteerRequestedUserMessages)) {
            return () => {};
          }
          steerOnUpdate = callbacks.onUpdate;
          return unsubscribeMock;
        }
      );

      const gate = createDeferred();
      const steerMock = vi.fn().mockReturnValue(params?.steerReturns ?? true);
      const runner: CliRuntimeRunner = {
        execute: vi.fn().mockImplementation(async function* () {
          yield { type: "assistant", data: "chunk-1" };
          await gate.promise;
          return {} satisfies RunnerExecutionResult;
        }),
        steer: steerMock,
        abort: vi.fn(),
        shutdown: vi.fn().mockResolvedValue(undefined),
      };

      const handler = createMessageHandler(() => runner, mockClient, sessionId, { attachmentCacheDir: params?.attachmentCacheDir });

      return {
        handler,
        runner,
        steerMock,
        gate,
        unsubscribeMock,
        getSteerOnUpdate: () => steerOnUpdate,
      };
    }

    it("does not subscribe to steer requests for runners without steer support", async () => {
      const msg1 = makeUserMessage();
      setQueryResponses({
        pendingRuns: [[msg1], []],
        continuationIds: [null],
      });

      const handler = createMessageHandler(() => mockRunner, mockClient, sessionId);
      handler.enqueueChat(makePendingChat());

      await vi.waitFor(() => {
        expect(handler.isProcessing()).toBe(false);
      });

      const steerSubscriptions = (mockClient.subscribe as ReturnType<typeof vi.fn>).mock.calls.filter(([fn]) =>
        isSameFunction(fn, api.cli.messages.listSteerRequestedUserMessages)
      );
      expect(steerSubscriptions).toHaveLength(0);
      expect(mockRunner.execute).toHaveBeenCalledWith(
        join(TEST_ROOT, "repo"),
        expect.any(String),
        expect.objectContaining({ steerEnabled: false })
      );
    });

    it("injects steer-requested messages into the active run and consumes them", async () => {
      const { handler, runner, steerMock, gate, unsubscribeMock, getSteerOnUpdate } = setupSteerableRun();
      handler.enqueueChat(makePendingChat());

      await vi.waitFor(() => {
        expect(getSteerOnUpdate()).not.toBeNull();
      });
      expect(runner.execute).toHaveBeenCalledWith(
        join(TEST_ROOT, "repo"),
        expect.any(String),
        expect.objectContaining({ steerEnabled: true })
      );

      const steerMessage = makeUserMessage({
        _id: "msg_steer_1" as UnprocessedUserMessage["_id"],
        content: [{ type: "text", data: "change of plans", timestamp: 3000 }],
        createdAt: 3000,
        steerRequestedAt: 3100,
      }) as SteerRequestedUserMessage;

      getSteerOnUpdate()?.([steerMessage]);

      await vi.waitFor(() => {
        expect(steerMock).toHaveBeenCalledWith(
          expect.objectContaining({
            prompt: expect.stringContaining("change of plans"),
            inputFormat: "prompt",
          }),
          undefined
        );
      });

      await vi.waitFor(() => {
        expect(mockMutation).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            assistantMessageId: "msg_assistant_1",
            userMessageIds: [steerMessage._id],
          })
        );
      });

      // A re-fired subscription update with the same message is a no-op.
      getSteerOnUpdate()?.([steerMessage]);
      await vi.waitFor(() => {
        expect(handler.isProcessing()).toBe(true);
      });
      expect(steerMock).toHaveBeenCalledTimes(1);

      gate.resolve();
      await vi.waitFor(() => {
        expect(handler.isProcessing()).toBe(false);
      });
      expect(unsubscribeMock).toHaveBeenCalled();
    });

    it("passes the steered message's mode to the runner", async () => {
      const { handler, steerMock, gate, getSteerOnUpdate } = setupSteerableRun();
      handler.enqueueChat(makePendingChat());
      await vi.waitFor(() => {
        expect(getSteerOnUpdate()).not.toBeNull();
      });

      getSteerOnUpdate()?.([
        makeUserMessage({
          _id: "msg_steer_mode" as UnprocessedUserMessage["_id"],
          cliMode: "agent",
          steerRequestedAt: 3100,
        }) as SteerRequestedUserMessage,
      ]);

      await vi.waitFor(() => {
        expect(steerMock).toHaveBeenCalledWith(expect.anything(), "agent");
      });
      gate.resolve();
      await vi.waitFor(() => {
        expect(handler.isProcessing()).toBe(false);
      });
    });

    it("injects image labels with their bytes when steering", async () => {
      const cacheDir = mkdtempSync(join(tmpdir(), "convoy-steer-labels-"));
      attachmentCacheDirs.push(cacheDir);
      vi.stubGlobal("fetch", vi.fn(async () => new Response("steered-image", { status: 200 })));
      const { handler, steerMock, gate, getSteerOnUpdate } = setupSteerableRun({ attachmentCacheDir: cacheDir });
      handler.enqueueChat(makePendingChat());
      await vi.waitFor(() => expect(getSteerOnUpdate()).not.toBeNull());
      const message = makeUserMessage({
        _id: "msg_steer_image" as UnprocessedUserMessage["_id"],
        content: [{ type: "text", data: "inspect #steered.png", timestamp: 3000 }],
        createdAt: 3000, steerRequestedAt: 3100,
        attachments: [{ storageId: `steer-image-${Date.now()}`, fileName: "steered.png", fileSize: 13, contentType: "image/png", uploadedAt: 3000, url: "https://example.test/steered.png" }],
      }) as SteerRequestedUserMessage;
      getSteerOnUpdate()?.([message]);
      await vi.waitFor(() => expect(steerMock).toHaveBeenCalledTimes(1));
      const execution = steerMock.mock.calls[0][0];
      const blocks = execution.bootstrapInput[0].message.content as Array<{ type: string; text?: string; source?: { data: string } }>;
      const index = blocks.findIndex(block => block.type === "image");
      expect(blocks[index - 1].text).toBe('attachment: "steered.png" (image/png)');
      expect(blocks[index].source?.data).toBe(Buffer.from("steered-image").toString("base64"));
      gate.resolve();
      await vi.waitFor(() => expect(handler.isProcessing()).toBe(false));
    });

    it("leaves messages queued when the runner declines the steer", async () => {
      const { handler, steerMock, gate, getSteerOnUpdate } = setupSteerableRun({ steerReturns: false });
      handler.enqueueChat(makePendingChat());

      await vi.waitFor(() => {
        expect(getSteerOnUpdate()).not.toBeNull();
      });

      const steerMessage = makeUserMessage({
        _id: "msg_steer_declined" as UnprocessedUserMessage["_id"],
        steerRequestedAt: 3100,
      }) as SteerRequestedUserMessage;

      getSteerOnUpdate()?.([steerMessage]);

      await vi.waitFor(() => {
        expect(steerMock).toHaveBeenCalledTimes(1);
      });

      const consumeCalls = mockMutation.mock.calls.filter(
        ([, args]) => args && typeof args === "object" && "assistantMessageId" in args
      );
      expect(consumeCalls).toHaveLength(0);

      // The declined message stays unhandled, so a later update retries it.
      getSteerOnUpdate()?.([steerMessage]);
      await vi.waitFor(() => {
        expect(steerMock).toHaveBeenCalledTimes(2);
      });

      gate.resolve();
      await vi.waitFor(() => {
        expect(handler.isProcessing()).toBe(false);
      });
    });
  });

  it.each([
    ["claude-code", false], ["codex", false], ["claude-code", true], ["codex", true],
  ] as const)("%s acknowledges only successful shutdown, failure=%s", async (cliType, shutdownFails) => {
    vi.useFakeTimers();
    try {
      let finishShutdown!: () => void;
      const shutdown = new Promise<void>((resolve, reject) => {
        finishShutdown = () => shutdownFails ? reject(new Error("shutdown failed")) : resolve();
      });
      (mockRunner.shutdown as ReturnType<typeof vi.fn>).mockReturnValue(shutdown);
      // A Codex goal paused on Stop rides the acknowledgment (OS-2277).
      mockRunner.stopReport = () => (cliType === "codex" ? { goalPaused: true } : undefined);
      let aborted = false;
      let queryStep = 0;

      const msg1 = makeUserMessage({
        _id: "msg_user_1" as UnprocessedUserMessage["_id"],
      });

      mockQuery.mockImplementation(async (_fn, args) => {
        if (args && "threadId" in args && "sessionId" in args) {
          return false;
        }

        queryStep += 1;
        if (queryStep === 1) {
          return [msg1];
        }
        if (queryStep === 2) {
          return null;
        }
        return [];
      });

      // The claim watch delivers its current value on subscribe, as Convex does.
      (mockClient.subscribe as ReturnType<typeof vi.fn>).mockImplementation(
        (fn: unknown, _args: unknown, callbacks: { onUpdate: (value: unknown) => void }) => {
          if (isSameFunction(fn, api.cli.threads.runControl.isClaimActiveForSession)) {
            callbacks.onUpdate(false);
          }
          return () => {};
        }
      );

      (mockRunner.execute as ReturnType<typeof vi.fn>).mockImplementation(
        async function* () {
          // Keep this as an async generator for the runner contract without
          // emitting chunks in this test scenario.
          yield* [];
          // Intentionally never yields chunks; the handler must exit by aborting
          // this blocked execution when the claim watch reports inactive
          // ownership.
          while (!aborted) {
            await new Promise<void>((resolve) => {
              setTimeout(resolve, 100);
            });
          }
          return {} satisfies RunnerExecutionResult;
        }
      );
      (mockRunner.abort as ReturnType<typeof vi.fn>).mockImplementation(() => {
        aborted = true;
      });

      const handler = createMessageHandler(() => mockRunner, mockClient, sessionId);
      handler.enqueueChat(makePendingChat({ cliType }));

      await vi.advanceTimersByTimeAsync(3_500);

      await vi.waitFor(() => {
        expect(mockRunner.abort).toHaveBeenCalled();
      });

      await vi.waitFor(() => expect(mockRunner.shutdown).toHaveBeenCalled());
      const acknowledgments = () => mockMutation.mock.calls.filter(([fn]) =>
        isSameFunction(fn, api.cli.threads.runControl.acknowledgeStop));
      expect(acknowledgments()).toHaveLength(0);
      finishShutdown();
      await vi.waitFor(() => expect(handler.isProcessing()).toBe(false));
      expect(acknowledgments()).toHaveLength(shutdownFails ? 0 : 1);
      if (!shutdownFails) {
        expect(acknowledgments()[0][1]).toMatchObject({ sessionId, runId: expect.any(String), messageId: expect.any(String) });
        expect(acknowledgments()[0][1].goalPaused).toBe(cliType === "codex" ? true : undefined);
      }

      expect(mockRunner.execute).not.toHaveBeenCalled();
      const failCalls = mockMutation.mock.calls.filter(
        ([, args]) =>
          args &&
          "messageId" in args &&
          "sessionId" in args &&
          "errorMessage" in args
      );
      expect(failCalls).toHaveLength(0);

      const releaseClaimCalls = mockMutation.mock.calls.filter(
        ([, args]) =>
          args &&
          "threadId" in args &&
          "sessionId" in args &&
          !("leaseMs" in args) &&
          !("userMessageIds" in args)
      );
      expect(releaseClaimCalls.length).toBeGreaterThanOrEqual(1);
    } finally {
      vi.useRealTimers();
    }
  });

  describe("interaction bridge cancel (OS-1463)", () => {
    function interactionCancelCalls() {
      return mockMutation.mock.calls.filter(
        ([, args]) => args && "requestId" in args && "reason" in args
      );
    }

    function runWithBridgeCancel(opts: { abandoned: boolean; reason?: string }) {
      (mockRunner.execute as ReturnType<typeof vi.fn>).mockImplementation(
        // eslint-disable-next-line require-yield
        async function* (
          _wd: string,
          _prompt: string,
          options: {
            interactionBridge?: {
              cancel(id: string, opts: { abandoned: boolean; reason?: string }): void;
            };
          }
        ) {
          options.interactionBridge?.cancel("req-parked", opts);
          return {} satisfies RunnerExecutionResult;
        }
      );

      setQueryResponses({
        pendingRuns: [[makeUserMessage()], []],
        continuationIds: [null],
      });

      const handler = createMessageHandler(() => mockRunner, mockClient, sessionId, {
        interactionRouter: {
          register: vi.fn(),
          unregister: vi.fn(),
          dispatch: vi.fn(),
        },
      });
      handler.enqueueChat(makePendingChat());
      return vi.waitFor(() => {
        expect(handler.isProcessing()).toBe(false);
      });
    }

    it("waits for creation before cancelling a provider-resolved request", async () => {
      const created = createDeferred();
      const cancelled = createDeferred();
      let bridgeRequested = false;
      const original = mockMutation.getMockImplementation()!;
      mockMutation.mockImplementation((fn, args) => {
        if (isSameFunction(fn, api.cli.interactionRequests.create)) return created.promise;
        if (isSameFunction(fn, api.cli.interactionRequests.cancel)) cancelled.resolve();
        return Reflect.apply(original, undefined, [fn, args]);
      });
      (mockRunner.execute as ReturnType<typeof vi.fn>).mockImplementation(
        // eslint-disable-next-line require-yield
        async function* (_wd: string, _prompt: string, options: RunnerExecutionOptions) {
          const controller = new AbortController();
          const response = options.interactionBridge!.request({ requestId: "racing", kind: "question", payloadJson: "{}" }, controller.signal).catch(() => {});
          options.interactionBridge!.cancel("racing", { abandoned: false, reason: "resolved" });
          controller.abort();
          bridgeRequested = true;
          await cancelled.promise;
          await response;
          return {} satisfies RunnerExecutionResult;
        }
      );
      setQueryResponses({ pendingRuns: [[makeUserMessage()], []], continuationIds: [null] });
      const handler = createMessageHandler(() => mockRunner, mockClient, sessionId, {
        interactionRouter: { register: vi.fn(), unregister: vi.fn(), dispatch: vi.fn() },
      });
      handler.enqueueChat(makePendingChat());
      try {
        await vi.waitFor(() => expect(bridgeRequested).toBe(true));
        expect(interactionCancelCalls()).toHaveLength(0);
      } finally { created.resolve(); }
      await vi.waitFor(() => expect(interactionCancelCalls()).toHaveLength(1));
      await vi.waitFor(() => expect(handler.isProcessing()).toBe(false));
    });

    it("keeps the server row pending when the runner abandons the run", async () => {
      // Abandonment is runner teardown: the pending row is the parked signal
      // the server wind-down turns into waiting_input — it must survive.
      await runWithBridgeCancel({ abandoned: true, reason: "run ended" });
      expect(interactionCancelCalls()).toHaveLength(0);
    });

    it("still cancels the server row when the provider withdraws the request", async () => {
      await runWithBridgeCancel({ abandoned: false, reason: "provider withdrew request" });
      await vi.waitFor(() => {
        expect(interactionCancelCalls()).toHaveLength(1);
      });
      expect(interactionCancelCalls()[0]?.[1]).toMatchObject({
        requestId: "req-parked",
        reason: "provider withdrew request",
      });
    });
  });
});

describe("sliceRunMessagesAtSoloRunBoundary", () => {
  it("returns all messages when none is a runtime command", () => {
    const messages = [makeUserMessage(), makeUserMessage({ _id: "msg_user_2" as UnprocessedUserMessage["_id"] })];
    expect(sliceRunMessagesAtSoloRunBoundary(messages)).toEqual(messages);
  });

  it("runs a leading runtime command alone", () => {
    const command = makeUserMessage({ runtimeCommand: true });
    const prose = makeUserMessage({ _id: "msg_user_2" as UnprocessedUserMessage["_id"] });
    expect(sliceRunMessagesAtSoloRunBoundary([command, prose])).toEqual([command]);
  });

  it("runs a script request alone and cuts prose before one (OS-1886)", () => {
    const script = makeUserMessage({ scriptRequest: { script: "pnpm lint", timeoutMs: 60_000 } });
    const prose = makeUserMessage({ _id: "msg_user_2" as UnprocessedUserMessage["_id"] });
    expect(sliceRunMessagesAtSoloRunBoundary([script, prose])).toEqual([script]);
    expect(sliceRunMessagesAtSoloRunBoundary([prose, script])).toEqual([prose]);
  });

  it("cuts a prose run just before the next runtime command", () => {
    const prose1 = makeUserMessage();
    const prose2 = makeUserMessage({ _id: "msg_user_2" as UnprocessedUserMessage["_id"] });
    const command = makeUserMessage({
      _id: "msg_user_3" as UnprocessedUserMessage["_id"],
      runtimeCommand: true,
    });
    expect(sliceRunMessagesAtSoloRunBoundary([prose1, prose2, command])).toEqual([prose1, prose2]);
  });
});

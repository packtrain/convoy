import { expect, test, describe, vi, beforeEach, afterEach } from "vitest";
import { api } from "../_generated/api";
import { createTestContext } from "../../convex-testing";
import { buildPathEntry } from "../../convex-testing/builders";

describe("cli worktreeOps", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.now());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function setup() {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();

    const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
      name: "CLI Key",
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    });

    const repoPath = buildPathEntry({
      path: "/home/dev/repo",
      gitRemoteUrl: "git@github.com:acme/repo.git",
    });
    const worktreePath = buildPathEntry({
      path: "/home/dev/repo-worktrees/feat-a",
      kind: "worktree",
      parentPathId: repoPath.id,
      branch: "feat/a",
    });
    const profile = await ctx.cliProfile(user._id, project._id, {
      paths: [repoPath, worktreePath],
    });
    const session = await ctx.cliSession(profile._id, apiKeyResult.id);

    return {
      ctx,
      user,
      project,
      asUser,
      t,
      apiKey: apiKeyResult.key,
      profile,
      repoPath,
      worktreePath,
      session,
    };
  }

  test("rescan enqueue is deduped against a pending rescan of the same path", async () => {
    const s = await setup();

    const first = await s.asUser.mutation(api.cli.worktreeOps.enqueue, {
      profileId: s.profile._id,
      kind: "rescan",
      pathId: s.repoPath.id,
    });
    const second = await s.asUser.mutation(api.cli.worktreeOps.enqueue, {
      profileId: s.profile._id,
      kind: "rescan",
      pathId: s.repoPath.id,
    });
    expect(second).toBe(first);

    const pending = await s.t.query(api.cli.worktreeOps.listPending, {
      profileId: s.profile._id,
      apiKey: s.apiKey,
    });
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      kind: "rescan",
      pathId: s.repoPath.id,
      path: s.repoPath.path,
      status: "pending",
    });
  });

  test("rescan rejects worktree entries; remove rejects regular paths", async () => {
    const s = await setup();

    await expect(
      s.asUser.mutation(api.cli.worktreeOps.enqueue, {
        profileId: s.profile._id,
        kind: "rescan",
        pathId: s.worktreePath.id,
      })
    ).rejects.toThrow("Worktrees can only be created from a repository path");

    await expect(
      s.asUser.mutation(api.cli.worktreeOps.enqueue, {
        profileId: s.profile._id,
        kind: "remove",
        pathId: s.repoPath.id,
      })
    ).rejects.toThrow("Only worktree paths can be removed");
  });

  test("remove is rejected while a claimed thread runs in the worktree", async () => {
    const s = await setup();
    await s.ctx.cliThread(s.user._id, s.project._id, s.profile._id, {
      pathId: s.worktreePath.id,
      path: s.worktreePath.path,
      status: "streaming",
      processingState: "streaming",
      claimedBySessionId: s.session._id,
      claimLeaseExpiresAt: Date.now() + 60_000,
    });

    await expect(
      s.asUser.mutation(api.cli.worktreeOps.enqueue, {
        profileId: s.profile._id,
        kind: "remove",
        pathId: s.worktreePath.id,
      })
    ).rejects.toThrow("A thread is currently running in this worktree");
  });

  test("remove op carries the parent path and completes done/failed", async () => {
    const s = await setup();

    const opId = await s.asUser.mutation(api.cli.worktreeOps.enqueue, {
      profileId: s.profile._id,
      kind: "remove",
      pathId: s.worktreePath.id,
    });

    const pending = await s.t.query(api.cli.worktreeOps.listPending, {
      profileId: s.profile._id,
      apiKey: s.apiKey,
    });
    expect(pending[0]).toMatchObject({
      kind: "remove",
      path: s.worktreePath.path,
      parentPath: s.repoPath.path,
    });

    await s.t.mutation(api.cli.worktreeOps.complete, {
      opId,
      sessionId: s.session._id,
      error: "Worktree has uncommitted changes",
      apiKey: s.apiKey,
    });

    const op = await s.asUser.query(api.cli.worktreeOps.get, { opId });
    expect(op).toMatchObject({
      status: "failed",
      error: "Worktree has uncommitted changes",
    });

    // Completed ops cannot be completed again.
    await expect(
      s.t.mutation(api.cli.worktreeOps.complete, {
        opId,
        sessionId: s.session._id,
        apiKey: s.apiKey,
      })
    ).rejects.toThrow("Worktree operation is no longer pending");
  });

  test("rescan completion stores the result payload readable by the requester", async () => {
    const s = await setup();

    const opId = await s.asUser.mutation(api.cli.worktreeOps.enqueue, {
      profileId: s.profile._id,
      kind: "rescan",
      pathId: s.repoPath.id,
    });

    const resultJson = JSON.stringify({
      refs: [{ name: "main", isCurrent: true, remoteOnly: false }],
    });
    await s.t.mutation(api.cli.worktreeOps.complete, {
      opId,
      sessionId: s.session._id,
      resultJson,
      apiKey: s.apiKey,
    });

    const op = await s.asUser.query(api.cli.worktreeOps.get, { opId });
    expect(op).toMatchObject({ status: "done", resultJson });

    // Another user cannot read the op.
    const stranger = await s.ctx.user();
    const asStranger = s.ctx.asUser(stranger);
    expect(await asStranger.query(api.cli.worktreeOps.get, { opId })).toBeNull();
  });

  test("file ops require file path and checkpoint refs", async () => {
    const s = await setup();

    await expect(
      s.asUser.mutation(api.cli.worktreeOps.enqueue, {
        profileId: s.profile._id,
        kind: "readFile",
        pathId: s.repoPath.id,
        postRef: "refs/convoy/checkpoints/t/b/post",
      })
    ).rejects.toThrow("File operation requires a file path and checkpoint refs");

    await expect(
      s.asUser.mutation(api.cli.worktreeOps.enqueue, {
        profileId: s.profile._id,
        kind: "diffFile",
        pathId: s.repoPath.id,
        filePath: "src/index.ts",
        postRef: "refs/convoy/checkpoints/t/b/post",
      })
    ).rejects.toThrow("File operation requires a file path and checkpoint refs");

    // diffFile without a filePath is valid — it requests the whole-run diff.
    const opId = await s.asUser.mutation(api.cli.worktreeOps.enqueue, {
      profileId: s.profile._id,
      kind: "diffFile",
      pathId: s.repoPath.id,
      preRef: "refs/convoy/checkpoints/t/b/pre",
      postRef: "refs/convoy/checkpoints/t/b/post",
    });
    const op = await s.asUser.query(api.cli.worktreeOps.get, { opId });
    expect(op).toMatchObject({ kind: "diffFile", status: "pending" });
    expect(op?.filePath).toBeUndefined();
  });

  test("readFile without a checkpoint ref reads the working tree (OS-2041)", async () => {
    const s = await setup();

    const opId = await s.asUser.mutation(api.cli.worktreeOps.enqueue, {
      profileId: s.profile._id,
      kind: "readFile",
      pathId: s.repoPath.id,
      filePath: "src/index.ts",
    });
    const op = await s.asUser.query(api.cli.worktreeOps.get, { opId });
    expect(op).toMatchObject({ kind: "readFile", status: "pending", filePath: "src/index.ts" });
    expect(op?.postRef).toBeUndefined();

    // The file path is still required.
    await expect(
      s.asUser.mutation(api.cli.worktreeOps.enqueue, {
        profileId: s.profile._id,
        kind: "readFile",
        pathId: s.repoPath.id,
      })
    ).rejects.toThrow("File operation requires a file path and checkpoint refs");
  });

  test("downloadFile uploads to storage, serves a download URL, and prunes the blob (OS-2050)", async () => {
    const s = await setup();

    await expect(
      s.asUser.mutation(api.cli.worktreeOps.enqueue, { profileId: s.profile._id, kind: "downloadFile", pathId: s.repoPath.id })
    ).rejects.toThrow("File operation requires a file path and checkpoint refs");

    const opId = await s.asUser.mutation(api.cli.worktreeOps.enqueue, {
      profileId: s.profile._id,
      kind: "downloadFile",
      pathId: s.repoPath.id,
      filePath: "assets/logo.png",
    });

    // The CLI asks for an upload URL for this op only.
    const uploadUrl = await s.t.mutation(api.cli.worktreeOps.generateUploadUrl, { opId, sessionId: s.session._id, apiKey: s.apiKey });
    expect(uploadUrl).toMatch(/^http/);
    const storageId = await s.t.run((ctx) => ctx.storage.store(new Blob(["png-bytes"])));
    await s.t.mutation(api.cli.worktreeOps.complete, { opId, sessionId: s.session._id, storageId, apiKey: s.apiKey });

    const op = await s.asUser.query(api.cli.worktreeOps.get, { opId });
    expect(op).toMatchObject({ status: "done", filePath: "assets/logo.png" });
    expect(op?.downloadUrl).toMatch(/^http/);

    // The browser saved it: the requester discards the blob and the row at once.
    await s.asUser.mutation(api.cli.worktreeOps.discard, { opId });
    expect(await s.asUser.query(api.cli.worktreeOps.get, { opId })).toBeNull();
    expect(await s.t.run((ctx) => ctx.db.system.get("_storage", storageId))).toBeNull();
    // Discarding again (or after the TTL prune) is a no-op.
    await s.asUser.mutation(api.cli.worktreeOps.discard, { opId });

    // Upload URLs are not handed out for other kinds.
    const readId = await s.asUser.mutation(api.cli.worktreeOps.enqueue, {
      profileId: s.profile._id, kind: "readFile", pathId: s.repoPath.id, filePath: "a.ts",
    });
    await expect(
      s.t.mutation(api.cli.worktreeOps.generateUploadUrl, { opId: readId, sessionId: s.session._id, apiKey: s.apiKey })
    ).rejects.toThrow("Only download operations upload a file");
  });

  test("downloadFile blob is pruned with the row on the TTL, and a stranger cannot discard it (OS-2050)", async () => {
    const s = await setup();
    const opId = await s.asUser.mutation(api.cli.worktreeOps.enqueue, {
      profileId: s.profile._id, kind: "downloadFile", pathId: s.repoPath.id, filePath: "a.bin",
    });
    const storageId = await s.t.run((ctx) => ctx.storage.store(new Blob(["bytes"])));
    await s.t.mutation(api.cli.worktreeOps.complete, { opId, sessionId: s.session._id, storageId, apiKey: s.apiKey });

    const stranger = s.ctx.asUser(await s.ctx.user());
    await stranger.mutation(api.cli.worktreeOps.discard, { opId });
    expect(await s.t.run((ctx) => ctx.db.system.get("_storage", storageId))).not.toBeNull();

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 1000);
    await s.t.finishInProgressScheduledFunctions();
    expect(await s.asUser.query(api.cli.worktreeOps.get, { opId })).toBeNull();
    expect(await s.t.run((ctx) => ctx.db.system.get("_storage", storageId))).toBeNull();
  });

  test("downloadFile completion rejects a blob over the size cap and deletes it (OS-2050)", async () => {
    const s = await setup();
    const opId = await s.asUser.mutation(api.cli.worktreeOps.enqueue, {
      profileId: s.profile._id, kind: "downloadFile", pathId: s.repoPath.id, filePath: "big.bin",
    });
    const storageId = await s.t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array(50 * 1024 * 1024 + 1)])));
    await s.t.mutation(api.cli.worktreeOps.complete, { opId, sessionId: s.session._id, storageId, apiKey: s.apiKey });

    const op = await s.asUser.query(api.cli.worktreeOps.get, { opId });
    expect(op).toMatchObject({ status: "failed", error: "File is too large to download (limit 50 MB)" });
    expect(op?.downloadUrl).toBeUndefined();
    expect(await s.t.run((ctx) => ctx.db.system.get("_storage", storageId))).toBeNull();
  });

  test("downloadFile completion refuses a blob another flow owns, and leaves it alone (OS-2050 review #1)", async () => {
    const s = await setup();
    // Another user's pending message attachment in the same project.
    const victim = s.ctx.asUser(await s.ctx.user());
    const victimBlob = await s.t.run((ctx) => ctx.storage.store(new Blob(["theirs"])));
    await s.t.run(async (ctx) => {
      await ctx.db.insert("cliMessagePendingUploads", {
        projectId: s.project._id,
        userId: (await ctx.db.query("users").collect()).at(-1)!._id,
        storageId: victimBlob,
        createdAt: Date.now(),
      });
    });
    void victim;

    const opId = await s.asUser.mutation(api.cli.worktreeOps.enqueue, {
      profileId: s.profile._id, kind: "downloadFile", pathId: s.repoPath.id, filePath: "a.bin",
    });
    await s.t.mutation(api.cli.worktreeOps.complete, { opId, sessionId: s.session._id, storageId: victimBlob, apiKey: s.apiKey });
    const op = await s.asUser.query(api.cli.worktreeOps.get, { opId });
    expect(op).toMatchObject({ status: "failed", error: "Uploaded file is not this operation's upload" });
    expect(op?.downloadUrl).toBeUndefined();
    await s.asUser.mutation(api.cli.worktreeOps.discard, { opId });
    expect(await s.t.run((ctx) => ctx.db.system.get("_storage", victimBlob))).not.toBeNull();

    // A storageId only counts on a download op.
    const readId = await s.asUser.mutation(api.cli.worktreeOps.enqueue, {
      profileId: s.profile._id, kind: "readFile", pathId: s.repoPath.id, filePath: "a.ts",
    });
    const own = await s.t.run((ctx) => ctx.storage.store(new Blob(["mine"])));
    await expect(
      s.t.mutation(api.cli.worktreeOps.complete, { opId: readId, sessionId: s.session._id, storageId: own, apiKey: s.apiKey })
    ).rejects.toThrow("Only download operations upload a file");
  });

  test("a download blob cannot be claimed by the attachment flow (OS-2050 review #1)", async () => {
    const s = await setup();
    const opId = await s.asUser.mutation(api.cli.worktreeOps.enqueue, {
      profileId: s.profile._id, kind: "downloadFile", pathId: s.repoPath.id, filePath: "a.bin",
    });
    const storageId = await s.t.run((ctx) => ctx.storage.store(new Blob(["bytes"])));
    await s.t.mutation(api.cli.worktreeOps.complete, { opId, sessionId: s.session._id, storageId, apiKey: s.apiKey });

    // Refused silently (OS-1901): no pending row appears for the claimed blob.
    await s.asUser.mutation(api.cli.messages.registerPendingUploadedAttachment, { projectId: s.project._id, storageId });
    const rows = await s.t.run((ctx) =>
      ctx.db.query("cliMessagePendingUploads").withIndex("by_storageId", (q) => q.eq("storageId", storageId)).collect()
    );
    expect(rows).toEqual([]);
  });

  test("a late completion after the TTL prune deletes the orphaned upload (OS-2050 review #3)", async () => {
    const s = await setup();
    const opId = await s.asUser.mutation(api.cli.worktreeOps.enqueue, {
      profileId: s.profile._id, kind: "downloadFile", pathId: s.repoPath.id, filePath: "a.bin",
    });
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 1000);
    await s.t.finishInProgressScheduledFunctions();

    // Returns instead of throwing: a thrown mutation would roll the delete back.
    const storageId = await s.t.run((ctx) => ctx.storage.store(new Blob(["late"])));
    await s.t.mutation(api.cli.worktreeOps.complete, { opId, sessionId: s.session._id, storageId, apiKey: s.apiKey });
    expect(await s.t.run((ctx) => ctx.db.system.get("_storage", storageId))).toBeNull();
  });

  test("a completion naming a missing blob fails as not found, not as too large (OS-2050 review #8)", async () => {
    const s = await setup();
    const opId = await s.asUser.mutation(api.cli.worktreeOps.enqueue, {
      profileId: s.profile._id, kind: "downloadFile", pathId: s.repoPath.id, filePath: "a.bin",
    });
    const storageId = await s.t.run((ctx) => ctx.storage.store(new Blob(["gone"])));
    await s.t.run((ctx) => ctx.storage.delete(storageId));
    await s.t.mutation(api.cli.worktreeOps.complete, { opId, sessionId: s.session._id, storageId, apiKey: s.apiKey });
    expect(await s.asUser.query(api.cli.worktreeOps.get, { opId })).toMatchObject({ status: "failed", error: "Uploaded file not found" });
  });

  test("diffFile round-trips refs, file path, and the CLI result", async () => {
    const s = await setup();

    const preRef = "refs/convoy/checkpoints/t/b/pre";
    const postRef = "refs/convoy/checkpoints/t/b/post";
    const opId = await s.asUser.mutation(api.cli.worktreeOps.enqueue, {
      profileId: s.profile._id,
      kind: "diffFile",
      pathId: s.repoPath.id,
      filePath: "src/index.ts",
      preRef,
      postRef,
    });

    const pending = await s.t.query(api.cli.worktreeOps.listPending, {
      profileId: s.profile._id,
      apiKey: s.apiKey,
    });
    expect(pending[0]).toMatchObject({
      kind: "diffFile",
      path: s.repoPath.path,
      filePath: "src/index.ts",
      preRef,
      postRef,
    });

    const resultJson = JSON.stringify({ patch: "@@ -1 +1 @@\n-a\n+b", truncated: false });
    await s.t.mutation(api.cli.worktreeOps.complete, {
      opId,
      sessionId: s.session._id,
      resultJson,
      apiKey: s.apiKey,
    });
    const op = await s.asUser.query(api.cli.worktreeOps.get, { opId });
    expect(op).toMatchObject({ status: "done", resultJson });
  });

  test("permits legacy Undo only for the thread's verified current checkout", async () => {
    const s = await setup();
    const thread = await s.ctx.cliThread(s.user._id, s.project._id, s.profile._id, {
      pathId: s.repoPath.id, path: s.repoPath.path,
    });
    const opId = await s.asUser.mutation(api.cli.worktreeOps.enqueue, {
      profileId: s.profile._id, kind: "revertRun", pathId: s.repoPath.id,
      preRef: `refs/convoy/checkpoints/${thread._id}/run/pre`,
    });
    expect(await s.asUser.query(api.cli.worktreeOps.get, { opId }))
      .toMatchObject({ allowLegacyCheckpoint: true });
    const wrongTarget = await s.asUser.mutation(api.cli.worktreeOps.enqueue, {
      profileId: s.profile._id, kind: "revertRun", pathId: s.worktreePath.id,
      preRef: `refs/convoy/checkpoints/${thread._id}/run/pre`,
    });
    expect(await s.asUser.query(api.cli.worktreeOps.get, { opId: wrongTarget }))
      .toMatchObject({ allowLegacyCheckpoint: false });
  });

  test("revertRun requires preRef and rejects while a claimed thread runs in the path", async () => {
    const s = await setup();

    await expect(
      s.asUser.mutation(api.cli.worktreeOps.enqueue, {
        profileId: s.profile._id,
        kind: "revertRun",
        pathId: s.repoPath.id,
      })
    ).rejects.toThrow("File operation requires a file path and checkpoint refs");

    const opId = await s.asUser.mutation(api.cli.worktreeOps.enqueue, {
      profileId: s.profile._id,
      kind: "revertRun",
      pathId: s.repoPath.id,
      preRef: "refs/convoy/checkpoints/t/b/pre",
    });
    expect(await s.asUser.query(api.cli.worktreeOps.get, { opId })).toMatchObject({
      kind: "revertRun",
      status: "pending",
      preRef: "refs/convoy/checkpoints/t/b/pre",
    });

    // A claimed thread in the same path blocks the revert.
    await s.ctx.cliThread(s.user._id, s.project._id, s.profile._id, {
      pathId: s.repoPath.id,
      path: s.repoPath.path,
      status: "streaming",
      processingState: "streaming",
      claimedBySessionId: s.session._id,
      claimLeaseExpiresAt: Date.now() + 60_000,
    });
    await expect(
      s.asUser.mutation(api.cli.worktreeOps.enqueue, {
        profileId: s.profile._id,
        kind: "revertRun",
        pathId: s.repoPath.id,
        preRef: "refs/convoy/checkpoints/t/b/pre",
      })
    ).rejects.toThrow("A thread is currently running in this working directory");
  });

  test("revertFile requires preRef and filePath and persists the file path", async () => {
    const s = await setup();

    await expect(
      s.asUser.mutation(api.cli.worktreeOps.enqueue, {
        profileId: s.profile._id,
        kind: "revertFile",
        pathId: s.repoPath.id,
        preRef: "refs/convoy/checkpoints/t/b/pre",
      })
    ).rejects.toThrow("File operation requires a file path and checkpoint refs");

    const opId = await s.asUser.mutation(api.cli.worktreeOps.enqueue, {
      profileId: s.profile._id,
      kind: "revertFile",
      pathId: s.repoPath.id,
      preRef: "refs/convoy/checkpoints/t/b/pre",
      filePath: "src/index.ts",
    });
    expect(await s.asUser.query(api.cli.worktreeOps.get, { opId })).toMatchObject({
      kind: "revertFile",
      status: "pending",
      preRef: "refs/convoy/checkpoints/t/b/pre",
      filePath: "src/index.ts",
    });

    // Same in-use guard as the whole-run revert.
    await s.ctx.cliThread(s.user._id, s.project._id, s.profile._id, {
      pathId: s.repoPath.id,
      path: s.repoPath.path,
      status: "streaming",
      processingState: "streaming",
      claimedBySessionId: s.session._id,
      claimLeaseExpiresAt: Date.now() + 60_000,
    });
    await expect(
      s.asUser.mutation(api.cli.worktreeOps.enqueue, {
        profileId: s.profile._id,
        kind: "revertFile",
        pathId: s.repoPath.id,
        preRef: "refs/convoy/checkpoints/t/b/pre",
        filePath: "src/index.ts",
      })
    ).rejects.toThrow("A thread is currently running in this working directory");
  });

  test("searchFiles requires a query and round-trips it with the CLI result", async () => {
    const s = await setup();

    await expect(
      s.asUser.mutation(api.cli.worktreeOps.enqueue, {
        profileId: s.profile._id,
        kind: "searchFiles",
        pathId: s.repoPath.id,
      })
    ).rejects.toThrow("File search requires a query");

    // Empty string is valid (bare `@` lists the top files).
    const opId = await s.asUser.mutation(api.cli.worktreeOps.enqueue, {
      profileId: s.profile._id,
      kind: "searchFiles",
      pathId: s.repoPath.id,
      query: "",
    });
    expect(await s.asUser.query(api.cli.worktreeOps.get, { opId })).toMatchObject({
      kind: "searchFiles",
      status: "pending",
      query: "",
      path: s.repoPath.path,
    });

    const resultJson = JSON.stringify({ files: ["src/index.ts", "src/app.ts"] });
    await s.t.mutation(api.cli.worktreeOps.complete, {
      opId,
      sessionId: s.session._id,
      resultJson,
      apiKey: s.apiKey,
    });
    expect(await s.asUser.query(api.cli.worktreeOps.get, { opId })).toMatchObject({
      status: "done",
      resultJson,
    });
  });

  test("searchFiles rows are pruned on the shorter file-op TTL", async () => {
    const s = await setup();

    const opId = await s.asUser.mutation(api.cli.worktreeOps.enqueue, {
      profileId: s.profile._id,
      kind: "searchFiles",
      pathId: s.repoPath.id,
      query: "index",
    });

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 1000);
    await s.t.finishInProgressScheduledFunctions();

    expect(await s.asUser.query(api.cli.worktreeOps.get, { opId })).toBeNull();
  });

  test("worktreeChanges needs only the path and is pruned on the file-op TTL", async () => {
    const s = await setup();

    const opId = await s.asUser.mutation(api.cli.worktreeOps.enqueue, {
      profileId: s.profile._id,
      kind: "worktreeChanges",
      pathId: s.worktreePath.id,
    });
    expect(await s.asUser.query(api.cli.worktreeOps.get, { opId })).toMatchObject({
      kind: "worktreeChanges",
      status: "pending",
      path: s.worktreePath.path,
    });

    const resultJson = JSON.stringify({ patch: "diff --git a/x b/x\n", truncated: false });
    await s.t.mutation(api.cli.worktreeOps.complete, {
      opId,
      sessionId: s.session._id,
      resultJson,
      apiKey: s.apiKey,
    });
    expect(await s.asUser.query(api.cli.worktreeOps.get, { opId })).toMatchObject({ status: "done", resultJson });

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 1000);
    await s.t.finishInProgressScheduledFunctions();
    expect(await s.asUser.query(api.cli.worktreeOps.get, { opId })).toBeNull();
  });

  test("gitLog carries the cursor to the CLI and is pruned on the file-op TTL (OS-2534)", async () => {
    const s = await setup();

    const opId = await s.asUser.mutation(api.cli.worktreeOps.enqueue, {
      profileId: s.profile._id,
      kind: "gitLog",
      pathId: s.repoPath.id,
      cursor: `${"a".repeat(40)}:50`,
      postRef: "ignored",
    });
    const [pending] = await s.t.query(api.cli.worktreeOps.listPending, { profileId: s.profile._id, apiKey: s.apiKey });
    expect(pending).toMatchObject({ kind: "gitLog", path: s.repoPath.path, cursor: `${"a".repeat(40)}:50` });
    expect(pending.postRef).toBeUndefined();

    await expect(
      s.asUser.mutation(api.cli.worktreeOps.enqueue, { profileId: s.profile._id, kind: "gitLog", pathId: s.repoPath.id, cursor: "--all:0" })
    ).rejects.toThrow("History cursor is invalid");

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 1000);
    await s.t.finishInProgressScheduledFunctions();
    expect(await s.asUser.query(api.cli.worktreeOps.get, { opId })).toBeNull();
  });

  test("commitPatch requires a commit hash and carries it as postRef (OS-2534)", async () => {
    const s = await setup();

    for (const postRef of [undefined, "--output=/tmp/x", "HEAD"]) {
      await expect(
        s.asUser.mutation(api.cli.worktreeOps.enqueue, {
          profileId: s.profile._id,
          kind: "commitPatch",
          pathId: s.worktreePath.id,
          ...(postRef ? { postRef } : {}),
        })
      ).rejects.toThrow("Commit patch requires a commit hash");
    }

    const hash = "0123456789abcdef0123456789abcdef01234567";
    await s.asUser.mutation(api.cli.worktreeOps.enqueue, {
      profileId: s.profile._id,
      kind: "commitPatch",
      pathId: s.worktreePath.id,
      postRef: hash,
    });
    const [pending] = await s.t.query(api.cli.worktreeOps.listPending, { profileId: s.profile._id, apiKey: s.apiKey });
    expect(pending).toMatchObject({ kind: "commitPatch", path: s.worktreePath.path, postRef: hash });
  });

  test("revertWorkingFile needs a file path, no refs, and is pruned on the file-op TTL", async () => {
    const s = await setup();

    await expect(
      s.asUser.mutation(api.cli.worktreeOps.enqueue, {
        profileId: s.profile._id,
        kind: "revertWorkingFile",
        pathId: s.worktreePath.id,
      })
    ).rejects.toThrow("File operation requires a file path and checkpoint refs");

    const opId = await s.asUser.mutation(api.cli.worktreeOps.enqueue, {
      profileId: s.profile._id,
      kind: "revertWorkingFile",
      pathId: s.worktreePath.id,
      filePath: "src/index.ts",
    });
    expect(await s.asUser.query(api.cli.worktreeOps.get, { opId })).toMatchObject({
      kind: "revertWorkingFile",
      status: "pending",
      path: s.worktreePath.path,
      filePath: "src/index.ts",
    });

    // Same in-use guard as the checkpoint reverts.
    await s.ctx.cliThread(s.user._id, s.project._id, s.profile._id, {
      pathId: s.worktreePath.id,
      path: s.worktreePath.path,
      status: "streaming",
      processingState: "streaming",
      claimedBySessionId: s.session._id,
      claimLeaseExpiresAt: Date.now() + 60_000,
    });
    await expect(
      s.asUser.mutation(api.cli.worktreeOps.enqueue, {
        profileId: s.profile._id,
        kind: "revertWorkingFile",
        pathId: s.worktreePath.id,
        filePath: "src/index.ts",
      })
    ).rejects.toThrow("A thread is currently running in this working directory");

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 1000);
    await s.t.finishInProgressScheduledFunctions();
    expect(await s.asUser.query(api.cli.worktreeOps.get, { opId })).toBeNull();
  });

  test("revertWorkingTree carries the listed file paths to the CLI (OS-2234)", async () => {
    const s = await setup();
    const enqueue = (filePaths?: string[]) =>
      s.asUser.mutation(api.cli.worktreeOps.enqueue, {
        profileId: s.profile._id,
        kind: "revertWorkingTree",
        pathId: s.worktreePath.id,
        ...(filePaths ? { filePaths } : {}),
      });

    await expect(enqueue()).rejects.toThrow("Revert all requires between 1 and 2000 file paths");
    await expect(enqueue([])).rejects.toThrow("Revert all requires between 1 and 2000 file paths");
    await expect(enqueue(Array.from({ length: 2001 }, (_, i) => `f${i}.ts`))).rejects.toThrow(
      "Revert all requires between 1 and 2000 file paths"
    );

    const opId = await enqueue(["a.ts", "src/b.ts"]);
    const pending = await s.t.query(api.cli.worktreeOps.listPending, {
      profileId: s.profile._id,
      apiKey: s.apiKey,
    });
    expect(pending.find((op) => op._id === opId)).toMatchObject({
      kind: "revertWorkingTree",
      path: s.worktreePath.path,
      filePaths: ["a.ts", "src/b.ts"],
    });

    // Same in-use guard as the other reverts.
    await s.ctx.cliThread(s.user._id, s.project._id, s.profile._id, {
      pathId: s.worktreePath.id,
      path: s.worktreePath.path,
      status: "streaming",
      processingState: "streaming",
      claimedBySessionId: s.session._id,
      claimLeaseExpiresAt: Date.now() + 60_000,
    });
    await expect(enqueue(["a.ts"])).rejects.toThrow("A thread is currently running in this working directory");

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 1000);
    await s.t.finishInProgressScheduledFunctions();
    expect(await s.asUser.query(api.cli.worktreeOps.get, { opId })).toBeNull();
  });

  test("file op rows are pruned on the shorter file-op TTL", async () => {
    const s = await setup();

    const opId = await s.asUser.mutation(api.cli.worktreeOps.enqueue, {
      profileId: s.profile._id,
      kind: "readFile",
      pathId: s.repoPath.id,
      filePath: "src/index.ts",
      postRef: "refs/convoy/checkpoints/t/b/post",
    });

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 1000);
    await s.t.finishInProgressScheduledFunctions();

    expect(await s.asUser.query(api.cli.worktreeOps.get, { opId })).toBeNull();
  });
});

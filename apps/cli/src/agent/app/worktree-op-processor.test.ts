import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runGit } from "../../lib/git/exec.js";
import { createWorktreeOpProcessor, type PendingWorktreeOp } from "./worktree-op-processor.js";

describe("worktree op processor", () => {
  it("fails an op kind this CLI does not know with an update hint", async () => {
    const mutation = vi.fn().mockResolvedValue(null);
    const processor = createWorktreeOpProcessor({ mutation } as never, "session_1", "profile_1");

    processor.enqueue([
      {
        _id: "op_1",
        profileId: "profile_1",
        kind: "someFutureKind",
        pathId: "path_1",
        path: "/tmp/nowhere",
        status: "pending",
        createdAt: 0,
      } as unknown as PendingWorktreeOp,
    ]);

    await vi.waitFor(() => expect(mutation).toHaveBeenCalled());
    expect(mutation.mock.calls[0][1]).toMatchObject({
      opId: "op_1",
      error: expect.stringMatching(/update @useconvoy\/cli/i),
    });
  });

  describe("downloadFile (OS-2050)", () => {
    let repo: string;
    beforeEach(async () => {
      repo = await mkdtemp(join(tmpdir(), "convoy-op-processor-"));
      await writeFile(join(repo, "a.bin"), Buffer.from([1, 2, 3]));
    });
    afterEach(async () => {
      vi.unstubAllGlobals();
      await rm(repo, { recursive: true, force: true });
    });

    const op = (path: string) =>
      ({ _id: "op_1", profileId: "profile_1", kind: "downloadFile", pathId: "path_1", path, filePath: "a.bin", status: "pending", createdAt: 0 }) as unknown as PendingWorktreeOp;

    it("uploads the bytes to the op's upload URL and completes with the storageId", async () => {
      const mutation = vi.fn().mockResolvedValueOnce("https://upload.test/u").mockResolvedValue(null);
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ storageId: "st_1" }), { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
      const processor = createWorktreeOpProcessor({ mutation } as never, "session_1", "profile_1");

      processor.enqueue([op(repo)]);

      await vi.waitFor(() => expect(mutation).toHaveBeenCalledTimes(2));
      expect(mutation.mock.calls[0][1]).toMatchObject({ opId: "op_1", sessionId: "session_1" });
      expect(fetchMock).toHaveBeenCalledWith("https://upload.test/u", expect.objectContaining({ method: "POST" }));
      expect(Buffer.from(fetchMock.mock.calls[0][1].body)).toEqual(Buffer.from([1, 2, 3]));
      expect(mutation.mock.calls[1][1]).toMatchObject({ opId: "op_1", storageId: "st_1" });
    });

    it("fails the op when the upload is rejected", async () => {
      const mutation = vi.fn().mockResolvedValueOnce("https://upload.test/u").mockResolvedValue(null);
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })));
      const processor = createWorktreeOpProcessor({ mutation } as never, "session_1", "profile_1");

      processor.enqueue([op(repo)]);

      await vi.waitFor(() => expect(mutation).toHaveBeenCalledTimes(2));
      expect(mutation.mock.calls[1][1]).toMatchObject({ opId: "op_1", error: expect.stringMatching(/Upload failed: 500/) });
    });
  });
  describe("revertWorkingTree (OS-2234)", () => {
    let repo: string;
    beforeEach(async () => {
      repo = await mkdtemp(join(tmpdir(), "convoy-op-revert-tree-"));
      await runGit(repo, ["init", "--initial-branch=main"]);
      await writeFile(join(repo, "a.txt"), "a\n");
      await runGit(repo, ["add", "."]);
      await runGit(repo, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", "init"]);
    });
    afterEach(async () => {
      await rm(repo, { recursive: true, force: true });
    });

    const op = (path: string, filePaths?: string[]) =>
      ({ _id: "op_1", profileId: "profile_1", kind: "revertWorkingTree", pathId: "path_1", path, filePaths, status: "pending", createdAt: 0 }) as unknown as PendingWorktreeOp;

    it("reverts the listed files and completes the op", async () => {
      await writeFile(join(repo, "a.txt"), "changed\n");
      const mutation = vi.fn().mockResolvedValue(null);
      const processor = createWorktreeOpProcessor({ mutation } as never, "session_1", "profile_1");

      processor.enqueue([op(repo, ["a.txt"])]);

      await vi.waitFor(() => expect(mutation).toHaveBeenCalled());
      expect(mutation.mock.calls[0][1]).toMatchObject({ opId: "op_1" });
      expect(mutation.mock.calls[0][1]).not.toHaveProperty("error");
      expect(await readFile(join(repo, "a.txt"), "utf8")).toBe("a\n");
    });

    it("fails the op without a file list", async () => {
      const mutation = vi.fn().mockResolvedValue(null);
      const processor = createWorktreeOpProcessor({ mutation } as never, "session_1", "profile_1");

      processor.enqueue([op(repo)]);

      await vi.waitFor(() => expect(mutation).toHaveBeenCalled());
      expect(mutation.mock.calls[0][1]).toMatchObject({ opId: "op_1", error: "Missing file paths" });
    });
  });
  describe("gitLog and commitPatch (OS-2534)", () => {
    let repo: string;
    let hash: string;
    beforeEach(async () => {
      repo = await mkdtemp(join(tmpdir(), "convoy-op-history-"));
      await runGit(repo, ["init", "--initial-branch=main"]);
      await writeFile(join(repo, "a.txt"), "a\n");
      await runGit(repo, ["add", "."]);
      await runGit(repo, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", "init"]);
      hash = (await runGit(repo, ["rev-parse", "HEAD"])).stdout.trim();
    });
    afterEach(async () => {
      await rm(repo, { recursive: true, force: true });
    });

    const op = (kind: string, extra: Record<string, unknown>) =>
      ({ _id: "op_1", profileId: "profile_1", kind, pathId: "path_1", path: repo, status: "pending", createdAt: 0, ...extra }) as unknown as PendingWorktreeOp;

    async function result(pending: PendingWorktreeOp): Promise<Record<string, unknown>> {
      const mutation = vi.fn().mockResolvedValue(null);
      createWorktreeOpProcessor({ mutation } as never, "session_1", "profile_1").enqueue([pending]);
      await vi.waitFor(() => expect(mutation).toHaveBeenCalled());
      return mutation.mock.calls[0][1];
    }

    it("answers gitLog with the first page", async () => {
      const completion = await result(op("gitLog", {}));
      expect(JSON.parse(completion.resultJson as string)).toMatchObject({ commits: [{ hash, subject: "init" }] });
    });

    it("answers commitPatch with the commit named in postRef", async () => {
      const completion = await result(op("commitPatch", { postRef: hash }));
      expect(JSON.parse(completion.resultJson as string)).toMatchObject({ patch: expect.stringContaining("+++ b/a.txt"), truncated: false });
    });

    it("fails commitPatch without a commit", async () => {
      expect(await result(op("commitPatch", {}))).toMatchObject({ error: "Missing commit hash" });
    });
  });
});

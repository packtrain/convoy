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

    it("answers a branch-scoped gitLog with the branch's commits and its fork point (OS-2595)", async () => {
      await runGit(repo, ["checkout", "-q", "-b", "feature"]);
      await runGit(repo, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "feature"]);
      const completion = await result(op("gitLog", { scope: "branch" }));
      expect(JSON.parse(completion.resultJson as string)).toMatchObject({
        commits: [{ subject: "feature" }],
        fork: { ref: "main", hash, behind: 0 },
      });
    });

    describe("worktreeChanges vs main (OS-2596)", () => {
      const commitFile = async (file: string, content: string, message: string) => {
        await writeFile(join(repo, file), content);
        await runGit(repo, ["add", "."]);
        await runGit(repo, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", message]);
      };
      const changedPaths = async (extra: Record<string, unknown>) => {
        const completion = await result(op("worktreeChanges", extra));
        const { patch } = JSON.parse(completion.resultJson as string) as { patch: string };
        return [...patch.matchAll(/^diff --git a\/(\S+)/gm)].map((match) => match[1]);
      };

      it("diffs the working tree against the merge-base: committed, uncommitted and untracked, not main's newer commits", async () => {
        await runGit(repo, ["checkout", "-q", "-b", "feature"]);
        await commitFile("committed.txt", "c\n", "feature work");
        await runGit(repo, ["checkout", "-q", "main"]);
        await commitFile("main-only.txt", "m\n", "main moves on");
        await runGit(repo, ["checkout", "-q", "feature"]);
        await writeFile(join(repo, "a.txt"), "edited\n");
        await writeFile(join(repo, "untracked.txt"), "u\n");

        expect(await changedPaths({ scope: "branch" })).toEqual(["a.txt", "committed.txt", "untracked.txt"]);
        expect(await changedPaths({})).toEqual(["a.txt", "untracked.txt"]);
      });

      it("takes the newer merge-base: origin/main when the branch started from it", async () => {
        await commitFile("fetched.txt", "f\n", "fetched");
        await runGit(repo, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
        await runGit(repo, ["reset", "-q", "--hard", "HEAD~1"]);
        await runGit(repo, ["checkout", "-q", "-b", "feature", "origin/main"]);
        await commitFile("feature.txt", "x\n", "feature work");

        expect(await changedPaths({ scope: "branch" })).toEqual(["feature.txt"]);
      });

      it("fails when there is no default branch to compare with", async () => {
        await runGit(repo, ["branch", "-m", "trunk"]);

        expect((await result(op("worktreeChanges", { scope: "branch" }))).error).toBe("No default branch to compare with");
      });
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

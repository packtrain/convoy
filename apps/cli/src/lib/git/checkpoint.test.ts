import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runGit } from "./exec.js";
import {
  capturePreRunCheckpoint,
  captureRunDiffSummary,
  diffBetweenRefs,
  parseDiffSummary,
  readFileAtRef,
  revertToCheckpoint,
} from "./checkpoint.js";

describe("parseDiffSummary", () => {
  it("joins numstat counts with name-status kinds", () => {
    const numstat = "10\t2\tsrc/a.ts\0" + "0\t5\tsrc/b.ts\0" + "3\t0\tsrc/new.ts\0";
    const nameStatus = "M\0src/a.ts\0" + "D\0src/b.ts\0" + "A\0src/new.ts\0";

    expect(parseDiffSummary(numstat, nameStatus)).toEqual([
      { path: "src/a.ts", kind: "modified", additions: 10, deletions: 2 },
      { path: "src/b.ts", kind: "deleted", additions: 0, deletions: 5 },
      { path: "src/new.ts", kind: "added", additions: 3, deletions: 0 },
    ]);
  });

  it("flags binary files and zeroes their counts", () => {
    expect(parseDiffSummary("-\t-\tlogo.png\0", "A\0logo.png\0")).toEqual([
      { path: "logo.png", kind: "added", additions: 0, deletions: 0, binary: true },
    ]);
  });

  it("returns empty for empty diffs", () => {
    expect(parseDiffSummary("", "")).toEqual([]);
  });
});

describe("checkpoint capture (real git)", () => {
  let repo: string;

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), "convoy-checkpoint-test-"));
    await runGit(repo, ["init", "--initial-branch=main"]);
    await runGit(repo, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "--allow-empty", "-m", "init"]);
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it.each([undefined, "file.txt"])("refuses to undo a worktree checkpoint in the recovered parent: %s", async (filePath) => {
    const checkout = join(repo, "checkout");
    await runGit(repo, ["worktree", "add", "-b", "feature", checkout]);
    await writeFile(join(checkout, "file.txt"), "worktree contents\n");
    await capturePreRunCheckpoint(checkout, "thread1", "batch1");
    await runGit(repo, ["worktree", "remove", "--force", checkout]);
    await expect(revertToCheckpoint(repo, "refs/convoy/checkpoints/thread1/batch1/pre", filePath)).rejects.toThrow("different working directory");
  });

  it("undoes a checkpoint in the same worktree after it moves", async () => {
    const checkout = join(repo, "checkout");
    const moved = join(repo, "moved");
    await runGit(repo, ["worktree", "add", "-b", "feature", checkout]);
    await writeFile(join(checkout, "file.txt"), "before");
    await capturePreRunCheckpoint(checkout, "thread1", "move");
    await runGit(repo, ["worktree", "move", checkout, moved]);
    await writeFile(join(moved, "file.txt"), "after");
    await revertToCheckpoint(moved, "refs/convoy/checkpoints/thread1/move/pre", "file.txt");
    expect(await readFile(join(moved, "file.txt"), "utf8")).toBe("before");
  });

  it("restores a legacy checkpoint only with verified checkout provenance", async () => {
    await writeFile(join(repo, "file.txt"), "before");
    await capturePreRunCheckpoint(repo, "thread1", "legacy");
    const ref = "refs/convoy/checkpoints/thread1/legacy/pre";
    const tree = (await runGit(repo, ["rev-parse", `${ref}^{tree}`])).stdout.trim();
    const legacy = (await runGit(repo, ["-c", "user.name=t", "-c", "user.email=t@t",
      "commit-tree", tree, "-m", "legacy checkpoint"])).stdout.trim();
    await runGit(repo, ["update-ref", ref, legacy]);
    await writeFile(join(repo, "file.txt"), "after");
    await expect(revertToCheckpoint(repo, ref, "file.txt")).rejects.toThrow("cannot be safely undone");
    await revertToCheckpoint(repo, ref, "file.txt", { allowLegacy: true });
    expect(await readFile(join(repo, "file.txt"), "utf8")).toBe("before");
  });

  it("captures pre/post snapshots and summarizes untracked + modified files without touching the index", async () => {
    await writeFile(join(repo, "tracked.txt"), "one\n");
    await runGit(repo, ["add", "tracked.txt"]);
    await runGit(repo, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", "add tracked"]);

    expect(await capturePreRunCheckpoint(repo, "thread1", "batch1")).toBe(true);

    await writeFile(join(repo, "tracked.txt"), "one\ntwo\n");
    await writeFile(join(repo, "untracked.txt"), "new file\n");

    const summary = await captureRunDiffSummary(repo, "thread1", "batch1");
    expect(summary).toEqual({
      preRef: "refs/convoy/checkpoints/thread1/batch1/pre",
      postRef: "refs/convoy/checkpoints/thread1/batch1/post",
      files: [
        { path: "tracked.txt", kind: "modified", additions: 1, deletions: 0 },
        { path: "untracked.txt", kind: "added", additions: 1, deletions: 0 },
      ],
    });

    // The user's real index and status must be untouched.
    const status = await runGit(repo, ["status", "--porcelain"]);
    expect(status.stdout).toContain("?? untracked.txt");
    expect(status.stdout).toContain(" M tracked.txt");
  });

  it("returns null when the run changed nothing", async () => {
    expect(await capturePreRunCheckpoint(repo, "thread1", "batch2")).toBe(true);
    expect(await captureRunDiffSummary(repo, "thread1", "batch2")).toBeNull();
  });

  it("reads file content and one-file / whole-run patches from checkpoint refs", async () => {
    await writeFile(join(repo, "a.txt"), "one\n");
    expect(await capturePreRunCheckpoint(repo, "thread1", "batch1")).toBe(true);
    await writeFile(join(repo, "a.txt"), "one\ntwo\n");
    await writeFile(join(repo, "b.txt"), "new\n");
    const summary = await captureRunDiffSummary(repo, "thread1", "batch1");
    expect(summary).not.toBeNull();
    const { preRef, postRef } = summary as NonNullable<typeof summary>;

    expect(await readFileAtRef(repo, postRef, "a.txt")).toEqual({ content: "one\ntwo\n", truncated: false });

    const fileDiff = await diffBetweenRefs(repo, preRef, postRef, "a.txt");
    expect(fileDiff.truncated).toBe(false);
    expect(fileDiff.patch).toContain("--- a/a.txt");
    expect(fileDiff.patch).toContain("+two");
    expect(fileDiff.patch).not.toContain("b.txt");

    const runDiff = await diffBetweenRefs(repo, preRef, postRef);
    expect(runDiff.patch).toContain("+++ b/a.txt");
    expect(runDiff.patch).toContain("+++ b/b.txt");
  });

  it("rejects missing and binary blobs in readFileAtRef", async () => {
    await writeFile(join(repo, "bin.dat"), Buffer.from([0, 1, 2, 3]));
    expect(await capturePreRunCheckpoint(repo, "thread1", "batch3")).toBe(true);
    await writeFile(join(repo, "bin.dat"), Buffer.from([0, 1, 2, 3, 4]));
    const summary = await captureRunDiffSummary(repo, "thread1", "batch3");
    const { postRef } = summary as NonNullable<typeof summary>;

    await expect(readFileAtRef(repo, postRef, "nope.txt")).rejects.toThrow("File not found at this checkpoint");
    await expect(readFileAtRef(repo, postRef, "bin.dat")).rejects.toThrow("Binary file");
  });

  it("reverts the working tree to the pre-run checkpoint", async () => {
    await writeFile(join(repo, "a.txt"), "original\n");
    expect(await capturePreRunCheckpoint(repo, "thread1", "batch1")).toBe(true);
    // The "run" modifies a file and adds a new one.
    await writeFile(join(repo, "a.txt"), "changed\n");
    await writeFile(join(repo, "created.txt"), "new\n");

    await revertToCheckpoint(repo, "refs/convoy/checkpoints/thread1/batch1/pre");

    const { readFile } = await import("node:fs/promises");
    expect(await readFile(join(repo, "a.txt"), "utf8")).toBe("original\n");
    await expect(readFile(join(repo, "created.txt"), "utf8")).rejects.toThrow();

    await expect(revertToCheckpoint(repo, "refs/convoy/checkpoints/thread1/nope/pre")).rejects.toThrow(
      "Checkpoint no longer exists"
    );
  });

  it("reverts a single file, leaving sibling changes intact (OS-1156)", async () => {
    const { readFile } = await import("node:fs/promises");
    await writeFile(join(repo, "a.txt"), "original\n");
    expect(await capturePreRunCheckpoint(repo, "thread1", "batch1")).toBe(true);
    // The "run" modifies a file and creates two more.
    await writeFile(join(repo, "a.txt"), "changed\n");
    await writeFile(join(repo, "created.txt"), "new\n");
    await writeFile(join(repo, "kept.txt"), "kept\n");
    const preRef = "refs/convoy/checkpoints/thread1/batch1/pre";

    // Modified file → restored from the checkpoint.
    await revertToCheckpoint(repo, preRef, "a.txt");
    expect(await readFile(join(repo, "a.txt"), "utf8")).toBe("original\n");
    expect(await readFile(join(repo, "kept.txt"), "utf8")).toBe("kept\n");

    // Run-created file (absent from the checkpoint) → deleted, even if staged.
    await runGit(repo, ["add", "created.txt"]);
    await revertToCheckpoint(repo, preRef, "created.txt");
    await expect(readFile(join(repo, "created.txt"), "utf8")).rejects.toThrow();
    const status = await runGit(repo, ["status", "--porcelain"]);
    expect(status.stdout).not.toContain("created.txt");
    expect(status.stdout).toContain("?? kept.txt");
  });

  it("skips non-git directories", async () => {
    const plainDir = await mkdtemp(join(tmpdir(), "convoy-nongit-"));
    try {
      expect(await capturePreRunCheckpoint(plainDir, "thread1", "batch1")).toBe(false);
    } finally {
      await rm(plainDir, { recursive: true, force: true });
    }
  });
});

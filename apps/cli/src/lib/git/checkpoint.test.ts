import { mkdtemp, rm, writeFile, readFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runGit } from "./exec.js";
import {
  capturePreRunCheckpoint,
  captureRunBaseline,
  captureRunChanges,
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

describe("multi-repo checkpoints (real git)", () => {
  let folder: string;
  const git = (repo: string, args: string[]) => runGit(join(folder, repo), ["-c", "user.name=t", "-c", "user.email=t@t", ...args]);
  const refsIn = async (repo: string) => (await runGit(join(folder, repo), ["for-each-ref", "--format=%(refname)", "refs/convoy/"])).stdout.trim();

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), "convoy-multi-repo-test-"));
    for (const repo of ["old-app", "new-app", "untouched"]) {
      await runGit(folder, ["init", "--initial-branch=main", repo]);
      await writeFile(join(folder, repo, "readme.md"), "one\n");
      await git(repo, ["add", "."]);
      await git(repo, ["commit", "-m", "init"]);
    }
  });

  afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  it("groups changed files by repo and leaves an untouched clean repo alone", async () => {
    await writeFile(join(folder, "old-app", "dirty.txt"), "before run\n");
    const baseline = await captureRunBaseline(folder, "thread1", "run1");
    expect(baseline?.kind).toBe("folder");
    // A clean repo gets no snapshot at run start.
    expect(await refsIn("new-app")).toBe("");

    await writeFile(join(folder, "old-app", "readme.md"), "one\ntwo\n");
    await writeFile(join(folder, "new-app", "added.txt"), "new\n");
    const summary = await captureRunChanges(folder, baseline!, "thread1", "run1");

    expect(summary).toEqual({
      preRef: "refs/convoy/checkpoints/thread1/run1/pre",
      postRef: "refs/convoy/checkpoints/thread1/run1/post",
      files: [
        { path: "added.txt", kind: "added", additions: 1, deletions: 0, repo: "new-app" },
        { path: "readme.md", kind: "modified", additions: 1, deletions: 0, repo: "old-app" },
      ],
      repos: [{ path: "new-app" }, { path: "old-app" }],
    });
    expect(await refsIn("untouched")).toBe("");
  });

  it("diffs a repo that was clean at start from its recorded HEAD, commits included", async () => {
    const baseline = await captureRunBaseline(folder, "thread1", "run1");
    await writeFile(join(folder, "new-app", "committed.txt"), "c\n");
    await git("new-app", ["add", "."]);
    await git("new-app", ["commit", "-m", "agent commit"]);

    const summary = await captureRunChanges(folder, baseline!, "thread1", "run1");
    expect(summary?.files).toEqual([{ path: "committed.txt", kind: "added", additions: 1, deletions: 0, repo: "new-app" }]);
  });

  it("reverts one file of a repo that was clean at start", async () => {
    const baseline = await captureRunBaseline(folder, "thread1", "run1");
    await writeFile(join(folder, "old-app", "readme.md"), "changed\n");
    await writeFile(join(folder, "new-app", "readme.md"), "changed too\n");
    await captureRunChanges(folder, baseline!, "thread1", "run1");

    await revertToCheckpoint(join(folder, "old-app"), "refs/convoy/checkpoints/thread1/run1/pre", "readme.md");
    expect(await readFile(join(folder, "old-app", "readme.md"), "utf8")).toBe("one\n");
    expect(await readFile(join(folder, "new-app", "readme.md"), "utf8")).toBe("changed too\n");
  });

  it("leaves out a repo whose capture fails and still reports the others", async () => {
    const baseline = await captureRunBaseline(folder, "thread1", "run1");
    await writeFile(join(folder, "old-app", "readme.md"), "changed\n");
    await writeFile(join(folder, "new-app", "readme.md"), "changed\n");
    await rm(join(folder, "old-app", ".git"), { recursive: true, force: true });

    const summary = await captureRunChanges(folder, baseline!, "thread1", "run1");
    expect(summary?.repos).toEqual([{ path: "new-app" }]);
  });

  it("caps the file list for the run as a whole, not per repo", async () => {
    const baseline = await captureRunBaseline(folder, "thread1", "run1");
    for (const repo of ["old-app", "new-app"]) {
      await Promise.all(Array.from({ length: 150 }, (_, i) => writeFile(join(folder, repo, `f${i}.txt`), "x\n")));
    }
    const summary = await captureRunChanges(folder, baseline!, "thread1", "run1");
    expect(summary?.files).toHaveLength(200);
    expect(summary?.truncated).toBe(true);
  });

  it("stops taking a repo's baseline after two timeouts", async () => {
    await writeFile(join(folder, "old-app", "dirty.txt"), "dirty\n");
    // A slow fsmonitor hook makes `git add` outlast the budget.
    const hook = join(folder, "slow-fsmonitor.sh");
    await writeFile(hook, "#!/bin/sh\nsleep 0.5\n", { mode: 0o755 });
    await git("old-app", ["config", "core.fsmonitor", hook]);
    for (const runId of ["run1", "run2"]) {
      const baseline = await captureRunBaseline(folder, "thread1", runId, { baselineTimeoutMs: 200 });
      expect(baseline?.kind === "folder" && baseline.repos.map((repo) => repo.relativePath)).toEqual(["new-app", "untouched"]);
    }
    const baseline = await captureRunBaseline(folder, "thread1", "run3");
    expect(baseline?.kind === "folder" && baseline.repos.map((repo) => repo.relativePath)).toEqual(["new-app", "untouched"]);
  });

  it("checkpoints the child repos of a folder inside another checkout, not the outer one", async () => {
    // outer repo → plain `projects/` → child repos
    const outer = await mkdtemp(join(tmpdir(), "convoy-outer-"));
    try {
      await runGit(outer, ["init", "--initial-branch=main"]);
      const projects = join(outer, "projects");
      await runGit(outer, ["init", "--initial-branch=main", join("projects", "app")]);
      await writeFile(join(projects, "app", "a.txt"), "one\n");
      await runGit(join(projects, "app"), ["add", "."]);
      await runGit(join(projects, "app"), ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", "init"]);

      const baseline = await captureRunBaseline(projects, "thread1", "run1");
      expect(baseline?.kind).toBe("folder");
      await writeFile(join(projects, "app", "a.txt"), "changed\n");
      const summary = await captureRunChanges(projects, baseline!, "thread1", "run1");
      expect(summary?.files.map((file) => `${file.repo}/${file.path}`)).toEqual(["app/a.txt"]);
    } finally {
      await rm(outer, { recursive: true, force: true });
    }
  });

  it("sees untracked files even with status.showUntrackedFiles=no", async () => {
    await git("old-app", ["config", "status.showUntrackedFiles", "no"]);
    await writeFile(join(folder, "old-app", "mine.txt"), "user's file\n");
    const baseline = await captureRunBaseline(folder, "thread1", "run1");
    await writeFile(join(folder, "old-app", "readme.md"), "changed\n");
    await writeFile(join(folder, "new-app", "only-added.txt"), "new\n");
    await git("new-app", ["config", "status.showUntrackedFiles", "no"]);

    const summary = await captureRunChanges(folder, baseline!, "thread1", "run1");
    // The user's file predates the run, and an added-only run still shows.
    expect(summary?.files.map((file) => `${file.repo}/${file.path}`)).toEqual(["new-app/only-added.txt", "old-app/readme.md"]);
  });

  it("reads repo state without touching the real index", async () => {
    const index = join(folder, "new-app", ".git", "index");
    // Same content, new mtime: a refreshing `git status` would rewrite the index.
    await utimes(join(folder, "new-app", "readme.md"), new Date(2020, 0, 1), new Date(2020, 0, 1));
    const before = await readFile(index);
    await captureRunBaseline(folder, "thread1", "run1");
    expect((await readFile(index)).equals(before)).toBe(true);
  });

  it("lists every changed repo when the file cap cuts one out", async () => {
    const baseline = await captureRunBaseline(folder, "thread1", "run1");
    await Promise.all(Array.from({ length: 210 }, (_, i) => writeFile(join(folder, "new-app", `f${i}.txt`), "x\n")));
    await writeFile(join(folder, "old-app", "readme.md"), "changed\n");
    const summary = await captureRunChanges(folder, baseline!, "thread1", "run1");
    expect(summary?.files).toHaveLength(200);
    expect(summary?.repos).toEqual([{ path: "new-app" }, { path: "old-app" }]);
  });

  it("counts a slow status in a clean repo against the budget, and only consecutive timeouts", async () => {
    const hook = join(folder, "slow-fsmonitor.sh");
    await writeFile(hook, "#!/bin/sh\nsleep 0.5\n", { mode: 0o755 });
    await git("new-app", ["config", "core.fsmonitor", hook]);
    const names = (baseline: Awaited<ReturnType<typeof captureRunBaseline>>) =>
      baseline?.kind === "folder" ? baseline.repos.map((repo) => repo.relativePath) : [];
    expect(names(await captureRunBaseline(folder, "thread1", "run1", { baselineTimeoutMs: 200 }))).toEqual(["old-app", "untouched"]);
    // A success in between resets the count.
    expect(names(await captureRunBaseline(folder, "thread1", "run2"))).toContain("new-app");
    expect(names(await captureRunBaseline(folder, "thread1", "run3", { baselineTimeoutMs: 200 }))).toEqual(["old-app", "untouched"]);
    expect(names(await captureRunBaseline(folder, "thread1", "run4"))).toContain("new-app");
  });

  it("counts every command of a dirty repo's snapshot against the budget, update-ref included", async () => {
    await writeFile(join(folder, "old-app", "dirty.txt"), "dirty\n");
    await writeFile(join(folder, "old-app", ".git", "hooks", "reference-transaction"), "#!/bin/sh\nsleep 0.5\n", { mode: 0o755 });
    const baseline = await captureRunBaseline(folder, "thread1", "run1", { baselineTimeoutMs: 300 });
    expect(baseline?.kind === "folder" && baseline.repos.map((repo) => repo.relativePath)).toEqual(["new-app", "untouched"]);
  });

  it("checkpoints a repo thread's whole folder, grouped by repo", async () => {
    const baseline = await captureRunBaseline(join(folder, "new-app"), "thread1", "run1", { folder });
    expect(baseline?.kind === "folder" && baseline.repos.map((repo) => repo.relativePath)).toEqual(["new-app", "old-app", "untouched"]);
    await writeFile(join(folder, "new-app", "readme.md"), "edited\n");
    await writeFile(join(folder, "old-app", "readme.md"), "edited\n");
    const summary = await captureRunChanges(join(folder, "new-app"), baseline!, "thread1", "run1");
    expect(summary?.files.map((file) => [file.repo, file.path])).toEqual([["new-app", "readme.md"], ["old-app", "readme.md"]]);
  });

  it("never drops a repo thread's own checkout for the folder's short baseline budget", async () => {
    await writeFile(join(folder, "new-app", "dirty.txt"), "dirty\n");
    await writeFile(join(folder, "new-app", ".git", "hooks", "reference-transaction"), "#!/bin/sh\nsleep 0.5\n", { mode: 0o755 });
    for (const runId of ["run1", "run2", "run3"]) {
      const baseline = await captureRunBaseline(join(folder, "new-app"), "thread1", runId, { folder, baselineTimeoutMs: 200 });
      expect(baseline?.kind === "folder" && baseline.repos.map((repo) => repo.relativePath)).toContain("new-app");
    }
  });

  it("checkpoints a worktree thread's worktree and the folder's other repos, not its repo's main checkout", async () => {
    await git("new-app", ["worktree", "add", "-b", "x", join(folder, "new-app-worktrees", "x")]);
    const cwd = join(folder, "new-app-worktrees", "x");
    const baseline = await captureRunBaseline(cwd, "thread1", "run1", { folder });
    // The main checkout shares the worktree's refs, so one run can't checkpoint both.
    expect(baseline?.kind === "folder" && baseline.repos.map((repo) => repo.relativePath)).toEqual(["new-app-worktrees/x", "old-app", "untouched"]);
    await writeFile(join(cwd, "readme.md"), "edited\n");
    await writeFile(join(folder, "old-app", "readme.md"), "edited\n");
    const summary = await captureRunChanges(cwd, baseline!, "thread1", "run1");
    expect(summary?.repos).toEqual([{ path: "new-app-worktrees/x" }, { path: "old-app" }]);
  });

  it("uses the single-repo capture when the folder is a repo, and nothing for a folder without repos", async () => {
    expect(await captureRunBaseline(join(folder, "old-app"), "thread1", "run1")).toEqual({ kind: "repo" });
    const empty = await mkdtemp(join(tmpdir(), "convoy-no-repos-"));
    try {
      expect(await captureRunBaseline(empty, "thread1", "run1")).toBeNull();
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, readFile, realpath, mkdir, cp, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGit } from "./exec.js";
import { buildDefaultWorktreePath, listWorktrees, parseWorktreeList, resolveExecutionWorkspace } from "./worktrees.js";
import { dedupeBranchRefs } from "../../agent/app/worktree-op-processor.js";

describe("execution workspace recovery (real git)", () => {
  let parent: string;
  let checkout: string;
  beforeEach(async () => {
    parent = await mkdtemp(join(tmpdir(), "convoy-workspace-test-"));
    checkout = join(parent, "checkout");
    await runGit(parent, ["init", "-b", "main"]);
    await runGit(parent, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "initial"]);
    await runGit(parent, ["worktree", "add", "-b", "feature", checkout]);
  });
  afterEach(() => rm(parent, { recursive: true, force: true }));

  async function savedWorktree() {
    const spec = { parentPathId: "parent", parentPath: parent, branch: "feature", status: "created" as const };
    const identity = await resolveExecutionWorkspace(checkout, spec);
    return { ...spec, repositoryId: identity.repositoryId, worktreeId: identity.worktreeId };
  }

  it("accepts a configured repository subdirectory and falls back to it", async () => {
    const subdir = join(parent, "app");
    await mkdir(subdir);
    const spec = { parentPath: subdir };
    const resolved = await resolveExecutionWorkspace(checkout, spec);
    expect(resolved.path).toBe(checkout);
    await runGit(parent, ["worktree", "remove", checkout]);
    expect(await resolveExecutionWorkspace(checkout, { ...spec, ...resolved }))
      .toMatchObject({ path: subdir, branch: "main" });
  });

  it("keeps a healthy checkout usable when Git metadata is restored onto new inodes", async () => {
    const saved = await savedWorktree();
    const original = join(parent, ".git");
    const copy = join(parent, "git-copy");
    await cp(original, copy, { recursive: true });
    await rm(original, { recursive: true });
    await rename(copy, original);
    expect(await resolveExecutionWorkspace(checkout, saved))
      .toMatchObject({ path: checkout, repositoryId: saved.repositoryId, worktreeId: saved.worktreeId });
  });

  it("finds a moved worktree by its identity after its branch changes", async () => {
    const saved = await savedWorktree();
    await runGit(checkout, ["switch", "-c", "renamed"]);
    const moved = join(parent, "moved");
    await runGit(parent, ["worktree", "move", checkout, moved]);
    expect(await resolveExecutionWorkspace(checkout, saved)).toMatchObject({ path: await realpath(moved), branch: "renamed", worktreeId: saved.worktreeId });
  });

  it("uses the parent's actual branch without changing its uncommitted files", async () => {
    const saved = await savedWorktree();
    await runGit(parent, ["worktree", "remove", checkout]);
    await runGit(parent, ["switch", "-c", "review"]);
    await writeFile(join(parent, "notes.txt"), "keep this");
    expect(await resolveExecutionWorkspace(checkout, saved)).toMatchObject({ path: parent, branch: "review" });
    expect(await readFile(join(parent, "notes.txt"), "utf8")).toBe("keep this");
  });

  it("rejects a replacement repository at the same parent path", async () => {
    const saved = await savedWorktree();
    await rm(parent, { recursive: true, force: true });
    await runGit(tmpdir(), ["init", "-b", "main", parent]);
    await expect(resolveExecutionWorkspace(checkout, saved)).rejects.toThrow("no longer matches");
  });

  it("rejects another checkout placed at the original path", async () => {
    const saved = await savedWorktree();
    await runGit(parent, ["worktree", "move", checkout, join(parent, "moved")]);
    await runGit(parent, ["worktree", "add", "-b", "other", checkout]);
    await expect(resolveExecutionWorkspace(checkout, saved)).rejects.toThrow("replaced by another checkout");
  });

  it("lists only worktrees whose directory exists on this machine", async () => {
    await runGit(parent, ["worktree", "add", "-b", "locked", join(parent, "locked")]);
    await runGit(parent, ["worktree", "lock", join(parent, "locked")]);
    await rm(checkout, { recursive: true });
    await rm(join(parent, "locked"), { recursive: true });
    expect((await listWorktrees(parent)).map((wt) => wt.branch)).toEqual(["main"]);
  });

  it("names the missing directory instead of reporting git as missing", async () => {
    await expect(runGit(join(parent, "missing"), ["status"])).rejects.toThrow(`Working directory does not exist: ${join(parent, "missing")}`);
  });

  it("does not guess a parent for ordinary missing paths", async () => {
    await expect(resolveExecutionWorkspace(join(parent, "missing"))).rejects.toThrow("No verified parent");
  });

  it("rejects missing parents and legacy parents with a changed remote", async () => {
    const saved = await savedWorktree();
    await expect(resolveExecutionWorkspace(checkout, { ...saved, parentPath: join(parent, "missing") })).rejects.toThrow("parent checkout is unavailable");
    await expect(resolveExecutionWorkspace(checkout, { ...saved, repositoryId: undefined, parentGitRemoteUrl: "https://example.com/original.git" })).rejects.toThrow("Git remote no longer matches");
  });
});

describe("parseWorktreeList", () => {
  it("parses main checkout, worktrees, and detached heads", () => {
    const porcelain = [
      "worktree /home/dev/repo",
      "HEAD 111",
      "branch refs/heads/main",
      "",
      "worktree /home/dev/repo-worktrees/feat-a",
      "HEAD 222",
      "branch refs/heads/feat/a",
      "",
      "worktree /home/dev/detached",
      "HEAD 333",
      "detached",
      "",
    ].join("\n");

    expect(parseWorktreeList(porcelain)).toEqual([
      { path: "/home/dev/repo", branch: "main", isMain: true },
      { path: "/home/dev/repo-worktrees/feat-a", branch: "feat/a", isMain: false },
      { path: "/home/dev/detached", branch: null, isMain: false },
    ]);
  });

  it("returns empty for empty output", () => {
    expect(parseWorktreeList("")).toEqual([]);
  });
});

describe("buildDefaultWorktreePath", () => {
  it("places worktrees in a sibling folder with slash-safe names", () => {
    expect(buildDefaultWorktreePath("/home/dev/repo", "feat/fix-login")).toBe("/home/dev/repo-worktrees/feat-fix-login");
  });
});

describe("dedupeBranchRefs", () => {
  it("collapses origin refs onto local branches and flags remote-only", () => {
    expect(
      dedupeBranchRefs([
        { name: "main", isCurrent: true, isRemote: false },
        { name: "feat/a", isCurrent: false, isRemote: false },
        { name: "origin/main", isCurrent: false, isRemote: true },
        { name: "origin/feat/b", isCurrent: false, isRemote: true },
      ])
    ).toEqual([
      { name: "main", isCurrent: true, remoteOnly: false },
      { name: "feat/a", isCurrent: false, remoteOnly: false },
      { name: "feat/b", isCurrent: false, remoteOnly: true },
    ]);
  });
});

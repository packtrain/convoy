import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runGit } from "./exec.js";
import { discoverRepositories, getCurrentBranch, listRepositoryPaths } from "./repo.js";

describe("getCurrentBranch (real git)", () => {
  let repo: string;

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), "convoy-repo-test-"));
    await runGit(repo, ["init", "--initial-branch=main"]);
    await runGit(repo, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "--allow-empty", "-m", "init"]);
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it("returns the checked-out branch", async () => {
    expect(await getCurrentBranch(repo)).toBe("main");
  });

  it("returns null for detached HEAD", async () => {
    await runGit(repo, ["checkout", "--detach"]);
    expect(await getCurrentBranch(repo)).toBeNull();
  });

  it("returns null for a non-git directory", async () => {
    const plain = await mkdtemp(join(tmpdir(), "convoy-nongit-test-"));
    try {
      expect(await getCurrentBranch(plain)).toBeNull();
    } finally {
      await rm(plain, { recursive: true, force: true });
    }
  });

  it("returns null for a missing directory", async () => {
    expect(await getCurrentBranch(join(repo, "missing"))).toBeNull();
  });
});

describe("discoverRepositories", () => {
  let root: string;
  const repoAt = async (relative: string, remote?: string) => {
    const dir = join(root, relative);
    await mkdir(dir, { recursive: true });
    await runGit(dir, ["init", "--initial-branch=main"]);
    await runGit(dir, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "--allow-empty", "-m", "init"]);
    if (remote) await runGit(dir, ["remote", "add", "origin", remote]);
    return dir;
  };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "convoy-discover-test-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("finds child repos and grandchild repos under plain folders, sorted by path", async () => {
    await repoAt("old-app", "git@github.com:acme/old-app.git");
    await repoAt("new-app");
    await repoAt("packages/api");
    await mkdir(join(root, "docs"));

    const repos = await discoverRepositories(root);

    expect(repos).toEqual([
      { path: join(root, "new-app"), relativePath: "new-app", branch: "main" },
      { path: join(root, "old-app"), relativePath: "old-app", gitRemoteUrl: "git@github.com:acme/old-app.git", branch: "main" },
      { path: join(root, "packages/api"), relativePath: "packages/api", branch: "main" },
    ]);
  });

  it("a repo folder is the only repo; its children are not scanned", async () => {
    await runGit(root, ["init", "--initial-branch=main"]);
    await runGit(root, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "--allow-empty", "-m", "init"]);
    await repoAt("vendor/lib");

    expect(await discoverRepositories(root)).toEqual([{ path: root, relativePath: ".", branch: "main" }]);
  });

  it("skips hidden, node_modules, *-worktrees, .git files and deeper levels", async () => {
    await repoAt(".hidden");
    await repoAt("node_modules/pkg");
    await repoAt("app-worktrees/feat");
    await repoAt("a/b/c");
    await mkdir(join(root, "linked"));
    await writeFile(join(root, "linked", ".git"), "gitdir: /elsewhere\n");
    await mkdir(join(root, "packages", "linked"), { recursive: true });
    await writeFile(join(root, "packages", "linked", ".git"), "gitdir: /elsewhere\n");

    expect(await discoverRepositories(root)).toEqual([]);
  });

  it("caps the list at 128 repos", async () => {
    await Promise.all(Array.from({ length: 130 }, (_, i) => mkdir(join(root, `r${String(i).padStart(3, "0")}`, ".git"), { recursive: true })));

    const repos = await discoverRepositories(root);

    expect(repos).toHaveLength(128);
    expect(repos.at(-1)?.relativePath).toBe("r127");
  });

  it("a missing or unreadable folder throws instead of reporting no repos", async () => {
    await expect(discoverRepositories(join(root, "missing"))).rejects.toThrow(/ENOENT/);
    await repoAt("packages/api");
    await chmod(join(root, "packages"), 0o000);
    try {
      await expect(discoverRepositories(root)).rejects.toThrow(/EACCES/);
    } finally { await chmod(join(root, "packages"), 0o755); }
  });

  it("lists repo paths without describing them, and a repo folder as itself", async () => {
    await repoAt("app");
    expect(await listRepositoryPaths(root)).toEqual([join(root, "app")]);
    expect(await listRepositoryPaths(join(root, "app"))).toEqual([join(root, "app")]);
  });

  it("drops credentials from a URL remote", async () => {
    await repoAt("app", "https://x-access-token:ghp_secret@github.com/acme/app.git");
    expect((await discoverRepositories(root))[0]?.gitRemoteUrl).toBe("https://github.com/acme/app.git");
  });
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runGit } from "./exec.js";
import { getCurrentBranch } from "./repo.js";

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

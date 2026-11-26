import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runGit } from "./exec.js";
import { MAX_FILE_OP_BYTES } from "./checkpoint.js";
import { COMMIT_PAGE_SIZE, MAX_REFS_PER_COMMIT, MAX_SUBJECT_CHARS, listCommits, readCommitPatch } from "./history.js";

const IDENTITY = ["-c", "user.name=Ada", "-c", "user.email=ada@example.com"];

describe("git history (real git)", () => {
  let repo: string;

  async function commit(file: string, content: string, message: string): Promise<string> {
    await writeFile(join(repo, file), content);
    await runGit(repo, ["add", file]);
    await runGit(repo, [...IDENTITY, "commit", "-q", "-m", message]);
    return (await runGit(repo, ["rev-parse", "HEAD"])).stdout.trim();
  }

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), "convoy-history-test-"));
    await runGit(repo, ["init", "-q", "--initial-branch=main"]);
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it("returns no commits on an unborn branch", async () => {
    expect(await listCommits(repo)).toEqual({ commits: [] });
  });

  it("lists commits newest first with parents, author, time, refs and subject", async () => {
    const first = await commit("a.txt", "one\n", "first");
    const second = await commit("a.txt", "two\n", "second\n\nbody line");

    const page = await listCommits(repo);

    expect(page.nextCursor).toBeUndefined();
    expect(page.commits).toHaveLength(2);
    expect(page.commits[0]).toMatchObject({
      hash: second,
      parents: [first],
      authorName: "Ada",
      authorEmail: "ada@example.com",
      refs: ["HEAD -> main"],
      subject: "second",
    });
    expect(page.commits[0].committedAt).toBeGreaterThan(1_000_000_000_000);
    expect(page.commits[1]).toMatchObject({ hash: first, parents: [], refs: [] });
  });

  it("pages from the first page's tip, so new commits do not shift later pages", async () => {
    for (let index = 0; index <= COMMIT_PAGE_SIZE; index++) {
      await runGit(repo, [...IDENTITY, "commit", "-q", "--allow-empty", "-m", `c${index}`]);
    }

    const first = await listCommits(repo);
    expect(first.commits).toHaveLength(COMMIT_PAGE_SIZE);
    expect(first.nextCursor).toBeDefined();

    await runGit(repo, [...IDENTITY, "commit", "-q", "--allow-empty", "-m", "newer"]);
    const second = await listCommits(repo, first.nextCursor);
    expect(second.commits.map((entry) => entry.subject)).toEqual(["c0"]);
    expect(second.nextCursor).toBeUndefined();
  });

  describe("with the default branch (OS-2536)", () => {
    // A worktree branch off main, with main merged back in once: the graph's lanes.
    async function branchWithMergeFromMain() {
      await commit("a.txt", "one\n", "base");
      await runGit(repo, ["checkout", "-q", "-b", "feature"]);
      await commit("f.txt", "f\n", "feature work");
      await runGit(repo, ["checkout", "-q", "main"]);
      await commit("m.txt", "m\n", "main moves on");
      await runGit(repo, ["checkout", "-q", "feature"]);
      await runGit(repo, [...IDENTITY, "merge", "-q", "--no-edit", "main"]);
      await runGit(repo, ["checkout", "-q", "main"]);
      const mainTip = await commit("n.txt", "n\n", "main again");
      await runGit(repo, ["checkout", "-q", "feature"]);
      return mainTip;
    }

    it("adds origin/HEAD's branch to the walk", async () => {
      const mainTip = await branchWithMergeFromMain();
      await runGit(repo, ["update-ref", "refs/remotes/origin/main", mainTip]);
      await runGit(repo, ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);
      await runGit(repo, ["checkout", "-q", "-b", "other", "main~1"]);
      await runGit(repo, [...IDENTITY, "commit", "-q", "--allow-empty", "-m", "other agent"]);
      await runGit(repo, ["update-ref", "refs/remotes/origin/other", "HEAD"]);
      await runGit(repo, ["checkout", "-q", "feature"]);

      const subjects = (await listCommits(repo)).commits.map((entry) => entry.subject);

      expect(subjects).toEqual(expect.arrayContaining(["main again", "feature work", "main moves on", "base"]));
      expect(subjects).toHaveLength(5);
    });

    it("falls back to origin/main, then origin/master, when origin/HEAD is missing", async () => {
      const mainTip = await branchWithMergeFromMain();
      await runGit(repo, ["update-ref", "refs/remotes/origin/master", mainTip]);
      await runGit(repo, ["branch", "-q", "-D", "main"]);

      expect((await listCommits(repo)).commits.map((entry) => entry.subject)).toContain("main again");
    });

    it("prefers origin/HEAD over origin/main, and origin/main over origin/master", async () => {
      const mainTip = await branchWithMergeFromMain();
      const base = (await runGit(repo, ["rev-list", "--max-parents=0", "HEAD"])).stdout.trim();
      await runGit(repo, ["update-ref", "refs/remotes/origin/master", base]);
      await runGit(repo, ["update-ref", "refs/remotes/origin/main", mainTip]);
      await runGit(repo, ["update-ref", "refs/remotes/origin/develop", "main~1"]);
      await runGit(repo, ["branch", "-q", "-D", "main"]);
      const subjects = async () => (await listCommits(repo)).commits.map((entry) => entry.subject);

      expect(await subjects()).toContain("main again");
      await runGit(repo, ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/develop"]);
      expect(await subjects()).not.toContain("main again");
    });

    it("walks both branches with every commit before its parents, HEAD's marked by its ref (CR OS-2536 #1)", async () => {
      await commit("a.txt", "one\n", "base");
      await runGit(repo, ["checkout", "-q", "-b", "feature"]);
      await commit("f.txt", "f\n", "f1");
      await runGit(repo, ["checkout", "-q", "main"]);
      for (const name of ["m1", "m2"]) {
        await commit(`${name}.txt`, "m\n", name);
      }
      await runGit(repo, ["update-ref", "refs/remotes/origin/main", "main"]);
      await runGit(repo, ["checkout", "-q", "feature"]);

      const { commits } = await listCommits(repo);

      // The web lays lanes out in this order and opens the commit with the `HEAD -> ` ref.
      expect(commits.map((entry) => entry.subject).sort()).toEqual(["base", "f1", "m1", "m2"]);
      const index = new Map(commits.map((entry, position) => [entry.hash, position]));
      for (const [position, entry] of commits.entries()) {
        expect(entry.parents.every((parent) => index.get(parent)! > position)).toBe(true);
      }
      expect(commits.find((entry) => entry.subject === "f1")?.refs).toEqual(["HEAD -> feature"]);
    });

    it("adds local main, then master, so commits on it past the fork point show (OS-2586)", async () => {
      await branchWithMergeFromMain();

      expect((await listCommits(repo)).commits.map((entry) => entry.subject)).toContain("main again");
      await runGit(repo, ["branch", "-q", "-m", "main", "master"]);
      expect((await listCommits(repo)).commits.map((entry) => entry.subject)).toContain("main again");
    });

    it("walks HEAD, origin's default branch and local main, skipping a tip on the same commit (OS-2586)", async () => {
      for (let index = 0; index < COMMIT_PAGE_SIZE; index++) {
        await runGit(repo, [...IDENTITY, "commit", "-q", "--allow-empty", "-m", `c${index}`]);
      }
      const remoteTip = (await runGit(repo, ["rev-parse", "HEAD"])).stdout.trim();
      await runGit(repo, ["update-ref", "refs/remotes/origin/main", remoteTip]);
      await runGit(repo, ["checkout", "-q", "-b", "feature"]);
      await runGit(repo, [...IDENTITY, "commit", "-q", "--allow-empty", "-m", "feature"]);
      const head = (await runGit(repo, ["rev-parse", "HEAD"])).stdout.trim();
      await runGit(repo, ["checkout", "-q", "main"]);
      await runGit(repo, [...IDENTITY, "commit", "-q", "--allow-empty", "-m", "local main"]);
      const localTip = (await runGit(repo, ["rev-parse", "HEAD"])).stdout.trim();
      await runGit(repo, ["checkout", "-q", "feature"]);

      const first = await listCommits(repo);
      expect(first.nextCursor).toBe(`${head},${remoteTip},${localTip}:${COMMIT_PAGE_SIZE}`);
      const second = await listCommits(repo, first.nextCursor);
      expect([...first.commits, ...second.commits]).toHaveLength(COMMIT_PAGE_SIZE + 2);

      await runGit(repo, ["update-ref", "refs/remotes/origin/main", localTip]);
      expect((await listCommits(repo)).nextCursor).toBe(`${head},${localTip}:${COMMIT_PAGE_SIZE}`);
    });

    it("pins both tips in the cursor, so a fetch while paging does not shift pages", async () => {
      for (let index = 0; index < COMMIT_PAGE_SIZE; index++) {
        await runGit(repo, [...IDENTITY, "commit", "-q", "--allow-empty", "-m", `c${index}`]);
      }
      const shared = (await runGit(repo, ["rev-parse", "HEAD"])).stdout.trim();
      await runGit(repo, ["checkout", "-q", "-b", "feature"]);
      await runGit(repo, [...IDENTITY, "commit", "-q", "--allow-empty", "-m", "feature"]);
      await runGit(repo, ["checkout", "-q", "main"]);
      await runGit(repo, [...IDENTITY, "commit", "-q", "--allow-empty", "-m", "main tip"]);
      const mainTip = (await runGit(repo, ["rev-parse", "HEAD"])).stdout.trim();
      await runGit(repo, ["update-ref", "refs/remotes/origin/main", mainTip]);
      await runGit(repo, ["checkout", "-q", "feature"]);
      const head = (await runGit(repo, ["rev-parse", "HEAD"])).stdout.trim();

      const first = await listCommits(repo);
      expect(first.nextCursor).toMatch(new RegExp(`^${head},${mainTip}:${COMMIT_PAGE_SIZE}$`));

      await runGit(repo, ["update-ref", "refs/remotes/origin/main", shared]);
      const second = await listCommits(repo, first.nextCursor);
      const subjects = [...first.commits, ...second.commits].map((entry) => entry.subject);
      expect(subjects).toHaveLength(COMMIT_PAGE_SIZE + 2);
      expect(new Set(subjects).size).toBe(subjects.length);
    });

    it("walks one tip when the default branch is HEAD's commit", async () => {
      for (let index = 0; index <= COMMIT_PAGE_SIZE; index++) {
        await runGit(repo, [...IDENTITY, "commit", "-q", "--allow-empty", "-m", `c${index}`]);
      }
      const head = (await runGit(repo, ["rev-parse", "HEAD"])).stdout.trim();
      await runGit(repo, ["update-ref", "refs/remotes/origin/main", head]);

      expect((await listCommits(repo)).nextCursor).toBe(`${head}:${COMMIT_PAGE_SIZE}`);
    });
  });

  describe("branch scope (OS-2595)", () => {
    const rev = async (ref: string) => (await runGit(repo, ["rev-parse", ref])).stdout.trim();
    const subjects = (page: { commits: { subject: string }[] }) => page.commits.map((entry) => entry.subject);

    it("lists only HEAD's commits that no default branch has, and where the branch forked", async () => {
      await commit("a.txt", "one\n", "base");
      const fork = await rev("HEAD");
      await runGit(repo, ["checkout", "-q", "-b", "feature"]);
      await commit("f.txt", "f\n", "f1");
      await commit("f.txt", "g\n", "f2");
      await runGit(repo, ["checkout", "-q", "main"]);
      await commit("m.txt", "m\n", "main 1");
      await commit("m.txt", "n\n", "main 2");
      await runGit(repo, ["update-ref", "refs/remotes/origin/main", "main~1"]);
      await runGit(repo, ["checkout", "-q", "feature"]);

      const page = await listCommits(repo, undefined, { scope: "branch" });

      expect(subjects(page)).toEqual(["f2", "f1"]);
      expect(page.fork).toEqual({ ref: "main", hash: fork, behind: 2 });
    });

    it("leaves out main's commits merged into the branch, and forks at the merged-in commit", async () => {
      await commit("a.txt", "one\n", "base");
      await runGit(repo, ["checkout", "-q", "-b", "feature"]);
      await commit("f.txt", "f\n", "feature work");
      await runGit(repo, ["checkout", "-q", "main"]);
      await commit("m.txt", "m\n", "main moves on");
      const merged = await rev("HEAD");
      await runGit(repo, ["checkout", "-q", "feature"]);
      await runGit(repo, [...IDENTITY, "merge", "-q", "--no-edit", "-m", "merge main", "main"]);

      const page = await listCommits(repo, undefined, { scope: "branch" });

      expect(subjects(page)).toEqual(["merge main", "feature work"]);
      expect(page.fork).toEqual({ ref: "main", hash: merged, behind: 0 });
    });

    it("names the closer default branch: origin/main when local main is behind it", async () => {
      await commit("a.txt", "one\n", "base");
      await commit("a.txt", "two\n", "fetched");
      const fetched = await rev("HEAD");
      await runGit(repo, ["update-ref", "refs/remotes/origin/main", fetched]);
      await runGit(repo, ["reset", "-q", "--hard", "HEAD~1"]);
      await runGit(repo, ["checkout", "-q", "-b", "feature", "origin/main"]);
      await commit("f.txt", "f\n", "f1");

      const page = await listCommits(repo, undefined, { scope: "branch" });

      expect(subjects(page)).toEqual(["f1"]);
      expect(page.fork).toEqual({ ref: "origin/main", hash: fetched, behind: 0 });
    });

    it("on the default branch itself lists the commits origin doesn't have", async () => {
      await commit("a.txt", "one\n", "pushed");
      const pushed = await rev("HEAD");
      await runGit(repo, ["update-ref", "refs/remotes/origin/main", pushed]);
      await commit("a.txt", "two\n", "unpushed");

      const page = await listCommits(repo, undefined, { scope: "branch" });

      expect(subjects(page)).toEqual(["unpushed"]);
      expect(page.fork).toEqual({ ref: "origin/main", hash: pushed, behind: 0 });
    });

    it("has no commits for a branch that hasn't moved, and still says where it starts", async () => {
      await commit("a.txt", "one\n", "base");
      const base = await rev("HEAD");
      await runGit(repo, ["checkout", "-q", "-b", "feature"]);

      const page = await listCommits(repo, undefined, { scope: "branch" });

      expect(page.commits).toEqual([]);
      expect(page.fork).toEqual({ ref: "main", hash: base, behind: 0 });
    });

    it("keeps the exclusions in the cursor, so later pages stay on the branch", async () => {
      await commit("a.txt", "one\n", "base");
      const base = await rev("HEAD");
      await runGit(repo, ["checkout", "-q", "-b", "feature"]);
      for (let index = 0; index <= COMMIT_PAGE_SIZE; index++) {
        await runGit(repo, [...IDENTITY, "commit", "-q", "--allow-empty", "-m", `f${index}`]);
      }
      const head = await rev("HEAD");

      const first = await listCommits(repo, undefined, { scope: "branch" });
      expect(first.nextCursor).toBe(`${head},^${base}:${COMMIT_PAGE_SIZE}`);
      const second = await listCommits(repo, first.nextCursor);

      expect(subjects(second)).toEqual(["f0"]);
      expect(second.fork).toBeUndefined();
    });
  });

  it("rejects a cursor that is not one it produced", async () => {
    await expect(listCommits(repo, "--all:0")).rejects.toThrow("Invalid history cursor");
  });

  it("returns a commit's body and its patch with a/ b/ prefixes despite user config", async () => {
    await commit("a.txt", "one\n", "first");
    const hash = await commit("a.txt", "two\n", "second\n\nwhy it changed");
    await runGit(repo, ["config", "diff.noprefix", "true"]);

    const result = await readCommitPatch(repo, hash);

    expect(result.body).toBe("why it changed");
    expect(result.truncated).toBe(false);
    expect(result.patch).toMatch(/^diff --git a\/a.txt b\/a.txt/);
    expect(result.patch).toContain("+two");
  });

  it("shows a root commit as additions", async () => {
    const hash = await commit("a.txt", "one\n", "first");

    expect((await readCommitPatch(repo, hash)).patch).toContain("new file mode");
  });

  it("shows a clean merge as an empty combined diff", async () => {
    await commit("a.txt", "one\n", "base");
    await runGit(repo, ["checkout", "-q", "-b", "side"]);
    await commit("b.txt", "side\n", "side");
    await runGit(repo, ["checkout", "-q", "main"]);
    await commit("c.txt", "main\n", "main");
    await runGit(repo, [...IDENTITY, "merge", "-q", "--no-edit", "side"]);
    const merge = (await runGit(repo, ["rev-parse", "HEAD"])).stdout.trim();

    expect((await readCommitPatch(repo, merge)).patch.trim()).toBe("");
    expect((await listCommits(repo)).commits[0].parents).toHaveLength(2);
  });

  it("keeps a page small: long subjects and ref lists are cut (OS-2534 review #2)", async () => {
    await runGit(repo, [...IDENTITY, "commit", "-q", "--allow-empty", "-m", "x".repeat(30_000)]);
    for (let index = 0; index < MAX_REFS_PER_COMMIT + 5; index++) {
      await runGit(repo, ["tag", `v${index}`]);
    }

    const [entry] = (await listCommits(repo)).commits;

    expect(entry.subject.length).toBe(MAX_SUBJECT_CHARS);
    expect(entry.refs).toHaveLength(MAX_REFS_PER_COMMIT);
  });

  it("keeps a page's JSON under the op budget whatever the metadata, and pages on from the cut (OS-2534 round 2 #1)", async () => {
    const name = "n".repeat(30_000);
    for (let index = 0; index < 50; index++) {
      await runGit(repo, ["-c", `user.name=${name}`, "-c", "user.email=a@b", "commit", "-q", "--allow-empty", "-m", `c${index}`]);
    }

    const first = await listCommits(repo);
    expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThan(MAX_FILE_OP_BYTES);
    expect(first.commits[0].authorName.length).toBeLessThan(1_000);

    await runGit(repo, [...IDENTITY, "tag", "-a", "-m", "t", `${"v".repeat(60)}/`.repeat(4) + "end"]);
    const tiny = (await listCommits(repo)).commits[0];
    expect(tiny.refs.every((ref) => ref.length <= 200)).toBe(true);
  });

  it("returns fewer commits when the budget cuts a page, and the cursor resumes right after them", async () => {
    for (let index = 0; index < 3; index++) {
      await runGit(repo, [...IDENTITY, "commit", "-q", "--allow-empty", "-m", `c${index}`]);
    }

    const page = await listCommits(repo, undefined, { budgetBytes: 400 });
    expect(page.commits.length).toBeLessThan(3);
    const rest = await listCommits(repo, page.nextCursor);
    expect([...page.commits, ...rest.commits].map((entry) => entry.subject)).toEqual(["c2", "c1", "c0"]);
  });

  it("hides Convoy checkpoint refs from the decorations", async () => {
    const hash = await commit("a.txt", "one\n", "first");
    await runGit(repo, ["update-ref", "refs/convoy/checkpoints/t/r/pre", hash]);

    expect((await listCommits(repo)).commits[0].refs).toEqual(["HEAD -> main"]);
  });

  it("cuts a very long body", async () => {
    const hash = await commit("a.txt", "one\n", `first\n\n${"b".repeat(25_000)}`);

    expect((await readCommitPatch(repo, hash)).body).toHaveLength(20_000);
  });

  it("shows a commit, not a tag header, for an annotated tag's hash (OS-2534 review #10)", async () => {
    await commit("a.txt", "one\n", "first");
    await runGit(repo, [...IDENTITY, "tag", "-a", "v1", "-m", "tag message"]);
    const tagHash = (await runGit(repo, ["rev-parse", "v1"])).stdout.trim();

    expect((await readCommitPatch(repo, tagHash)).body).not.toContain("tag message");
  });

  it("a commit message past the output cap still returns the real patch, not body text as a patch (CR OS-2534 UX #3)", async () => {
    await writeFile(join(repo, "small.txt"), "one\n");
    await runGit(repo, ["add", "small.txt"]);
    const message = join(repo, "..", `msg-${Date.now()}.txt`);
    await writeFile(message, "subject\n\n".concat("diff --git a/fake b/fake\n".repeat(500_000)));
    await runGit(repo, [...IDENTITY, "commit", "-q", "-F", message]);
    await rm(message);
    const hash = (await runGit(repo, ["rev-parse", "HEAD"])).stdout.trim();

    const result = await readCommitPatch(repo, hash);

    expect(result.patch).toContain("diff --git a/small.txt b/small.txt");
    expect(result.patch).not.toContain("a/fake");
    expect(result.body).toHaveLength(20_000);
  }, 30_000);

  it("a patch past git's 10 MiB output cap comes back truncated, not as an error (OS-2534 UX review 3)", async () => {
    // 12 MiB of text lines: git show's output passes runGit's maxBuffer.
    const hash = await commit("big.txt", "x".repeat(99).concat("\n").repeat(12 * 10_486), "huge");

    const result = await readCommitPatch(repo, hash);

    expect(result.truncated).toBe(true);
    expect(result.patch.length).toBeGreaterThan(0);
    expect(result.patch.length).toBeLessThanOrEqual(MAX_FILE_OP_BYTES);
  }, 30_000);

  it("refuses anything but a full commit hash", async () => {
    await commit("a.txt", "one\n", "first");

    await expect(readCommitPatch(repo, "HEAD")).rejects.toThrow("Invalid commit hash");
    await expect(readCommitPatch(repo, "0".repeat(40))).rejects.toThrow("Commit not found");
  });
});

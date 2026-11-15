import { mkdir, mkdtemp, readFile, rm, stat, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runGit } from "./exec.js";
import { MAX_FILE_OP_BYTES } from "./checkpoint.js";
import { MAX_DOWNLOAD_BYTES, diffWorkingTree, readWorkingFile, readWorkingFileBytes, revertWorkingFile, revertWorkingTree } from "./working-tree.js";

describe("diffWorkingTree (real git)", () => {
  let repo: string;

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), "convoy-working-tree-test-"));
    await runGit(repo, ["init", "--initial-branch=main"]);
    await writeFile(join(repo, "tracked.txt"), "one\n");
    await runGit(repo, ["add", "tracked.txt"]);
    await runGit(repo, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", "init"]);
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it("returns one patch covering modified and untracked files", async () => {
    await writeFile(join(repo, "tracked.txt"), "two\n");
    await writeFile(join(repo, "fresh.txt"), "new\n");

    const result = await diffWorkingTree(repo);

    expect(result.truncated).toBe(false);
    expect(result.patch).toContain("--- a/tracked.txt");
    expect(result.patch).toContain("+two");
    expect(result.patch).toContain("new file mode");
    expect(result.patch).toContain("+++ b/fresh.txt");
  });

  it("leaves the user's index untouched", async () => {
    await writeFile(join(repo, "fresh.txt"), "new\n");

    await diffWorkingTree(repo);

    const staged = await runGit(repo, ["diff", "--cached", "--name-only"]);
    expect(staged.stdout.trim()).toBe("");
    const status = await runGit(repo, ["status", "--porcelain"]);
    expect(status.stdout).toContain("?? fresh.txt");
  });

  it("keeps the a/ b/ prefixes the web parser needs despite diff.noprefix", async () => {
    await runGit(repo, ["config", "diff.noprefix", "true"]);
    await writeFile(join(repo, "tracked.txt"), "two\n");

    const result = await diffWorkingTree(repo);

    expect(result.patch).toContain("--- a/tracked.txt");
    expect(result.patch).toContain("+++ b/tracked.txt");
  });

  it("caps the result by serialized bytes, not characters", async () => {
    // 3-byte characters: 300k of them is 900 kB on the wire.
    await writeFile(join(repo, "fresh.txt"), "€".repeat(300_000));

    const result = await diffWorkingTree(repo);

    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(MAX_FILE_OP_BYTES);
  });

  it("returns an empty patch for a clean tree", async () => {
    expect(await diffWorkingTree(repo)).toEqual({ patch: "", truncated: false });
  });
});

describe("revertWorkingFile (real git)", () => {
  let repo: string;

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), "convoy-revert-working-test-"));
    await runGit(repo, ["init", "--initial-branch=main"]);
    await writeFile(join(repo, "tracked.txt"), "one\n");
    await runGit(repo, ["add", "tracked.txt"]);
    await runGit(repo, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", "init"]);
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it("restores a modified tracked file to HEAD, staged or not", async () => {
    await writeFile(join(repo, "tracked.txt"), "two\n");
    await runGit(repo, ["add", "tracked.txt"]);
    await writeFile(join(repo, "tracked.txt"), "three\n");

    await revertWorkingFile(repo, "tracked.txt");

    expect(await readFile(join(repo, "tracked.txt"), "utf8")).toBe("one\n");
    expect((await runGit(repo, ["status", "--porcelain"])).stdout.trim()).toBe("");
  });

  it("brings back a deleted tracked file", async () => {
    await rm(join(repo, "tracked.txt"));

    await revertWorkingFile(repo, "tracked.txt");

    expect(await readFile(join(repo, "tracked.txt"), "utf8")).toBe("one\n");
  });

  it("deletes an untracked file, even when staged", async () => {
    await writeFile(join(repo, "fresh.txt"), "new\n");
    await runGit(repo, ["add", "fresh.txt"]);

    await revertWorkingFile(repo, "fresh.txt");

    await expect(stat(join(repo, "fresh.txt"))).rejects.toThrow();
    expect((await runGit(repo, ["status", "--porcelain"])).stdout.trim()).toBe("");
  });

  it("rejects a path that escapes the checkout", async () => {
    await expect(revertWorkingFile(repo, "../outside.txt")).rejects.toThrow("outside the checkout");
    await expect(revertWorkingFile(repo, "/etc/hosts")).rejects.toThrow("outside the checkout");
  });
});

describe("revertWorkingTree (real git)", () => {
  let repo: string;

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), "convoy-revert-tree-test-"));
    await runGit(repo, ["init", "--initial-branch=main"]);
    await writeFile(join(repo, "a.txt"), "a\n");
    await writeFile(join(repo, "b.txt"), "b\n");
    await runGit(repo, ["add", "."]);
    await runGit(repo, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", "init"]);
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it("reverts every listed file: modified, deleted and new", async () => {
    await writeFile(join(repo, "a.txt"), "changed\n");
    await rm(join(repo, "b.txt"));
    await mkdir(join(repo, "dir"));
    await writeFile(join(repo, "dir/new.txt"), "new\n");

    await revertWorkingTree(repo, ["a.txt", "b.txt", "dir/new.txt"]);

    expect(await readFile(join(repo, "a.txt"), "utf8")).toBe("a\n");
    expect(await readFile(join(repo, "b.txt"), "utf8")).toBe("b\n");
    await expect(stat(join(repo, "dir/new.txt"))).rejects.toThrow();
    expect((await runGit(repo, ["status", "--porcelain"])).stdout.trim()).toBe("");
  });

  it("leaves files that are not in the list alone", async () => {
    await writeFile(join(repo, "a.txt"), "changed\n");
    await writeFile(join(repo, "b.txt"), "later edit\n");

    await revertWorkingTree(repo, ["a.txt"]);

    expect(await readFile(join(repo, "a.txt"), "utf8")).toBe("a\n");
    expect(await readFile(join(repo, "b.txt"), "utf8")).toBe("later edit\n");
  });

  it("touches nothing when any path escapes the checkout", async () => {
    await writeFile(join(repo, "a.txt"), "changed\n");

    await expect(revertWorkingTree(repo, ["a.txt", "../outside.txt"])).rejects.toThrow("outside the checkout");

    expect(await readFile(join(repo, "a.txt"), "utf8")).toBe("changed\n");
  });
});

describe("readWorkingFile (real fs)", () => {
  let repo: string;

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), "convoy-working-tree-test-"));
    await writeFile(join(repo, "tracked.txt"), "one\n");
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it("returns the on-disk content, untracked or not", async () => {
    await writeFile(join(repo, "tracked.txt"), "two\n");

    expect(await readWorkingFile(repo, "tracked.txt")).toEqual({ content: "two\n", truncated: false });
  });

  it("refuses binary files and missing files", async () => {
    await writeFile(join(repo, "blob.bin"), Buffer.from([0x89, 0x50, 0x00, 0x47]));

    await expect(readWorkingFile(repo, "blob.bin")).rejects.toThrow("Binary file");
    await expect(readWorkingFile(repo, "gone.txt")).rejects.toThrow("File not found");
  });

  it("rejects a path that escapes the checkout", async () => {
    await expect(readWorkingFile(repo, "../outside.txt")).rejects.toThrow("outside the checkout");
  });
});

describe("readWorkingFileBytes (real fs)", () => {
  let repo: string;

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), "convoy-working-tree-test-"));
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it("returns raw bytes, binary included, and refuses missing or escaping paths", async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x00, 0x47]);
    await writeFile(join(repo, "blob.bin"), bytes);

    expect(await readWorkingFileBytes(repo, "blob.bin")).toEqual(bytes);
    await expect(readWorkingFileBytes(repo, "gone.bin")).rejects.toThrow("File not found");
    await expect(readWorkingFileBytes(repo, "../outside.bin")).rejects.toThrow("outside the checkout");
  });

  it("refuses a file past the size cap before reading it", async () => {
    await writeFile(join(repo, "huge.bin"), "");
    await truncate(join(repo, "huge.bin"), MAX_DOWNLOAD_BYTES + 1);

    await expect(readWorkingFileBytes(repo, "huge.bin")).rejects.toThrow("too large to download");
  });

  it("refuses symlinks that resolve outside the checkout, in both readers", async () => {
    const outside = join(repo, "..", `convoy-outside-${Date.now()}.txt`);
    await writeFile(outside, "secret\n");
    try {
      await symlink(outside, join(repo, "link.txt"));
      await mkdir(join(repo, "inner"));
      await writeFile(join(repo, "inner", "ok.txt"), "fine\n");
      await symlink(join(repo, "inner"), join(repo, "inner-link"));
      await symlink(join(repo, ".."), join(repo, "up"));

      await expect(readWorkingFileBytes(repo, "link.txt")).rejects.toThrow("outside the checkout");
      await expect(readWorkingFile(repo, "link.txt")).rejects.toThrow("outside the checkout");
      await expect(readWorkingFileBytes(repo, join("up", "..", "..", "etc", "hosts"))).rejects.toThrow("outside the checkout");
      // Links that stay inside still read.
      expect((await readWorkingFile(repo, join("inner-link", "ok.txt"))).content).toBe("fine\n");
    } finally {
      await rm(outside, { force: true });
    }
  });
});

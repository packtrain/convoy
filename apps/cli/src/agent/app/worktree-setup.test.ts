import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGit } from "../../lib/git/exec.js";
import { createWorktree } from "../../lib/git/worktrees.js";
import { createScriptRunner } from "./script-runner.js";
import { prepareWorktree } from "./worktree-setup.js";

const roots: string[] = [];
afterAll(() => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));

async function repo() {
  const root = mkdtempSync(join(tmpdir(), "convoy-setup-queue-"));
  roots.push(root);
  const parent = join(root, "repo");
  mkdirSync(parent);
  await runGit(parent, ["init", "-b", "main"]);
  await runGit(parent, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "initial"]);
  return { root, parent };
}

function setUp(r: Awaited<ReturnType<typeof repo>>, script: string, signal = new AbortController().signal, createDelayMs = 0) {
  return prepareWorktree({
    setup: { repoKey: "a/b", script, revision: 1 },
    parentPath: r.parent, branch: "feat/q",
    create: async () => {
      const created = await createWorktree({ parentPath: r.parent, branch: "feat/q" });
      await new Promise((resolve) => setTimeout(resolve, createDelayMs));
      return created;
    },
    threadId: "t", cliType: "claude-code", runner: createScriptRunner(), emit: () => {},
    signal,
  });
}

describe("worktree setup queue", () => {
  it("a Lane aborted while queued behind a failing setup never runs the script", async () => {
    const r = await repo();
    const first = setUp(r, "sleep 0.3; exit 1");
    const stop = new AbortController();
    const second = setUp(r, `touch "${join(r.root, "ran-after-stop")}"`, stop.signal);
    const stopped = expect(second).rejects.toThrow("aborted");
    stop.abort();
    await expect(first).rejects.toThrow("exited with code 1");
    await stopped;
    expect(existsSync(join(r.root, "ran-after-stop"))).toBe(false);
  });

  it("Lanes sharing one worktree run its script once", async () => {
    const r = await repo();
    const script = `echo run >> "${join(r.root, "runs.txt")}"`;
    const [a, b] = await Promise.all([setUp(r, script), setUp(r, script)]);
    expect(a.path).toBe(b.path);
    expect(b.reused).toBe(true);
    expect(readFileSync(join(r.root, "runs.txt"), "utf8")).toBe("run\n");
  });

  it("stopping a queued Lane keeps the next one waiting for the running setup", async () => {
    const r = await repo();
    const out = join(r.root, "out.txt");
    const first = setUp(r, `sleep 0.5; echo first >> "${out}"`);
    const stop = new AbortController();
    const stopped = expect(setUp(r, "true", stop.signal)).rejects.toThrow("aborted");
    stop.abort();
    await stopped;
    const third = setUp(r, `echo third >> "${out}"`);
    await Promise.all([first, third]);
    expect(readFileSync(out, "utf8")).toBe("first\n");
  });

  it("a Retry right after a Stop during creation waits for that creation", async () => {
    const r = await repo();
    const runs = join(r.root, "runs.txt");
    const stop = new AbortController();
    const stopped = expect(setUp(r, "true", stop.signal, 300)).rejects.toThrow("aborted");
    await new Promise((resolve) => setTimeout(resolve, 100));
    stop.abort();
    await stopped;
    await setUp(r, `echo run >> "${runs}"`);
    expect(readFileSync(runs, "utf8")).toBe("run\n");
  });
});

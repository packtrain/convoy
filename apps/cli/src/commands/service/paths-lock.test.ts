import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

// Each filesystem call on the lock reports to `after`, so a test can run a competing owner at that exact point.
const hook = vi.hoisted(() => ({ after: undefined as undefined | ((op: string, path: string) => void) }));
vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  const wrap = <T extends (...args: never[]) => unknown>(op: string, fn: T) => ((...args: Parameters<T>) => {
    const result = fn(...args);
    hook.after?.(op, String(args[0]));
    return result;
  }) as T;
  return { ...fs, readFileSync: wrap("read", fs.readFileSync), linkSync: wrap("link", fs.linkSync),
    renameSync: wrap("rename", fs.renameSync), unlinkSync: wrap("unlink", fs.unlinkSync) };
});
const { acquireLock } = await import("./paths.js");

const dirs: string[] = [];
afterEach(() => { hook.after = undefined; for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it("never gives a lock to two owners when contenders race a stale takeover", () => {
  const dir = mkdtempSync(join(tmpdir(), "cv-lock-race-")); dirs.push(dir);
  const file = join(dir, "owner.lock");
  const dead = spawnSync(process.execPath, ["-e", "0"]).pid;
  writeFileSync(file, JSON.stringify({ pid: dead, start: "gone", holder: "service" }), { mode: 0o600 });
  const owners: string[] = [];
  const attempt = (holder: "service" | "connect" | "login") => { try { acquireLock(file, holder); owners.push(holder); } catch { /* held */ } };
  let step = 0;
  hook.after = (op, path) => {
    // A has read the stale holder: B reclaims and acquires before A acts on what it read.
    if (step === 0 && op === "read" && path === file) { step = 1; hook.after = undefined; attempt("connect"); hook.after = after; }
  };
  const after = (op: string, path: string) => {
    // After A's next change on or beside the lock, C tries to acquire.
    if (step === 1 && op !== "read" && path.startsWith(file)) { step = 2; hook.after = undefined; attempt("login"); }
  };
  attempt("service");
  hook.after = undefined;
  expect(owners).toEqual(["connect"]);
  expect(JSON.parse(readFileSync(file, "utf8")).holder).toBe("connect");
});

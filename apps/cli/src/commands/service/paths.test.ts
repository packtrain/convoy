import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync, chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { acquireLock, leasePath, loginJobPath, removeLoginJob, servicePaths, privateFile, writeLoginJob } from "./paths.js";

const homes: string[] = [];
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });
function home() { const dir = mkdtempSync(join(tmpdir(), "cv-private-")); homes.push(dir); return dir; }
it("rejects a shared directory and symlinked service state", () => {
  const dir = home(); mkdirSync(join(dir, ".convoy"), { mode: 0o755 });
  expect(() => servicePaths(dir)).toThrow("private control-account");
  chmodSync(join(dir, ".convoy"), 0o700);
  symlinkSync(dir, join(dir, ".convoy/service"));
  expect(() => servicePaths(dir)).toThrow("private control-account");
});
it("rejects public log/lock files and symlinks", () => {
  const dir = home(); const file = join(dir, "file"); writeFileSync(file, "", { mode: 0o644 });
  expect(() => privateFile(file)).toThrow("Unsafe service file");
  chmodSync(file, 0o600); privateFile(file);
  symlinkSync(file, join(dir, "link"));
  expect(() => privateFile(join(dir, "link"))).toThrow();
});
it("rejects a private HOME beneath a writable non-sticky ancestor", () => {
  const dir = home(); chmodSync(dir, 0o777);
  mkdirSync(join(dir, "home"), { mode: 0o700 });
  expect(() => servicePaths(join(dir, "home"))).toThrow("ancestor");
});

it("does not create service state directories for a read-only log lookup", () => {
  const dir = home();
  servicePaths(dir, false);
  expect(() => statSync(join(dir, ".convoy"))).toThrow();
});

describe("CLI lock", () => {
  it("is exclusive while the holder lives and names the holder", () => {
    const file = join(home(), "owner.lock");
    const release = acquireLock(file, "service");
    expect(() => acquireLock(file, "connect")).toThrow(expect.objectContaining({ holder: "service" }));
    expect(() => acquireLock(file, "connect")).toThrow("Lock held by service.");
    release();
    expect(existsSync(file)).toBe(false);
    acquireLock(file, "connect")();
  });

  it("takes over a lock whose PID is no longer running", () => {
    const file = join(home(), "owner.lock");
    const child = spawnSync(process.execPath, ["-e", "0"]);
    writeFileSync(file, JSON.stringify({ pid: child.pid, start: "gone", holder: "service" }), { mode: 0o600 });
    const release = acquireLock(file, "connect");
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ pid: process.pid, holder: "connect" });
    release();
  });

  it("treats a reused PID with a different start time, or an empty legacy flock file, as stale", () => {
    const file = join(home(), "owner.lock");
    writeFileSync(file, JSON.stringify({ pid: process.pid, start: "an earlier boot", holder: "service" }), { mode: 0o600 });
    acquireLock(file, "connect")();
    writeFileSync(file, "", { mode: 0o600 });
    acquireLock(file, "service")();
  });

  it("keeps a lease per project identity under the private service directory", () => {
    const dir = home();
    const lease = leasePath("a".repeat(64), dir);
    expect(lease).toBe(join(dir, ".convoy/service/leases", `${"a".repeat(64)}.lease`));
    expect(statSync(join(dir, ".convoy/service/leases")).mode & 0o777).toBe(0o700);
  });
});
it.each(["darwin", "linux"] as const)("writes the %s login job, refreshes only an existing one and removes it", (platform) => {
  const dir = home(), file = loginJobPath(dir, platform);
  expect(file).toBe(join(dir, platform === "linux" ? ".config/systemd/user/convoy.service" : "Library/LaunchAgents/build.convoy.service.plist"));
  expect(writeLoginJob("a", true, file)).toBe(false);
  expect(existsSync(file)).toBe(false);
  expect(writeLoginJob("a", false, file)).toBe(true);
  expect(statSync(file).mode & 0o777).toBe(0o644);
  expect(writeLoginJob("a", true, file)).toBe(false);
  expect(writeLoginJob("b", true, file)).toBe(true);
  expect(readFileSync(file, "utf8")).toBe("b");
  expect(removeLoginJob(file)).toBe(true);
  expect(removeLoginJob(file)).toBe(false);
});

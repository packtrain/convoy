import { chmodSync, mkdtempSync, mkdirSync, realpathSync, rmSync, existsSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { claimLocalEnvironment, readLocalEnvironment, realFolder, resolveMounts, saveLocalEnvironment, withEnvironmentLock } from "./paths.js";
it("cancels a pending lock without running the action or releasing another owner's lock", async () => {
  vi.useFakeTimers();
  const directory = mkdtempSync(join(tmpdir(), "convoy-lock-"));
  mkdirSync(join(directory, "lock"));
  const abort = new AbortController(), action = vi.fn(async () => {});
  try {
    const outcome = withEnvironmentLock(directory, action, 600000, abort.signal).then(() => "resolved", () => "aborted");
    abort.abort(); await vi.advanceTimersByTimeAsync(200);
    rmSync(join(directory, "lock"), { recursive: true });
    await vi.advanceTimersByTimeAsync(200);
    expect(await outcome).toBe("aborted"); expect(action).not.toHaveBeenCalled();
    expect(existsSync(join(directory, "lock"))).toBe(false);
  } finally { vi.useRealTimers(); rmSync(directory, { recursive: true, force: true }); }
});

it("reads and writes the private Local environment record, never replacing a saved one", () => {
  const home = mkdtempSync(join(tmpdir(), "convoy-mode-"));
  try {
    expect(readLocalEnvironment(home)).toBeUndefined();
    saveLocalEnvironment(home, { schema: 1, mode: "shared" });
    expect(readLocalEnvironment(home)).toEqual({ schema: 1, mode: "shared" });
    expect(saveLocalEnvironment(home, { schema: 1, mode: "isolated" })).toEqual({ schema: 1, mode: "shared" });
    expect(readLocalEnvironment(home)).toEqual({ schema: 1, mode: "shared" });
    expect(readdirSync(join(home, ".convoy"))).toEqual(["environment.json"]);
    expect(statSync(join(home, ".convoy/environment.json")).mode & 0o777).toBe(0o600);
    chmodSync(join(home, ".convoy/environment.json"), 0o644);
    expect(() => readLocalEnvironment(home)).toThrow("Unsafe environment record");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

it("lets no other command save a mode while one installs isolated mode", () => {
  const home = mkdtempSync(join(tmpdir(), "convoy-claim-")), claim = join(home, ".convoy/environment.claim");
  try {
    mkdirSync(join(home, ".convoy"), { mode: 0o700 });
    writeFileSync(claim, String(process.ppid), { mode: 0o600 });
    expect(() => saveLocalEnvironment(home, { schema: 1, mode: "shared" })).toThrow(`PID ${process.ppid}) is installing isolated mode`);
    expect(() => claimLocalEnvironment(home)).toThrow("is installing isolated mode");
    writeFileSync(claim, "999999999");
    const release = claimLocalEnvironment(home);
    expect(readFileSync(claim, "utf8")).toBe(String(process.pid));
    expect(saveLocalEnvironment(home, { schema: 1, mode: "isolated" })).toEqual({ schema: 1, mode: "isolated" });
    release();
    expect(existsSync(claim)).toBe(false);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

describe("host folder mounts (OS-2251)", () => {
  const home = "/Users/me", real = (folder: string) => folder;
  const resolve = (folders: string[]) => resolveMounts(folders, home, real);
  it("expands ~, resolves the list and keeps each folder at its own path", () => {
    expect(resolve(["~/code", " /Volumes/data/work ", ""])).toEqual(["/Users/me/code", "/Volumes/data/work"]);
  });
  it.each([
    ["/", "home folder"], ["/Users", "home folder"], ["~", "home folder"],
    ["~/.ssh", "credentials"], ["~/.config/gh", "credentials"], ["~/.docker", "credentials"], ["~/.aws", "credentials"], ["~/.gnupg", "credentials"],
    ["/workspace/a", "container"], ["/opt", "container"], ["/opt/convoy", "container"], ["/home/node/code", "container"], ["/var/lib/convoy-projects", "container"],
    ["/usr/local", "container"], ["/etc", "container"], ["/tmp/x", "container"], ["/proc", "container"], ["/var/run", "Docker socket"], ["/run", "Docker socket"], ["/srv/..", "home folder"],
    ["/srv/a,b", "comma"],
  ])("refuses %s (%s)", (folder, reason) => {
    expect(() => resolve([folder])).toThrow(new RegExp(reason));
  });
  it("refuses the folder that holds DOCKER_HOST's socket", () => {
    vi.stubEnv("DOCKER_HOST", "unix:///srv/docker/docker.sock");
    try { expect(() => resolve(["/srv/docker"])).toThrow(/Docker socket/); } finally { vi.unstubAllEnvs(); }
  });
  it("refuses a mount at or under another", () => {
    expect(() => resolve(["~/code", "~/code/app"])).toThrow("/Users/me/code and /Users/me/code/app overlap");
    expect(() => resolve(["~/code/app", "~/code"])).toThrow("overlap");
    expect(() => resolve(["~/code", "~/code"])).toThrow("overlap");
  });
  it("treats a child named ..x as inside its parent (round 1 #1)", () => {
    expect(() => resolve(["~/.ssh/..keys"])).toThrow(/credentials/);
    expect(() => resolve(["/etc/..config"])).toThrow(/container/);
    expect(() => resolve(["/srv/code", "/srv/code/..nested"])).toThrow("overlap");
    expect(resolve(["/srv/..code"])).toEqual(["/srv/..code"]);
  });
  it("refuses a folder whose real path differs", () => {
    expect(() => resolveMounts(["~/code"], home, () => "/private/code")).toThrow(/symlink.*\/private\/code/);
  });
  it("checks the folder on disk", () => {
    const directory = mkdtempSync(join(tmpdir(), "convoy-mount-"));
    try {
      expect(realFolder(directory)).toBe(realpathSync(directory));
      expect(() => realFolder(join(directory, "missing"))).toThrow(/does not exist/);
      writeFileSync(join(directory, "file"), "");
      expect(() => realFolder(join(directory, "file"))).toThrow(/not a folder/);
      symlinkSync(directory, join(directory, "link"));
      expect(() => realFolder(join(directory, "link"))).toThrow(/symlink/);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});

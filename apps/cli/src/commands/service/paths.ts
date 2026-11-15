import { constants, existsSync, linkSync, lstatSync, mkdirSync, openSync, closeSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export function servicePaths(home = homedir(), create = true) {
  for (let parent = dirname(home); ; parent = dirname(parent)) {
    const info = lstatSync(parent);
    const trustedOwner = info.uid === 0 || info.uid === process.getuid?.();
    const protectedStickyDirectory = Boolean(info.mode & 0o1000) && trustedOwner;
    if (!info.isDirectory() || !trustedOwner || ((info.mode & 0o022) && !protectedStickyDirectory)) {
      throw new Error("Unsafe service HOME ancestor permissions.");
    }
    if (parent === dirname(parent)) break;
  }
  const directory = join(home, ".convoy", "service");
  for (const target of [home, join(home, ".convoy"), directory]) {
    if (!existsSync(target)) {
      if (!create) continue;
      mkdirSync(target, { mode: 0o700 });
    }
    const info = lstatSync(target);
    if (!info.isDirectory() || realpathSync(target) !== target || info.uid !== process.getuid?.() ||
        (info.mode & (target === home ? 0o022 : 0o077))) {
      throw new Error("Service state requires canonical, private control-account directories under HOME.");
    }
  }
  const socket = join(directory, "control.sock");
  if (Buffer.byteLength(socket) > 100) throw new Error("HOME is too long for the service Unix socket.");
  return { directory, socket, lock: join(directory, "owner.lock") };
}

export function privateFile(file: string): void {
  const fd = openSync(file, constants.O_CREAT | constants.O_APPEND | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  closeSync(fd);
  validatePrivateFile(file);
}

export function validatePrivateFile(file: string): void {
  const info = lstatSync(file);
  if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid?.() || (info.mode & 0o077)) {
    throw new Error(`Unsafe service file in ${dirname(file)}.`);
  }
}

/** Per-project execution lease of a shared registration. Spec: docs/specs/cli-shared-environments.md#locks */
export function leasePath(identity: string, home = homedir(), create = true): string {
  const directory = join(servicePaths(home, create).directory, "leases");
  if (!existsSync(directory)) {
    if (!create) return join(directory, `${identity}.lease`);
    mkdirSync(directory, { mode: 0o700 });
  }
  const info = lstatSync(directory);
  if (!info.isDirectory() || info.uid !== process.getuid?.() || (info.mode & 0o077)) throw new Error("Service state requires canonical, private control-account directories under HOME.");
  return join(directory, `${identity}.lease`);
}

export const LAUNCH_AGENT_LABEL = "build.convoy.service";
export const launchAgentPath = (home = homedir()) => join(home, "Library", "LaunchAgents", `${LAUNCH_AGENT_LABEL}.plist`);

/** Writes the login job when its content differs; with `refresh`, only one that already exists. */
export function writeLaunchAgent(content: string, refresh = false, home = homedir()): boolean {
  const file = launchAgentPath(home);
  const current = existsSync(file) ? readFileSync(file, "utf8") : undefined;
  if (current === content || (refresh && current === undefined)) return false;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content, { mode: 0o644 });
  return true;
}

export function removeLaunchAgent(home = homedir()): boolean {
  if (!existsSync(launchAgentPath(home))) return false;
  unlinkSync(launchAgentPath(home));
  return true;
}

export type LockHolder = "service" | "connect" | "shell" | "login";
export class LockHeldError extends Error {
  constructor(readonly holder: string) { super(`Lock held by ${holder}.`); }
}

/** A start-time token, so a PID reused after a reboot or container restart reads as a different process. */
function processStart(pid: number): string | undefined {
  try {
    if (process.platform === "linux") {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
    }
    const result = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", env: { PATH: "/bin:/usr/bin", LC_ALL: "C" } });
    return result.status === 0 && result.stdout.trim() ? result.stdout.trim() : undefined;
  } catch { return undefined; }
}

function liveHolder(content: string): string | undefined {
  let entry: { pid?: unknown; start?: unknown; holder?: unknown };
  try { entry = JSON.parse(content); } catch { return undefined; }
  if (!Number.isSafeInteger(entry.pid) || (entry.pid as number) <= 0) return undefined;
  const pid = entry.pid as number, start = processStart(pid);
  if (start !== undefined && typeof entry.start === "string") { if (start !== entry.start) return undefined; }
  else {
    try { process.kill(pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EPERM") return undefined; }
  }
  return typeof entry.holder === "string" ? entry.holder : "unknown";
}

/** The live holder of a lock file; undefined when it is free or stale. */
export function lockHolder(file: string): string | undefined {
  try { return liveHolder(readFileSync(file, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}

/**
 * Deletes a stale lock only while holding the claim for its inode, so no two contenders reclaim it and a
 * contender that read it earlier never removes the next owner's file.
 */
function reclaim(file: string, inode: number, stale: string, claimant: string): void {
  const claim = `${file}.${inode}.reclaim`, candidate = `${claim}-${process.pid}-${randomBytes(6).toString("hex")}`;
  writeFileSync(candidate, claimant, { mode: 0o600, flag: "wx" });
  try { linkSync(candidate, claim); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    let holder = "";
    try { holder = readFileSync(claim, "utf8"); } catch { return; }
    if (!liveHolder(holder)) throw new Error(`A crashed process left ${claim}. Check that no convoy process is running, then delete it.`);
    return;
  } finally { unlinkSync(candidate); }
  try {
    // Only this claim's holder may delete this inode; the content check also rules out a reused inode.
    const info = lstatSync(file, { throwIfNoEntry: false });
    if (info?.ino === inode && readFileSync(file, "utf8") === stale) unlinkSync(file);
  } finally { unlinkSync(claim); }
}

/** Exclusive lock file holding the holder's PID and role; a dead holder's lock is taken over. Returns release. */
export function acquireLock(file: string, holder: LockHolder): () => void {
  const content = JSON.stringify({ pid: process.pid, start: processStart(process.pid), holder }) + "\n";
  const temporary = (kind: string) => `${file}.${kind}-${process.pid}-${randomBytes(6).toString("hex")}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    // Linking a complete file is atomic, so readers never see a half-written holder.
    const candidate = temporary("new");
    writeFileSync(candidate, content, { mode: 0o600, flag: "wx" });
    let linked = false;
    try { linkSync(candidate, file); linked = true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    finally { unlinkSync(candidate); }
    if (linked) {
      const release = () => {
        process.off("exit", release);
        try { if (readFileSync(file, "utf8") === content) unlinkSync(file); } catch { /* already gone */ }
      };
      process.once("exit", release);
      return release;
    }
    let current: string, inode: number;
    try { inode = lstatSync(file).ino; current = readFileSync(file, "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    const live = liveHolder(current);
    if (live) throw new LockHeldError(live);
    reclaim(file, inode, current, content);
  }
  throw new LockHeldError("unknown");
}

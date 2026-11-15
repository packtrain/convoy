import { setTimeout as delay } from "node:timers/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { existsSync, linkSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { IMAGE_RECORD, environmentName, environmentSchema, imageRecordSchema, isolatedMounts, localEnvironmentSchema, sharedMounts, type Environment, type LocalEnvironment } from "./validators.js";

export function environmentDirectory(name: string, home = homedir(), create = true) {
  environmentName.parse(name);
  let directory = home;
  for (const part of [".convoy", "environments", name]) {
    directory = join(directory, part);
    if (create && !existsSync(directory)) mkdirSync(directory, { mode: 0o700 });
    const info = lstatSync(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) || (process.getuid && info.uid !== process.getuid())) {
      throw new Error("Managed environment state must be private and owned by this account.");
    }
  }
  return directory;
}
export function readEnvironment(directory: string): Environment | undefined {
  const file = join(directory, "environment.json");
  if (!existsSync(file)) return undefined;
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077)) throw new Error("Unsafe managed environment state.");
  return environmentSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}
export function saveEnvironment(directory: string, value: Environment) {
  const temporary = join(directory, `environment-${process.pid}.tmp`);
  writeFileSync(temporary, JSON.stringify(environmentSchema.parse(value)) + "\n", { mode: 0o600, flag: "wx" });
  renameSync(temporary, join(directory, "environment.json"));
}

/** Never steal an ambiguous lock. A crashed writer needs explicit local recovery. */
export async function withEnvironmentLock<T>(directory: string, action: () => Promise<T>, waitMs = 600_000, signal?: AbortSignal): Promise<T> {
  const lock = join(directory, "lock");
  const deadline = Date.now() + waitMs;
  for (;;) {
    signal?.throwIfAborted();
    try { mkdirSync(lock, { mode: 0o700 }); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() >= deadline) throw new Error(`Environment is locked at ${lock}. After a crashed command, confirm its writer has exited before removing this directory.`);
      await delay(200, undefined, { signal });
    }
  }
  try { signal?.throwIfAborted(); writeFileSync(join(lock, "pid"), String(process.pid), { mode: 0o600 }); return await action(); }
  finally { rmSync(lock, { recursive: true }); }
}

/** Whether a managed environment is saved under this name. */
export function environmentExists(name: string, home = homedir()) {
  return environmentName.safeParse(name).success && existsSync(join(home, ".convoy", "environments", name, "environment.json"));
}

/** The Local target's mode record, `~/.convoy/environment.json`; owner-only, never a symlink. */
export function readLocalEnvironment(home = homedir()): LocalEnvironment | undefined {
  const file = join(home, ".convoy", "environment.json");
  if (!existsSync(file)) return undefined;
  const info = lstatSync(file);
  if (!info.isFile() || (info.mode & 0o077) || (process.getuid && info.uid !== process.getuid())) throw new Error(`Unsafe environment record at ${file}. Make it a private file owned by this account.`);
  return localEnvironmentSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}
/** Another live process's claim from `claimLocalEnvironment`; a dead holder's claim is stale. */
function liveClaim(file: string) {
  let pid: number;
  try { pid = Number(readFileSync(file, "utf8")); } catch { return undefined; }
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return undefined;
  try { process.kill(pid, 0); return pid; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM" ? pid : undefined; }
}
const claimError = (pid: number) => new Error(`Another convoy command (PID ${pid}) is installing isolated mode. Wait for it to finish, then retry.`);

/**
 * Holds the mode choice across the isolated install, sudo prompt included, so no other command saves a mode meanwhile.
 * The claim is linked into place whole. ponytail: a crashed holder's reused PID blocks until that process exits, and two
 * contenders taking over one stale claim can both win; the service's lease takeover is the upgrade if that matters.
 */
export function claimLocalEnvironment(home: string) {
  const directory = join(home, ".convoy"), file = join(directory, "environment.claim"), temporary = `${file}.${process.pid}`;
  if (!existsSync(directory)) mkdirSync(directory, { mode: 0o700 });
  writeFileSync(temporary, String(process.pid), { mode: 0o600 });
  try {
    for (;;) {
      try { linkSync(temporary, file); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const pid = liveClaim(file);
        if (pid) throw claimError(pid);
        rmSync(file, { force: true });
      }
    }
  } finally { rmSync(temporary, { force: true }); }
  return () => rmSync(file, { force: true });
}

/** Creates the record whole and never replaces one, since the mode is fixed; returns the record now saved. */
export function saveLocalEnvironment(home: string, value: LocalEnvironment): LocalEnvironment {
  const directory = join(home, ".convoy");
  if (!existsSync(directory)) mkdirSync(directory, { mode: 0o700 });
  const claim = join(directory, "environment.claim"), holder = existsSync(claim) ? liveClaim(claim) : undefined;
  if (holder) throw claimError(holder);
  const temporary = join(directory, `environment-${process.pid}.tmp`);
  writeFileSync(temporary, JSON.stringify(localEnvironmentSchema.parse(value)) + "\n", { mode: 0o600, flag: "wx" });
  try { linkSync(temporary, join(directory, "environment.json")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  finally { rmSync(temporary); }
  return readLocalEnvironment(home)!;
}

/** The mode and mounts baked into a managed image; undefined outside one. */
export function readImageRecord(file = IMAGE_RECORD) {
  return existsSync(file) ? imageRecordSchema.parse(JSON.parse(readFileSync(file, "utf8"))) : undefined;
}

const within = (path: string, root: string) => { const step = relative(root, path); return step !== ".." && !step.startsWith("../") && !isAbsolute(step); };
const CREDENTIALS = [".ssh", ".aws", ".docker", ".gnupg", ".config", ".kube"];
const IMAGE_PATHS = [...new Set([...Object.values(isolatedMounts), ...Object.values(sharedMounts)]),
  "/usr", "/etc", "/bin", "/sbin", "/lib", "/lib64", "/boot", "/root", "/proc", "/sys", "/dev", "/run", "/tmp", "/var"];

/** A folder that exists, is no symlink and sits under none; returns its real path. */
export function realFolder(folder: string) {
  const info = lstatSync(folder, { throwIfNoEntry: false });
  if (!info) throw new Error(`Mount folder ${folder} does not exist.`);
  if (info.isSymbolicLink()) throw new Error(`Mount folder ${folder} is a symlink. Mount ${realpathSync(folder)} instead.`);
  if (!info.isDirectory()) throw new Error(`Mount folder ${folder} is not a folder.`);
  return realpathSync(folder);
}

/** Host folders to bind-mount at the same path, checked before Docker sees them. Spec: docs/specs/cli-shared-environments.md#host-folder-mounts */
export function resolveMounts(folders: string[], home = homedir(), real = realFolder): string[] {
  const sockets = ["/var/run/docker.sock", "/run/docker.sock", process.env.DOCKER_HOST?.match(/^unix:\/\/(\/.+)$/)?.[1]].filter(Boolean) as string[];
  const result: string[] = [];
  for (const entry of folders.map(folder => folder.trim()).filter(Boolean)) {
    const folder = resolve(entry.replace(/^~(?=$|\/)/, home));
    if (folder.includes(",")) throw new Error(`Mount folder ${folder} has a comma, which Docker cannot mount.`);
    if (within(home, folder)) throw new Error(`Mount folder ${folder} is your home folder or holds it. Mount a folder inside it, such as ~/code.`);
    if (CREDENTIALS.some(name => within(folder, join(home, name)))) throw new Error(`Mount folder ${folder} holds credentials. Mount your code folders only.`);
    if (sockets.some(socket => within(socket, folder))) throw new Error(`Mount folder ${folder} holds the Docker socket.`);
    const used = IMAGE_PATHS.find(path => within(folder, path) || within(path, folder));
    if (used) throw new Error(`Mount folder ${folder} overlaps ${used}, which the container uses.`);
    const actual = real(folder);
    if (actual !== folder) throw new Error(`Mount folder ${folder} sits under a symlink. Mount ${actual} instead.`);
    const parent = result.find(other => within(folder, other) || within(other, folder));
    if (parent) throw new Error(`Mount folders ${parent} and ${folder} overlap. Keep only the outer one.`);
    result.push(folder);
  }
  return result;
}

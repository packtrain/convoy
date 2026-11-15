import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { remotesSchema, type Remote } from "./validators.js";

function remotesFile(home: string, create = false) {
  const directory = join(home, ".convoy");
  if (create && !existsSync(directory)) mkdirSync(directory, { mode: 0o700 });
  return join(directory, "remotes.json");
}

/** Saved SSH targets. Only the owner may read or replace this private file. */
export function readRemotes(home = homedir()): Remote[] {
  const file = remotesFile(home);
  if (!existsSync(file)) return [];
  const info = lstatSync(file);
  if (!info.isFile() || (info.mode & 0o077) || (process.getuid && info.uid !== process.getuid())) throw new Error(`Unsafe remote targets file ${file}. It must be private and owned by this account.`);
  return remotesSchema.parse(JSON.parse(readFileSync(file, "utf8"))).remotes;
}

export function saveRemotes(remotes: Remote[], home = homedir()) {
  const file = remotesFile(home, true), temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(remotesSchema.parse({ schema: 1, remotes })) + "\n", { mode: 0o600, flag: "wx" });
  renameSync(temporary, file);
}

export function readRemote(name: string, home = homedir()): Remote {
  const remote = readRemotes(home).find(value => value.name === name);
  if (!remote) throw new Error(`Unknown remote ${name}. Add it with convoy remote add ${name} --host <ssh-destination>.`);
  return remote;
}

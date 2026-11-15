import * as fs from "node:fs";
import { dirname, join, parse, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { getConfigPath } from "../toml.js";
import { credentialStoreSchema, type CredentialData } from "./validators.js";
const LIMIT = 1024 * 1024;
const empty = (): CredentialData => ({ version: 1, generation: 0, entries: {}, bindings: {} });

export class CredentialStore {
  readonly file: string;
  constructor(readonly directory = dirname(getConfigPath())) {
    this.file = join(directory, "credentials-v1.json");
  }
  private checkDirectory(create = false) {
    const directory = resolve(this.directory);
    let cursor = parse(directory).root;
    for (const part of directory.slice(cursor.length).split("/")) {
      cursor = join(cursor, part);
      try {
        const ancestor = fs.lstatSync(cursor);
        const unsafe = !ancestor.isDirectory() ? "is not a plain directory (a symlink?)."
          : ancestor.uid !== 0 && ancestor.uid !== process.getuid?.() ? "is owned by another user."
          : ancestor.mode & 0o022 && !(ancestor.mode & 0o1000) ? `is writable by group or others. Run chmod go-w ${cursor}.` : "";
        if (unsafe) throw new Error(`Unsafe credential directory: ${cursor} ${unsafe}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        if (!create) return false;
        fs.mkdirSync(cursor, { mode: 0o700 });
      }
    }
    const info = fs.lstatSync(directory);
    if (create && (info.uid !== process.getuid?.() || info.mode & 0o077))
      throw new Error(`Credential directory must be owner-only (0700)${info.uid === process.getuid?.() ? `. Run chmod 700 ${directory}.` : ""}`);
    return true;
  }
  read(): CredentialData {
    try {
      let info: fs.Stats;
      try {
        info = fs.lstatSync(this.file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        try {
          fs.lstatSync(this.file + ".enabled");
        } catch (markerError) {
          if ((markerError as NodeJS.ErrnoException).code === "ENOENT") return empty();
          throw markerError;
        }
        throw new Error("Managed credential store is missing");
      }
      this.checkDirectory(true);
      if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid?.() || info.mode & 0o077 || info.size > LIMIT)
        throw new Error("Unsafe credential file");
      const fd = fs.openSync(this.file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try {
        const actual = fs.fstatSync(fd);
        if (actual.ino !== info.ino || actual.dev !== info.dev || actual.size > LIMIT) throw new Error("Credential file changed");
        return credentialStoreSchema.parse(JSON.parse(fs.readFileSync(fd, "utf8")));
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      throw new Error("Cannot read managed credentials. Check schema, ownership and private file permissions.");
    }
  }
  mutate<T>(fn: (data: CredentialData) => T): T {
    this.checkDirectory(true);
    const lock = this.file + ".lock";
    try {
      fs.mkdirSync(lock, { mode: 0o700 });
    } catch {
      throw new Error(
        "Managed credentials are locked. Retry after the writer finishes; recover a stale lock only after verifying no writer is running."
      );
    }
    const temp = this.file + "." + randomUUID();
    const marker = this.file + ".enabled";
    let createdMarker = false;
    let committed = false;
    try {
      const data = this.read();
      const result = fn(data);
      data.generation++;
      if (!credentialStoreSchema.safeParse(data).success) throw new Error("Invalid managed credential update");
      const text = JSON.stringify(data);
      if (Buffer.byteLength(text) > LIMIT) throw new Error("Managed credential capacity exceeded");
      const fd = fs.openSync(temp, "wx", 0o600);
      try {
        fs.writeFileSync(fd, text);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      try {
        const enabled = fs.openSync(marker, "wx", 0o600);
        createdMarker = true;
        try {
          fs.writeFileSync(enabled, "1\n");
          fs.fsyncSync(enabled);
        } finally {
          fs.closeSync(enabled);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const info = fs.lstatSync(marker);
        if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid?.() || info.mode & 0o077)
          throw new Error("Unsafe credential marker");
      }
      fs.renameSync(temp, this.file);
      committed = true;
      const dir = fs.openSync(this.directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
      try {
        fs.fsyncSync(dir);
      } finally {
        fs.closeSync(dir);
      }
      return result;
    } finally {
      try {
        if (createdMarker && !committed) fs.unlinkSync(marker);
      } finally {
        fs.rmSync(temp, { force: true });
        fs.rmdirSync(lock);
      }
    }
  }
}

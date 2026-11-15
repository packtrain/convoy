import { ServiceStartupError } from "./errors.js";
import { appendFileSync, existsSync, readFileSync, renameSync, statSync, truncateSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { privateFile, validatePrivateFile } from "./paths.js";
import { logSchema, type LogEntry } from "./validators.js";

const FILE_LIMIT = 1024 * 1024;
export class ServiceLogs {
  private entries: LogEntry[] = [];
  private sequence = 0;
  private file: string;
  constructor(directory: string, private limit = FILE_LIMIT, private mode: "writer" | "reader" = "writer") {
    this.file = join(directory, "operations.ndjson");
    for (const file of [this.file + ".1", this.file]) {
      if (!existsSync(file)) continue;
      validatePrivateFile(file);
      if (statSync(file).size > limit + 1024) throw new ServiceStartupError("Oversized service log. Move it aside before starting.");
      const raw = readFileSync(file);
      const complete = raw.subarray(0, raw.lastIndexOf(10) + 1);
      if (mode === "writer" && file === this.file && complete.length !== raw.length) truncateSync(file, complete.length);
      for (const line of complete.toString("utf8").split("\n")) {
        if (!line) continue;
        try { this.entries.push(logSchema.parse(JSON.parse(line))); } catch { /* Ignore a crash-truncated record. */ }
      }
    }
    this.sequence = this.entries.at(-1)?.seq ?? 0;
    this.entries = this.entries.slice(-1000);
    if (mode === "writer") privateFile(this.file);
  }
  add(profile: string, message: string) {
    if (this.mode !== "writer") throw new Error("Retained log readers cannot write.");
    const entry = { seq: ++this.sequence, ts: Date.now(), profile, message };
    const line = JSON.stringify(entry) + "\n";
    if (statSync(this.file).size + Buffer.byteLength(line) > this.limit) {
      if (existsSync(this.file + ".1")) unlinkSync(this.file + ".1");
      renameSync(this.file, this.file + ".1");
      privateFile(this.file);
    }
    appendFileSync(this.file, line, { mode: 0o600 });
    this.entries.push(entry);
    if (this.entries.length > 1000) this.entries.shift();
  }
  read(after = 0, profile?: string) {
    const entries = this.entries.filter((entry) => entry.seq > after).slice(0, 100);
    return { entries: entries.filter((entry) => !profile || entry.profile === profile),
      cursor: entries.at(-1)?.seq ?? this.sequence,
      gap: after > this.sequence || (after > 0 && after < (this.entries[0]?.seq ?? 1) - 1) };
  }
}

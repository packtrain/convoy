import { spawn } from "node:child_process";
import { Duplex } from "node:stream";
import { HELPER, containerName, type Environment } from "./validators.js";

export interface DockerOptions { onProgress?: (text: string) => void; input?: string; progress?: boolean; timeout?: number; redact?: string[]; diagnostics?: boolean; signal?: AbortSignal }
export type Docker = (args: string[], options?: DockerOptions) => Promise<string>;

export const docker: Docker = (args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"], signal: options.signal });
  let output = "", diagnostics = "";
  const timeout = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Docker operation timed out. Inspect environment status before retrying.")); }, options.timeout ?? 60_000);
  child.stdin.on("error", () => {});
  child.stdin.end(options.input);
  child.stdout.on("data", (chunk: Buffer) => {
    if (options.progress) (options.onProgress ?? (text => process.stderr.write(text)))(chunk.toString());
    else { output += chunk.toString(); if (Buffer.byteLength(output) > 1024 * 1024) child.kill("SIGKILL"); }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    if (options.progress || options.diagnostics) (options.onProgress ?? (text => process.stderr.write(text)))(chunk.toString());
    if (!options.progress) diagnostics = (diagnostics + chunk.toString()).slice(-4096);
  });
  child.once("error", () => { clearTimeout(timeout); reject(new Error("Docker is unavailable. Install/start Docker Desktop or Docker Engine on this host.")); });
  child.once("close", code => {
    clearTimeout(timeout);
    let detail = options.input ? "Target operation failed; inspect target status before retrying." : diagnostics.trim();
    if (options.redact) {
      detail = `${output.slice(-8192)}\n${diagnostics}`;
      for (const secret of options.redact) if (secret) detail = detail.split(secret).join("<redacted>");
      detail = detail.replace(/sk_(?:user|project|org)_[a-zA-Z0-9_-]+/g, "<redacted>");
    }
    if (code !== 0 || Buffer.byteLength(output) > 1024 * 1024) reject(new Error(`Docker ${args[0]} failed. ${detail.trim()}`));
    else resolve(output.trim());
  });
});

export function bridge(environment: Environment): Duplex {
  const child = spawn("docker", ["exec", "-i", "--user", "node", containerName(environment), "convoy", "service", "bridge"], { stdio: "pipe" });
  const stream = new Duplex({
    read() { child.stdout.resume(); },
    write(chunk, encoding, callback) { child.stdin.write(chunk, encoding, callback); },
    final(callback) { child.stdin.end(callback); },
    destroy(error, callback) { child.stdout.destroy(); child.stdin.destroy(); child.kill("SIGTERM"); callback(error); },
  });
  child.stdout.on("data", chunk => { if (!stream.push(chunk)) child.stdout.pause(); });
  child.stdout.on("end", () => stream.push(null));
  child.stdout.on("error", error => stream.destroy(error));
  child.stdin.on("error", error => stream.destroy(error));
  child.stderr.resume();
  child.once("error", () => stream.destroy(new Error("Cannot execute the managed environment bridge.")));
  child.once("close", code => { if (code && !stream.destroyed) stream.destroy(new Error("Managed environment bridge exited. Inspect environment status.")); });
  stream.once("close", () => { child.stdin.destroy(); child.kill("SIGTERM"); });
  return stream;
}

export function helperArgs(environment: Environment, operation: string, ...args: string[]) {
  return ["exec", "--user", "root", containerName(environment), "python3", "-I", HELPER, operation, ...args];
}

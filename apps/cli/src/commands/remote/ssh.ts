import { spawn } from "node:child_process";
import { Duplex } from "node:stream";
import { ServiceTransportError } from "../service/errors.js";
import type { Remote } from "./validators.js";

const MARKER = "convoy-bridge-ready-1";
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
// Documented install paths tried when convoy is not on the non-interactive SSH PATH. Spec: docs/specs/cli-remote.md#targets
const INSTALL_PATHS = ["/opt/convoy/node_modules/.bin/convoy", "/usr/local/bin/convoy"];
class CliNotFoundError extends ServiceTransportError {}

/**
 * Uses the account's SSH config and known_hosts; never prompts or forwards agents, X11 or ports.
 * Runs through the remote login shell so its profile's PATH reaches a shared service. Spec: docs/specs/cli-shared-environments.md#execution
 */
export function sshArgs(remote: Remote, args: string[], options: { tty?: boolean; marker?: boolean } = {}) {
  const command = [...(remote.container ? ["docker", "exec", "-i", ...(options.tty ? ["-t"] : []), remote.container] : []), remote.command ?? "convoy", ...args];
  return [options.tty ? "-t" : "-T", "-o", "BatchMode=yes", "-o", "ForwardAgent=no", "-o", "ForwardX11=no", "-o", "ClearAllForwardings=yes",
    "-o", "ConnectTimeout=15", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3", "--", remote.host,
    `exec "$SHELL" -lc ${quote(`${options.marker ? `echo ${MARKER}; ` : ""}exec ${command.map(quote).join(" ")}`)}`];
}

function failure(remote: Remote, code: number | null, stderr: string) {
  // eslint-disable-next-line no-control-regex -- strip terminal control bytes from remote stderr
  const detail = stderr.replace(/[\0-\x1f\x7f]+/g, " ").trim().slice(-512);
  if (code === 255) return new ServiceTransportError(`SSH to ${remote.host} failed: ${(detail || "connection error").replace(/\.?$/, ".")} Check that ssh ${remote.host} works without prompts.`);
  if (code === 127) return new CliNotFoundError(`Convoy CLI not found on ${remote.name}${remote.container ? ` in container ${remote.container}` : ""}. Install a compatible CLI there or set its absolute path with --command.`);
  if (detail.includes("Service unavailable.")) return new ServiceTransportError(`Service unavailable. Start it with convoy service start -b --remote ${remote.name}.`);
  return new ServiceTransportError(`Remote ${remote.name}: ${detail || `bridge exited with status ${code ?? "unknown"}.`}`);
}

/** Protocol stream to the remote service. Shell startup output before the marker is discarded. */
export function sshBridge(remote: Remote): Duplex {
  const child = spawn("ssh", sshArgs(remote, ["service", "bridge"], { marker: true }), { stdio: "pipe" });
  let preamble: Buffer | undefined = Buffer.alloc(0), stderr = "";
  const stream = new Duplex({
    read() { child.stdout.resume(); },
    // A broken pipe means ssh exited; its status, not EPIPE, explains why.
    write(chunk, encoding, callback) { child.stdin.write(chunk, encoding, () => callback()); },
    final(callback) { child.stdin.end(() => callback()); },
    destroy(error, callback) { child.stdout.destroy(); child.stdin.destroy(); child.kill("SIGTERM"); callback(error); },
  });
  child.stdout.on("data", (chunk: Buffer) => {
    if (preamble) {
      preamble = Buffer.concat([preamble, chunk]);
      const index = preamble.indexOf(MARKER + "\n");
      if (index < 0) { if (preamble.length > 65_536) stream.destroy(new ServiceTransportError(`Remote ${remote.name} shell startup output exceeded 64 KiB. Keep non-interactive shell startup files quiet.`)); return; }
      chunk = preamble.subarray(index + MARKER.length + 1); preamble = undefined;
    }
    if (chunk.length && !stream.push(chunk)) child.stdout.pause();
  });
  child.stdout.on("end", () => stream.push(null));
  child.stdout.on("error", error => stream.destroy(error));
  child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-4096); });
  child.stdin.on("error", () => {});
  child.once("error", () => stream.destroy(new ServiceTransportError("Cannot run ssh. Install an OpenSSH client on this host.")));
  child.once("close", code => { if (!stream.destroyed) stream.destroy(code ? failure(remote, code, stderr) : undefined); });
  return stream;
}

/** Runs one CLI command without a terminal; resolves its stdout after the marker. */
export function sshRun(remote: Remote, args: string[], timeout = 30_000, input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("ssh", sshArgs(remote, args, { marker: true }), { stdio: "pipe" });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
    let stdout = "", stderr = "", timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeout);
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); if (stdout.length > 1024 * 1024) child.kill("SIGKILL"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-4096); });
    child.once("error", () => reject(new ServiceTransportError("Cannot run ssh. Install an OpenSSH client on this host.")));
    child.once("close", code => {
      clearTimeout(timer);
      const start = stdout.indexOf(MARKER + "\n");
      if (timedOut) reject(new ServiceTransportError(`Remote ${remote.name} did not answer within ${Math.round(timeout / 1000)} seconds.`));
      else if (code === 0 && start >= 0) resolve(stdout.slice(start + MARKER.length + 1).trim());
      else reject(code === 0 ? new ServiceTransportError(`Remote ${remote.name} returned no output.`) : failure(remote, code, stderr));
    });
  });
}

/** The remote CLI version; without --command, also the install path that answered. */
export async function remoteVersion(remote: Remote, timeout = 30_000, paths = INSTALL_PATHS): Promise<{ version: string; command?: string }> {
  const parse = (output: string) => {
    const version = output.split("\n").at(-1)?.trim() ?? "";
    if (!/^\d+\.\d+\.\d+/.test(version)) throw new ServiceTransportError(`Remote ${remote.name} did not report a Convoy version.`);
    return version;
  };
  try { return { version: parse(await sshRun(remote, ["--version"], timeout)) }; }
  catch (error) { if (remote.command || !(error instanceof CliNotFoundError)) throw error; }
  // One call tries each path and prints the first that answers before its version.
  const script = 'for c; do v=$("$c" --version 2>/dev/null) && { printf "%s\\n%s\\n" "$c" "$v"; exit 0; }; done; exit 127';
  const output = await sshRun({ ...remote, command: "/bin/sh" }, ["-c", script, "sh", ...paths], timeout);
  return { version: parse(output), command: output.split("\n")[0] };
}

/** Runs one CLI command on the remote with this terminal attached; resolves its exit status. */
export function sshForward(remote: Remote, args: string[], signal?: AbortSignal): Promise<number> {
  const tty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const child = spawn("ssh", sshArgs(remote, args, { tty }), { stdio: "inherit", signal });
  return new Promise((resolve, reject) => {
    child.once("error", error => reject(error.name === "AbortError" ? error : new ServiceTransportError("Cannot run ssh. Install an OpenSSH client on this host.")));
    child.once("close", code => {
      if (code === 127) console.error(failure(remote, code, "").message);
      resolve(code ?? 1);
    });
  });
}

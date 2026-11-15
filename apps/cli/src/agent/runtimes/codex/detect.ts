import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CliRuntimeDetectOptions, DetectedCli } from "../contracts.js";
import { resolveCodexExecutablePath } from "./runner.js";

const execFileAsync = promisify(execFile);

export type AvailableCodexCli = DetectedCli & {
  type: "codex";
};

/** An assigned AWS provider is advertised with its Region so the web picks matching model IDs. */
export async function detectCodex(options?: CliRuntimeDetectOptions): Promise<AvailableCodexCli | null> {
  try {
    const executable = await resolveCodexExecutablePath();
    const { stdout } = await execFileAsync(
      executable.command,
      ["--version"],
      { timeout: 10_000 }
    );
    // `codex --version` prints e.g. "codex-cli 0.142.3".
    const version = String(stdout ?? "").match(/(\d+\.\d+\.\d+)/)?.[1] ?? "unknown";
    const provider = options?.codexProvider;
    return provider ? { type: "codex", version, provider: provider.provider, region: provider.region } : { type: "codex", version };
  } catch {
    return null;
  }
}

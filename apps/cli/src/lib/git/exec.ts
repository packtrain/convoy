import { execFile, type ExecFileException } from "node:child_process";
import { existsSync } from "node:fs";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

export interface GitResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface RunGitOptions {
  timeoutMs?: number;
  /** Resolve (instead of throwing) when git exits non-zero. */
  allowNonZeroExit?: boolean;
  /** Extra environment variables merged over process.env (e.g. GIT_INDEX_FILE). */
  env?: Record<string, string>;
}

export class GitCommandError extends Error {
  constructor(
    message: string,
    public readonly gitArgs: readonly string[],
    public readonly exitCode: number | null,
    public readonly stderr: string
  ) {
    super(message);
    this.name = "GitCommandError";
  }
}

/** Git's `fatal:`/`error:` line, else the first line; progress lines come first. */
function errorLine(text: string): string {
  const lines = text.trim().split("\n").map((line) => line.trim());
  return lines.find((line) => /^(fatal|error):/.test(line)) ?? lines[0] ?? "";
}

/**
 * Single spawn point for git in the CLI. Bounded by a timeout and an output
 * cap; failures surface as GitCommandError with stderr attached.
 */
export async function runGit(cwd: string, args: string[], options: RunGitOptions = {}): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd,
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES,
        encoding: "utf8",
        ...(options.env ? { env: { ...process.env, ...options.env } } : {}),
      },
      (error: ExecFileException | null, stdout, stderr) => {
        if (!error) {
          resolve({ stdout, stderr, exitCode: 0 });
          return;
        }

        // Node reports a missing cwd as `spawn git ENOENT`.
        if (error.code === "ENOENT" && !existsSync(cwd)) {
          reject(new GitCommandError(`Working directory does not exist: ${cwd}`, args, null, ""));
          return;
        }

        const exitCode = typeof error.code === "number" ? error.code : null;
        if (exitCode !== null && options.allowNonZeroExit) {
          resolve({ stdout, stderr, exitCode });
          return;
        }

        const reason = error.killed ? `git ${args[0] ?? ""} timed out` : errorLine(stderr) || error.message;
        reject(new GitCommandError(reason, args, exitCode, stderr));
      }
    );
  });
}

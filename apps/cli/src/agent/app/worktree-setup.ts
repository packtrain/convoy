import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runGit } from "../../lib/git/exec.js";
import type { CreateWorktreeResult } from "../../lib/git/worktrees.js";
import type { CliRuntimeRunner, ContentChunk } from "../runtimes/contracts.js";

/** Fixed, no per-script setting. Spec: cli-worktrees.md#worktree-setup-scripts. */
export const WORKTREE_SETUP_TIMEOUT_MS = 30 * 60_000;
/**
 * In the worktree's git administrative directory, next to `convoy-identity`, so it never reaches a commit.
 * `pending` once Convoy created the worktree, `done <revision>` after the script succeeded.
 */
export const WORKTREE_SETUP_MARKER = "convoy-worktree-setup";

export interface ApprovedWorktreeSetup {
  repoKey: string;
  script: string;
  revision: number;
}

export function unapprovedWorktreeSetupMessage(repoKey: string): string {
  return `This project has a worktree setup script for ${repoKey} that you haven't approved. Review it in Project settings → Worktrees, then retry.`;
}

/** The web renders this code with a "Review script" link; the run's failure text is the fallback. */
export function unapprovedWorktreeSetupNotice(repoKey: string): ContentChunk {
  return notice("worktree-setup-unapproved", `The setup script for \`${repoKey}\` needs your approval.`);
}

export interface PrepareWorktreeInput {
  /** The registered path the worktree is created from; may be a repo subdirectory. */
  parentPath: string;
  branch: string;
  create: () => Promise<CreateWorktreeResult>;
  /** Absent when the repo has no setup. */
  setup?: ApprovedWorktreeSetup;
  /** Stop, claim loss and CLI shutdown; latched, so an abort before the spawn still counts. */
  signal: AbortSignal;
  threadId: string;
  cliType: string;
  runner: CliRuntimeRunner;
  emit: (chunk: ContentChunk) => void;
}

// ponytail: per-process lock; two CLI processes on one machine can still race on the same branch.
const preparing = new Map<string, Promise<unknown>>();

/**
 * Creates (or reuses) the worktree and runs its setup script once. Calls for the
 * same parent and branch queue, so Workflow Lanes sharing one worktree run it once.
 * Throws when aborted or when the script fails; then the marker stays `pending`.
 */
export async function prepareWorktree(input: PrepareWorktreeInput): Promise<CreateWorktreeResult> {
  const key = `${input.parentPath}\n${input.branch}`;
  const previous = preparing.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(() => prepareUnlocked(input));
  preparing.set(key, current);
  // Release the lock when the work settles, not when a stopped caller leaves the race below.
  current
    .finally(() => {
      if (preparing.get(key) === current) preparing.delete(key);
    })
    .catch(() => undefined);
  return Promise.race([current, abortion(input.signal)]);
}

function abortion(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

async function gitOutput(cwd: string, args: string[]): Promise<string> {
  return (await runGit(cwd, args)).stdout.trim();
}

function notice(code: string, message: string): ContentChunk {
  return { type: "convoy_notice", data: JSON.stringify({ code, title: "Worktree setup", message }) };
}

async function prepareUnlocked(input: PrepareWorktreeInput): Promise<CreateWorktreeResult> {
  input.signal.throwIfAborted();
  const created = await input.create();
  const { setup } = input;
  if (!setup) return created;

  const marker = join(await gitOutput(created.path, ["rev-parse", "--absolute-git-dir"]), WORKTREE_SETUP_MARKER);
  const state = await readFile(marker, "utf8").then((text) => text.trim(), () => null);
  if (!created.reused) {
    await writeFile(marker, "pending\n");
  } else if (state === null) {
    input.emit(notice("worktree-setup-skipped", `The worktree for \`${input.branch}\` already existed and Convoy did not create it, so its setup script did not run.`));
    return created;
  } else if (state !== "pending") {
    return created;
  }

  input.emit(notice("worktree-setup", `Running worktree setup for \`${setup.repoKey}\`…`));
  const env = {
    CONVOY_PARENT_PATH: await gitOutput(input.parentPath, ["rev-parse", "--show-toplevel"]),
    CONVOY_WORKTREE_PATH: created.path,
    CONVOY_BRANCH: input.branch,
  };
  input.signal.throwIfAborted();
  const kill = () => input.runner.abort();
  input.signal.addEventListener("abort", kill, { once: true });
  try {
    const execution = input.runner.execute(created.path, setup.script, {
      cliType: input.cliType,
      threadId: input.threadId,
      scriptRequest: { script: setup.script, timeoutMs: WORKTREE_SETUP_TIMEOUT_MS, env },
    });
    let next = await execution.next();
    while (!next.done) {
      input.emit(next.value);
      next = await execution.next();
    }
    const result = next.value.scriptResult;
    input.signal.throwIfAborted();
    if (!result || result.timedOut || result.exitCode !== 0) {
      const outcome = result?.timedOut
        ? `timed out after ${WORKTREE_SETUP_TIMEOUT_MS / 60_000} minutes`
        : `exited with code ${result?.exitCode ?? "unknown"}`;
      throw new Error(`Worktree setup for ${setup.repoKey} ${outcome}. Retry runs it again in the same worktree.`);
    }
  } finally {
    input.signal.removeEventListener("abort", kill);
  }
  await writeFile(marker, `done ${setup.revision}\n`);
  return created;
}

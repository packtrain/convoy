import { readFile, realpath, rm, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { runGit } from "./exec.js";
import {
  CAPTURE_TIMEOUT_MS,
  DIFF_ARGS,
  MAX_FILE_OP_BLOB_BYTES,
  capFileOpText,
  withWorkingTreeIndex,
  type FileAtRef,
  type FileDiff,
} from "./checkpoint.js";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "../storage-upload.js";

function escapes(rel: string): boolean {
  return !rel || rel.startsWith("..") || isAbsolute(rel);
}

/** `filePath` relative to `cwd`, or throw when it escapes the checkout lexically. */
function insidePath(cwd: string, filePath: string, verb: string): string {
  const rel = relative(resolve(cwd), resolve(cwd, filePath));
  if (escapes(rel)) {
    throw new Error(`Refusing to ${verb} a path outside the checkout: ${filePath}`);
  }
  return rel;
}

/**
 * Resolved, existing regular file for a read; also refuses symlinks whose
 * target lands outside the checkout (git tracks symlinks, so a branch can add
 * one). Both sides go through `realpath`: the checkout root may itself be a link.
 */
async function readableInside(cwd: string, filePath: string, verb: string): Promise<{ abs: string; size: number }> {
  const abs = join(cwd, insidePath(cwd, filePath, verb));
  const info = await stat(abs).catch(() => null);
  if (!info?.isFile()) {
    throw new Error("File not found in the working tree");
  }
  const [root, target] = await Promise.all([realpath(cwd), realpath(abs)]);
  if (escapes(relative(root, target))) {
    throw new Error(`Refusing to ${verb} a path outside the checkout: ${filePath}`);
  }
  return { abs: target, size: info.size };
}

/**
 * Current on-disk content of one file (OS-2041), with the same binary and
 * size guards as `readFileAtRef`. Never cached by the web: the tree is mutable.
 */
export async function readWorkingFile(cwd: string, filePath: string): Promise<FileAtRef> {
  const { abs, size } = await readableInside(cwd, filePath, "read");
  if (size > MAX_FILE_OP_BLOB_BYTES) {
    throw new Error(`File is too large to view (${Math.round(size / 1024 / 1024)} MB)`);
  }
  const content = await readFile(abs, "utf8");
  if (content.includes("\0")) {
    throw new Error("Binary file");
  }
  const capped = capFileOpText(content);
  return { content: capped.text, truncated: capped.truncated };
}

/** Download cap (OS-2050): the shared upload limit. */
export const MAX_DOWNLOAD_BYTES = MAX_UPLOAD_BYTES;

/** Raw on-disk bytes of one file for a download (OS-2050): no binary check, capped. */
export async function readWorkingFileBytes(cwd: string, filePath: string): Promise<Buffer> {
  const { abs, size } = await readableInside(cwd, filePath, "download");
  if (size > MAX_DOWNLOAD_BYTES) {
    throw new Error(`File is too large to download (${Math.round(size / 1024 / 1024)} MB, limit ${MAX_UPLOAD_MB} MB)`);
  }
  return readFile(abs);
}

/**
 * Uncommitted changes of a checkout as one unified patch against HEAD,
 * untracked files included (OS-2036, docs/specs/cli-worktrees.md → Worktree
 * changes view). Same byte cap and `truncated` flag as `diffBetweenRefs`.
 */
export async function diffWorkingTree(cwd: string): Promise<FileDiff> {
  const patch = await withWorkingTreeIndex(cwd, async (env) => {
    // --cached compares the temp index with HEAD (or the empty tree on an
    // unborn branch), so untracked files show as additions.
    const result = await runGit(cwd, [...DIFF_ARGS, "--cached"], { env, timeoutMs: CAPTURE_TIMEOUT_MS });
    return result.stdout;
  });
  const capped = capFileOpText(patch);
  return { patch: capped.text, truncated: capped.truncated };
}

/**
 * Discard one file's uncommitted changes (OS-2043): a file in HEAD is restored
 * from it, worktree and index; an untracked one is deleted. Not undoable.
 */
export async function revertWorkingFile(cwd: string, filePath: string): Promise<void> {
  const rel = insidePath(cwd, filePath, "revert");
  const inHead = await runGit(cwd, ["cat-file", "-e", `HEAD:${rel}`], { allowNonZeroExit: true });
  if (inHead.exitCode === 0) {
    await runGit(cwd, ["restore", "--source", "HEAD", "--worktree", "--staged", "--", rel], { timeoutMs: CAPTURE_TIMEOUT_MS });
    return;
  }
  await rm(join(cwd, rel), { force: true });
  // Drop a staged index entry for the new file, if any.
  await runGit(cwd, ["reset", "--quiet", "--", rel], { timeoutMs: CAPTURE_TIMEOUT_MS, allowNonZeroExit: true });
}

/**
 * Discard the uncommitted changes of exactly `filePaths` (OS-2234). Every path
 * is checked before any is touched; then each goes through `revertWorkingFile`.
 */
export async function revertWorkingTree(cwd: string, filePaths: readonly string[]): Promise<void> {
  for (const filePath of filePaths) {
    insidePath(cwd, filePath, "revert");
  }
  for (const filePath of filePaths) {
    try {
      await revertWorkingFile(cwd, filePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Stopped at ${filePath}: ${message}`);
    }
  }
}

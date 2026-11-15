import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";
import type { CliRunDiffFile } from "@/convex/lib/contracts/validators";

export type PullRequestDiff = FunctionReturnType<typeof api.integrations.github.pullRequests.readDiff>;
export type PullRequestDiffFile = PullRequestDiff["files"][number];

// ponytail: the shared section header has no rename kind, so a rename shows its new path only.
const SECTION_KIND: Record<PullRequestDiffFile["status"], CliRunDiffFile["kind"]> = {
  added: "added",
  removed: "deleted",
  modified: "modified",
  renamed: "modified",
};

/** GitHub's file entry as the shared file-section header expects it. */
export function toSectionFile(file: PullRequestDiffFile): CliRunDiffFile {
  return { path: file.path, kind: SECTION_KIND[file.status], additions: file.additions, deletions: file.deletions };
}

/**
 * GitHub's `patch` holds hunks only; the renderer needs git headers. Null when
 * GitHub sent no text (binary, too large, or past the budget): never an empty diff.
 */
export function toUnifiedPatch(file: PullRequestDiffFile): string | null {
  if (file.patch === undefined) {
    return null;
  }
  // The headers are line-oriented, so control characters in a name would split them.
  // The section header shows the real name; these only feed the renderer.
  const oldPath = headerPath(file.previousPath ?? file.path);
  const newPath = headerPath(file.path);
  const from = file.status === "added" ? "/dev/null" : `a/${oldPath}`;
  const to = file.status === "removed" ? "/dev/null" : `b/${newPath}`;
  return `diff --git a/${oldPath} b/${newPath}\n--- ${from}\n+++ ${to}\n${file.patch}\n`;
}

function headerPath(path: string): string {
  return path.replace(/[\u0000-\u001f\u007f]/g, "_");
}

import type { CliThreadRepoBranch } from "@/convex/lib/contracts/validators";

export interface ThreadBranchLabel {
  text: string;
  title: string;
  /** The one branch, when there is one to copy. */
  branch?: string;
  /** Each repo's line, `old-app · main`, in a multi-repo folder whose repos differ. */
  repoLines?: string[];
}

/** A thread's branch, or "N repos" with each repo's branch on hover (docs/specs/cli-multi-repo-projects.md#branch-and-pull-requests). */
export function threadBranchLabel(thread: { branch?: string; repoBranches?: CliThreadRepoBranch[] }): ThreadBranchLabel | undefined {
  if (thread.branch) return { text: thread.branch, title: `Branch: ${thread.branch}`, branch: thread.branch };
  const repos = thread.repoBranches;
  if (!repos?.length) return undefined;
  const repoLines = repos.map((repo) => `${repo.repo} · ${repo.branch ?? "no branch"}`);
  return { text: `${repos.length} ${repos.length === 1 ? "repo" : "repos"}`, title: repoLines.join("\n"), repoLines };
}

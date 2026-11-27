import type { CliRunDiffRepo, CliRunDiffRepoPreview } from "@/convex/lib/contracts/validators";

// Multi-repo runs: files carry their repo's relative path, the summary each repo's entry id.
// Spec: docs/specs/cli-thread-run-diffs.md#multi-repo-folders

/** The repo entry a file's ops target; undefined for a repo the server couldn't resolve. */
export function repoPathIdOf(summary: { repos?: CliRunDiffRepo[] }, file: { repo?: string }): string | undefined {
  return summary.repos?.find((repo) => repo.path === file.repo)?.pathId;
}

/** A file's path from the thread's working directory, as a mention names it. */
export function folderPathOf(file: { path: string; repo?: string }): string {
  return file.repo ? `${file.repo}/${file.path}` : file.path;
}

/**
 * One repo's slice of a run, null when the run didn't change it; a single-repo run is returned as is.
 * `files` stays a preview's slice; an envelope's counts become the repo's own.
 */
export function scopeRunToRepo<T extends { repos?: (CliRunDiffRepo | CliRunDiffRepoPreview)[]; files: { path: string; repo?: string }[] }>(
  summary: T,
  repo: { id: string; label: string }
): T | null {
  if (!summary.repos) {
    return summary;
  }
  const entry = summary.repos.find((changed) => changed.pathId === repo.id);
  if (!entry) {
    return null;
  }
  const counts = "fileCount" in entry ? { fileCount: entry.fileCount, additions: entry.additions, deletions: entry.deletions } : {};
  return { ...summary, ...counts, files: summary.files.filter((file) => file.repo === repo.label) };
}

/**
 * The repo the Changes tab shows: the one remembered for the thread, else the newest run's first
 * changed repo, else the first. Undefined for a folder without repos.
 */
export function pickChangesRepo<R extends { id: string }>(
  repos: readonly R[],
  remembered: string | null,
  runsNewestFirst: readonly { repos?: CliRunDiffRepo[] }[]
): R | undefined {
  const byId = (id: string | null | undefined) => repos.find((repo) => repo.id === id);
  const rememberedRepo = byId(remembered);
  if (rememberedRepo) return rememberedRepo;
  for (const run of runsNewestFirst) {
    const changed = run.repos?.map((repo) => byId(repo.pathId)).find((repo) => repo !== undefined);
    if (changed) return changed;
  }
  return repos[0];
}

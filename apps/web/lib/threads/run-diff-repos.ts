import { folderRepos, relativePathInside, type CliProfilePathEntry, type CliRunDiffRepo, type CliRunDiffRepoPreview } from "@/convex/lib/contracts/validators";

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

/** A file's path from a repo thread's own checkout (`own`, relative to the folder), as a mention names it. */
export function checkoutPathOf(file: { path: string; repo?: string }, own: string): string {
  return !file.repo || file.repo === own ? file.path : `${"../".repeat(own.split("/").length)}${folderPathOf(file)}`;
}

/**
 * One repo's slice of a run, null when the run didn't change it. A single-repo run is returned as is,
 * or only for `singleRepoOwnerId` when set (a repo thread's own checkout, for CLIs before 0.189).
 * `files` stays a preview's slice; an envelope's counts become the repo's own.
 */
export function scopeRunToRepo<T extends { repos?: (CliRunDiffRepo | CliRunDiffRepoPreview)[]; files: { path: string; repo?: string }[] }>(
  summary: T,
  repo: { id: string; label: string },
  singleRepoOwnerId?: string
): T | null {
  if (!summary.repos) {
    return singleRepoOwnerId === undefined || singleRepoOwnerId === repo.id ? summary : null;
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

type ProfilePath = Pick<CliProfilePathEntry, "id" | "path" | "label" | "kind" | "parentPathId">;

/**
 * The repos a thread's Changes tab switches between: a folder's repos, or for a thread on one of
 * them (or its worktree) its own checkout first, then the folder's other repos. Labels are paths
 * relative to the folder, as run summaries name them. Spec: docs/specs/cli-multi-repo-projects.md#picking-a-repo
 */
export function threadChangesRepos<P extends ProfilePath>(paths: readonly P[], pathId: string | undefined): P[] {
  const entry = paths.find((path) => path.id === pathId);
  const repo = entry?.kind === "worktree" ? paths.find((path) => path.id === entry.parentPathId && path.kind === "repo") : entry;
  if (!entry || repo?.kind !== "repo") return folderRepos(paths, pathId);
  const folder = paths.find((path) => path.id === repo.parentPathId);
  const siblings = folderRepos(paths, repo.parentPathId).filter((path) => path.id !== entry.id);
  return [{ ...entry, label: entry === repo || !folder ? entry.label : relativePathInside(folder.path, entry.path) ?? entry.label }, ...siblings];
}

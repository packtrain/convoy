import { useCallback, useMemo, useState } from "react";
import type { CliRunDiffRepo } from "@/convex/lib/contracts/validators";
import { readChangesRepo, writeChangesRepo } from "@/lib/threads/changes-view-prefs";
import { pickChangesRepo, scopeRunToRepo } from "@/lib/threads/run-diff-repos";

interface RunEnvelope {
  role: string;
  diffSummary?: { repos?: CliRunDiffRepo[]; files: { path: string; repo?: string }[] };
}

/**
 * The repo a multi-repo thread's Changes tab shows, and the runs narrowed to it. The default settles once
 * `ready` (messages loaded), so a new run elsewhere never moves an open view; `select` remembers a pick
 * per thread. Spec: docs/specs/cli-multi-repo-projects.md#repo-switcher
 */
export function useChangesRepo<R extends { id: string; label: string }, E extends RunEnvelope>(
  threadId: string,
  repos: readonly R[],
  envelopes: readonly E[],
  ready: boolean,
  /** A repo or worktree thread: the default is its own checkout, `repos[0]` (OS-2647). */
  options: { ownFirst?: boolean } = {}
) {
  const [picked, setPicked] = useState<{ threadId: string; repoId: string } | null>(null);
  const settled = picked?.threadId === threadId ? repos.find((repo) => repo.id === picked.repoId) : undefined;
  const fallback =
    settled || repos.length === 0
      ? undefined
      : pickChangesRepo(repos, readChangesRepo(threadId), options.ownFirst ? [] : envelopes.flatMap((message) => (message.role === "assistant" && message.diffSummary ? [message.diffSummary] : [])).reverse());
  if (fallback && ready) {
    setPicked({ threadId, repoId: fallback.id });
  }
  const repo = settled ?? fallback;

  const select = useCallback(
    (repoId: string) => {
      setPicked({ threadId, repoId });
      writeChangesRepo(threadId, repoId);
    },
    [threadId]
  );
  const ownId = options.ownFirst ? repos[0]?.id : undefined;
  const scoped = useMemo(
    () =>
      repo
        ? envelopes.map((message) =>
            message.role === "assistant" && message.diffSummary
              ? { ...message, diffSummary: scopeRunToRepo(message.diffSummary, repo, ownId) ?? undefined }
              : message
          )
        : envelopes,
    [envelopes, repo, ownId]
  );
  return { repo, select, envelopes: scoped };
}

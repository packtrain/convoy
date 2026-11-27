import type { CliProfilePathEntry } from "@/convex/lib/contracts/validators";
import { cn } from "@/lib/utils";

type RepoCountPath = Pick<CliProfilePathEntry, "kind" | "parentPathId" | "label">;

/** "N repos" for a multi-repo folder, its repos listed on hover. Spec: docs/specs/cli-multi-repo-projects.md#web */
export function RepoCount({ paths, parentId, className }: { paths: RepoCountPath[]; parentId: string; className?: string }) {
  const repos = paths.filter((path) => path.kind === "repo" && path.parentPathId === parentId);
  if (repos.length === 0) return null;
  return (
    <span className={cn("shrink-0 text-muted-foreground", className)} title={repos.map((repo) => repo.label).join("\n")}>
      {repos.length} {repos.length === 1 ? "repo" : "repos"}
    </span>
  );
}

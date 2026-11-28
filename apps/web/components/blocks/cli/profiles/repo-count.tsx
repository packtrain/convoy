import { folderRepos, type CliProfilePathEntry } from "@/convex/lib/contracts/validators";
import { cn } from "@/lib/utils";

type RepoCountPath = Pick<CliProfilePathEntry, "kind" | "parentPathId" | "label">;

/** "N repos" for a multi-repo folder, its repos listed on hover. Spec: docs/specs/cli-multi-repo-projects.md#web */
export function RepoCount({ paths, parentId, className }: { paths: RepoCountPath[]; parentId: string; className?: string }) {
  const repos = folderRepos(paths, parentId);
  if (repos.length === 0) return null;
  const labels = repos.map((repo) => repo.label);
  // The names join the parent row's accessible name: the count sits inside a link or menu item.
  return (
    <span className={cn("shrink-0 text-muted-foreground", className)}>
      <span aria-hidden title={labels.join("\n")}>{repos.length} {repos.length === 1 ? "repo" : "repos"}</span>
      <span className="sr-only">{repos.length} {repos.length === 1 ? "repo" : "repos"}: {labels.join(", ")}</span>
    </span>
  );
}

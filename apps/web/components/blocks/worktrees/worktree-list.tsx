"use client";

import { useState, type ReactNode } from "react";
import { ChevronRight, FolderGit2, GitBranch, Laptop, Loader2, Trash2 } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { folderRepos, isConfiguredPath, type CliProfilePathEntry } from "@/convex/lib/contracts/validators";
import { Button } from "@/components/ui/button";
import { truncateRepoPath } from "@/components/blocks/project/agent-list-item";
import { AppLink, appRoute, href, parseWorktreeChangesTarget, useNavigation } from "@/lib/navigation";
import { readExpandedProfileIds, writeExpandedProfileIds } from "@/lib/worktrees/storage";
import { useWorktreeRemoval } from "@/lib/worktrees/hooks/use-worktree-removal";
import { cn } from "@/lib/utils";
import { RemoveWorktreeDialog } from "./worktree-remove-dialog";

interface WorktreeListProps {
  profileId: Id<"cliProfiles">;
  /** The profile's path entries, as the caller already holds them. */
  paths: CliProfilePathEntry[];
  organizationSlug: string;
  projectAlias: string;
  /** Dense thread-list layout: unrounded rows, compact thread-row type and height. */
  compactLayout: boolean;
  /** The CLI row's avatar; it becomes the expand toggle and shows a chevron on hover and when expanded. */
  avatar: ReactNode;
  /** The CLI row, rendered without its own avatar; clicking it toggles like the chevron. */
  children: (toggle: () => void) => ReactNode;
}

/**
 * Expandable checkouts of one CLI profile under its Connected CLIs row — each
 * repo path and its worktrees in stored order, linking to the changes view
 * (OS-2036). Expansion persists per profile in localStorage.
 */
export function WorktreeList({ profileId, paths, organizationSlug, projectAlias, compactLayout, avatar, children }: WorktreeListProps) {
  const [expanded, setExpanded] = useState(() => readExpandedProfileIds().includes(profileId));
  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    const others = readExpandedProfileIds().filter((id) => id !== profileId);
    writeExpandedProfileIds(next ? [...others, profileId] : others);
  };

  // The checkout whose changes view is open.
  const { location, push } = useNavigation();
  const target = parseWorktreeChangesTarget(location.search);
  // A repo opens in its folder's switcher (`pathId=<folder>&repo=<repo>`), so the repo row is the open one.
  const selectedPathId = target?.profileId === String(profileId) ? (target.repo ?? target.pathId) : null;
  // Lives here, not in the rows, so collapsing mid-op still reports the outcome.
  const [confirmWorktree, setConfirmWorktree] = useState<CliProfilePathEntry | null>(null);
  const removal = useWorktreeRemoval(profileId, {
    onRemoved: (pathId) => {
      if (pathId === selectedPathId) {
        push(appRoute.projectThreads(organizationSlug, projectAlias));
      }
    },
    onViewChanges: (pathId) =>
      push(appRoute.projectThreadsWithPreselection(organizationSlug, projectAlias, { profileId: String(profileId), pathId, view: "changes" })),
  });

  // A 2px gap keeps hovered and selected rows from merging into one block.
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-0.5">
      {/* One hover surface: the row highlights as a whole, the toggle has no bg of its own. */}
      <div
        className={cn(
          "group/cli grid grid-cols-[auto_minmax(0,1fr)] items-center transition-colors hover:bg-accent",
          !compactLayout && "rounded-lg"
        )}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className={cn(
            "size-6 cursor-pointer rounded-full text-muted-foreground hover:bg-transparent hover:text-foreground aria-expanded:bg-transparent dark:hover:bg-transparent",
            // Thread rows: pl-2 compact, px-3 inside the non-compact card.
            compactLayout ? "ml-2" : "ml-3"
          )}
          aria-label={expanded ? "Hide checkouts" : "Show checkouts"}
          aria-expanded={expanded}
          onClick={toggle}
        >
          <span className={cn("contents", expanded ? "hidden" : "group-hover/cli:hidden group-focus-within/cli:hidden")}>{avatar}</span>
          <ChevronRight
            className={cn(
              "size-3.5 transition-transform",
              expanded ? "rotate-90" : "hidden group-hover/cli:block group-focus-within/cli:block"
            )}
          />
        </Button>
        {children(toggle)}
      </div>
      {expanded && (
        <CheckoutRows
          profileId={profileId}
          paths={paths}
          organizationSlug={organizationSlug}
          projectAlias={projectAlias}
          compactLayout={compactLayout}
          selectedPathId={selectedPathId}
          removingPathId={removal.removingPathId}
          onRemove={setConfirmWorktree}
        />
      )}
      <RemoveWorktreeDialog
        worktree={confirmWorktree}
        onClose={() => setConfirmWorktree(null)}
        onConfirm={(worktree) => void removal.remove(worktree.id)}
      />
    </div>
  );
}

// Content sits under the CLI name: toggle margin (8/12) + 24px toggle + the row's 6px lead-in;
// each nesting level indents one icon column further.
const INDENT = { compact: ["pl-[38px]", "pl-[62px]", "pl-[86px]"], regular: ["pl-[42px]", "pl-[66px]", "pl-[90px]"] };

function CheckoutRows({
  profileId,
  paths,
  organizationSlug,
  projectAlias,
  compactLayout,
  selectedPathId,
  removingPathId,
  onRemove,
}: Omit<WorktreeListProps, "children" | "avatar"> & {
  selectedPathId: string | null;
  removingPathId: string | null;
  onRemove: (worktree: CliProfilePathEntry) => void;
}) {
  // Alphabetical (OS-2038): checkouts by label, worktrees by branch.
  const byName = (a: CliProfilePathEntry, b: CliProfilePathEntry) =>
    (a.kind === "worktree" ? (a.branch ?? a.label) : a.label).localeCompare(b.kind === "worktree" ? (b.branch ?? b.label) : b.label);
  // A folder's repos nest under it in stored order, each with its worktrees (cli-multi-repo-projects.md#web).
  const checkouts = paths.filter(isConfiguredPath).sort(byName);
  const worktreesOf = (parentId: string) =>
    paths.filter((entry) => entry.kind === "worktree" && entry.parentPathId === parentId).sort(byName);
  const parentIds = new Set(paths.filter((entry) => entry.kind !== "worktree").map((entry) => entry.id));
  const orphans = paths
    .filter((entry) => entry.kind === "worktree" && !parentIds.has(entry.parentPathId ?? ""))
    .sort(byName);
  const withWorktrees = (entry: CliProfilePathEntry, depth: number) => [
    renderRow(entry, depth),
    ...worktreesOf(entry.id).map((wt) => renderRow(wt, depth + 1)),
  ];

  function renderRow(entry: CliProfilePathEntry, depth: number) {
    const selected = entry.id === selectedPathId;
    const removing = entry.id === removingPathId;
    const removable = entry.kind === "worktree";
    const name = entry.kind === "worktree" ? entry.branch : entry.label;
    return (
      <div key={entry.id} className={cn("group/checkout relative", removing && "opacity-60")}>
        <AppLink
          aria-current={selected ? "page" : undefined}
          href={href(
            appRoute.projectThreadsWithPreselection(organizationSlug, projectAlias, {
              profileId: String(profileId),
              ...(entry.kind === "repo" && entry.parentPathId ? { pathId: entry.parentPathId, repo: entry.id } : { pathId: entry.id }),
              view: "changes",
            })
          )}
          // Same type and height as the compact thread row (px-3 py-2, text-sm leading-5).
          className={cn(
            "flex items-center gap-2 py-2 pr-3 text-sm font-medium leading-5 transition-colors group-hover/checkout:bg-accent",
            !compactLayout && "rounded-lg",
            INDENT[compactLayout ? "compact" : "regular"][Math.min(depth, 2)],
            // Room for the remove button while it shows.
            removable && (selected || removing ? "pr-9" : "group-hover/checkout:pr-9 group-focus-within/checkout:pr-9"),
            selected && "bg-primary/10 group-hover/checkout:bg-primary/10"
          )}
          title={entry.path}
        >
          {entry.kind === "worktree" ? (
            <GitBranch className="size-4 shrink-0 text-muted-foreground" />
          ) : entry.kind === "repo" ? (
            <FolderGit2 className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <Laptop className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate">{name}</span>
          {entry.kind !== "repo" && (
            <span className="truncate text-xs font-normal text-muted-foreground/70">{truncateRepoPath(entry.path)}</span>
          )}
        </AppLink>
        {removable && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={`Remove worktree ${name}`}
            disabled={removing}
            className={cn(
              "absolute top-1/2 right-1.5 -translate-y-1/2 cursor-pointer text-muted-foreground hover:text-destructive",
              selected || removing
                ? "opacity-100"
                : "opacity-0 focus-visible:opacity-100 group-hover/checkout:opacity-100 group-focus-within/checkout:opacity-100"
            )}
            onClick={() => onRemove(entry)}
          >
            {removing ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-0.5 pb-1">
      {checkouts.map((checkout) => [
        ...withWorktrees(checkout, 0),
        ...folderRepos(paths, checkout.id).flatMap((repo) => withWorktrees(repo, 1)),
      ])}
      {orphans.map((entry) => renderRow(entry, 0))}
    </div>
  );
}

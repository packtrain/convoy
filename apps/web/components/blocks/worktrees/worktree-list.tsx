"use client";

import { useState, type ReactNode } from "react";
import { ChevronRight, GitBranch, Laptop } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import type { CliProfilePathEntry } from "@/convex/lib/contracts/validators";
import { Button } from "@/components/ui/button";
import { truncateRepoPath } from "@/components/blocks/project/agent-list-item";
import { AppLink, appRoute, href, parseWorktreeChangesTarget, useNavigation } from "@/lib/navigation";
import { readExpandedProfileIds, writeExpandedProfileIds } from "@/lib/worktrees/storage";
import { cn } from "@/lib/utils";

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
        />
      )}
    </div>
  );
}

function CheckoutRows({ profileId, paths, organizationSlug, projectAlias, compactLayout }: Omit<WorktreeListProps, "children" | "avatar">) {
  // The checkout whose changes view is open.
  const target = parseWorktreeChangesTarget(useNavigation().location.search);
  const selectedPathId = target?.profileId === String(profileId) ? target.pathId : null;

  // Alphabetical (OS-2038): checkouts by label, worktrees by branch.
  const byName = (a: CliProfilePathEntry, b: CliProfilePathEntry) =>
    (a.kind === "worktree" ? (a.branch ?? a.label) : a.label).localeCompare(b.kind === "worktree" ? (b.branch ?? b.label) : b.label);
  const checkouts = paths.filter((entry) => entry.kind !== "worktree").sort(byName);
  const worktreesOf = (parentId: string) =>
    paths.filter((entry) => entry.kind === "worktree" && entry.parentPathId === parentId).sort(byName);
  const orphans = paths
    .filter((entry) => entry.kind === "worktree" && !checkouts.some((checkout) => checkout.id === entry.parentPathId))
    .sort(byName);

  const renderRow = (entry: CliProfilePathEntry, nested: boolean) => (
    <AppLink
      key={entry.id}
      aria-current={entry.id === selectedPathId ? "page" : undefined}
      href={href(
        appRoute.projectThreadsWithPreselection(organizationSlug, projectAlias, {
          profileId: String(profileId),
          pathId: entry.id,
          view: "changes",
        })
      )}
      // Same type and height as the compact thread row (px-3 py-2, text-sm leading-5).
      className={cn(
        "flex items-center gap-2 py-2 pr-3 text-sm font-medium leading-5 transition-colors hover:bg-accent",
        !compactLayout && "rounded-lg",
        // Content sits under the CLI name: toggle margin (8/12) + 24px toggle +
        // the row's 6px lead-in; worktrees indent one icon column further.
        compactLayout ? (nested ? "pl-[62px]" : "pl-[38px]") : nested ? "pl-[66px]" : "pl-[42px]",
        entry.id === selectedPathId && "bg-primary/10 hover:bg-primary/10"
      )}
      title={entry.path}
    >
      {entry.kind === "worktree" ? (
        <GitBranch className="size-4 shrink-0 text-muted-foreground" />
      ) : (
        <Laptop className="size-4 shrink-0 text-muted-foreground" />
      )}
      <span className="truncate">{entry.kind === "worktree" ? entry.branch : entry.label}</span>
      <span className="truncate text-xs font-normal text-muted-foreground/70">{truncateRepoPath(entry.path)}</span>
    </AppLink>
  );

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-0.5 pb-1">
      {checkouts.map((checkout) => [renderRow(checkout, false), ...worktreesOf(checkout.id).map((wt) => renderRow(wt, true))])}
      {orphans.map((entry) => renderRow(entry, false))}
    </div>
  );
}

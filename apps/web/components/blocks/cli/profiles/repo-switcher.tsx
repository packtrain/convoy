"use client";

import { ChevronDown, FolderGit2, GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type SwitcherRepo = { id: string; label: string; kind?: "repo" | "worktree"; branch?: string };

/** A repo's worktree reads as its branch; `label` (its path in the folder) is the title. */
function nameOf(repo: SwitcherRepo) {
  return repo.kind === "worktree" ? (repo.branch ?? repo.label) : repo.label;
}

/** Picks the repo a multi-repo folder's Changes and History show. Spec: docs/specs/cli-multi-repo-projects.md#repo-switcher */
export function RepoSwitcher({
  repos,
  value,
  onChange,
}: {
  repos: readonly SwitcherRepo[];
  value: string;
  onChange: (repoId: string) => void;
}) {
  const current = repos.find((repo) => repo.id === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="min-w-0 max-w-40 shrink cursor-pointer gap-1 px-2 font-medium" aria-label={`Repository: ${current ? nameOf(current) : ""}`} title={current?.label}>
          {/* No repo icon: the toolbar is tight, and the name must fit. The branch icon tells a worktree from its repo. */}
          {current?.kind === "worktree" && <GitBranch className="size-3.5 text-muted-foreground" />}
          <span className="truncate">{current && nameOf(current)}</span>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 min-w-48 overflow-y-auto">
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {repos.map((repo) => (
            <DropdownMenuRadioItem key={repo.id} value={repo.id} title={repo.label} className="whitespace-nowrap">
              {repo.kind === "worktree"
                ? <GitBranch className="size-3.5 text-muted-foreground" aria-hidden />
                : <FolderGit2 className="size-3.5 text-muted-foreground" aria-hidden />}
              {nameOf(repo)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

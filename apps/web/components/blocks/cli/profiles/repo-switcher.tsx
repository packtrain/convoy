"use client";

import { ChevronDown, FolderGit2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Picks the repo a multi-repo folder's Changes and History show. Spec: docs/specs/cli-multi-repo-projects.md#repo-switcher */
export function RepoSwitcher({
  repos,
  value,
  onChange,
}: {
  repos: readonly { id: string; label: string }[];
  value: string;
  onChange: (repoId: string) => void;
}) {
  const current = repos.find((repo) => repo.id === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="min-w-0 cursor-pointer gap-1 px-2 font-medium" aria-label={`Repository: ${current?.label ?? ""}`}>
          <FolderGit2 className="size-3.5 text-muted-foreground" />
          <span className="truncate">{current?.label}</span>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 min-w-48 overflow-y-auto">
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {repos.map((repo) => (
            <DropdownMenuRadioItem key={repo.id} value={repo.id}>
              {repo.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

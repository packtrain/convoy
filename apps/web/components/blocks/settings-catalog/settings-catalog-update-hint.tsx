"use client";

import { CircleFadingArrowUp } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * The organization template is ahead of the installed copy, so a refresh has
 * something to fetch (OS-1759). Shared by AI Agents and Skills rows.
 */
export function SettingsCatalogUpdateHint({ version }: { version: number }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span role="img" aria-label={`New version ${version} is available`} className="inline-flex items-center">
          <CircleFadingArrowUp className="size-4 text-muted-foreground" />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">New version {version} is available</TooltipContent>
    </Tooltip>
  );
}

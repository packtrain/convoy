"use client";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * `v{n}` badge for a settings catalog row (OS-1759). Shared by AI Agents and
 * Skills: an organization template shows its own version, an installed copy the
 * version it came from, red once that copy diverged.
 */
export function SettingsCatalogVersionBadge({
  version,
  label,
  diverged = false,
}: {
  version: number;
  label: string;
  diverged?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant={diverged ? "destructive" : "outline"}
          shape="rounded"
          className="shrink-0 px-1.5 font-normal tabular-nums"
          role="img"
          aria-label={label}
        >
          v{version}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{label}.</TooltipContent>
    </Tooltip>
  );
}

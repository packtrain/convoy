"use client";

import { useMemo } from "react";
import { useQueries, type RequestForQueries } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { MAX_PULL_REQUEST_LIST_REFS } from "@/convex/checks/lib/constants";
import { cn } from "@/lib/utils";
import { StatusGlyph } from "./check-row";

type ListedRow = FunctionReturnType<typeof api.checks.results.listForPullRequestList>[number];
type ListedCheck = ListedRow["checks"][number];

/**
 * The current results of the Checks shown in the pull request list, by PR ref, for the loaded rows.
 * One read per batch the server accepts; loading more rows adds a batch and leaves the earlier ones alone.
 */
export function usePullRequestListChecks(projectId: Id<"projects">, refs: string[]): Map<string, ListedCheck[]> {
  // useQueries resubscribes when the object changes, so it is keyed on the refs' content, not the array.
  const refsKey = JSON.stringify(refs);
  const queries = useMemo(() => {
    const list: string[] = JSON.parse(refsKey);
    const batches: RequestForQueries = {};
    for (let start = 0; start < list.length; start += MAX_PULL_REQUEST_LIST_REFS) {
      batches[start] = { query: api.checks.results.listForPullRequestList, args: { projectId, refs: list.slice(start, start + MAX_PULL_REQUEST_LIST_REFS) } };
    }
    return batches;
  }, [projectId, refsKey]);
  const batches = useQueries(queries);
  return new Map(
    Object.values(batches).flatMap((rows) => (Array.isArray(rows) ? (rows as ListedRow[]).map((row) => [row.ref, row.checks] as const) : []))
  );
}

/**
 * A PR list row's status icons, one slot per shown Check so each column is the same Check, with its label, value,
 * and note in a tooltip. An unreported Check is the pending circle; a result from an older head is dimmed.
 */
export function PullRequestCheckIcons({ checks }: { checks: ListedCheck[] | undefined }) {
  if (!checks?.length) return null;
  return (
    <span className="relative z-10 flex shrink-0 items-center gap-1" aria-label="Pull request checks">
      {checks.map((check) => (
        <Tooltip key={check.key}>
          <TooltipTrigger asChild>
            <span
              tabIndex={0}
              data-outdated={check.outdated || undefined}
              className={cn("rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none", check.outdated && "opacity-40")}
            >
              <StatusGlyph status={check.status} />
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-72">
            <p className="font-medium">
              {check.label}
              {check.value ? `: ${check.value}` : null}
            </p>
            {check.status === "pending" ? <p>Not reported on this pull request</p> : null}
            {check.note ? <p className="whitespace-pre-wrap">{check.note}</p> : null}
            {check.outdated ? <p className="text-warning">Outdated: reported on an older commit</p> : null}
          </TooltipContent>
        </Tooltip>
      ))}
    </span>
  );
}

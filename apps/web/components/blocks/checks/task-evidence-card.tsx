"use client";

import { useState, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { ChevronRight } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CheckRow, isOutdated, overallStatus, StatusGlyph, summarizeChecks } from "./check-row";
import type { CheckGlyph, ProjectRoute, TaskChecks } from "./types";

/** Rows hidden until the header unfolds them: the claim held and nobody needs to look. */
const SETTLED: ReadonlySet<CheckGlyph> = new Set(["passed", "warning"]);

export type FailedCheck = { label: string; note?: string };

/**
 * Checks as a card beside other content, such as a pull request's Overview. Shows only rows
 * that need attention until its header is clicked. Spec: docs/specs/github-integration.md → PR reader.
 */
export function ChecksCard({
  data,
  title,
  projectRoute,
  onFix,
  action,
}: {
  data: TaskChecks;
  /** A function puts the pass count ("2/3") in the title instead of the subtitle. */
  title: ReactNode | ((count: string) => ReactNode);
  projectRoute?: ProjectRoute;
  /** Offered while a check failed: drafts a thread from the failed rows and their notes. */
  onFix?: (failed: FailedCheck[]) => void;
  /** Sits beside Fix, e.g. Run checks. */
  action?: ReactNode;
}) {
  const [showSettled, setShowSettled] = useState(false);
  const rows = data.checks.map((check) => ({ check, status: check.results[0]?.status ?? ("pending" as const) }));
  const statuses = rows.map((row) => row.status);
  const { passed, total, rest } = summarizeChecks(statuses);
  const count = `${passed}/${total}`;
  const settled = rows.filter((row) => SETTLED.has(row.status)).length;
  const shown = showSettled ? rows : rows.filter((row) => !SETTLED.has(row.status));
  const checklist = data.checklists.find((candidate) => candidate._id === data.checklistId)?.name;
  const outdated = data.checks.some((check) => isOutdated(data, check.results[0]));
  // Shown in the header too, since a passed row stays folded (OS-2401).
  const unpublished = data.checks.some((check) => check.results[0]?.githubPublishError);
  const failed = rows.filter((row) => row.status === "failed").map(({ check }) => ({ label: check.label, note: check.results[0]?.note }));
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="relative flex items-center gap-3 p-3 pr-10">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
          <StatusGlyph status={overallStatus(statuses)} className="size-4.5" />
        </div>
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-medium tabular-nums">{typeof title === "function" ? title(count) : title}</span>
          <span className="truncate text-xs text-muted-foreground tabular-nums">
            {[typeof title === "function" ? null : `${count} passed`, checklist, rest, outdated ? "Outdated" : null, unpublished ? "Not on GitHub" : null].filter(Boolean).join(" · ")}
          </span>
        </div>
        <div className="relative z-10 ml-auto flex shrink-0 items-center gap-1">
          {onFix && failed.length ? (
            <Button size="xs" variant="ghost" onClick={() => onFix(failed)}>
              Fix
            </Button>
          ) : null}
          {action}
        </div>
        {settled > 0 ? (
          <button
            type="button"
            onClick={() => setShowSettled(!showSettled)}
            aria-expanded={showSettled}
            aria-label={showSettled ? "Hide passed checks" : `Show ${settled} passed checks`}
            className="absolute inset-0 cursor-pointer rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <ChevronRight
              className={cn("absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground transition-transform", showSettled && "rotate-90")}
            />
          </button>
        ) : null}
      </div>
      {shown.length ? (
        <ul className="divide-y border-t">
          {shown.map(({ check }) => (
            <li key={check.key}>
              <CheckRow
                label={check.label}
                added={check.added}
                outdated={isOutdated(data, check.results[0])}
                results={check.results}
                surface="card"
                projectRoute={projectRoute}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** A Task's Checks as a card (the PR Overview's Evidence). */
export function TaskEvidenceCard({
  taskId,
  title,
  projectRoute,
  onFix,
}: {
  taskId: Id<"tasks">;
  title: ReactNode;
  projectRoute?: ProjectRoute;
  onFix?: (failed: FailedCheck[]) => void;
}) {
  const data = useQuery(api.checks.checklists.getForTask, { taskId });
  if (!data || data.checks.length === 0) return null;
  return <ChecksCard data={data} title={title} projectRoute={projectRoute} onFix={onFix} />;
}

"use client";

import { CircleHelp } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { externalRoutes } from "@/lib/navigation";
import { CheckRow, isOutdated, summarizeChecks } from "./check-row";
import { NO_CHECKS, RunChecksMenu, useSwitchChecklist } from "./run-checks-menu";
import type { ProjectRoute, TaskChecks } from "./types";
import { useThreadChecks } from "./use-thread-checks";

const passCount = (checks: TaskChecks["checks"]) => {
  const { passed, total } = summarizeChecks(checks.map((check) => check.results[0]?.status ?? "pending"));
  return `${passed}/${total}`;
};

function ChecksDocsLink() {
  return (
    <a
      href={externalRoutes.docsChecks}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="About checks"
      title="About checks"
      className="text-muted-foreground/70 transition-colors hover:text-foreground"
    >
      <CircleHelp className="size-3.5" />
    </a>
  );
}

function ChecklistSelect({ taskId, data, readOnlyReason }: { taskId: Id<"tasks">; data: TaskChecks; readOnlyReason: string | null }) {
  const onChange = useSwitchChecklist({ taskId }, data);
  const current = data.checklists.find((checklist) => checklist._id === data.checklistId);
  if (readOnlyReason) {
    return (
      <span className="text-xs text-muted-foreground" title={readOnlyReason}>
        {current?.name ?? "No checks"}
      </span>
    );
  }
  return (
    <Select value={data.checklistId ?? NO_CHECKS} onValueChange={onChange}>
      <SelectTrigger variant="badge" aria-label="Checklist">
        <SelectValue>{current?.name ?? "No checks"}</SelectValue>
      </SelectTrigger>
      <SelectContent align="end">
        <SelectItem value={NO_CHECKS}>No checks</SelectItem>
        {data.checklists.map((checklist) => (
          <SelectItem key={checklist._id} value={checklist._id}>
            {checklist.name}
            {checklist.isDefault ? <span className="text-xs text-muted-foreground">Default</span> : null}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * A task's Checks: the task sidebar's section with its Checklist selector, or the thread Checks
 * tab's (`surface="tab"`), whose Run checks menu sends to `runThreadId`. Spec: docs/specs/task-checks.md → UI.
 */
export function TaskChecksSection({
  taskId,
  threadId,
  readOnlyReason,
  projectRoute,
  surface = "task",
  runThreadId,
}: {
  taskId: Id<"tasks"> | undefined;
  /** The Checks tab's thread, whose own Checks show while it has no task. */
  threadId?: Id<"cliThreads">;
  readOnlyReason: string | null;
  projectRoute?: ProjectRoute;
  surface?: "task" | "tab";
  /** The thread owner's thread; omitted for viewers, who cannot send to it. */
  runThreadId?: Id<"cliThreads">;
}) {
  const data = useThreadChecks(threadId, taskId);
  if (!data) return null;
  const rows = data.checks.map((check) => (
    <CheckRow
      key={check.key}
      label={check.label}
      added={check.added}
      outdated={isOutdated(data, check.results[0])}
      results={check.results}
      surface={surface}
      projectRoute={projectRoute}
    />
  ));

  if (surface === "tab") {
    return (
      <section className="border-b border-border">
        {/* Same toolbar row as the Changes tab's (ThreadChangesToolbar). */}
        <div className="flex h-[41px] shrink-0 items-center gap-2 border-b border-border bg-card px-4">
          <h3 className="text-sm font-medium">Checks</h3>
          <ChecksDocsLink />
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">{data.checks.length > 0 ? passCount(data.checks) : "No checks"}</span>
          {runThreadId ? <RunChecksMenu taskId={taskId} threadId={runThreadId} data={data} readOnlyReason={readOnlyReason} /> : null}
        </div>
        {rows.length > 0 ? <div className="px-2 py-2">{rows}</div> : null}
      </section>
    );
  }

  // Nothing to pick and nothing to show: the project has no checklists.
  if (!taskId || (data.checklists.length === 0 && data.checks.length === 0)) return null;
  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-sm font-medium text-foreground">Checks</h3>
        {data.checks.length > 0 ? (
          <Badge variant="secondary" shape="rounded" className="tabular-nums">
            {passCount(data.checks)}
          </Badge>
        ) : null}
        <ChecksDocsLink />
        <span className="ml-auto">
          <ChecklistSelect taskId={taskId} data={data} readOnlyReason={readOnlyReason} />
        </span>
      </div>
      {data.checks.length > 0 ? <div className="-mx-2">{rows}</div> : <p className="text-sm text-muted-foreground">No checks</p>}
    </section>
  );
}

"use client";

import { useQuery } from "convex/react";
import { ListChecks, Plus } from "lucide-react";
import { TaskChecksSection, useThreadChecks } from "@/components/blocks/checks";
import { EmptyState } from "@/components/custom/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ResponseAttachments } from "@/components/blocks/thread/response-attachments";
import { api } from "@/convex/_generated/api";
import { useProjectPermissions } from "@/lib/authz/use-project-permissions";
import type { Id } from "@/convex/_generated/dataModel";
import { AppLink, appRoute } from "@/lib/navigation";
import { formatAbsoluteTime, formatRelativeTime } from "@/lib/format-relative-time";

/**
 * The thread's agent-attached files, one group per reply, newest first, and its Checks (its task's, or its own).
 * Null while loading; the panel then shows empty states (docs/specs/task-checks.md → Checks tab).
 * Checks load by thread id in parallel with the thread doc; `thread` is null until that doc lands.
 */
export function useThreadEvidence(threadId: Id<"cliThreads">, thread: { taskId: Id<"tasks"> | undefined } | null) {
  const files = useQuery(api.cli.messages.listAgentAttachmentsByThread, { threadId });
  const taskChecks = useThreadChecks(threadId, undefined);
  // Wait for the thread too: Run checks switches the Checklist of whichever side owns the Checks.
  if (!files || !thread || taskChecks === undefined) return null;
  const checks = taskChecks?.checks ?? [];
  const evidenceIds = new Set<string>(checks.flatMap((check) => check.results.flatMap((result) => result.files.map((file) => file.storageId))));
  // Files that answer a Check show in its row instead.
  const groups = files.flatMap((group) => {
    const attachments = group.attachments.filter((attachment) => !evidenceIds.has(attachment.storageId));
    return attachments.length > 0 ? [{ ...group, attachments }] : [];
  });
  return { taskId: thread.taskId, hasChecks: checks.length > 0, hasChecklists: (taskChecks?.checklists.length ?? 0) > 0, groups };
}

/** Thread sidebar Checks tab: the Checks, then files attached without a check. `isOwner` enables Run checks. */
export function EvidencePanel({
  threadId,
  thread,
  isOwner = false,
  projectRoute,
  projectId,
}: {
  threadId: Id<"cliThreads">;
  /** Null until the thread doc lands. */
  thread: { taskId: Id<"tasks"> | undefined; taskArchived?: boolean } | null;
  isOwner?: boolean;
  projectRoute: { organizationSlug: string; projectAlias: string };
  projectId?: Id<"projects">;
}) {
  const evidence = useThreadEvidence(threadId, thread);
  const permissions = useProjectPermissions(projectId ?? null);
  if (!evidence) {
    return (
      <div className="flex w-full flex-col gap-3 px-4 py-3">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }
  const { taskId, groups } = evidence;
  // Same gate as the task sidebar's Checklist selector.
  const readOnlyReason = thread?.taskArchived ? "Archived tasks are read-only" : permissions.readOnlyReason;
  return (
    <section className="h-full min-h-0 overflow-y-auto">
      <div className="w-full">
        {evidence.hasChecks || evidence.hasChecklists ? (
          <TaskChecksSection
            taskId={taskId}
            threadId={threadId}
            readOnlyReason={readOnlyReason}
            projectRoute={projectRoute}
            surface="tab"
            runThreadId={isOwner ? threadId : undefined}
          />
        ) : (
          <EmptyState
            className="border-b border-border"
            icon={ListChecks}
            title="No checks yet"
            description={
              isOwner && !permissions.canEditProject
                ? "Checks list what an agent must prove before its work is done. Ask a project admin to add them."
                : "Checks list what an agent must prove before its work is done."
            }
            action={
              isOwner && permissions.canEditProject ? (
                <Button variant="secondary" asChild>
                  <AppLink href={appRoute.projectSettings(projectRoute.organizationSlug, projectRoute.projectAlias, "checks")}>
                    <Plus className="size-4" />
                    Add checks
                  </AppLink>
                </Button>
              ) : null
            }
          />
        )}
        <div className="px-4 py-3">
          <h3 className="mb-3 text-sm font-medium">{evidence.hasChecks ? "Other files" : "Files"}</h3>
          {groups.length > 0 ? (
            <ol className="flex flex-col gap-4">
              {groups.map((group) => {
                const at = Math.max(...group.attachments.map((attachment) => attachment.uploadedAt));
                return (
                  <li key={group.messageId} className="flex flex-col gap-2">
                    <time dateTime={new Date(at).toISOString()} title={formatAbsoluteTime(at)} className="text-xs text-muted-foreground">
                      {formatRelativeTime(at)}
                    </time>
                    <ResponseAttachments messageId={group.messageId} attachments={group.attachments} />
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">No files attached yet</p>
          )}
        </div>
      </div>
    </section>
  );
}

"use client";

import { ResponseAttachments, type ThreadMessageAttachment } from "@/components/blocks/thread/response-attachments";
import type { Id } from "@/convex/_generated/dataModel";
import { CheckRow, overallStatus, StatusGlyph, summarizeChecks } from "./check-row";
import { useThreadChecks } from "./use-thread-checks";

/**
 * An agent reply's files, with a checks card for the results this run reported. Check evidence
 * moves into the card; other files render below it. Spec: docs/specs/task-checks.md → Transcript.
 */
export function ReplyChecks({
  threadId,
  taskId,
  messageId,
  attachments,
}: {
  threadId: Id<"cliThreads"> | undefined;
  taskId: Id<"tasks"> | undefined;
  messageId: string;
  attachments: ThreadMessageAttachment[] | undefined;
}) {
  const data = useThreadChecks(threadId, taskId);
  // The checklist's Checks with this run's answer or "Not reported", then the ones it added.
  const rows = (data?.checks ?? []).flatMap((check) => {
    const result = check.results.find((candidate) => candidate.messageId === messageId);
    return result || !check.added ? [{ check, result }] : [];
  });
  const reported = rows.flatMap(({ result }) => (result ? [result] : []));
  const evidenceIds = new Set<string>(reported.flatMap((result) => result.files.map((file) => file.storageId)));
  const otherFiles = (attachments ?? []).filter((attachment) => !evidenceIds.has(attachment.storageId));

  const filesBlock = otherFiles.length > 0 ? <ResponseAttachments messageId={messageId} attachments={otherFiles} /> : null;
  if (!data || reported.length === 0) return filesBlock;

  const statuses = rows.map(({ result }) => result?.status ?? "pending");
  const { passed, total, rest } = summarizeChecks(statuses);
  const checklist = data.checklists.find((candidate) => candidate._id === data.checklistId)?.name;
  return (
    <>
      <div className="overflow-hidden rounded-lg border">
        <div className="flex items-center gap-3 p-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
            <StatusGlyph status={overallStatus(statuses)} className="size-4.5" />
          </div>
          <div className="flex min-w-0 flex-col">
            <span className="text-sm font-medium tabular-nums">
              {passed}/{total} checks passed
            </span>
            <span className="truncate text-xs text-muted-foreground">{[checklist, rest].filter(Boolean).join(" · ")}</span>
          </div>
        </div>
        <ul className="divide-y border-t">
          {rows.map(({ check, result }) => (
            <li key={check.key}>
              <CheckRow label={check.label} added={check.added} results={result ? [result] : []} surface="transcript" />
            </li>
          ))}
        </ul>
      </div>
      {filesBlock}
    </>
  );
}

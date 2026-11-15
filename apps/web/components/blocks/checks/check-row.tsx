"use client";

import { useState } from "react";
import { useConvex } from "convex/react";
import { ChevronRight, Circle, CircleCheck, CircleMinus, CircleX, TriangleAlert } from "lucide-react";
import { ResponseAttachments } from "@/components/blocks/thread/response-attachments";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { api } from "@/convex/_generated/api";
import { formatAbsoluteTime, formatRelativeTime } from "@/lib/format-relative-time";
import { AppLink, appRoute, useRouteParams } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import type { CheckGlyph, CheckResult, ProjectRoute } from "./types";

const GLYPHS: Record<CheckGlyph, { icon: typeof Circle; className: string; word: string }> = {
  passed: { icon: CircleCheck, className: "text-success", word: "Passed" },
  warning: { icon: TriangleAlert, className: "text-warning", word: "Warning" },
  failed: { icon: CircleX, className: "text-destructive", word: "Failed" },
  not_performed: { icon: CircleMinus, className: "text-muted-foreground", word: "Not performed" },
  pending: { icon: Circle, className: "text-muted-foreground/50", word: "Pending" },
};

export function StatusGlyph({ status, className }: { status: CheckGlyph; className?: string }) {
  const { icon: Icon, className: tone, word } = GLYPHS[status];
  return <Icon aria-label={word} className={cn("size-4 shrink-0", tone, className)} />;
}

/** Pass count and the "1 failed · 1 pending" tail. A warning's claim held, so it counts as passed. */
export function summarizeChecks(statuses: CheckGlyph[]) {
  const count = (status: CheckGlyph) => statuses.filter((value) => value === status).length;
  const rest = (["failed", "warning", "not_performed", "pending"] as const)
    .filter((status) => count(status) > 0)
    .map((status) => `${count(status)} ${GLYPHS[status].word.toLowerCase()}`);
  return { passed: count("passed") + count("warning"), total: statuses.length, rest: rest.join(" · ") };
}

/** A card or section's glyph: a failure wins, then a warning, then all passed; otherwise pending. */
export function overallStatus(statuses: CheckGlyph[]): CheckGlyph {
  if (statuses.includes("failed")) return "failed";
  if (statuses.includes("warning")) return "warning";
  return statuses.length > 0 && statuses.every((status) => status === "passed") ? "passed" : "pending";
}

const isMedia = (file: CheckResult["files"][number]) => file.contentType.startsWith("image/") || file.contentType.startsWith("video/");

/** `transcript` is one reply's own results, so it skips time, provenance, and history. */
type Surface = "tab" | "task" | "transcript";

function ResultTime({ at }: { at: number }) {
  return (
    <time dateTime={new Date(at).toISOString()} title={formatAbsoluteTime(at)}>
      {formatRelativeTime(at)}
    </time>
  );
}

/** A result's files, signed through its task rather than its thread. */
function ResultFiles({ result }: { result: CheckResult }) {
  const convex = useConvex();
  return (
    <ResponseAttachments
      messageId={result._id}
      attachments={result.files}
      loadUrls={() => convex.query(api.checks.results.getFileUrls, { resultId: result._id })}
    />
  );
}

/** Threads are private: only their owner gets a link (docs/specs/task-checks.md → Visibility). */
function Provenance({ result, projectRoute }: { result: CheckResult; projectRoute?: ProjectRoute }) {
  // Linking to the open thread would only reload it and drop the sidebar's URL state.
  const viewingThreadId = useRouteParams<{ threadId?: string }>()?.threadId;
  if (result.threadId === viewingThreadId) return <>Reported in this thread</>;
  if (!result.reportedByViewer) {
    return (
      <>
        Reported by {result.reporterName} in <span className="text-foreground">{result.threadTitle}</span>
      </>
    );
  }
  return (
    <>
      Reported in{" "}
      {projectRoute ? (
        <AppLink
          href={appRoute.projectThreadDetail(projectRoute.organizationSlug, projectRoute.projectAlias, result.threadId)}
          className="text-foreground underline-offset-2 hover:underline"
        >
          {result.threadTitle}
        </AppLink>
      ) : (
        <span className="text-foreground">{result.threadTitle}</span>
      )}
    </>
  );
}

/** One Check: status, label, and an expandable justification, evidence, and history. Rows with images or video start open. */
export function CheckRow({
  label,
  added,
  results,
  surface,
  projectRoute,
}: {
  label: string;
  added: boolean;
  /** Newest first; the first is shown, the rest are history. */
  results: CheckResult[];
  surface: Surface;
  projectRoute?: ProjectRoute;
}) {
  const [latest, ...history] = results;
  // Follows the current result until the user toggles, so a live image result opens too.
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = toggled ?? Boolean(latest?.files.some(isMedia));
  const status: CheckGlyph = latest?.status ?? "pending";
  const table = surface === "transcript";

  return (
    <Collapsible open={open && Boolean(latest)} onOpenChange={setToggled} disabled={!latest} className="text-sm">
      <CollapsibleTrigger
        className={cn(
          "group/check-row flex w-full items-center gap-2 text-left enabled:cursor-pointer",
          table ? "px-3 py-2 enabled:hover:bg-muted/50" : "rounded-md px-2 enabled:hover:bg-muted/60",
          surface === "tab" && "py-1.5",
          surface === "task" && "py-1"
        )}
      >
        <StatusGlyph status={status} />
        <span className={cn("min-w-0 flex-1 truncate", !latest && "text-muted-foreground")}>{label}</span>
        {added ? (
          <Badge variant="outline" shape="rounded" className="text-muted-foreground">
            Added
          </Badge>
        ) : null}
        {surface === "tab" ? (
          <span className="shrink-0 text-xs text-muted-foreground">{latest ? <ResultTime at={latest.reportedAt} /> : "Pending"}</span>
        ) : null}
        {table && !latest ? <span className="shrink-0 text-xs text-muted-foreground">Not reported</span> : null}
        {latest ? (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/check-row:rotate-90" />
        ) : (
          <span className="size-3.5 shrink-0" />
        )}
      </CollapsibleTrigger>
      {latest ? (
        <CollapsibleContent className={cn("flex flex-col gap-2 pb-3", table ? "px-3 pt-0.5 pl-9" : "pt-1 pr-2 pl-8")}>
          {latest.note ? (
            <p className="text-xs whitespace-pre-wrap text-muted-foreground">
              {latest.status === "passed" ? null : <span className="font-medium text-foreground">{GLYPHS[latest.status].word}: </span>}
              {latest.note}
            </p>
          ) : null}
          <ResultFiles result={latest} />
          {table ? null : (
            <p className="text-xs text-muted-foreground">
              <Provenance result={latest} projectRoute={projectRoute} />
              {surface === "task" ? (
                <>
                  {" · "}
                  <ResultTime at={latest.reportedAt} />
                </>
              ) : null}
            </p>
          )}
          {!table && history.length > 0 ? (
            <div className="mt-1 flex flex-col gap-1 border-t border-border pt-2">
              <span className="text-xs font-medium text-muted-foreground">Earlier</span>
              {history.map((result) => (
                <div key={result._id} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <StatusGlyph status={result.status} className="mt-px size-3.5" />
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <span>
                      <ResultTime at={result.reportedAt} /> · {result.threadTitle}
                      {result.note ? ` — ${result.note}` : ""}
                    </span>
                    <ResultFiles result={result} />
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </CollapsibleContent>
      ) : null}
    </Collapsible>
  );
}

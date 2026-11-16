"use client";

import { useEffect, useRef, useState } from "react";
import { useConvex } from "convex/react";
import { ChevronDown, ChevronRight, Circle, CircleCheck, CircleMinus, CircleX, Copy, FileText, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { ResponseAttachments } from "@/components/blocks/thread/response-attachments";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Pill, PillContent, PillIcon, PillText } from "@/components/ui/pill";
import { api } from "@/convex/_generated/api";
import { formatAbsoluteTime, formatRelativeTime } from "@/lib/format-relative-time";
import { AppLink, appRoute, useRouteParams } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import type { CheckGlyph, CheckResult, ProjectRoute, TaskChecks } from "./types";

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

/** A pull request's result reported on an older head than the PR's current one. */
export function isOutdated(data: Pick<TaskChecks, "pullRequest">, result: CheckResult | undefined): boolean {
  const head = data.pullRequest?.headSha;
  return Boolean(head && result?.headSha && result.headSha !== head);
}

const isMedia = (file: CheckResult["files"][number]) => file.contentType.startsWith("image/") || file.contentType.startsWith("video/");

/**
 * `transcript` is one reply's own results, so it skips time, provenance, and history. `card` is a framed
 * card's rows (the PR page): the transcript's layout, with provenance and history.
 */
type Surface = "tab" | "task" | "transcript" | "card";

/** `inSentence` lowercases the first letter, for "Reported just now". */
function ResultTime({ at, inSentence }: { at: number; inSentence?: boolean }) {
  const text = formatRelativeTime(at);
  return (
    <time dateTime={new Date(at).toISOString()} title={formatAbsoluteTime(at)}>
      {inSentence ? text.charAt(0).toLowerCase() + text.slice(1) : text}
    </time>
  );
}

/** A result's files, signed through its task rather than its thread. Inline pages show as cards; the reply shows the page. */
function ResultFiles({ result }: { result: CheckResult }) {
  const convex = useConvex();
  return (
    <ResponseAttachments
      messageId={result._id}
      attachments={result.files.map((file) => ({ ...file, display: undefined }))}
      loadUrls={() => convex.query(api.checks.results.getFileUrls, { resultId: result._id })}
    />
  );
}

/** The result's artifact as a pill to its page, with Copy ID like the task's own pills. Outside a project route it is plain text. */
function ArtifactPill({ result, projectRoute, className }: { result: CheckResult; projectRoute?: ProjectRoute; className?: string }) {
  const params = useRouteParams<{ organizationSlug?: string; projectAlias?: string }>();
  const organizationSlug = projectRoute?.organizationSlug ?? params?.organizationSlug;
  const projectAlias = projectRoute?.projectAlias ?? params?.projectAlias;
  const { artifactId } = result;
  if (!artifactId) return null;
  const name = result.artifactName ?? "Artifact";
  const body = (
    <>
      <PillIcon>
        <FileText className="size-3.5 text-muted-foreground" />
      </PillIcon>
      <PillText title={name}>{name}</PillText>
    </>
  );
  if (!organizationSlug || !projectAlias) {
    return (
      <Pill size="compact" className={className}>
        <PillContent>{body}</PillContent>
      </Pill>
    );
  }
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Pill size="compact" className={className}>
          <PillContent asChild>
            <AppLink href={appRoute.projectArtifact(organizationSlug, projectAlias, artifactId)}>{body}</AppLink>
          </PillContent>
        </Pill>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem
          onClick={() => {
            void navigator.clipboard.writeText(artifactId);
            toast.success("Artifact ID copied to clipboard");
          }}
        >
          <Copy className="mr-2 h-4 w-4" />
          Copy ID
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * "14m ago" in the thread being viewed, else "14m ago in “Thread”"; a teammate's adds "by Name".
 * Threads are private: only their owner gets a link (docs/specs/task-checks.md → Visibility).
 */
function Reported({ result, projectRoute, inSentence }: { result: CheckResult; projectRoute?: ProjectRoute; inSentence?: boolean }) {
  // Linking to the open thread would only reload it and drop the sidebar's URL state.
  const viewingThreadId = useRouteParams<{ threadId?: string }>()?.threadId;
  if (result.threadId === viewingThreadId) return <ResultTime at={result.reportedAt} inSentence={inSentence} />;
  const title =
    result.reportedByViewer && projectRoute ? (
      <AppLink
        href={appRoute.projectThreadDetail(projectRoute.organizationSlug, projectRoute.projectAlias, result.threadId)}
        className="underline-offset-2 hover:underline"
      >
        {result.threadTitle}
      </AppLink>
    ) : (
      result.threadTitle
    );
  return (
    <>
      <ResultTime at={result.reportedAt} inSentence={inSentence} />
      {result.reportedByViewer ? null : ` by ${result.reporterName}`} in “{title}”
    </>
  );
}

/** One section of the open row's card: a small muted label over its content. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs text-muted-foreground">{title}</span>
      {children}
    </div>
  );
}

/**
 * One Check: a one-line header (status, label, value), and a card with the full value, note, attachments,
 * when it was reported, and older results. Rows with images or video start open. Spec: docs/specs/task-checks.md → UI.
 */
export function CheckRow({
  label,
  added,
  outdated = false,
  results,
  surface,
  projectRoute,
}: {
  label: string;
  added: boolean;
  /** The current result is a pull request's from an older head (OS-2400). */
  outdated?: boolean;
  /** Newest first; the first is shown, the rest are history. */
  results: CheckResult[];
  surface: Surface;
  projectRoute?: ProjectRoute;
}) {
  const [latest, ...history] = results;
  // Follows the current result until the user toggles, so a live image result opens too.
  const [toggled, setToggled] = useState<boolean | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const open = toggled ?? Boolean(latest?.files.some(isMedia));
  const status: CheckGlyph = latest?.status ?? "pending";
  const table = surface === "transcript";
  // Full-width rows inset like the card header, with the open parts stacked under the label.
  const framed = table || surface === "card";
  // The header value is one line; the card repeats it only if the header cut it off.
  const valueRef = useRef<HTMLSpanElement>(null);
  const [valueClipped, setValueClipped] = useState(false);
  useEffect(() => {
    const node = valueRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setValueClipped(node.scrollWidth > node.clientWidth));
    observer.observe(node);
    return () => observer.disconnect();
  }, [latest?.value]);
  const hasAttachments = Boolean(latest && (latest.files.length > 0 || latest.artifactId));
  // The transcript card is one reply's own results, so it has no Reported or history.
  const hasCard = Boolean(latest && (!table || valueClipped || latest.note || hasAttachments));

  return (
    <Collapsible open={open && Boolean(latest)} onOpenChange={setToggled} disabled={!latest} className="text-sm">
      <CollapsibleTrigger
        className={cn(
          "group/check-row flex w-full min-w-0 items-center gap-2 text-left enabled:cursor-pointer",
          framed ? "px-3 py-2 enabled:hover:bg-muted/50" : "rounded-md px-2 enabled:hover:bg-muted/60",
          surface === "tab" && "py-1.5",
          surface === "task" && "py-1"
        )}
      >
        <StatusGlyph status={status} />
        <span className={cn("min-w-0 flex-1 truncate", !latest && "text-muted-foreground")}>{label}</span>
        {latest?.value ? (
          // Label and value grow from a zero basis, so the value gets at most half of the free space.
          <span ref={valueRef} title={latest.value} className="max-w-fit min-w-0 flex-1 truncate text-xs text-muted-foreground tabular-nums">
            {latest.value}
          </span>
        ) : null}
        {added ? (
          <Badge variant="outline" shape="rounded" className="text-muted-foreground">
            Added
          </Badge>
        ) : null}
        {outdated ? (
          <Badge variant="outline" shape="rounded" className="text-warning" title="Reported on an older commit">
            Outdated
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
      {latest && hasCard ? (
        <CollapsibleContent>
          {/* A framed card is already a table, so there the parts stack plainly under the label. */}
          <div
            className={cn(
              framed ? "flex flex-col gap-3 pr-3 pb-3 pl-9" : "mt-1 mb-3 divide-y divide-border/70 rounded-md bg-muted/50 *:px-3.5 *:py-2.5"
            )}
          >
            {valueClipped ? (
              <Section title="Value">
                <p className="break-words whitespace-pre-wrap">{latest.value}</p>
              </Section>
            ) : null}
            {latest.note ? (
              <Section title="Description">
                <p className="whitespace-pre-wrap">{latest.note}</p>
              </Section>
            ) : null}
            {hasAttachments ? (
              <Section title="Attachments">
                <div className="mt-0.5 flex flex-col items-start gap-2">
                  <ArtifactPill result={latest} projectRoute={projectRoute} className="max-w-full" />
                  <ResultFiles result={latest} />
                </div>
              </Section>
            ) : null}
            {!table && showHistory && history.length > 0 ? (
              <Section title={history.length === 1 ? "Older result" : "Older results"}>
                <ol className="flex flex-col gap-2.5">
                  {history.map((result) => (
                    <li key={result._id} className="flex items-start gap-2">
                      <StatusGlyph status={result.status} className="mt-0.5" />
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <p className="break-words whitespace-pre-wrap">
                          <span className="tabular-nums">{result.value ?? GLYPHS[result.status].word}</span>
                          {result.note ? ` · ${result.note}` : null}
                        </p>
                        <span title={result.threadTitle} className="truncate text-muted-foreground">
                          <Reported result={result} projectRoute={projectRoute} />
                        </span>
                        <ResultFiles result={result} />
                        <ArtifactPill result={result} projectRoute={projectRoute} className="max-w-full self-start" />
                      </div>
                    </li>
                  ))}
                </ol>
              </Section>
            ) : null}
            {table ? null : (
              // A footer, not a section: who and when, with the older-results toggle.
              <footer className={cn("flex items-center gap-3 text-xs text-muted-foreground", !framed && "py-2!")}>
                <span className="min-w-0 flex-1 truncate" title={latest.threadTitle}>
                  Reported <Reported result={latest} projectRoute={projectRoute} inSentence />
                </span>
                {history.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setShowHistory((value) => !value)}
                    aria-expanded={showHistory}
                    className="inline-flex shrink-0 cursor-pointer items-center gap-1 hover:text-foreground"
                  >
                    {history.length} older {history.length === 1 ? "result" : "results"}
                    <ChevronDown className={cn("size-3 transition-transform", showHistory && "rotate-180")} />
                  </button>
                ) : null}
              </footer>
            )}
          </div>
        </CollapsibleContent>
      ) : null}
    </Collapsible>
  );
}

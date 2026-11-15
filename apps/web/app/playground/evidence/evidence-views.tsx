"use client";

import { useState } from "react";
import { Check as CheckIcon, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Circle, CircleCheck, CircleMinus, CircleX, FileText, ListChecks, Play, TriangleAlert } from "lucide-react";
import { ThreadAttachmentCard } from "@/components/blocks/thread/thread-attachment-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getFileIcon } from "@/lib/tasks/files";
import { cn } from "@/lib/utils";
import { CHECKLISTS, ME, threadOwner, type Check, type CheckStatus, type EvidenceFile, type EvidenceState, type FileGroup } from "./fixtures";

type Glyph = CheckStatus | "pending";

const NO_CHECKLIST = "none";

const GLYPHS: Record<Glyph, { icon: typeof Circle; className: string; word: string }> = {
  passed: { icon: CircleCheck, className: "text-green-600 dark:text-green-500", word: "Passed" },
  warning: { icon: TriangleAlert, className: "text-amber-600 dark:text-amber-500", word: "Warning" },
  failed: { icon: CircleX, className: "text-destructive", word: "Failed" },
  not_performed: { icon: CircleMinus, className: "text-muted-foreground", word: "Not performed" },
  pending: { icon: Circle, className: "text-muted-foreground/50", word: "Pending" },
};

export function StatusGlyph({ status, className }: { status: Glyph; className?: string }) {
  const { icon: Icon, className: tone, word } = GLYPHS[status];
  return <Icon aria-label={word} className={cn("size-4 shrink-0", tone, className)} />;
}

const isMedia = (file: EvidenceFile) => file.contentType.startsWith("image/") || file.contentType.startsWith("video/");

/** Images and videos as a thumbnail strip, everything else as the real attachment card. */
export function EvidenceFiles({ files, onOpen, size = "md" }: { files: EvidenceFile[]; onOpen: (file: EvidenceFile) => void; size?: "sm" | "md" }) {
  const media = files.filter(isMedia);
  const other = files.filter((file) => !isMedia(file));
  if (files.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {media.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {media.map((file) => (
            <button
              key={file.id}
              type="button"
              title={file.fileName}
              onClick={() => onOpen(file)}
              className={cn(
                "relative aspect-video cursor-pointer overflow-hidden rounded-md bg-gradient-to-br ring-1 ring-border transition-opacity hover:opacity-90",
                size === "sm" ? "h-14" : "h-20",
                file.tint
              )}
            >
              {file.contentType.startsWith("video/") ? (
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="flex size-6 items-center justify-center rounded-full bg-background/80">
                    <Play className="size-3 fill-current" />
                  </span>
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
      {other.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {other.map((file) => (
            <ThreadAttachmentCard key={file.id} fileName={file.fileName} fileSize={file.fileSize} icon={getFileIcon(file.contentType)} onClick={() => onOpen(file)} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Where a row sits. `transcript` is one reply's own results, so it skips time and provenance. */
type Surface = "tab" | "task" | "transcript" | "pullRequest";

/** One check: a table row in the transcript, a plain list row in the sidebars. Rows with images or video start open. */
function CheckRow({ check, viewer, onOpen, surface }: { check: Check; viewer: string; onOpen: (file: EvidenceFile) => void; surface: Surface }) {
  const [latest, ...history] = check.results;
  // The PR page stacks several cards, so its rows stay closed.
  const [open, setOpen] = useState(() => surface !== "pullRequest" && Boolean(latest?.files.some(isMedia)));
  const status: Glyph = latest?.status ?? "pending";
  const table = surface === "transcript" || surface === "pullRequest";
  const showHistory = surface !== "transcript" && history.length > 0;
  const Row = table ? "li" : "div";
  return (
    <Row className="text-sm">
      <Collapsible open={open} onOpenChange={setOpen} disabled={!latest}>
        <CollapsibleTrigger
          className={cn(
            "group/check-row flex w-full items-center gap-2 text-left enabled:cursor-pointer",
            table ? "px-3 py-2 enabled:hover:bg-muted/50" : "rounded-md px-2 enabled:hover:bg-muted/60",
            surface === "tab" && "py-1.5",
            surface === "task" && "py-1"
          )}
        >
          <StatusGlyph status={status} />
          <span className={cn("min-w-0 flex-1 truncate", !latest && "text-muted-foreground")}>{check.label}</span>
          {check.source === "added" ? (
            <Badge variant="outline" shape="rounded" className="text-muted-foreground">
              Added
            </Badge>
          ) : null}
          {surface === "tab" || surface === "pullRequest" ? <span className="shrink-0 text-xs text-muted-foreground">{latest ? latest.at : "Pending"}</span> : null}
          {surface === "transcript" && !latest ? <span className="shrink-0 text-xs text-muted-foreground">Not reported</span> : null}
          {latest ? (
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/check-row:rotate-90" />
          ) : (
            <span className="size-3.5 shrink-0" />
          )}
        </CollapsibleTrigger>
        {latest ? (
          <CollapsibleContent className={cn("flex flex-col gap-2 pb-3", table ? "px-3 pt-0.5 pl-9" : "pt-1 pr-2 pl-8")}>
            {latest.note ? (
              <p className="text-xs text-muted-foreground">
                {latest.status === "not_performed" || latest.status === "warning" ? <span className="font-medium text-foreground">{GLYPHS[latest.status].word}: </span> : null}
                {latest.note}
              </p>
            ) : null}
            <EvidenceFiles files={latest.files} onOpen={onOpen} size={surface === "task" ? "sm" : "md"} />
            {latest.artifact ? (
              <button type="button" className="flex w-fit cursor-pointer items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">
                <FileText className="size-3.5 text-muted-foreground" /> {latest.artifact}
              </button>
            ) : null}
            {surface === "transcript" ? null : (
              <p className="text-xs text-muted-foreground">
                {threadOwner(latest.thread) === viewer ? (
                  <>
                    Reported in{" "}
                    <button type="button" className="cursor-pointer text-foreground underline-offset-2 hover:underline">
                      {latest.thread}
                    </button>
                  </>
                ) : (
                  <>
                    Reported by {threadOwner(latest.thread)} in <span className="text-foreground">{latest.thread}</span>
                  </>
                )}{" "}
                · Run {latest.run}
                {surface === "task" ? ` · ${latest.at}` : ""}
              </p>
            )}
            {showHistory ? (
              <div className="mt-1 flex flex-col gap-1 border-t border-border pt-2">
                <span className="text-xs font-medium text-muted-foreground">Earlier</span>
                {history.map((result) => (
                  <div key={`${result.thread}-${result.run}`} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <StatusGlyph status={result.status} className="mt-px size-3.5" />
                    <span>
                      {result.at} · {result.thread} · Run {result.run}
                      {result.note ? ` — ${result.note}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </CollapsibleContent>
        ) : null}
      </Collapsible>
    </Row>
  );
}

function summarize(checks: Check[]) {
  const count = (status: CheckStatus) => checks.filter((check) => check.results[0]?.status === status).length;
  const pending = checks.filter((check) => check.results.length === 0).length;
  const rest = [
    count("failed") ? `${count("failed")} failed` : null,
    count("warning") ? `${count("warning")} warning` : null,
    count("not_performed") ? `${count("not_performed")} not performed` : null,
    pending ? `${pending} pending` : null,
  ].filter(Boolean);
  // A warning's claim held, so it counts as passed.
  return { passed: count("passed") + count("warning"), total: checks.length, rest: rest.join(" · ") };
}

/** A card's state on the PR page: a failure wins, then a warning, then anything not yet passed. */
const cardStatus = (checks: Check[]): Glyph => {
  const statuses = checks.map((check) => check.results[0]?.status);
  if (statuses.includes("failed")) return "failed";
  if (statuses.includes("warning")) return "warning";
  return statuses.every((status) => status === "passed") ? "passed" : "pending";
};

/** One reply's results as a card table in the transcript, shaped like the run's Changes card. The PR page shows a Task's. */
export function ChecksCard({
  checks,
  checklist,
  onOpen,
  summary,
  title,
  action,
}: {
  checks: Check[];
  checklist: string | null;
  onOpen: (file: EvidenceFile) => void;
  /** Set on the PR page ("OS-1 task checks"): replaces the checklist line, and rows gain time and provenance. */
  summary?: React.ReactNode;
  /** The PR page's card name; the pass count moves to the right. */
  title?: string;
  /** A header button left of the chevron, e.g. the PR page's Fix. */
  action?: React.ReactNode;
}) {
  const { passed, total, rest } = summarize(checks);
  const [showPassed, setShowPassed] = useState(false);
  // The PR page shows only what needs attention until asked for the rest.
  const unpassed = checks.filter((check) => check.results[0]?.status !== "passed");
  const rows = summary && !showPassed ? unpassed : checks;
  return (
    <div className="overflow-hidden rounded-lg border bg-background">
      <div className="relative flex items-center gap-3 p-3 pr-10">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
          {title ? <StatusGlyph status={cardStatus(checks)} className="size-4.5" /> : <ListChecks className="size-4.5" />}
        </div>
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-medium tabular-nums">{title ? `${title}: ${passed}/${total}` : `${passed}/${total} checks passed`}</span>
          <span className="truncate text-xs text-muted-foreground">{summary ?? [checklist, rest].filter(Boolean).join(" · ")}</span>
        </div>
        {action ? <div className="relative z-10 ml-auto">{action}</div> : null}
        {summary ? <ExpandToggle count={checks.length - unpassed.length} shown={showPassed} onToggle={() => setShowPassed(!showPassed)} /> : null}
      </div>
      {rows.length ? (
        <ul className="divide-y border-t">
          {rows.map((check) => (
            <CheckRow key={check.key} check={check} viewer={ME} onOpen={onOpen} surface={summary ? "pullRequest" : "transcript"} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Makes a `relative` card header one expand/collapse button for its hidden rows; the chevron shows the state. */
export function ExpandToggle({ count, what = "passed", shown, onToggle }: { count: number; what?: string; shown: boolean; onToggle: () => void }) {
  if (!count) return null;
  const label = shown ? `Hide ${what}` : `Show ${count} ${what}`;
  return (
    <button type="button" aria-label={label} aria-expanded={shown} title={label} onClick={onToggle} className="absolute inset-0 flex cursor-pointer items-center justify-end pr-4 text-muted-foreground hover:bg-muted/30">
      {shown ? <ChevronsDownUp className="size-4" /> : <ChevronsUpDown className="size-4" />}
    </button>
  );
}

/** Asks the agent to perform checks, or switches the checklist (done checks stay; see `applyChecklist`). */
export function RunChecksButton({
  checklist,
  hasChecks,
  onRun,
  onPickChecklist,
}: {
  checklist: string | null;
  hasChecks: boolean;
  onRun: (what: string) => void;
  onPickChecklist: (name: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="xs" variant="outline" className="cursor-pointer">
          <ListChecks /> Run checks <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {hasChecks ? (
          <>
            <DropdownMenuItem onClick={() => onRun("pending and failed checks")}>Pending and failed</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onRun("all checks")}>All checks</DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuLabel className="text-xs text-muted-foreground">Switch checklist</DropdownMenuLabel>
        {CHECKLISTS.map((list) => (
          <DropdownMenuItem key={list.name} onClick={() => onPickChecklist(list.name)}>
            <span className="flex-1">{list.name}</span>
            {list.name === checklist ? <CheckIcon className="size-3.5" /> : <span className="text-xs text-muted-foreground">{list.keys.length}</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FilesTimeline({ groups, onOpen }: { groups: FileGroup[]; onOpen: (file: EvidenceFile) => void }) {
  return (
    <ol className="flex flex-col gap-4">
      {groups.map((group) => (
        <li key={`${group.thread}-${group.run}`} className="flex flex-col gap-2">
          <span className="text-xs text-muted-foreground">{group.at}</span>
          <EvidenceFiles files={group.files} onOpen={onOpen} />
        </li>
      ))}
    </ol>
  );
}

/** Thread sidebar Evidence tab: the owner's checks first, then files attached with no check. */
export function EvidenceTab({ state, viewer, onOpen, runChecks, banner }: { state: EvidenceState; viewer: string; onOpen: (file: EvidenceFile) => void; runChecks: React.ReactNode; banner?: string | null }) {
  return (
    <div className="flex flex-col">
      {banner ? <div className="border-b border-border bg-muted/50 px-4 py-2 text-xs">{banner}</div> : null}
      {state.checks.length > 0 ? (
        <section className="border-b border-border px-2 pt-3 pb-2">
          <div className="mb-1 flex items-center gap-2 px-2">
            <h3 className="text-sm font-medium">Checks</h3>
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">
              {summarize(state.checks).passed}/{state.checks.length}
            </span>
            {runChecks}
          </div>
          {state.checks.map((check) => (
            <CheckRow key={check.key} check={check} viewer={viewer} onOpen={onOpen} surface="tab" />
          ))}
        </section>
      ) : null}
      {state.files.length > 0 ? (
        <section className="px-4 py-3">
          <div className="mb-3 flex items-center gap-2">
            <h3 className="text-sm font-medium">{state.checks.length > 0 ? "Other files" : "Files"}</h3>
            {state.checks.length === 0 ? <span className="ml-auto">{runChecks}</span> : null}
          </div>
          <FilesTimeline groups={state.files} onOpen={onOpen} />
        </section>
      ) : null}
    </div>
  );
}

/** Task sidebar Checks: which checklist applies (task type default, switchable) and the rows. Runs start from the thread. */
export function TaskChecksSection({
  state,
  viewer,
  defaultChecklist,
  onChecklistChange,
  onOpen,
}: {
  state: EvidenceState;
  viewer: string;
  defaultChecklist: string;
  onChecklistChange: (name: string | null) => void;
  onOpen: (file: EvidenceFile) => void;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          Checks
          {state.checks.length > 0 ? (
            <Badge variant="secondary" shape="rounded" className="tabular-nums">
              {summarize(state.checks).passed}/{state.checks.length}
            </Badge>
          ) : null}
        </h3>
        <span className="ml-auto">
          <Select value={state.checklist ?? NO_CHECKLIST} onValueChange={(value) => onChecklistChange(value === NO_CHECKLIST ? null : value)}>
            <SelectTrigger variant="badge" aria-label="Checklist">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value={NO_CHECKLIST}>No checks</SelectItem>
              {CHECKLISTS.map((list) => (
                <SelectItem key={list.name} value={list.name}>
                  {list.name}
                  {list.name === defaultChecklist ? <span className="text-xs text-muted-foreground">Default</span> : null}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </span>
      </div>
      {state.checks.length > 0 ? (
        <div className="-mx-2">
          {state.checks.map((check) => (
            <CheckRow key={check.key} check={check} viewer={viewer} onOpen={onOpen} surface="task" />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No checks</p>
      )}
    </section>
  );
}

/** Stand-in for the lightbox the real tab reuses. */
export function PreviewDialog({ file, onClose }: { file: EvidenceFile | null; onClose: () => void }) {
  if (!file) return null;
  return (
    <div role="dialog" aria-label={file.fileName} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-10" onClick={onClose}>
      <div className="flex w-full max-w-3xl flex-col gap-2" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between text-sm text-white">
          <span>{file.fileName}</span>
          <Button size="xs" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
        <div className={cn("flex aspect-video items-center justify-center rounded-lg bg-gradient-to-br text-sm text-muted-foreground", file.tint ?? "from-muted to-muted")}>
          {isMedia(file) ? null : "Text preview (TextAttachmentDialog in the real app)"}
        </div>
      </div>
    </div>
  );
}

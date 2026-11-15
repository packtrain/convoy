"use client";

import { useState } from "react";
import { ArrowLeft, ChevronDown, ChevronRight, Circle, CircleCheck, CircleHelp, CircleMinus, CircleX, FileText, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { AppLink, routeTarget } from "@/lib/navigation";
import { cn } from "@/lib/utils";

type Status = "passed" | "warning" | "failed" | "not_performed" | "pending";
type Result = { status: Status; value?: string; note?: string; files?: { name: string; size: string }[]; artifact?: { name: string; type: "md" | "html" }; thread?: string; when: string };
type Check = { key: string; label: string; results: Result[] };

const GLYPHS: Record<Status, { icon: typeof Circle; tone: string; word: string }> = {
  passed: { icon: CircleCheck, tone: "text-success", word: "Passed" },
  warning: { icon: TriangleAlert, tone: "text-warning", word: "Warning" },
  failed: { icon: CircleX, tone: "text-destructive", word: "Failed" },
  not_performed: { icon: CircleMinus, tone: "text-muted-foreground", word: "Not performed" },
  pending: { icon: Circle, tone: "text-muted-foreground/50", word: "Pending" },
};

const LONG = Array.from({ length: 48 }, (_, index) => `word${String(index).padStart(3, "0")}`).join(" ");

const CHECKS: Check[] = [
  { key: "merge-risk", label: "Merge risk", results: [{ status: "failed", value: "High", note: "Touches auth middleware, new branch has no test", when: "15m ago" }] },
  {
    key: "db-queries",
    label: "Extra database requests",
    results: [
      { status: "warning", value: LONG, note: "Rechecked", when: "14m ago" },
      { status: "warning", value: "+3", note: "tasks.list reads labels per row", thread: "Set up Checks for testing OS-2385 (a check result can now carry a value and an artifact)", when: "15m ago" },
    ],
  },
  { key: "scope", label: "Scope", results: [{ status: "passed", value: "Frontend only", when: "15m ago" }] },
  { key: "perf", label: "Performance impact", results: [{ status: "warning", value: "+1 index scan", note: "Scan on tasks by list", files: [{ name: "perf.html", size: "523 B" }], when: "14m ago" }] },
  { key: "architecture", label: "Architecture changes", results: [{ status: "passed", value: "2 modules", artifact: { name: "Architecture", type: "md" }, when: "14m ago" }] },
  { key: "test-cases", label: "Manual test cases", results: [{ status: "passed", value: "12 cases", artifact: { name: "Test plan", type: "md" }, thread: "Write the test plan", when: "14m ago" }] },
  { key: "ui", label: "UI verified", results: [] },
];

const WIDTHS = { sidebar: { label: "Task sidebar", px: 380 }, wide: { label: "Checks tab", px: 720 } } as const;

/** "14m ago" in the thread being viewed, else "14m ago in “Thread name”". */
const reported = (result: Result) => (result.thread ? `${result.when} in “${result.thread}”` : result.when);

function Glyph({ status, className }: { status: Status; className?: string }) {
  const { icon: Icon, tone, word } = GLYPHS[status];
  return <Icon aria-label={word} className={cn("size-4 shrink-0", tone, className)} />;
}

/** Files and the artifact share one card, like the transcript's attachment cards. */
function AttachmentCard({ name, meta, href }: { name: string; meta: string; href?: string }) {
  const body = (
    <>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
        <FileText className="size-4 text-muted-foreground" />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{name}</span>
        <span className="text-muted-foreground">{meta}</span>
      </span>
    </>
  );
  const className = "flex max-w-56 items-center gap-2.5 rounded-lg border border-border bg-background py-1.5 pr-3 pl-1.5";
  return href ? (
    <a href={href} className={cn(className, "cursor-pointer hover:bg-muted/50")}>
      {body}
    </a>
  ) : (
    <div className={className}>{body}</div>
  );
}

/** One section of the open row's card: a small muted label over its content. */
function Part({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 px-3.5 py-2.5">
      <span className="text-xs text-muted-foreground">{title}</span>
      {children}
    </div>
  );
}

function CheckRow({ check, defaultOpen }: { check: Check; defaultOpen?: boolean }) {
  const [latest, ...previous] = check.results;
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const [showPrevious, setShowPrevious] = useState(false);
  const status: Status = latest?.status ?? "pending";
  // The prototype calls a value long by length; the real row measures whether the header cut it off.
  const longValue = (latest?.value?.length ?? 0) > 24;

  return (
    <Collapsible open={open && Boolean(latest)} onOpenChange={setOpen} disabled={!latest}>
      <div className={cn("flex items-center gap-2 rounded-md px-2 text-sm", latest && "hover:bg-muted/60")}>
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2.5 py-2 text-left enabled:cursor-pointer">
          <Glyph status={status} />
          <span className={cn("min-w-0 flex-1 truncate", !latest && "text-muted-foreground")}>{check.label}</span>
          {latest?.value ? (
            <span title={latest.value} className="max-w-fit min-w-0 flex-1 truncate text-xs text-muted-foreground tabular-nums">
              {latest.value}
            </span>
          ) : null}
          {latest ? null : <span className="shrink-0 text-xs text-muted-foreground">Not reported</span>}
        </CollapsibleTrigger>
        {latest ? (
          <CollapsibleTrigger tabIndex={-1} aria-hidden className="group/chevron shrink-0 cursor-pointer">
            <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-data-[state=open]/chevron:rotate-90" />
          </CollapsibleTrigger>
        ) : (
          <span className="size-3.5 shrink-0" />
        )}
      </div>
      {latest ? (
        <CollapsibleContent>
          {/* One card, one section per part: a small mono label over its content, split by dividers. */}
          <div className="mt-1 mb-3 divide-y divide-border/70 rounded-md bg-muted/50 text-sm">
            {longValue ? (
              <Part title="Value">
                <p className="break-words whitespace-pre-wrap">{latest.value}</p>
              </Part>
            ) : null}
            {latest.note ? (
              <Part title="Description">
                <p className="whitespace-pre-wrap">{latest.note}</p>
              </Part>
            ) : null}
            {latest.files?.length || latest.artifact ? (
              <Part title="Attachments">
                <div className="mt-0.5 flex flex-wrap gap-2">
                  {latest.artifact ? <AttachmentCard name={latest.artifact.name} meta={`Artifact · ${latest.artifact.type.toUpperCase()}`} href="#artifact" /> : null}
                  {latest.files?.map((file) => (
                    <AttachmentCard key={file.name} name={file.name} meta={file.size} />
                  ))}
                </div>
              </Part>
            ) : null}
            <Part title="Reported">
              <div className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate" title={reported(latest)}>
                  {reported(latest)}
                </span>
                {previous.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setShowPrevious((value) => !value)}
                    className="inline-flex shrink-0 cursor-pointer items-center gap-1 text-muted-foreground hover:text-foreground"
                    aria-expanded={showPrevious}
                  >
                    {previous.length} older {previous.length === 1 ? "result" : "results"}
                    <ChevronDown className={cn("size-3.5 transition-transform", showPrevious && "rotate-180")} />
                  </button>
                ) : null}
              </div>
            </Part>
            {showPrevious ? (
              <Part title={previous.length === 1 ? "Older result" : "Older results"}>
                <ol className="flex flex-col gap-2.5">
                  {previous.map((result, index) => (
                    <li key={index} className="flex items-start gap-2">
                      <Glyph status={result.status} className="mt-0.5" />
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <p className="break-words whitespace-pre-wrap">
                          <span className="tabular-nums">{result.value ?? GLYPHS[result.status].word}</span>
                          {result.note ? <span> · {result.note}</span> : null}
                        </p>
                        <span className="truncate text-muted-foreground" title={reported(result)}>
                          {reported(result)}
                        </span>
                        {result.artifact ? <AttachmentCard name={result.artifact.name} meta={`Artifact · ${result.artifact.type.toUpperCase()}`} href="#artifact" /> : null}
                      </div>
                    </li>
                  ))}
                </ol>
              </Part>
            ) : null}
          </div>
        </CollapsibleContent>
      ) : null}
    </Collapsible>
  );
}

/** Proposed check-row hierarchy for OS-2385, on local data. */
export default function CheckRowsPlaygroundPage() {
  const [width, setWidth] = useState<keyof typeof WIDTHS>("sidebar");
  const passed = CHECKS.filter((check) => ["passed", "warning"].includes(check.results[0]?.status ?? "")).length;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-xs">
        <AppLink href={routeTarget("/playground")} className="mr-2 inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
          <ArrowLeft aria-hidden="true" className="size-3.5" /> Playground
        </AppLink>
        <span className="font-medium">Check rows</span>
        <span className="rounded-md border border-border px-2 py-0.5 text-muted-foreground">OS-2385 · UX proposal</span>
        <span className="mx-2 h-4 w-px bg-border" />
        {(Object.keys(WIDTHS) as (keyof typeof WIDTHS)[]).map((key) => (
          <Button key={key} size="xs" variant={key === width ? "default" : "outline"} onClick={() => setWidth(key)}>
            {WIDTHS[key].label} · {WIDTHS[key].px}px
          </Button>
        ))}
      </div>

      <div className="flex justify-center p-8">
        <section className="flex flex-col gap-2" style={{ width: WIDTHS[width].px }}>
          <div className="flex items-center gap-2 px-2">
            <h3 className="text-sm font-medium">Checks</h3>
            <span className="rounded-md bg-muted px-1.5 text-xs text-muted-foreground tabular-nums">
              {passed}/{CHECKS.length}
            </span>
            <CircleHelp className="size-3.5 text-muted-foreground" />
            <Button size="xs" variant="ghost" className="ml-auto text-muted-foreground">
              Review signals <ChevronDown className="size-3" />
            </Button>
          </div>
          <div className="flex flex-col gap-0.5">
            {CHECKS.map((check) => (
              <CheckRow key={check.key} check={check} defaultOpen={check.key === "db-queries" || check.key === "perf" || check.key === "test-cases"} />
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

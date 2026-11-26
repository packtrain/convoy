"use client";

import { useState, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, ArrowUpRight, GitBranch, Terminal } from "lucide-react";
import { CollapsibleToolPart } from "@/components/blocks/thread/message-parts/components/collapsible-tool-part";
import { ToolSurface } from "@/components/blocks/thread/message-parts/components/tool-surface";
import { Marker, MarkerContent } from "@/components/ui/marker";
import { AppLink, routeTarget } from "@/lib/navigation";
import { getThreadPullRequestPresentation } from "@/lib/threads/pull-request";
import { cn } from "@/lib/utils";

/** The event has no state, but a PR it just opened is open. */
const OPEN = getThreadPullRequestPresentation("open");

const PAYLOAD = {
  type: "system",
  subtype: "code_change_published",
  provider: "github",
  url: "https://github.com/packtrain/convoy/pull/9",
  repo: "packtrain/convoy",
  identifier: "9",
  action: "created",
  branch: "epic/os-2173-pull-request-watch-wake",
  uuid: "6ad0caae-6273-459f-91d3-3f53d5ecf583",
  session_id: "bc61f968-9f33-4b36-88b1-5922979c41d1",
};

type Action = "created" | "updated";

const ACTION_VERB: Record<Action, string> = { created: "Opened", updated: "Pushed to" };
const NUMBER = `#${PAYLOAD.identifier}`;

function Toggle<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly T[]; onChange: (v: T) => void }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex rounded-md border border-border p-0.5">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            className={cn("rounded px-2 py-0.5", option === value ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Neighbouring rows from the screenshot, so each variant is judged in the transcript's rhythm. */
function Transcript({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-3">
      <CollapsibleToolPart icon={Terminal} title="Open the pull request on GitHub" hasBody={false} />
      {children}
      <div className="text-sm text-muted-foreground">Reasoning</div>
    </div>
  );
}

function Today() {
  return (
    <CollapsibleToolPart
      icon={AlertTriangle}
      title={`Code change published: Published ${PAYLOAD.repo}${NUMBER}.`}
      renderChildren={() => (
        <ToolSurface>
          <pre className="overflow-x-auto font-mono text-xs text-foreground">
            <code>{JSON.stringify({ subtype: PAYLOAD.subtype, payload: PAYLOAD }, null, 2)}</code>
          </pre>
        </ToolSurface>
      )}
    />
  );
}

/** The event's `url`. Opening the in-app reader instead is a wiring choice, not new data. */
function PrHref({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <a href={PAYLOAD.url} target="_blank" rel="noreferrer" className={className}>
      {children}
    </a>
  );
}

const Branch = ({ className }: { className?: string }) => (
  <span className={cn("min-w-0 items-center gap-1 font-mono text-xs text-muted-foreground", className)}>
    <GitBranch aria-hidden="true" className="size-3 shrink-0" />
    <span className="truncate">{PAYLOAD.branch}</span>
  </span>
);

/** A: one tool-height row. Verb, PR chip, branch. */
function QuietRow({ action }: { action: Action }) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
      <OPEN.icon aria-hidden="true" className={cn("size-3.5 shrink-0", OPEN.colorClass)} />
      <span className="shrink-0">{ACTION_VERB[action]} pull request</span>
      <PrHref className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-border bg-muted/50 px-1.5 text-foreground no-underline hover:bg-muted">
        <span className="font-medium">{PAYLOAD.repo}</span>
        <span className="text-xs font-medium text-muted-foreground tabular-nums">{NUMBER}</span>
        <ArrowUpRight aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
      </PrHref>
      <Branch className="hidden sm:inline-flex" />
    </div>
  );
}

/** B: a two-line card: PR ref on top, branch under it. */
function PrCard({ action }: { action: Action }) {
  return (
    <PrHref className="block max-w-xl rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-foreground no-underline transition-colors hover:bg-muted/70">
      <div className="flex items-center gap-2">
        <OPEN.icon aria-hidden="true" className={cn("size-4 shrink-0", OPEN.colorClass)} />
        <span className="shrink-0 text-muted-foreground">{ACTION_VERB[action]}</span>
        <span className="min-w-0 truncate font-medium">{PAYLOAD.repo}</span>
        <span className="shrink-0 text-xs font-medium text-muted-foreground tabular-nums">{NUMBER}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          GitHub <ArrowUpRight aria-hidden="true" className="size-3.5" />
        </span>
      </div>
      <Branch className="mt-1 flex pl-6" />
    </PrHref>
  );
}

/** C: a centred milestone in the transcript, like the compaction marker. */
function Milestone({ action }: { action: Action }) {
  return (
    <Marker variant="separator" className="my-2 text-xs">
      <MarkerContent>
        <span className="inline-flex items-center gap-1.5">
          <OPEN.icon aria-hidden="true" className={cn("size-3.5", OPEN.colorClass)} />
          {ACTION_VERB[action]}{" "}
          <PrHref>
            {PAYLOAD.repo}
            {NUMBER}
          </PrHref>
        </span>
      </MarkerContent>
    </Marker>
  );
}

const VARIANTS: { key: string; title: string; note: string; render: (action: Action) => ReactNode }[] = [
  {
    key: "a",
    title: "A · Quiet row",
    note: "Same height as a tool row, so the transcript keeps its rhythm. The chip opens the PR.",
    render: (action) => <QuietRow action={action} />,
  },
  {
    key: "b",
    title: "B · PR card",
    note: "Stands out as the result of the run. The whole card is the link, and the branch gets its own line.",
    render: (action) => <PrCard action={action} />,
  },
  {
    key: "c",
    title: "C · Milestone",
    note: "A divider at the point where the work became reviewable. Easy to spot when scrolling; drops the branch.",
    render: (action) => <Milestone action={action} />,
  },
];

export default function CodeChangePublishedPlaygroundPage() {
  const [action, setAction] = useState<Action>("created");

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-4xl space-y-8 px-4 py-8 sm:px-8 sm:py-12">
        <header className="space-y-4">
          <AppLink href={routeTarget("/playground")} className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft aria-hidden="true" className="size-3.5" /> Playground
          </AppLink>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold">Code change published</h1>
            <span className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground">OS-2611</span>
          </div>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Claude Code emits <code className="rounded bg-muted px-1 py-0.5 text-xs">system / code_change_published</code> when it opens a PR.
            Today it renders as a warning-icon runtime notice with raw JSON. Three replacements below, each in the transcript between the rows
            from the original screenshot.
          </p>
          <div className="flex flex-wrap gap-4 rounded-lg border border-border bg-muted/20 px-3 py-2">
            <Toggle label="action" value={action} options={["created", "updated"] as const} onChange={setAction} />
          </div>
          <p className="text-xs text-muted-foreground">
            Everything shown comes from the event: <code>repo</code>, <code>identifier</code>, <code>branch</code>, <code>action</code> and <code>url</code>.
            It has no state; the icon uses the open-PR colour because the agent just opened it. <code>updated</code> is a guess; only <code>created</code> has been seen.
          </p>
        </header>

        <section className="space-y-3 border-t border-border pt-6">
          <h2 className="text-sm font-medium">Today</h2>
          <div className="rounded-lg border border-border bg-card/40 p-4">
            <Transcript>
              <Today />
            </Transcript>
          </div>
        </section>

        {VARIANTS.map((variant) => (
          <section key={variant.key} className="space-y-3 border-t border-border pt-6">
            <h2 className="text-sm font-medium">{variant.title}</h2>
            <p className="max-w-2xl text-sm text-muted-foreground">{variant.note}</p>
            <div className="rounded-lg border border-border bg-card/40 p-4">
              <Transcript>{variant.render(action)}</Transcript>
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}

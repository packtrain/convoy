"use client";

import { useState, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, Bot, FolderGit2, FolderInput, GitBranch, Terminal, type LucideIcon } from "lucide-react";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { CollapsibleToolPart } from "@/components/blocks/thread/message-parts/components/collapsible-tool-part";
import { ToolSurface } from "@/components/blocks/thread/message-parts/components/tool-surface";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Marker } from "@/components/ui/marker";
import { AppLink, routeTarget } from "@/lib/navigation";
import { cn } from "@/lib/utils";

/** Every way a thread's working directory changes: worktree creation, the two recovery outcomes, and an agent's move. */
type Change = "created" | "moved" | "parent" | "agent";
type Width = "wide" | "narrow";

interface WorktreeChange {
  change: Change;
  previousPath: string;
  path: string;
  branch: string;
  baseRef?: string;
}

const PARENT = "/workspace";
const WORKTREE = "/workspace-worktrees/feat-os-2587-add-captions-to-image";
const BRANCH = "feat/os-2587-add-captions-to-image";

const CHANGES: Record<Change, WorktreeChange> = {
  created: { change: "created", previousPath: PARENT, path: WORKTREE, branch: BRANCH, baseRef: "main" },
  moved: { change: "moved", previousPath: WORKTREE, path: "/workspace-worktrees/archive/feat-os-2587-add-captions-to-image", branch: BRANCH },
  parent: { change: "parent", previousPath: WORKTREE, path: PARENT, branch: "main" },
  agent: { change: "agent", previousPath: PARENT, path: WORKTREE, branch: BRANCH },
};

interface ChangeCopy {
  icon: LucideIcon;
  /** Short cause after the chips; the first thing to truncate. */
  label: string;
  pending: string;
  /** The old directory is gone, so its chip is struck through. */
  oldGone: boolean;
  explain: (c: WorktreeChange) => ReactNode;
}

const COPY: Record<Change, ChangeCopy> = {
  created: {
    icon: FolderGit2,
    label: "new worktree",
    pending: "Creating worktree",
    oldGone: false,
    explain: (c) => (
      <>
        Created for this thread on <Code>{c.branch}</Code> from <Code>{c.baseRef}</Code>. Every later run happens here.
      </>
    ),
  },
  moved: {
    icon: FolderInput,
    label: "worktree moved",
    pending: "Finding worktree",
    oldGone: true,
    explain: () => "Git reports the same worktree at a new path. Files, branch and Undo history carry over.",
  },
  parent: {
    icon: FolderInput,
    label: "worktree removed",
    pending: "Finding worktree",
    oldGone: true,
    explain: () =>
      "The worktree no longer exists, so the thread fell back to its parent checkout, on whatever branch is checked out there. Nothing was copied from the old worktree.",
  },
  agent: {
    icon: Bot,
    label: "moved by agent",
    pending: "Moving to",
    oldGone: false,
    explain: () => (
      <>
        The agent moved its work here and ran <Code>convoy threads move-worktree</Code>. Every later run happens here.
        The old checkout was left as it is.
      </>
    ),
  },
};

const WIDTH_CLASS: Record<Width, string> = { wide: "max-w-3xl", narrow: "max-w-sm" };

const segments = (path: string) => path.split("/").filter(Boolean);
/** Basenames, unless they match (a moved worktree); then the last two segments. */
function chipLabels(c: WorktreeChange): [string, string] {
  const [a, b] = [segments(c.previousPath), segments(c.path)];
  if (a.at(-1) !== b.at(-1)) return [a.at(-1) ?? "/", b.at(-1) ?? "/"];
  return [a.slice(-2).join("/"), b.slice(-2).join("/")];
}

function Code({ children, className }: { children: ReactNode; className?: string }) {
  return <code className={cn("font-mono text-foreground", className)}>{children}</code>;
}

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

function Today({ c }: { c: WorktreeChange }) {
  if (c.change === "created") {
    return <CollapsibleToolPart icon={AlertTriangle} title={`Worktree: Creating worktree for branch ${c.branch} from ${c.baseRef}…`} hasBody={false} />;
  }
  const message = `The thread previously ran in ${c.previousPath}. Its working directory is now ${c.path}. Recheck files before editing.`;
  return (
    <CollapsibleToolPart
      icon={AlertTriangle}
      title={`Working directory recovered: ${message}`}
      renderChildren={() => (
        <ToolSurface>
          <pre className="overflow-x-auto font-mono text-xs text-foreground">
            <code>{JSON.stringify({ code: "workspace-recovered", kind: "runtime-notice", message, title: "Working directory recovered" }, null, 2)}</code>
          </pre>
        </ToolSurface>
      )}
    />
  );
}

function Details({ c }: { c: WorktreeChange }) {
  const rows: [string, ReactNode][] = [
    ["Now", <Code key="now" className="break-all">{c.path}</Code>],
    [
      "Was",
      <Code key="was" className={cn("break-all text-muted-foreground", COPY[c.change].oldGone && "line-through decoration-muted-foreground/50")}>
        {c.previousPath}
      </Code>,
    ],
    [
      "Branch",
      <span key="branch" className="inline-flex items-center gap-1 font-mono text-foreground">
        <GitBranch aria-hidden="true" className="size-3 shrink-0" />
        {c.branch}
      </span>,
    ],
  ];
  return (
    <ToolSurface className="space-y-3 text-left text-xs">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="leading-5 text-muted-foreground">{COPY[c.change].explain(c)}</p>
    </ToolSurface>
  );
}

const CHIP = "inline-flex h-5 min-w-0 items-center rounded-md border border-border px-1.5 font-mono text-[11px]";

/** The divider: icon, (old) → (new), cause. The old chip and the cause give way first; the new chip last. */
function WorktreeMilestone({ c, pending = false }: { c: WorktreeChange; pending?: boolean }) {
  const [open, setOpen] = useState(false);
  const copy = COPY[c.change];
  const [oldLabel, newLabel] = chipLabels(c);

  if (pending) {
    return (
      <Marker variant="separator" className="my-2 text-xs">
        <span className="flex min-w-0 items-center gap-1.5">
          <copy.icon aria-hidden="true" className="size-3.5 shrink-0" />
          <Shimmer as="span">{`${copy.pending} ${newLabel}…`}</Shimmer>
        </span>
      </Marker>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="my-2">
      <Marker variant="separator" className="text-xs">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            title={`${c.previousPath} → ${c.path}`}
            className="flex min-w-0 max-w-[85%] cursor-pointer items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-muted/50 hover:text-foreground"
          >
            <copy.icon aria-hidden="true" className="size-3.5 shrink-0" />
            <span className={cn(CHIP, "shrink-[3] text-muted-foreground")}>
              <span className={cn("truncate", copy.oldGone && "line-through decoration-muted-foreground/50")}>{oldLabel}</span>
            </span>
            <ArrowRight aria-hidden="true" className="size-3 shrink-0" />
            <span className={cn(CHIP, "shrink bg-muted/50 text-foreground")}>
              <span className="truncate">{newLabel}</span>
            </span>
            <span className="min-w-0 shrink-[6] truncate">{copy.label}</span>
          </button>
        </CollapsibleTrigger>
      </Marker>
      <CollapsibleContent className="mt-2">
        <Details c={c} />
      </CollapsibleContent>
    </Collapsible>
  );
}

function Frame({ width, children }: { width: Width; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card/40 p-4">
      <div className={cn("space-y-3", WIDTH_CLASS[width])}>{children}</div>
    </div>
  );
}

const Reasoning = () => <div className="text-sm text-muted-foreground">Reasoning</div>;
const Tool = ({ title }: { title: string }) => <CollapsibleToolPart icon={Terminal} title={title} hasBody={false} />;

export default function WorkspaceRecoveredPlaygroundPage() {
  const [change, setChange] = useState<Change>("parent");
  const [width, setWidth] = useState<Width>("wide");
  const [pending, setPending] = useState<"done" | "pending">("done");
  const c = CHANGES[change];

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-4xl space-y-8 px-4 py-8 sm:px-8 sm:py-12">
        <header className="space-y-4">
          <AppLink href={routeTarget("/playground")} className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft aria-hidden="true" className="size-3.5" /> Playground
          </AppLink>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold">Worktree changes</h1>
            <span className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground">OS-2609</span>
          </div>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            A thread&apos;s working directory changes in three ways: the CLI creates its worktree (<code className="rounded bg-muted px-1 py-0.5 text-xs">worktree-create</code>),
            or recovery finds the worktree moved or falls back to the parent checkout (<code className="rounded bg-muted px-1 py-0.5 text-xs">workspace-recovered</code>).
            All three become one divider: (old) → (new) and the cause. Click it for the full paths, branch and explanation.
          </p>
          <div className="flex flex-wrap gap-4 rounded-lg border border-border bg-muted/20 px-3 py-2">
            <Toggle label="change" value={change} options={["created", "moved", "parent", "agent"] as const} onChange={setChange} />
            <Toggle label="state" value={pending} options={["done", "pending"] as const} onChange={setPending} />
            <Toggle label="thread width" value={width} options={["wide", "narrow"] as const} onChange={setWidth} />
          </div>
          <p className="text-xs text-muted-foreground">
            Both notices would send <code>change</code>, <code>previousPath</code>, <code>path</code> and <code>branch</code> (plus <code>baseRef</code> on create).
            The CLI knows all of them at that point. <code>message</code> stays as the fallback for older web builds. <code>pending</code> is the
            &ldquo;Creating worktree…&rdquo; moment before the create finishes; recovery has no visible pending step today.
          </p>
        </header>

        <section className="space-y-3 border-t border-border pt-6">
          <h2 className="text-sm font-medium">Today</h2>
          <Frame width={width}>
            <Today c={c} />
            <Reasoning />
            <Tool title="Check branch, status, commit conventions" />
          </Frame>
        </section>

        <section className="space-y-3 border-t border-border pt-6">
          <h2 className="text-sm font-medium">Milestone</h2>
          <Frame width={width}>
            <WorktreeMilestone key={change} c={c} pending={pending === "pending"} />
            <Reasoning />
            <Tool title="Check branch, status, commit conventions" />
          </Frame>
        </section>

        <section className="space-y-3 border-t border-border pt-6">
          <h2 className="text-sm font-medium">One thread, all three</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Created in a worktree, the worktree later moved, then removed. Each change marks where the following runs happen.
          </p>
          <Frame width={width}>
            <WorktreeMilestone c={CHANGES.created} />
            <Tool title="Add captions to image blocks" />
            <WorktreeMilestone c={CHANGES.moved} />
            <Tool title="Run the image block tests" />
            <WorktreeMilestone c={{ ...CHANGES.parent, previousPath: CHANGES.moved.path }} />
            <Reasoning />
            <Tool title="Check branch, status, commit conventions" />
          </Frame>
        </section>
      </div>
    </main>
  );
}

"use client";

import { useState, type ReactNode } from "react";
import { ArrowRight, Bot, FolderGit2, FolderInput, GitBranch, type LucideIcon } from "lucide-react";
import { z } from "zod";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Marker } from "@/components/ui/marker";
import type { RuntimeNoticePart } from "@/lib/cli-stream-ui";
import { cn } from "@/lib/utils";
import { ToolSurface } from "./components/tool-surface";

/** Fields the CLI sends on worktree notices (docs/specs/cli-worktrees.md#worktree-change-notices). */
const changeSchema = z.object({
  change: z.enum(["created", "moved", "parent", "agent"]),
  previousPath: z.string().min(1),
  path: z.string().min(1),
  branch: z.string().min(1).optional(),
  baseRef: z.string().min(1).optional(),
});
const pendingSchema = z.object({ branch: z.string().min(1), baseRef: z.string().min(1).optional() });

type WorktreeChange = z.infer<typeof changeSchema>;
type Notice = { pending: z.infer<typeof pendingSchema> } | { change: WorktreeChange };

const NOTICE_SCHEMAS: Record<string, (fields: unknown) => Notice | null> = {
  "worktree-create": (fields) => {
    const parsed = pendingSchema.safeParse(fields);
    return parsed.success ? { pending: parsed.data } : null;
  },
  "worktree-created": parseChange,
  "workspace-recovered": parseChange,
  "workspace-moved": parseChange,
};

function parseChange(fields: unknown): Notice | null {
  const parsed = changeSchema.safeParse(fields);
  return parsed.success ? { change: parsed.data } : null;
}

/** The divider's data, or null for other notices and for older CLIs that sent only `message`. */
export function parseWorktreeNotice(part: RuntimeNoticePart): Notice | null {
  const parse = NOTICE_SCHEMAS[part.code];
  if (!parse || !part.detailsJson) return null;
  try {
    return parse(JSON.parse(part.detailsJson));
  } catch {
    return null;
  }
}

const COPY: Record<WorktreeChange["change"], { icon: LucideIcon; label: string; oldGone: boolean; explain: (c: WorktreeChange) => ReactNode }> = {
  created: {
    icon: FolderGit2,
    label: "new worktree",
    oldGone: false,
    explain: (c) => (
      <>
        Created for this thread{c.branch && <> on <Code>{c.branch}</Code></>}
        {c.baseRef && <> from <Code>{c.baseRef}</Code></>}. Every later run happens here.
      </>
    ),
  },
  moved: {
    icon: FolderInput,
    label: "worktree moved",
    oldGone: true,
    explain: () => "Git reports the same worktree at a new path. Files, branch and Undo history carry over.",
  },
  parent: {
    icon: FolderInput,
    label: "worktree removed",
    oldGone: true,
    explain: () =>
      "The worktree no longer exists, so the thread fell back to its parent checkout, on whatever branch is checked out there. Nothing was copied from the old worktree.",
  },
  agent: {
    icon: Bot,
    label: "moved by agent",
    oldGone: false,
    explain: () => (
      <>
        The agent moved its work here and ran <Code>convoy threads move-worktree</Code>. Every later run happens here.
        The old checkout was left as it is.
      </>
    ),
  },
};

const segments = (path: string) => path.split("/").filter(Boolean);

/** Basenames, unless they match (a moved worktree); then the last two folders. */
function chipLabels(c: WorktreeChange): [string, string] {
  const [from, to] = [segments(c.previousPath), segments(c.path)];
  if (from.at(-1) !== to.at(-1)) return [from.at(-1) ?? "/", to.at(-1) ?? "/"];
  return [from.slice(-2).join("/"), to.slice(-2).join("/")];
}

function Code({ children, className }: { children: ReactNode; className?: string }) {
  return <code className={cn("font-mono text-foreground", className)}>{children}</code>;
}

const CHIP = "inline-flex h-5 min-w-0 items-center rounded-md border border-border px-1.5 font-mono text-[11px]";

function Details({ c }: { c: WorktreeChange }) {
  const copy = COPY[c.change];
  return (
    <ToolSurface className="space-y-3 text-left text-xs">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        <dt className="text-muted-foreground">Now</dt>
        <dd className="min-w-0"><Code className="break-all">{c.path}</Code></dd>
        <dt className="text-muted-foreground">Was</dt>
        <dd className="min-w-0">
          <Code className={cn("break-all text-muted-foreground", copy.oldGone && "line-through decoration-muted-foreground/50")}>{c.previousPath}</Code>
        </dd>
        {c.branch && (
          <>
            <dt className="text-muted-foreground">Branch</dt>
            <dd className="inline-flex min-w-0 items-center gap-1 font-mono text-foreground">
              <GitBranch aria-hidden="true" className="size-3 shrink-0" />
              {c.branch}
            </dd>
          </>
        )}
      </dl>
      <p className="leading-5 text-muted-foreground">{copy.explain(c)}</p>
    </ToolSurface>
  );
}

/** A transcript divider for each working-directory change: (old) → (new) and the cause; click for details. */
export function WorktreeChangeNotice({ notice }: { notice: Notice }) {
  const [open, setOpen] = useState(false);

  if ("pending" in notice) {
    const { branch, baseRef } = notice.pending;
    return (
      <Marker variant="separator" className="my-2 text-xs">
        <span className="flex min-w-0 items-center gap-1.5">
          <FolderGit2 aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="truncate">Creating worktree {branch}{baseRef ? ` from ${baseRef}` : ""}…</span>
        </span>
      </Marker>
    );
  }

  const c = notice.change;
  const copy = COPY[c.change];
  const [oldLabel, newLabel] = chipLabels(c);
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

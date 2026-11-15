"use client";

import { useState, type ReactNode } from "react";
import {
  Check,
  ChevronDown,
  ListFilter,
  Circle,
  CircleAlert,
  FolderGit2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/custom/spinner";
import { StatusIcon } from "@/components/blocks/tasks/task-table/badges";
import { TaskType } from "@/components/blocks/tasks/task-ref-with-type";
import { Status } from "@/lib/tasks/status";
import { BUILT_IN_TASK_TYPES } from "@/lib/tasks/task-types";
import { renderCliIcon, type CliTypeSlug } from "@/lib/cli-runtime-ui/registry";
import { cn } from "@/lib/utils";

// ponytail: static seed data + pure layout only — no data fetching, routing, or actions yet.

type WatchThreadStatus =
  | "waiting_input"
  | "failed"
  | "running"
  | "needs_review"
  | "done";

interface WatchThreadSeed {
  id: string;
  name: string;
  /** org/project, GitHub-style repo slug */
  project: string;
  taskRef?: string;
  taskName?: string;
  taskTypeKey?: string;
  taskStatus?: Status;
  cliType: CliTypeSlug;
  agent?: string;
  updatedAgo: string;
  messages: number;
  linesAdded?: number;
  linesRemoved?: number;
  status: WatchThreadStatus;
}

const THREADS: WatchThreadSeed[] = [
  {
    id: "t1",
    name: "Should the retry endpoint also clear stale claims?",
    project: "contoso/convoy",
    taskRef: "OS-1198",
    taskName: "Fix retry requeue for failed runs",
    taskTypeKey: "bug",
    taskStatus: Status.IN_PROGRESS,
    cliType: "claude-code",
    agent: "Fable",
    updatedAgo: "4 min ago",
    messages: 12,
    linesAdded: 86,
    linesRemoved: 14,
    status: "waiting_input",
  },
  {
    id: "t2",
    name: "Pick a migration strategy for legacy statuses",
    project: "contoso/convoy",
    taskRef: "OS-1145",
    taskName: "Remove legacy claimed message status",
    taskTypeKey: "chore",
    taskStatus: Status.IN_PROGRESS,
    cliType: "codex",
    agent: "GPT-5.5",
    updatedAgo: "22 min ago",
    messages: 7,
    status: "waiting_input",
  },
  {
    id: "t3",
    name: "Implement worktree cleanup hook",
    project: "contoso/cmux",
    taskRef: "CM-88",
    taskName: "Worktree lifecycle hooks",
    taskTypeKey: "feature",
    taskStatus: Status.IN_PROGRESS,
    cliType: "claude-code",
    agent: "Fable",
    updatedAgo: "9 min ago",
    messages: 31,
    linesAdded: 240,
    linesRemoved: 61,
    status: "failed",
  },
  {
    id: "t4",
    name: "Add watch tower dashboard layout",
    project: "contoso/convoy",
    taskRef: "OS-1220",
    taskName: 'Create a "Watch tower" dashboard',
    taskTypeKey: "task",
    taskStatus: Status.IN_PROGRESS,
    cliType: "claude-code",
    agent: "Fable",
    updatedAgo: "just now",
    messages: 18,
    linesAdded: 412,
    linesRemoved: 3,
    status: "running",
  },
  {
    id: "t5",
    name: "Investigate flaky pagination test",
    project: "acme/webapp",
    cliType: "cursor",
    updatedAgo: "2 min ago",
    messages: 5,
    status: "running",
  },
  {
    id: "t6",
    name: "Refactor notification fan-out to batched writes",
    project: "contoso/convoy",
    taskRef: "OS-1003",
    taskName: "Notifications module",
    taskTypeKey: "epic",
    taskStatus: Status.IN_REVIEW,
    cliType: "claude-code",
    agent: "Fable",
    updatedAgo: "35 min ago",
    messages: 44,
    linesAdded: 512,
    linesRemoved: 388,
    status: "needs_review",
  },
  {
    id: "t7",
    name: "Translate onboarding emails to Spanish",
    project: "acme/webapp",
    taskRef: "WEB-412",
    taskName: "Localize transactional emails",
    taskTypeKey: "feature",
    taskStatus: Status.TODO,
    cliType: "codex",
    agent: "GPT-5.5",
    updatedAgo: "1 h ago",
    messages: 9,
    linesAdded: 130,
    linesRemoved: 0,
    status: "needs_review",
  },
  {
    id: "t8",
    name: "Explain the claim-lease expiry edge case",
    project: "contoso/convoy",
    cliType: "opencode",
    updatedAgo: "3 h ago",
    messages: 6,
    status: "needs_review",
  },
  {
    id: "t9",
    name: "Bump CLI version and changelog",
    project: "contoso/convoy",
    taskRef: "OS-1201",
    taskName: "Release 0.14",
    taskTypeKey: "chore",
    taskStatus: Status.DONE,
    cliType: "claude-code",
    agent: "Fable",
    updatedAgo: "yesterday",
    messages: 4,
    linesAdded: 12,
    linesRemoved: 2,
    status: "done",
  },
  {
    id: "t10",
    name: "Fix search results opening in wrong list",
    project: "contoso/convoy",
    taskRef: "OS-1234",
    taskName: "Open search results in owning list",
    taskTypeKey: "bug",
    taskStatus: Status.DONE,
    cliType: "claude-code",
    agent: "Fable",
    updatedAgo: "yesterday",
    messages: 22,
    linesAdded: 64,
    linesRemoved: 31,
    status: "done",
  },
  {
    id: "t11",
    name: "Draft README restructure",
    project: "contoso/convoy",
    cliType: "codex",
    agent: "GPT-5.5",
    updatedAgo: "2 days ago",
    messages: 15,
    linesAdded: 210,
    linesRemoved: 190,
    status: "done",
  },
];

const STATUS_META: Record<
  WatchThreadStatus,
  { label: string; dotClassName: string; pulse?: boolean }
> = {
  waiting_input: {
    label: "Waiting for input",
    dotClassName: "text-amber-500 fill-amber-500",
    pulse: true,
  },
  failed: { label: "Failed", dotClassName: "text-red-500 fill-red-500" },
  running: { label: "Running", dotClassName: "text-blue-500 fill-blue-500" },
  needs_review: {
    label: "Needs review",
    dotClassName: "text-blue-500 fill-blue-500",
  },
  done: { label: "Done", dotClassName: "text-emerald-500 fill-emerald-500" },
};

/** Section order in the status view; also ranks task groups by their most urgent thread. */
const ATTENTION_RANK: Record<WatchThreadStatus, number> = {
  waiting_input: 0,
  failed: 1,
  running: 2,
  needs_review: 3,
  done: 4,
};

const SECTIONS: {
  status: WatchThreadStatus;
  title: string;
  description: string;
}[] = [
  {
    status: "waiting_input",
    title: "Waiting for your input",
    description: "Agents asked a question and are blocked until you answer.",
  },
  {
    status: "failed",
    title: "Failed",
    description: "Runs that stopped with an error and can be retried.",
  },
  {
    status: "running",
    title: "Running",
    description: "Agents currently working.",
  },
  {
    status: "needs_review",
    title: "Needs your review",
    description: "Finished threads you haven't opened since they completed.",
  },
  {
    status: "done",
    title: "Recently finished",
    description: "Reviewed threads from the last few days.",
  },
];

function StatusIndicator({ status }: { status: WatchThreadStatus }) {
  const meta = STATUS_META[status];
  return (
    <span className="inline-flex items-center gap-2 text-xs text-foreground">
      {status === "running" ? (
        <Spinner className="size-3 text-blue-500" />
      ) : status === "done" ? (
        <Check className="size-3.5 text-emerald-500" />
      ) : status === "failed" ? (
        <CircleAlert className="size-3.5 text-red-500" />
      ) : (
        <Circle
          className={cn("size-2", meta.dotClassName, meta.pulse && "animate-pulse")}
        />
      )}
      {meta.label}
    </span>
  );
}

function DiffStat({ added, removed }: { added?: number; removed?: number }) {
  if (added === undefined && removed === undefined) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <span className="font-mono text-xs">
      <span className="text-emerald-600 dark:text-emerald-400">+{added ?? 0}</span>{" "}
      <span className="text-red-600 dark:text-red-400">−{removed ?? 0}</span>
    </span>
  );
}

function ThreadRow({ thread }: { thread: WatchThreadSeed }) {
  return (
    <div className="grid cursor-pointer grid-cols-[minmax(0,1fr)_150px_110px] items-center gap-4 border-t border-border px-4 py-2.5 transition-colors hover:bg-muted/50">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 shrink-0 text-muted-foreground">
          {renderCliIcon(thread.cliType, "size-4")}
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">
            {thread.name}
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span className="inline-flex shrink-0 items-center gap-1">
              <FolderGit2 className="size-3" />
              {thread.project}
            </span>
            {thread.taskRef ? (
              <>
                <span aria-hidden>·</span>
                <span className="inline-flex min-w-0 items-center gap-1">
                  <TaskType
                    taskType={taskTypeFor(thread.taskTypeKey)}
                    variant="icon"
                    className="size-3 shrink-0"
                  />
                  <span className="shrink-0 font-medium text-foreground/80">
                    {thread.taskRef}
                  </span>
                  <span className="truncate">{thread.taskName}</span>
                </span>
              </>
            ) : null}
            <span aria-hidden>·</span>
            <span className="shrink-0">updated {thread.updatedAgo}</span>
          </div>
        </div>
      </div>
      <StatusIndicator status={thread.status} />
      <DiffStat added={thread.linesAdded} removed={thread.linesRemoved} />
    </div>
  );
}

function TableHeader() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_150px_110px] gap-4 rounded-t-lg bg-muted/60 px-4 py-2 text-xs font-medium text-muted-foreground">
      <span>Thread</span>
      <span>Status</span>
      <span>Changes</span>
    </div>
  );
}

function Section({
  header,
  children,
}: {
  header: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">{header}</div>
      {children}
    </section>
  );
}

function StatusSections({ hidden }: { hidden: Set<string> }) {
  return (
    <div className="space-y-6">
      {SECTIONS.map((section) => {
        if (hidden.has(section.status)) return null;
        const threads = THREADS.filter((t) => t.status === section.status);
        if (threads.length === 0) return null;
        return (
          <Section
            key={section.status}
            header={
              <span className="flex min-w-0 items-baseline gap-2">
                <h2 className="text-base font-semibold">{section.title}</h2>
                <span className="rounded-full bg-muted px-2 text-xs tabular-nums text-muted-foreground">
                  {threads.length}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {section.description}
                </span>
              </span>
            }
          >
            <div className="rounded-lg border border-border">
              <TableHeader />
              {threads.map((thread) => (
                <ThreadRow key={thread.id} thread={thread} />
              ))}
            </div>
            {section.status === "done" ? (
              <div className="mt-2">
                <Button variant="ghost" size="sm" className="text-muted-foreground">
                  Show 12 more finished threads
                </Button>
              </div>
            ) : null}
          </Section>
        );
      })}
    </div>
  );
}

function taskTypeFor(key: string | undefined) {
  return (
    BUILT_IN_TASK_TYPES.find((t) => t.key === key) ?? BUILT_IN_TASK_TYPES[0]
  );
}

/** Active work first, backlog after, finished last. */
const TASK_STATUS_ORDER: Status[] = [
  Status.IN_PROGRESS,
  Status.IN_REVIEW,
  Status.BLOCKED,
  Status.PLAN_REVIEW,
  Status.PLANNING,
  Status.TRIAGE,
  Status.TODO,
  Status.DONE,
  Status.CANCELED,
];

function TaskStatusSections({ hidden }: { hidden: Set<string> }) {
  const byTaskStatus = (status: Status) =>
    THREADS.filter((t) => t.taskStatus === status).sort(
      (a, b) => ATTENTION_RANK[a.status] - ATTENTION_RANK[b.status]
    );
  const noTask = THREADS.filter((t) => !t.taskStatus);

  const groups: { key: string; header: ReactNode; threads: WatchThreadSeed[] }[] =
    [
      ...TASK_STATUS_ORDER.map((status) => ({
        key: status,
        header: (
          <span className="flex items-center gap-2">
            <StatusIcon status={status} className="size-4" />
            <h2 className="text-base font-semibold">{status}</h2>
          </span>
        ),
        threads: byTaskStatus(status),
      })),
      {
        key: "no-task",
        header: <h2 className="text-base font-semibold">No task</h2>,
        threads: noTask,
      },
    ];

  return (
    <div className="space-y-6">
      {groups.map((group) => {
        if (hidden.has(group.key) || group.threads.length === 0) return null;
        return (
          <Section
            key={group.key}
            header={
              <span className="flex min-w-0 flex-1 items-center gap-2">
                {group.header}
                <span className="rounded-full bg-muted px-2 text-xs tabular-nums text-muted-foreground">
                  {group.threads.length}
                </span>
              </span>
            }
          >
            <div className="rounded-lg border border-border">
              <TableHeader />
              {group.threads.map((thread) => (
                <ThreadRow key={thread.id} thread={thread} />
              ))}
            </div>
          </Section>
        );
      })}
    </div>
  );
}

const TASK_STATUS_FILTER_OPTIONS: { key: string; label: string }[] = [
  ...TASK_STATUS_ORDER.map((status) => ({ key: status, label: status })),
  { key: "no-task", label: "No task" },
];

function SectionFilterDropdown({
  options,
  hidden,
  onToggle,
}: {
  options: { key: string; label: string }[];
  hidden: Set<string>;
  onToggle: (key: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label="Filter sections"
          className="cursor-pointer"
        >
          <ListFilter className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {options.map((option) => (
          <DropdownMenuItem
            key={option.key}
            className="cursor-pointer gap-2"
            onSelect={(event) => {
              event.preventDefault();
              onToggle(option.key);
            }}
          >
            <Checkbox
              checked={!hidden.has(option.key)}
              aria-label={`Show ${option.label}`}
              className="pointer-events-none"
            />
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function WatchTowerPlaygroundPage() {
  const [groupBy, setGroupBy] = useState<"status" | "task">("status");
  const [hiddenAgentSections, setHiddenAgentSections] = useState<Set<string>>(
    new Set()
  );
  const [hiddenTaskSections, setHiddenTaskSections] = useState<Set<string>>(
    new Set()
  );

  const toggleIn =
    (setter: typeof setHiddenAgentSections) => (key: string) =>
      setter((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="px-6 py-6">
        <div className="mx-auto w-full max-w-5xl">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-semibold">Inbox</h1>
            <div className="flex items-center gap-2">
              <div className="flex items-center rounded-md border border-border p-0.5">
                <Button
                  variant={groupBy === "status" ? "secondary" : "ghost"}
                  size="sm"
                  className="h-7"
                  onClick={() => setGroupBy("status")}
                >
                  By status
                </Button>
                <Button
                  variant={groupBy === "task" ? "secondary" : "ghost"}
                  size="sm"
                  className="h-7"
                  onClick={() => setGroupBy("task")}
                >
                  By task status
                </Button>
              </div>
              <Button variant="outline" size="sm">
                All projects
                <ChevronDown className="size-3.5" />
              </Button>
              <Button variant="outline" size="sm">
                Last week
                <ChevronDown className="size-3.5" />
              </Button>
              <SectionFilterDropdown
                options={
                  groupBy === "status"
                    ? SECTIONS.map((s) => ({ key: s.status, label: s.title }))
                    : TASK_STATUS_FILTER_OPTIONS
                }
                hidden={
                  groupBy === "status" ? hiddenAgentSections : hiddenTaskSections
                }
                onToggle={toggleIn(
                  groupBy === "status"
                    ? setHiddenAgentSections
                    : setHiddenTaskSections
                )}
              />
            </div>
          </div>

          {groupBy === "status" ? (
            <StatusSections hidden={hiddenAgentSections} />
          ) : (
            <TaskStatusSections hidden={hiddenTaskSections} />
          )}
        </div>
      </div>
    </main>
  );
}

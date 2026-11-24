"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { format } from "date-fns";
import {
  AlertTriangle,
  Bot,
  ChevronDown,
  ChevronRight,
  FileText,
  GitBranch,
  GitPullRequest,
  Info,
  ListTree,
  MoreHorizontal,
  Pause,
  Play,
  Repeat,
  Signal,
  SkipForward,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import { TaskListIdentity } from "@/components/blocks/project/task-lists/task-list-identity";
import { TaskListPicker } from "@/components/blocks/project/task-lists/task-list-management";
import { matchesTaskListMenuQuery } from "@/components/blocks/project/task-lists/task-list-menu-model";
import type { TaskListItem } from "@/components/blocks/project/task-lists/task-list-types";
import type { TaskListResultsController } from "@/components/blocks/project/task-lists/use-task-list-results";
import { AgentThreadWorkStatusDot } from "@/components/blocks/tasks/agent-thread-work/agent-thread-work-status";
import { StatusDropdownMenu } from "@/components/blocks/tasks/status-dropdown-menu";
import { TaskRefWithType } from "@/components/blocks/tasks/task-ref-with-type";
import { EmptyValue, PriorityIcon, StatusBadge } from "@/components/blocks/tasks/task-table/badges";
import { EmptyState } from "@/components/custom/empty-state";
import { ThreadComposer } from "@/components/blocks/thread/thread-composer";
import { ThreadAgentSelector, type ThreadAgentSelectorAgent } from "@/components/blocks/thread/thread-agent-selector";
import { WorkingDirectorySelector, type WorkingDirectorySelectorProfile } from "@/components/blocks/thread/working-directory-selector";
import { TooltipExt } from "@/components/custom/tooltip-ext";
import { TimePickerInput } from "@/components/time-picker/time-picker-input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Pill, PillContent, PillIcon, PillMeta, PillText } from "@/components/ui/pill";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import type { Id } from "@/convex/_generated/dataModel";
import { renderCliIcon } from "@/lib/cli-runtime-ui/registry";
import { BACKLOG_SYSTEM_LIST } from "@/lib/task-lists/system-lists";
import { isClosedStatus } from "@/lib/tasks/status-policy";
import { resolveTaskTypeSummary } from "@/lib/tasks/task-types";
import { Status, type Priority } from "@/lib/tasks/types";
import { useComposerRuntimeOverrides } from "@/lib/threads/hooks/use-composer-runtime-overrides";
import { THREAD_STATUS_META } from "@/lib/threads/status-meta";
import { cn } from "@/lib/utils";
import {
  AGENTS,
  AGENT_PROMPTS,
  CLI_PROFILES,
  DEFAULT_RULE,
  KEEP_CLOSED,
  LIST_KEYS,
  LISTS,
  ME,
  MONTHS,
  PATHS,
  TIMEZONES,
  UNITS,
  UNIT_LABEL,
  WORKFLOWS,
  WORKSPACES,
  WORKSPACE_LABEL,
  WEEKDAYS,
  describeRule,
  formatSlot,
  nextSlots,
  type LastRun,
  type ListKey,
  type Note,
  type Occurrence,
  type PlainTask,
  type Rule,
  type SkipReason,
  type Template,
  type Workspace,
} from "./fixtures";

export type Selection = { kind: "template" | "occurrence" | "task"; id: string };
export type TemplateAction = "run" | "pause" | "stop" | "remove" | "delete";
export type RecurrenceDraft = Pick<Template, "rule" | "timezone" | "runner" | "agent"> &
  Required<Pick<Template, "prompt" | "runtime" | "workspace" | "workflow" | "target">>;
export type SaveRepeat = (taskId: string, draft: RecurrenceDraft) => void;

/** A recurring task creates Occurrences only while it is open and not paused. */
export function isLive(template: Template): boolean {
  return !template.paused && !isClosedStatus(template.status);
}

function Who({ assignee, agent }: { assignee: string | null; agent: string | null }) {
  if (!assignee && !agent) return <span className="text-sm text-muted-foreground">No assignee</span>;
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-sm">
      {agent ? (
        <>
          <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Bot className="size-3.5" aria-hidden="true" />
          </span>
          <span className="truncate">{agent}</span>
        </>
      ) : null}
      {assignee ? (
        <>
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium">
            {assignee[0]}
          </span>
          {agent ? null : <span className="truncate">{assignee}</span>}
        </>
      ) : null}
    </span>
  );
}

function ListValue({ listKey }: { listKey: ListKey }) {
  return <TaskListIdentity list={LISTS[listKey]} size="compact" className="text-sm [&_svg]:size-3" />;
}

/** The real Runs cell: a CLI badge with the thread's status dot, or a dash. */
function RunsCell({ thread }: { thread: Occurrence["thread"] }) {
  if (!thread) return <EmptyValue />;
  return (
    <span
      className="relative flex size-5 shrink-0 items-center justify-center rounded-full bg-background"
      title={`${thread.title} · ${THREAD_STATUS_META[thread.state].label}`}
    >
      {renderCliIcon("claude-code", "size-3")}
      <AgentThreadWorkStatusDot status={thread.state} className="absolute right-0 bottom-0 size-1.5" />
    </span>
  );
}

/** `when` adds the slot time; the still-open case reads complete without it. */
const SKIP_COPY: Record<SkipReason, (template: Template, run: LastRun) => { text: string; warn: boolean; when: boolean }> = {
  late: () => ({ text: "Skipped, spawner was late", warn: false, when: true }),
  previous_open: (_, run) => ({ text: `Skipped, ${run.ref} is still open`, warn: false, when: false }),
  runner_unavailable: (template) => ({ text: template.runnerProblem ?? "Runner unavailable", warn: true, when: true }),
};

function LastRunValue({ template, now }: { template: Template; now: Date }) {
  const run = template.lastRun;
  if (!run) return <EmptyValue />;
  if (run.outcome === "spawned") {
    return (
      <span className="truncate text-sm">
        Created {run.ref} <span className="text-muted-foreground">· {formatSlot(run.slot, now)}</span>
      </span>
    );
  }
  const { text, warn, when } = SKIP_COPY[run.reason](template, run);
  const Icon = warn ? AlertTriangle : SkipForward;
  return (
    <span
      className="flex min-w-0 items-center gap-1.5 text-sm"
      title={`${text}. ${template.skipped} ${template.skipped === 1 ? "slot" : "slots"} skipped since the last occurrence.`}
    >
      <Icon className={cn("size-3.5 shrink-0", warn ? "text-warning" : "text-muted-foreground")} aria-hidden="true" />
      <span className="truncate">
        {text} {when ? <span className="text-muted-foreground">· {formatSlot(run.slot, now)}</span> : null}
      </span>
    </span>
  );
}

function NextValue({ template, now }: { template: Template; now: Date }) {
  if (isClosedStatus(template.status)) return <span className="text-sm text-muted-foreground">Stopped</span>;
  if (template.paused) {
    return (
      <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Pause className="size-3.5" aria-hidden="true" /> Paused
      </span>
    );
  }
  const [next] = nextSlots(template.rule, now, 1);
  return <span className="truncate text-sm">{next ? formatSlot(next, now) : "—"}</span>;
}

function TemplateMenu({ template, onAction }: { template: Template; onAction: (action: TemplateAction) => void }) {
  const closed = isClosedStatus(template.status);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${template.ref}`} onClick={(event) => event.stopPropagation()}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44" onClick={(event) => event.stopPropagation()}>
        <DropdownMenuItem disabled={closed} onSelect={() => onAction("run")}>
          Run now
        </DropdownMenuItem>
        <DropdownMenuItem disabled={closed} onSelect={() => onAction("pause")}>
          {template.paused ? "Resume" : "Pause"}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction("stop")}>{closed ? "Reopen" : "Mark done"}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction("remove")}>Remove repeat</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => onAction("delete")}>
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function rowProps(selected: boolean, onOpen: () => void) {
  return {
    role: "button",
    tabIndex: 0,
    "data-state": selected ? "selected" : undefined,
    onClick: onOpen,
    onKeyDown: (event: KeyboardEvent) => {
      if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) onOpen();
    },
  };
}

const ROW_CLASS = "h-11 cursor-pointer border-b border-border transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted";
/** The real table's columns: Task, Status, Runs, Priority, Assignee, Due date. */
const TREE_COLUMNS = "grid grid-cols-[minmax(0,1fr)_7.5rem_2.5rem_2.5rem_11rem_9rem] items-center gap-3 px-4";

function TaskName({ refId, typeKey, name, closed }: { refId: string; typeKey: string; name: string; closed: boolean }) {
  return (
    <>
      <TaskRefWithType
        refId={refId}
        taskType={resolveTaskTypeSummary(typeKey)}
        refInteractive={false}
        className="shrink-0 gap-1.5"
        refClassName="text-muted-foreground"
      />
      <span className={cn("truncate", closed && "text-muted-foreground line-through")}>{name}</span>
    </>
  );
}

/** "↻ OS-2511" on an Occurrence that is not shown under its recurring task. */
function OccurrenceOf({ template, onOpen, className }: { template: Template; onOpen: () => void; className?: string }) {
  return (
    <TooltipExt content={`Occurrence of ${template.ref}, ${describeRule(template.rule).toLowerCase()}. Open the recurring task.`}>
      <button
        type="button"
        aria-label={`Open recurring task ${template.ref}`}
        className={cn(
          "flex shrink-0 cursor-pointer items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground",
          className
        )}
        onClick={(event) => {
          event.stopPropagation();
          onOpen();
        }}
      >
        <Repeat className="size-3" aria-hidden="true" />
        {template.ref}
      </button>
    </TooltipExt>
  );
}

/** A list as a tree: Occurrences sit under their recurring task as subtasks, or at the top level when created in this list. */
export function TaskTreeView({
  templates,
  allTemplates,
  occurrences,
  tasks,
  now,
  selectedId,
  onSelect,
  onSaveRepeat,
  onAction,
}: {
  templates: Template[];
  /** Every recurring task in the project: a top-level Occurrence's one may live in another list. */
  allTemplates: Template[];
  occurrences: Occurrence[];
  tasks: PlainTask[];
  now: Date;
  selectedId: string | null;
  onSelect: (selection: Selection) => void;
  onSaveRepeat: SaveRepeat;
  onAction: (template: Template, action: TemplateAction) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(templates.slice(1).map((template) => template.id)));
  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <div className="min-w-[860px] text-sm">
      <div className={cn(TREE_COLUMNS, "h-10 border-b border-border font-medium")}>
        <span>Task</span>
        <span>Status</span>
        <span>Runs</span>
        <Signal className="size-3.5 text-muted-foreground" aria-label="Priority" />
        <span>Assignee</span>
        <span>Due date</span>
      </div>
      {/* Created in this list: normal top-level tasks, newest on top. */}
      {occurrences.map((occurrence) => {
        const template = occurrence.list ? allTemplates.find((candidate) => candidate.id === occurrence.templateId) : undefined;
        if (!template) return null;
        return (
          <div
            key={occurrence.id}
            {...rowProps(occurrence.id === selectedId, () => onSelect({ kind: "occurrence", id: occurrence.id }))}
            className={cn(TREE_COLUMNS, ROW_CLASS)}
          >
            <span className="flex min-w-0 items-center gap-2 pl-6">
              <TaskName
                refId={occurrence.ref}
                typeKey={template.typeKey}
                name={occurrence.name}
                closed={isClosedStatus(occurrence.status)}
              />
              <OccurrenceOf template={template} onOpen={() => onSelect({ kind: "template", id: template.id })} />
            </span>
            <span>
              <StatusBadge status={occurrence.status} />
            </span>
            <RunsCell thread={occurrence.thread} />
            <PriorityIcon priority={template.priority} />
            <Who assignee={template.assignee} agent={template.agent} />
            <span className="truncate">{formatSlot(occurrence.slot, now)}</span>
          </div>
        );
      })}
      {templates.map((template) => {
        const open = !collapsed.has(template.id);
        const shown = occurrences.filter((occurrence) => occurrence.templateId === template.id && !occurrence.list);
        const Chevron = open ? ChevronDown : ChevronRight;
        return (
          <div key={template.id}>
            <div
              {...rowProps(template.id === selectedId, () => onSelect({ kind: "template", id: template.id }))}
              className={cn(TREE_COLUMNS, ROW_CLASS)}
            >
              <span className="flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  aria-label={open ? `Collapse ${template.ref}` : `Expand ${template.ref}`}
                  aria-expanded={open}
                  className="-ml-1 flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-muted"
                  onClick={(event) => {
                    event.stopPropagation();
                    toggle(template.id);
                  }}
                >
                  <Chevron className="size-3.5" />
                </button>
                <TaskName refId={template.ref} typeKey={template.typeKey} name={template.name} closed={isClosedStatus(template.status)} />
                <RepeatChip template={template} now={now} onSave={onSaveRepeat} onAction={(action) => onAction(template, action)} />
              </span>
              <span>
                <StatusBadge status={template.status} />
              </span>
              <EmptyValue />
              <PriorityIcon priority={template.priority} />
              <Who assignee={template.assignee} agent={template.agent} />
              <EmptyValue />
            </div>
            {open ? (
              <>
                {shown.map((occurrence) => (
                  <div
                    key={occurrence.id}
                    {...rowProps(occurrence.id === selectedId, () => onSelect({ kind: "occurrence", id: occurrence.id }))}
                    className={cn(TREE_COLUMNS, ROW_CLASS)}
                  >
                    <span className="flex min-w-0 items-center gap-2 pl-8">
                      <TaskName
                        refId={occurrence.ref}
                        typeKey={template.typeKey}
                        name={occurrence.name}
                        closed={isClosedStatus(occurrence.status)}
                      />
                    </span>
                    <span>
                      <StatusBadge status={occurrence.status} />
                    </span>
                    <RunsCell thread={occurrence.thread} />
                    <PriorityIcon priority={template.priority} />
                    <Who assignee={template.assignee} agent={template.agent} />
                    <span className="truncate">{formatSlot(occurrence.slot, now)}</span>
                  </div>
                ))}
                {template.subtasks.map((name) => (
                  <div key={name} className={cn(TREE_COLUMNS, "h-11 border-b border-border text-muted-foreground")}>
                    <span className="flex min-w-0 items-center gap-2 pl-8">
                      <StatusBadge status={Status.TODO} variant="compact" />
                      <span className="truncate">{name}</span>
                    </span>
                  </div>
                ))}
              </>
            ) : null}
          </div>
        );
      })}
      {tasks.map((task) => (
        <div
          key={task.id}
          {...rowProps(task.id === selectedId, () => onSelect({ kind: "task", id: task.id }))}
          className={cn(TREE_COLUMNS, ROW_CLASS)}
        >
          <span className="flex min-w-0 items-center gap-2 pl-6">
            <TaskName refId={task.ref} typeKey={task.typeKey} name={task.name} closed={isClosedStatus(task.status)} />
          </span>
          <span>
            <StatusBadge status={task.status} />
          </span>
          <EmptyValue />
          <PriorityIcon priority={task.priority} />
          <Who assignee={task.assignee} agent={task.agent} />
          <EmptyValue />
        </div>
      ))}
    </div>
  );
}

const BOARD_STATUSES = [Status.TODO, Status.IN_PROGRESS, Status.IN_REVIEW, Status.DONE] as const;

/** The board shows work: Occurrences get their own cards, and the recurring task itself has none. */
export function BoardView({
  templates,
  occurrences,
  tasks,
  now,
  selectedId,
  onSelect,
}: {
  templates: Template[];
  occurrences: Occurrence[];
  tasks: PlainTask[];
  now: Date;
  selectedId: string | null;
  onSelect: (selection: Selection) => void;
}) {
  const templateById = new Map(templates.map((template) => [template.id, template]));
  const cards = [
    ...occurrences.flatMap((occurrence) => {
      const template = templateById.get(occurrence.templateId);
      return template
        ? [
            {
              kind: "occurrence" as const,
              id: occurrence.id,
              ref: occurrence.ref,
              name: occurrence.name,
              status: occurrence.status,
              typeKey: template.typeKey,
              assignee: template.assignee,
              agent: template.agent,
              occurrence,
              template,
            },
          ]
        : [];
    }),
    ...tasks.map((task) => ({
      kind: "task" as const,
      id: task.id,
      ref: task.ref,
      name: task.name,
      status: task.status,
      typeKey: task.typeKey,
      assignee: task.assignee,
      agent: task.agent,
      occurrence: undefined,
      template: undefined,
    })),
  ];
  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
      {BOARD_STATUSES.map((status) => {
        const column = cards.filter((card) => card.status === status);
        return (
          <div key={status} className="flex w-72 shrink-0 flex-col rounded-lg bg-muted/40">
            <div className="flex h-10 shrink-0 items-center gap-2 px-3 text-sm font-medium">
              <StatusBadge status={status} variant="compact" />
              {status}
              <span className="text-xs font-normal text-muted-foreground">{column.length}</span>
            </div>
            <div className="flex flex-col gap-2 px-2 pb-2">
              {column.map((card) => (
                <div
                  key={card.id}
                  {...rowProps(card.id === selectedId, () => onSelect({ kind: card.kind, id: card.id }))}
                  className="flex cursor-pointer flex-col gap-2 rounded-md border border-border bg-card p-3 text-sm transition-colors hover:border-foreground/20 data-[state=selected]:border-foreground/40"
                >
                  <span className="flex items-center gap-2">
                    <TaskRefWithType
                      refId={card.ref}
                      taskType={resolveTaskTypeSummary(card.typeKey)}
                      refInteractive={false}
                      className="shrink-0 gap-1.5"
                      refClassName="text-xs text-muted-foreground"
                    />
                    {card.template ? (
                      <OccurrenceOf
                        template={card.template}
                        className="ml-auto"
                        onOpen={() => onSelect({ kind: "template", id: card.template.id })}
                      />
                    ) : null}
                  </span>
                  <span className="leading-5">{card.name}</span>
                  <span className="flex items-center justify-between gap-2">
                    <Who assignee={card.assignee} agent={card.agent} />
                    {card.occurrence?.thread ? <RunsCell thread={card.occurrence.thread} /> : null}
                  </span>
                  {card.occurrence ? (
                    <span className="text-xs text-muted-foreground">Due {formatSlot(card.occurrence.slot, now)}</span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const RECURRING_COLUMNS =
  "grid grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_9.5rem_minmax(0,1.7fr)_minmax(0,1.2fr)_minmax(0,0.9fr)_4.5rem] items-center gap-3 px-4";

/** The Recurring filter: every recurring task in the project, wherever it lives. */
export function RecurringFilterView({
  templates,
  now,
  selectedId,
  onSelect,
  onAction,
  onSaveRepeat,
}: {
  templates: Template[];
  now: Date;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAction: (template: Template, action: TemplateAction) => void;
  onSaveRepeat: SaveRepeat;
}) {
  if (templates.length === 0) {
    return (
      <EmptyState
        fill
        icon={Repeat}
        title="No recurring tasks"
        description="Open any task and set Repeat. Copies of it then appear on schedule, under it or in a list you pick."
      />
    );
  }
  return (
    <div className="min-w-[980px] text-sm">
      <div className={cn(RECURRING_COLUMNS, "h-10 border-b border-border font-medium")}>
        <span>Task</span>
        <span>Repeats</span>
        <span>Next</span>
        <span>Last run</span>
        <span>Assignee</span>
        <span>List</span>
        <span />
      </div>
      {templates.map((template) => {
        const closed = isClosedStatus(template.status);
        return (
          <div
            key={template.id}
            {...rowProps(template.id === selectedId, () => onSelect(template.id))}
            className={cn(RECURRING_COLUMNS, ROW_CLASS)}
          >
            <span className="flex min-w-0 items-center gap-2">
              <TaskName refId={template.ref} typeKey={template.typeKey} name={template.name} closed={closed} />
            </span>
            <span className="flex min-w-0">
              <RepeatChip
                template={template}
                className="shrink"
                now={now}
                onSave={onSaveRepeat}
                onAction={(action) => onAction(template, action)}
              />
            </span>
            <NextValue template={template} now={now} />
            <LastRunValue template={template} now={now} />
            {template.runner ? (
              <TooltipExt content={`Runs on ${template.runner.profile}, as ${template.runner.user}`}>
                <span className="min-w-0">
                  <Who assignee={template.assignee} agent={template.agent} />
                </span>
              </TooltipExt>
            ) : (
              <Who assignee={template.assignee} agent={template.agent} />
            )}
            <ListValue listKey={template.list} />
            <span className="flex items-center justify-end gap-1.5">
              <TooltipExt content={closed ? "Stopped" : template.paused ? "Resume" : "Pause"}>
                {/* The span takes the tooltip's data-state, which would otherwise overwrite the switch's. */}
                <span className="flex items-center">
                  <Switch
                    size="sm"
                    aria-label={`${template.ref} is active`}
                    className="cursor-pointer"
                    disabled={closed}
                    checked={isLive(template)}
                    onClick={(event) => event.stopPropagation()}
                    onCheckedChange={() => onAction(template, "pause")}
                  />
                </span>
              </TooltipExt>
              <TemplateMenu template={template} onAction={(action) => onAction(template, action)} />
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Field({ label, children, align = "center" }: { label: string; children: ReactNode; align?: "center" | "start" }) {
  return (
    <div className={cn("flex gap-4", align === "center" ? "items-center" : "items-start")}>
      <span className={cn("w-24 shrink-0 text-sm whitespace-nowrap text-muted-foreground", align === "start" && "pt-0.5")}>{label}</span>
      <div className="min-w-0 flex-1 text-sm">{children}</div>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        {hint}
      </div>
      {children}
    </div>
  );
}

function Notes({ notes, empty }: { notes: Note[]; empty: string }) {
  if (notes.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {notes.map((note) => (
        <Pill key={note.name} className="max-w-[260px] pr-2">
          <PillContent>
            <PillIcon>
              <FileText className="size-4 text-muted-foreground" />
            </PillIcon>
            <PillText>{note.name}</PillText>
            <PillMeta variant="badge" className="mt-px">
              {note.updated}
            </PillMeta>
          </PillContent>
        </Pill>
      ))}
    </div>
  );
}

function Subtasks({ names }: { names: string[] }) {
  return (
    <Section title="Subtasks">
      {names.length === 0 ? (
        <p className="text-sm text-muted-foreground">No subtasks</p>
      ) : (
        <div className="space-y-1.5">
          {names.map((name) => (
            <div key={name} className="flex items-center gap-2 text-sm">
              <StatusBadge status={Status.TODO} variant="compact" />
              <span className="truncate">{name}</span>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function CommonFields({
  parent,
  parentLabel = "Parent",
  list,
  typeKey,
  status,
  priority,
  assignee,
  agent,
  onStatusChange,
}: {
  parent?: ReactNode;
  parentLabel?: string;
  list: ListKey;
  typeKey: string;
  status: Status;
  priority: Priority;
  assignee: string | null;
  agent: string | null;
  onStatusChange: (status: Status) => void;
}) {
  return (
    <>
      {parent ? <Field label={parentLabel}>{parent}</Field> : null}
      <Field label="List">
        <ListValue listKey={list} />
      </Field>
      <Field label="Type">
        <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-1.5 py-0.5 text-xs font-medium">
          {resolveTaskTypeSummary(typeKey).name}
        </span>
      </Field>
      <Field label="Status">
        <StatusDropdownMenu
          status={status}
          onStatusChange={onStatusChange}
          align="start"
          trigger={
            <button type="button" className="flex cursor-pointer items-center gap-2 text-sm hover:opacity-80">
              <StatusBadge status={status} />
            </button>
          }
        />
      </Field>
      <Field label="Priority">
        <span className="flex items-center gap-2">
          <PriorityIcon priority={priority} />
          {priority}
        </span>
      </Field>
      <Field label="Assignee">
        <span className="flex items-center gap-2">
          <Who assignee={assignee} agent={agent} />
          {agent && assignee ? <span className="text-muted-foreground">{assignee}</span> : null}
        </span>
      </Field>
    </>
  );
}

function SidebarShell({
  refId,
  name,
  closed,
  titleIcon,
  headerActions,
  onClose,
  children,
}: {
  refId: string;
  name: string;
  closed: boolean;
  titleIcon?: ReactNode;
  headerActions?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <aside className="flex w-[440px] shrink-0 flex-col border-l border-border">
      <div className="flex h-[41px] shrink-0 items-center justify-end gap-1 border-b border-border px-2">
        {headerActions}
        <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
          <X />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
        <div>
          <span className="mb-2 block text-xs text-muted-foreground">{refId}</span>
          <h2 className={cn("text-xl font-semibold", closed && "text-muted-foreground line-through")}>
            {name}
            {titleIcon}
          </h2>
        </div>
        {children}
      </div>
    </aside>
  );
}

const linkRowClass =
  "-ml-1 flex min-w-0 cursor-pointer items-center gap-1.5 rounded-sm px-1 py-0.5 text-left text-sm transition-opacity hover:opacity-80";

/** A recurring task's detail: the usual fields plus Repeat, Next, Last run and its Occurrences. */
export function TemplateSidebar({
  template,
  occurrences,
  now,
  onAction,
  onSaveRepeat,
  onStatusChange,
  onOpenOccurrence,
  onClose,
}: {
  template: Template;
  occurrences: Occurrence[];
  now: Date;
  onAction: (action: TemplateAction) => void;
  onSaveRepeat: SaveRepeat;
  onStatusChange: (status: Status) => void;
  onOpenOccurrence: (id: string) => void;
  onClose: () => void;
}) {
  const closed = isClosedStatus(template.status);
  return (
    <SidebarShell
      refId={template.ref}
      name={template.name}
      closed={closed}
      onClose={onClose}
      titleIcon={
        <TooltipExt content="Recurring task">
          <Repeat className="ml-2 inline size-4 align-baseline text-muted-foreground" aria-label="Recurring task" />
        </TooltipExt>
      }
      headerActions={
        <>
          <Button variant="ghost" size="sm" disabled={closed} onClick={() => onAction("run")}>
            <Play /> Run now
          </Button>
          <TemplateMenu template={template} onAction={onAction} />
        </>
      }
    >
      <div className="space-y-4">
        <CommonFields
          list={template.list}
          typeKey={template.typeKey}
          status={template.status}
          priority={template.priority}
          assignee={template.assignee}
          agent={template.agent}
          onStatusChange={onStatusChange}
        />
        <Field label="Repeat">
          <RepeatPopover subject={template} now={now} onSave={onSaveRepeat} onAction={onAction}>
            <button type="button" className={linkRowClass}>
              <Repeat className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="shrink-0">{describeRule(template.rule)}</span>
              <span className="truncate text-muted-foreground">{template.timezone}</span>
            </button>
          </RepeatPopover>
        </Field>
        {template.target ? (
          <Field label="Create in">
            <ListValue listKey={template.target} />
          </Field>
        ) : null}
        <Field label="Next">
          <span className="flex items-center gap-2">
            <NextValue template={template} now={now} />
            {template.paused && !closed ? (
              <Button variant="outline" size="xs" onClick={() => onAction("pause")}>
                Resume
              </Button>
            ) : null}
            {closed ? <span className="text-xs text-muted-foreground">Reopen the task to continue.</span> : null}
          </span>
        </Field>
        <Field label="Last run">
          <LastRunValue template={template} now={now} />
        </Field>
        {template.runner ? (
          <Field label="Runs on" align="start">
            <span className={cn("block truncate", template.runnerProblem && "text-muted-foreground line-through")}>
              {template.runner.profile} · {template.runner.path}
            </span>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {[`as ${template.runner.user}`, template.workspace === "worktree" ? "new worktree" : null, template.workflow]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </Field>
        ) : null}
      </div>

      {template.runnerProblem ? (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-warning-foreground">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <div className="flex-1">
            <p>{template.runnerProblem}. Nothing is created until you pick a runner.</p>
            <RepeatPopover subject={template} now={now} onSave={onSaveRepeat} onAction={onAction}>
              <Button variant="outline" size="xs" className="mt-2">
                Pick a runner
              </Button>
            </RepeatPopover>
          </div>
        </div>
      ) : null}

      {template.description ? <p className="text-sm leading-6">{template.description}</p> : null}

      <Subtasks names={template.subtasks} />

      <Section
        title="Occurrences"
        hint={
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="About older occurrences"
                className="flex size-5 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Info className="size-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 p-3 text-xs text-muted-foreground">
              The {KEEP_CLOSED} most recent closed occurrences are kept. When a new one is created, older ones move to Archived.
            </PopoverContent>
          </Popover>
        }
      >
        {occurrences.length === 0 ? (
          <p className="text-sm text-muted-foreground">No occurrences yet</p>
        ) : (
          <div className="-mx-1">
            {occurrences.map((occurrence) => (
              <button
                key={occurrence.id}
                type="button"
                onClick={() => onOpenOccurrence(occurrence.id)}
                className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-1 py-1.5 text-left text-sm hover:bg-muted/50"
              >
                <StatusBadge status={occurrence.status} variant="compact" srLabel={occurrence.status} />
                <span className="w-16 shrink-0 text-muted-foreground">{occurrence.ref}</span>
                <span className="min-w-0 flex-1 truncate">{formatSlot(occurrence.slot, now)}</span>
                {occurrence.thread ? <AgentThreadWorkStatusDot status={occurrence.thread.state} /> : null}
              </button>
            ))}
          </div>
        )}
      </Section>
    </SidebarShell>
  );
}

/** An Occurrence: a subtask of the recurring task or a task in the list it names, with a link to the occurrence before it. */
export function OccurrenceSidebar({
  occurrence,
  template,
  previous,
  isLatest,
  now,
  onStatusChange,
  onOpenTemplate,
  onOpenOccurrence,
  onClose,
}: {
  occurrence: Occurrence;
  template: Template;
  previous: Occurrence | undefined;
  isLatest: boolean;
  now: Date;
  onStatusChange: (status: Status) => void;
  onOpenTemplate: () => void;
  onOpenOccurrence: (id: string) => void;
  onClose: () => void;
}) {
  const closed = isClosedStatus(occurrence.status);
  const blocks = isLatest && !closed && isLive(template);
  return (
    <SidebarShell refId={occurrence.ref} name={occurrence.name} closed={closed} onClose={onClose}>
      <div className="space-y-4">
        <CommonFields
          parent={
            <button type="button" className={linkRowClass} onClick={onOpenTemplate}>
              <Repeat className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="shrink-0 text-muted-foreground">{template.ref}</span>
              <span className="truncate">{describeRule(template.rule)}</span>
            </button>
          }
          parentLabel={occurrence.list ? "Recurring task" : "Parent"}
          list={occurrence.list ?? template.list}
          typeKey={template.typeKey}
          status={occurrence.status}
          priority={template.priority}
          assignee={template.assignee}
          agent={template.agent}
          onStatusChange={onStatusChange}
        />
        <Field label="Threads" align="start">
          {occurrence.thread ? (
            <span className="flex min-w-0 items-center gap-2">
              <AgentThreadWorkStatusDot status={occurrence.thread.state} />
              <span className="truncate">{occurrence.thread.title}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">No threads</span>
          )}
        </Field>
        <Field label="Due date">{formatSlot(occurrence.slot, now)}</Field>
        <Field label="Last occurrence">
          {previous ? (
            <button type="button" className={linkRowClass} onClick={() => onOpenOccurrence(previous.id)}>
              <StatusBadge status={previous.status} variant="compact" srLabel={previous.status} />
              <span className="shrink-0 text-muted-foreground">{previous.ref}</span>
              <span className="truncate">{formatSlot(previous.slot, now)}</span>
            </button>
          ) : (
            <EmptyValue />
          )}
        </Field>
        {occurrence.pr ? (
          <Field label="Links">
            <span className="flex min-w-0 items-center gap-1.5">
              <GitPullRequest className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="truncate">{occurrence.pr}</span>
            </span>
          </Field>
        ) : null}
        <Field label="Created">
          <span className="text-muted-foreground">
            {occurrence.runNow ? "by Run now" : "on schedule"}, {format(occurrence.slot, "MMM d, HH:mm")}
          </span>
        </Field>
      </div>

      {template.description ? <p className="text-sm leading-6">{template.description}</p> : null}

      <Subtasks names={template.subtasks} />

      <Section title="Artifacts">
        <Notes notes={occurrence.artifacts} empty="No artifacts" />
      </Section>

      {blocks && template.skipped > 0 ? (
        <Section title="Activity">
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <SkipForward className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            The next occurrence of {template.ref} was skipped because this task is still open.
          </p>
        </Section>
      ) : null}
    </SidebarShell>
  );
}

/** A plain task: the Repeat row turns it into a recurring task where it is. */
export function PlainTaskSidebar({
  task,
  now,
  onStatusChange,
  onSaveRepeat,
  onClose,
}: {
  task: PlainTask;
  now: Date;
  onStatusChange: (status: Status) => void;
  onSaveRepeat: SaveRepeat;
  onClose: () => void;
}) {
  return (
    <SidebarShell refId={task.ref} name={task.name} closed={isClosedStatus(task.status)} onClose={onClose}>
      <div className="space-y-4">
        <CommonFields
          list={task.list}
          typeKey={task.typeKey}
          status={task.status}
          priority={task.priority}
          assignee={task.assignee}
          agent={task.agent}
          onStatusChange={onStatusChange}
        />
        <Field label="Threads">
          <span className="text-muted-foreground">No threads</span>
        </Field>
        <Field label="Due date">
          <span className="text-muted-foreground">Pick a date</span>
        </Field>
        <Field label="Repeat">
          <RepeatPopover subject={task} now={now} onSave={onSaveRepeat}>
            <button type="button" className={cn(linkRowClass, "text-muted-foreground")}>
              <Repeat className="size-3.5 shrink-0" aria-hidden="true" />
              Does not repeat
            </button>
          </RepeatPopover>
        </Field>
      </div>
      {task.description ? <p className="text-sm leading-6">{task.description}</p> : null}
      <Subtasks names={[]} />
    </SidebarShell>
  );
}

function FormRow({ label, tight, children }: { label: string; tight?: boolean; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-start gap-x-4">
      <span className="pt-1.5 text-sm text-muted-foreground">{label}</span>
      <div className={cn("flex min-w-0 flex-wrap items-center", tight ? "gap-1" : "gap-2")}>{children}</div>
    </div>
  );
}

type RepeatProps = {
  /** A recurring task, or a plain task about to become one. */
  subject: Template | PlainTask;
  now: Date;
  onSave: SaveRepeat;
  onAction?: (action: TemplateAction) => void;
};

/** The repeat indicator on a row. Clicking it opens the repeat dropdown. */
function RepeatChip({ template, className, ...props }: Omit<RepeatProps, "subject"> & { template: Template; className?: string }) {
  const Icon = template.paused ? Pause : Repeat;
  return (
    <RepeatPopover subject={template} {...props}>
      <button
        type="button"
        aria-label={`Repeat: ${describeRule(template.rule)}`}
        className={cn(
          "flex min-w-0 shrink-0 cursor-pointer items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground data-[state=open]:text-foreground",
          !isLive(template) && "opacity-60",
          className
        )}
      >
        <Icon className="size-3 shrink-0" aria-hidden="true" />
        <span className="truncate">{describeRule(template.rule)}</span>
        {template.runnerProblem ? <AlertTriangle className="size-3 shrink-0 text-warning" aria-label="Runner unavailable" /> : null}
      </button>
    </RepeatPopover>
  );
}

/** The one place to see and change a Recurrence: opens from the chip and from the sidebar's Repeat row. */
function RepeatPopover({ children, ...props }: RepeatProps & { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild onClick={(event) => event.stopPropagation()}>
        {children}
      </PopoverTrigger>
      {/* Clicks bubble through the portal to the row, so stop them here. */}
      <PopoverContent
        align="start"
        className="max-h-(--radix-popover-content-available-height) w-[32rem] gap-3 overflow-y-auto p-3"
        onClick={(event) => event.stopPropagation()}
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <RepeatEditor {...props} onDone={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

/** A compact single-choice dropdown. `icon` gives it the look of the composer bar's selectors. */
function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
  icon: Icon,
  active = false,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  className?: string;
  icon?: LucideIcon;
  /** Composer bar only: tints the icon when the choice is not the default. */
  active?: boolean;
}) {
  const current = options.find((option) => option.value === value)?.label;
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant={Icon ? "ghost" : "outline"}
          size="sm"
          aria-label={Icon ? `${label}: ${current}` : label}
          title={Icon ? `${label}: ${current}` : undefined}
          className={cn("min-w-0 cursor-pointer gap-1.5", Icon ? "shrink" : "justify-between font-normal", className)}
        >
          {Icon ? <Icon className={cn("size-3.5 shrink-0", active ? "text-info" : "opacity-70")} /> : null}
          <span className={cn("truncate", Icon && !active && "text-muted-foreground")}>{current}</span>
          <ChevronDown className="size-3 shrink-0 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className={cn("max-h-64 overflow-y-auto", Icon && "min-w-44")}>
        <DropdownMenuRadioGroup value={value} onValueChange={(next) => onChange(next as T)}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Hour and minute as the due date picker's inputs: type digits or use the arrow keys. */
function TimeField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const hourRef = useRef<HTMLInputElement>(null);
  const minuteRef = useRef<HTMLInputElement>(null);
  const [hours, minutes] = value.split(":").map(Number);
  const date = new Date(2000, 0, 1, hours, minutes);
  const setDate = (next: Date | undefined) => {
    if (next) onChange(format(next, "HH:mm"));
  };
  return (
    <span className="flex items-center gap-1">
      <TimePickerInput
        ref={hourRef}
        id="repeat-hour"
        picker="hours"
        aria-label="Hour"
        className="h-7 w-10"
        date={date}
        setDate={setDate}
        onRightFocus={() => minuteRef.current?.focus()}
      />
      <span className="text-sm text-muted-foreground">:</span>
      <TimePickerInput
        ref={minuteRef}
        id="repeat-minute"
        picker="minutes"
        aria-label="Minute"
        className="h-7 w-10"
        date={date}
        setDate={setDate}
        onLeftFocus={() => hourRef.current?.focus()}
      />
    </span>
  );
}

/** Days a month can have, counting Feb 29. */
const daysIn = (month: number) => new Date(2024, month + 1, 0).getDate();
const dayOptions = (count: number) => Array.from({ length: count }, (_, index) => ({ value: String(index + 1), label: String(index + 1) }));
const MONTH_OPTIONS = MONTHS.map((label, index) => ({ value: String(index), label }));
const TIMEZONE_OPTIONS = TIMEZONES.map((timezone) => ({ value: timezone, label: timezone }));

// The list selector's rows. Keys double as ids and, upper-cased, as refs. Backlog is the selector's own row.
const LIST_ITEMS = LIST_KEYS.flatMap((key): TaskListItem[] => {
  const list = LISTS[key];
  if (list.type !== "list") return [];
  const user = ME as Id<"users">;
  return [
    {
      ...list,
      _id: key as Id<"taskLists">,
      _creationTime: 0,
      projectId: "playground" as Id<"projects">,
      ref: key.toUpperCase(),
      isArchived: false,
      isDefault: key === "inbox",
      isPinned: false,
      createdBy: user,
      updatedBy: user,
      createdAt: 0,
      updatedAt: 0,
    },
  ];
});

/** "Create in": the real list selector, set up like the task sidebar's List field, plus one row for subtasks. */
function CreateIn({ value, onChange }: { value: ListKey | null; onChange: (value: ListKey | null) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const resetQuery = () => setQuery("");
  const results: TaskListResultsController = {
    query,
    setQuery,
    resetQuery,
    results: LIST_ITEMS.filter((list) => matchesTaskListMenuQuery(list, query.trim().toLocaleLowerCase())),
    isLoading: false,
    isLoadingMore: false,
    activeListLimitReached: false,
    hasMore: false,
    loadMore: () => {},
  };
  const pick = (next: ListKey | null) => {
    onChange(next);
    setOpen(false);
  };
  return (
    <DropdownMenu
      modal={false}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) resetQuery();
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label="Create in"
          className="min-w-0 flex-1 cursor-pointer justify-between gap-1.5 font-normal"
        >
          {value ? <ListValue listKey={value} /> : <UnderThisTask />}
          <ChevronDown className="size-3 shrink-0 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48 p-2">
        {/* The build adds this row inside the shared picker, so search and arrow keys reach it. */}
        <button
          type="button"
          className={cn(
            "flex w-full cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
            value === null && "bg-muted"
          )}
          onClick={() => pick(null)}
        >
          <UnderThisTask />
        </button>
        <div role="separator" className="-mx-2 my-2 h-px bg-border" />
        <TaskListPicker
          resultsController={results}
          selectedListRef={value?.toUpperCase() ?? null}
          isBacklogSelected={value === "backlog"}
          showRowActions={false}
          // Archived is not a place to create work, and lists are not created from here.
          disabledRows={{ system: (key) => key !== BACKLOG_SYSTEM_LIST.key, create: true }}
          onSelectBacklog={() => pick("backlog")}
          onSelectList={(list) => pick(LIST_KEYS.find((key) => key === list._id) ?? null)}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UnderThisTask() {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <ListTree className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="truncate">Under this task</span>
    </span>
  );
}

const NOOP_SUBMIT = () => {};
const NO_WORKFLOW = "none";
const WORKFLOW_OPTIONS = [{ value: NO_WORKFLOW, label: "Workflow" }, ...WORKFLOWS.map((name) => ({ value: name, label: name }))];
const WORKSPACE_OPTIONS: { value: Workspace; label: string }[] = WORKSPACES.map((value) => ({ value, label: WORKSPACE_LABEL[value] }));
const AGENT_OPTIONS: ThreadAgentSelectorAgent[] = AGENTS.map((name, index) => ({
  _id: name,
  name,
  appearance: { color: ["#6366f1", "#0ea5e9", "#f59e0b"][index % 3] },
}));
// Profile names and paths double as ids here. No git remote: the worktree picker calls the CLI, so fixtures leave it out.
const PROFILE_OPTIONS: WorkingDirectorySelectorProfile[] = CLI_PROFILES.map((name, index) => ({
  _id: name as Id<"cliProfiles">,
  name,
  hostname: `${name}.local`,
  isOnline: index === 0,
  paths: PATHS.map((path) => ({ id: path, path, label: path.split("/").at(-1) ?? path })),
}));

function RepeatEditor({ subject, now, onSave, onAction, onDone }: RepeatProps & { onDone: () => void }) {
  const template = "rule" in subject ? subject : undefined;
  const me = ME;
  const [draft, setDraft] = useState<RecurrenceDraft>(() => ({
    rule: template?.rule ?? DEFAULT_RULE,
    timezone: template?.timezone ?? TIMEZONES[0],
    runner: template?.runner ?? { profile: CLI_PROFILES[0], path: PATHS[0], user: me },
    agent: subject.agent,
    prompt: template?.prompt ?? (subject.agent ? (AGENT_PROMPTS[subject.agent] ?? "") : ""),
    runtime: template?.runtime ?? {},
    workspace: template?.workspace ?? "local",
    workflow: template?.workflow ?? null,
    target: template?.target ?? null,
  }));
  const { rule } = draft;
  const patch = (fields: Partial<RecurrenceDraft>) => setDraft((current) => ({ ...current, ...fields }));
  const [seedKey, setSeedKey] = useState(0);
  /** As the real composer: an agent's prompt fills an empty composer, or replaces the previous agent's unedited one. */
  const pickAgent = (agent: string | undefined) => {
    const previousSeed = draft.agent ? AGENT_PROMPTS[draft.agent] : undefined;
    const seedable = draft.prompt.trim() === "" || draft.prompt.trim() === previousSeed;
    patch({ agent: agent ?? null, ...(seedable ? { prompt: agent ? (AGENT_PROMPTS[agent] ?? "") : "" } : {}) });
    if (seedable) setSeedKey((key) => key + 1);
  };
  const setRule = (fields: Partial<Rule>) => setDraft((current) => ({ ...current, rule: { ...current.rule, ...fields } }));
  const runtimeSelectors = useComposerRuntimeOverrides(draft.runtime, (fields) =>
    setDraft((current) => ({ ...current, runtime: { ...current.runtime, ...fields } }))
  );
  const upcoming = nextSlots(rule, now, 3);
  // Off: the occurrence is only created. A new recurrence starts with it on when the task has an agent.
  const [startsThread, setStartsThread] = useState(template ? template.runner !== null : subject.agent !== null);
  // A stored profile that no longer exists (runner unavailable) must be re-picked before saving.
  const runnerMissing = startsThread && !CLI_PROFILES.includes(draft.runner?.profile ?? "");
  const maxDay = rule.unit === "year" ? daysIn(rule.month) : 31;

  const closed = template ? isClosedStatus(template.status) : false;
  const act = (action: TemplateAction) => {
    onAction?.(action);
    onDone();
  };

  return (
    <>
      {template ? (
        <div className="-mx-3 grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-4 gap-y-1.5 border-b border-border px-3 pb-3">
          <span className="text-sm text-muted-foreground">Next</span>
          <NextValue template={template} now={now} />
          <span className="text-sm text-muted-foreground">Last run</span>
          <LastRunValue template={template} now={now} />
        </div>
      ) : (
        <p className="text-sm font-medium">Repeat {subject.ref}</p>
      )}
      <div className="flex flex-col gap-3">
        <FormRow label="Repeat every">
          <Input
            type="number"
            min={1}
            max={99}
            aria-label="Interval"
            className="h-7 w-14"
            value={rule.every}
            onChange={(event) => setRule({ every: Math.max(1, Math.min(99, Number(event.target.value) || 1)) })}
          />
          <Choice
            label="Unit"
            className="w-28"
            value={rule.unit}
            options={UNITS.map((unit) => ({ value: unit, label: UNIT_LABEL[unit][rule.every === 1 ? 0 : 1] }))}
            onChange={(unit) => setRule({ unit })}
          />
        </FormRow>

        {rule.unit === "week" ? (
          <FormRow label="On" tight>
            {WEEKDAYS.map(({ day, short, long }) => {
              const on = rule.weekdays.includes(day);
              return (
                <Button
                  key={day}
                  type="button"
                  size="sm"
                  variant={on ? "default" : "outline"}
                  aria-pressed={on}
                  aria-label={long}
                  className="w-9 px-0"
                  // The last selected day stays on: a weekly rule needs one.
                  onClick={() =>
                    setRule({
                      weekdays: on
                        ? rule.weekdays.length > 1
                          ? rule.weekdays.filter((d) => d !== day)
                          : rule.weekdays
                        : [...rule.weekdays, day],
                    })
                  }
                >
                  {short}
                </Button>
              );
            })}
          </FormRow>
        ) : null}

        {rule.unit === "month" || rule.unit === "year" ? (
          <FormRow label={rule.unit === "month" ? "On day" : "On"}>
            {rule.unit === "year" ? (
              <Choice
                label="Month"
                className="w-32"
                value={String(rule.month)}
                options={MONTH_OPTIONS}
                // A day the new month lacks falls back to its last day.
                onChange={(month) => setRule({ month: Number(month), dayOfMonth: Math.min(rule.dayOfMonth, daysIn(Number(month))) })}
              />
            ) : null}
            <Choice
              label="Day of month"
              className="w-16"
              value={String(Math.min(rule.dayOfMonth, maxDay))}
              options={dayOptions(maxDay)}
              onChange={(day) => setRule({ dayOfMonth: Number(day) })}
            />
            {rule.unit === "month" && rule.dayOfMonth > 28 ? (
              <span className="text-xs text-muted-foreground">Shorter months use their last day.</span>
            ) : null}
            {rule.unit === "year" && rule.month === 1 && rule.dayOfMonth === 29 ? (
              <span className="text-xs text-muted-foreground">Feb 28 when the year has no Feb 29.</span>
            ) : null}
          </FormRow>
        ) : null}

        <FormRow label={rule.unit === "hour" ? "Timezone" : "At"}>
          {rule.unit === "hour" ? null : <TimeField value={rule.time} onChange={(time) => setRule({ time })} />}
          <Choice
            label="Timezone"
            className="min-w-0 flex-1"
            value={draft.timezone}
            options={TIMEZONE_OPTIONS}
            onChange={(timezone) => patch({ timezone })}
          />
        </FormRow>

        <div className="space-y-0.5 text-xs">
          <p>{describeRule(rule)}</p>
          <p className="text-muted-foreground">
            Next: {upcoming.map((slot) => format(slot, rule.unit === "year" ? "MMM d, yyyy" : "EEE, MMM d, HH:mm")).join(" · ")}
          </p>
        </div>

        <FormRow label="Create in">
          <CreateIn value={draft.target} onChange={(target) => patch({ target })} />
        </FormRow>
      </div>

      <label className="flex items-center justify-between gap-3 text-sm">
        Start a thread for every occurrence
        <Switch size="sm" checked={startsThread} onCheckedChange={setStartsThread} />
      </label>
      {startsThread ? (
        <ThreadComposer
          onSubmit={NOOP_SUBMIT}
          // Remounts on an agent seed: the editor reads its content only on mount.
          key={seedKey}
          textareaPlaceholder="Prompt for every occurrence"
          textareaClassName="min-h-20"
          containerClassName="p-0"
          contentClassName="max-w-none"
          initialInput={draft.prompt}
          onInputChange={(prompt) => patch({ prompt })}
          hideAttachmentTools
          hideSubmit
          // The real worktree and workflow pickers need a live CLI and project, so the whole
          // context bar is rendered here: real directory and agent selectors, stand-ins for the other two.
          workflowSelector={
            <>
              <WorkingDirectorySelector
                profiles={PROFILE_OPTIONS}
                profileId={draft.runner?.profile ?? ""}
                pathId={draft.runner?.path ?? ""}
                // Picking the directory makes the picker the acting user (spec: Runner).
                onChange={(profile, path) => patch({ runner: { profile, path, user: me } })}
              />
              <Choice
                label="Workspace"
                icon={GitBranch}
                active={draft.workspace === "worktree"}
                value={draft.workspace}
                options={WORKSPACE_OPTIONS}
                onChange={(workspace) => patch({ workspace })}
              />
              <ThreadAgentSelector agents={AGENT_OPTIONS} value={draft.agent ?? undefined} onChange={pickAgent} />
              <Choice
                label="Workflow"
                icon={Workflow}
                active={draft.workflow !== null}
                value={draft.workflow ?? NO_WORKFLOW}
                options={WORKFLOW_OPTIONS}
                onChange={(workflow) => patch({ workflow: workflow === NO_WORKFLOW ? null : workflow })}
              />
            </>
          }
          selectorsProps={{
            hideWorkingDirectory: true,
            profiles: PROFILE_OPTIONS,
            profileId: draft.runner?.profile ?? "",
            pathId: "",
            ...runtimeSelectors,
          }}
        />
      ) : null}
      <div className="-mx-3 flex items-center gap-1 border-t border-border px-3 pt-3">
        {template && onAction ? (
          <>
            <Button variant="ghost" size="sm" disabled={closed} onClick={() => act("run")}>
              <Play /> Run now
            </Button>
            <Button variant="ghost" size="sm" disabled={closed} onClick={() => act("pause")}>
              {template.paused ? "Resume" : "Pause"}
            </Button>
          </>
        ) : null}
        <Button
          size="sm"
          className="ml-auto"
          disabled={runnerMissing || rule.every < 1}
          onClick={() => {
            onSave(subject.id, { ...draft, runner: startsThread ? draft.runner : null });
            onDone();
          }}
        >
          {template ? "Save" : "Make recurring"}
        </Button>
      </div>
    </>
  );
}

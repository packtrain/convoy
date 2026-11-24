"use client";

import { useRef, useState } from "react";
import { format } from "date-fns";
import { ArrowLeft, FastForward } from "lucide-react";
import { TaskListIdentity } from "@/components/blocks/project/task-lists/task-list-identity";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AppLink, routeTarget } from "@/lib/navigation";
import { isClosedStatus } from "@/lib/tasks/status-policy";
import { Status } from "@/lib/tasks/types";
import {
  KEEP_CLOSED,
  LISTS,
  SEED_OCCURRENCES,
  SEED_TASKS,
  SEED_TEMPLATES,
  START,
  formatSlot,
  nextSlots,
  type ListKey,
  type Occurrence,
  type PlainTask,
  type Template,
} from "./fixtures";
import {
  BoardView,
  OccurrenceSidebar,
  PlainTaskSidebar,
  RecurringFilterView,
  TaskTreeView,
  TemplateSidebar,
  isLive,
  type RecurrenceDraft,
  type Selection,
  type TemplateAction,
} from "./recurring-views";

/** The list the table and board show. The Recurring filter spans the whole project. */
const LIST: ListKey = "chores";
const VIEWS = ["table", "board", "recurring"] as const;
type View = (typeof VIEWS)[number];
const VIEW_LABEL: Record<View, string> = { table: "Table", board: "Board", recurring: "Recurring" };

const bySlotDesc = (a: Occurrence, b: Occurrence) => b.slot.getTime() - a.slot.getTime();
/** A recurring task or one of its Occurrences as a plain task, once the repeat is gone. */
const toPlainTask = (template: Template, item: Pick<Occurrence, "id" | "ref" | "name" | "status"> & { list?: ListKey }): PlainTask => ({
  id: item.id,
  ref: item.ref,
  name: item.name,
  typeKey: template.typeKey,
  status: item.status,
  priority: template.priority,
  list: item.list ?? template.list,
  assignee: template.assignee,
  agent: template.agent,
  description: template.description,
});
const where = (template: Template) => (template.target ? `in ${LISTS[template.target].name}` : `under ${template.ref}`);

/** Recurring tasks on local state: a recurring task lives in any list, and its Occurrences are its subtasks or tasks in a list it names (OS-2506). */
export default function RecurringTasksPlaygroundPage() {
  const [templates, setTemplates] = useState(SEED_TEMPLATES);
  const [occurrences, setOccurrences] = useState(SEED_OCCURRENCES);
  const [tasks, setTasks] = useState(SEED_TASKS);
  const [now, setNow] = useState(START);
  const [view, setView] = useState<View>("table");
  const [selection, setSelection] = useState<Selection | null>({ kind: "template", id: "t1" });
  const [deleting, setDeleting] = useState<Template | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [log, setLog] = useState<string | null>(null);
  const nextRefNumber = useRef(2540);

  const patchTemplate = (id: string, patch: Partial<Template>) =>
    setTemplates((current) => current.map((template) => (template.id === id ? { ...template, ...patch } : template)));
  const sorted = [...occurrences].sort(bySlotDesc);
  const occurrencesOf = (templateId: string) => sorted.filter((occurrence) => occurrence.templateId === templateId);

  function spawn(template: Template, slot: Date, runNow: boolean): Occurrence {
    const ref = `OS-${nextRefNumber.current++}`;
    const occurrence: Occurrence = {
      id: ref,
      ref,
      templateId: template.id,
      list: template.target ?? undefined,
      name: template.name,
      status: Status.TODO,
      slot,
      runNow,
      thread: template.runner ? { title: template.name, state: "streaming" } : undefined,
      artifacts: [],
    };
    // Keep the newest closed Occurrences of this task; the rest leave for Archived.
    setOccurrences((current) => {
      const stale = new Set(current.filter((item) => item.templateId === template.id && isClosedStatus(item.status)).slice(KEEP_CLOSED));
      return [occurrence, ...current.filter((item) => !stale.has(item))];
    });
    patchTemplate(template.id, { lastRun: { slot, outcome: "spawned", ref }, skipped: 0 });
    return occurrence;
  }

  /** Run now ignores an open previous Occurrence but still needs a working runner. */
  function runNow(template: Template) {
    if (template.runnerProblem) {
      setLog(`Run now failed: ${template.runnerProblem}`);
      return;
    }
    const occurrence = spawn(template, now, true);
    setLog(
      `Run now created ${occurrence.ref} ${where(template)}${template.agent ? ` and started ${template.agent}` : ""}. The schedule did not move.`
    );
  }

  /** Moves the clock to the earliest slot and applies the spawn rules to that recurring task. */
  function advance() {
    const due = templates
      .filter(isLive)
      .map((template) => ({ template, slot: nextSlots(template.rule, now, 1)[0] }))
      .filter((entry) => entry.slot)
      .sort((a, b) => a.slot.getTime() - b.slot.getTime())[0];
    if (!due) {
      setLog("Nothing is scheduled. Every recurring task is paused or stopped.");
      return;
    }
    const { template, slot } = due;
    setNow(slot);
    const previous = occurrencesOf(template.id)[0];
    const at = format(slot, "EEE, MMM d, HH:mm");
    if (template.runnerProblem) {
      patchTemplate(template.id, { lastRun: { slot, outcome: "skipped", reason: "runner_unavailable" }, skipped: template.skipped + 1 });
      setLog(`${at} · ${template.ref} skipped: ${template.runnerProblem}.`);
    } else if (previous && !isClosedStatus(previous.status)) {
      patchTemplate(template.id, {
        lastRun: { slot, outcome: "skipped", reason: "previous_open", ref: previous.ref },
        skipped: template.skipped + 1,
      });
      setLog(`${at} · ${template.ref} skipped: ${previous.ref} is still open.`);
    } else {
      const occurrence = spawn(template, slot, false);
      setLog(
        `${at} · ${template.ref} created ${occurrence.ref} ${where(template)}${template.agent ? ` and started ${template.agent}` : ""}.`
      );
    }
  }

  function act(template: Template, action: TemplateAction) {
    const closed = isClosedStatus(template.status);
    const actions: Record<TemplateAction, () => void> = {
      run: () => runNow(template),
      pause: () => {
        patchTemplate(template.id, { paused: !template.paused });
        setLog(
          template.paused
            ? `${template.ref} resumed. It continues at the next slot.`
            : `${template.ref} paused. Its occurrences are untouched.`
        );
      },
      stop: () => {
        patchTemplate(template.id, { status: closed ? Status.TODO : Status.DONE });
        setLog(
          closed
            ? `${template.ref} reopened. It continues at the next slot.`
            : `${template.ref} marked done. It stops repeating until it is reopened.`
        );
      },
      remove: () => {
        // The task and its Occurrences become plain tasks. The real app keeps subtask Occurrences nested; this table shows them flat.
        const kept = occurrencesOf(template.id);
        setTasks((current) => [
          ...current,
          toPlainTask(template, template),
          ...kept.map((occurrence) => toPlainTask(template, occurrence)),
        ]);
        setTemplates((current) => current.filter((candidate) => candidate.id !== template.id));
        setOccurrences((current) => current.filter((occurrence) => occurrence.templateId !== template.id));
        setSelection({ kind: "task", id: template.id });
        setLog(`${template.ref} no longer repeats. Its ${kept.length} occurrences stay.`);
      },
      delete: () => setDeleting(template),
    };
    actions[action]();
  }

  /** Saves the repeat dropdown: edits a recurring task, or turns a plain task into one where it is. */
  function saveRepeat(taskId: string, draft: RecurrenceDraft) {
    const first = formatSlot(nextSlots(draft.rule, now, 1)[0], now);
    const existing = templates.find((template) => template.id === taskId);
    const task = tasks.find((candidate) => candidate.id === taskId);
    if (existing) {
      patchTemplate(taskId, { ...draft, runnerProblem: undefined });
      setLog(`${existing.ref} saved. Next occurrence ${first}.`);
    } else if (task) {
      const template: Template = { ...task, ...draft, paused: false, lastRun: null, skipped: 0, subtasks: [] };
      setTemplates((current) => [...current, template]);
      setTasks((current) => current.filter((candidate) => candidate.id !== task.id));
      setSelection({ kind: "template", id: template.id });
      setLog(`${task.ref} now repeats. First occurrence ${first}.`);
    }
  }

  const listTemplates = templates.filter((template) => template.list === LIST && (showClosed || !isClosedStatus(template.status)));
  // Subtasks of this list's recurring tasks, plus Occurrences any recurring task created in this list.
  const listOccurrences = sorted.filter((occurrence) =>
    occurrence.list ? occurrence.list === LIST : listTemplates.some((template) => template.id === occurrence.templateId)
  );
  const deletingSubtasks = deleting ? occurrencesOf(deleting.id).filter((occurrence) => !occurrence.list) : [];
  const deletingKept = deleting ? occurrencesOf(deleting.id).filter((occurrence) => occurrence.list) : [];
  const listTasks = tasks.filter((task) => task.list === LIST);
  const allRecurring = empty ? [] : templates.filter((template) => showClosed || !isClosedStatus(template.status));

  const selectedTemplate = selection?.kind === "template" ? templates.find((template) => template.id === selection.id) : undefined;
  const selectedOccurrence =
    selection?.kind === "occurrence" ? occurrences.find((occurrence) => occurrence.id === selection.id) : undefined;
  const occurrenceTemplate = selectedOccurrence ? templates.find((template) => template.id === selectedOccurrence.templateId) : undefined;
  const selectedTask = selection?.kind === "task" ? tasks.find((task) => task.id === selection.id) : undefined;
  const series = selectedOccurrence ? occurrencesOf(selectedOccurrence.templateId) : [];
  const seriesIndex = selectedOccurrence ? series.findIndex((occurrence) => occurrence.id === selectedOccurrence.id) : -1;
  const close = () => setSelection(null);

  return (
    <main className="flex h-screen flex-col bg-background text-foreground">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-xs">
        <AppLink
          href={routeTarget("/playground")}
          className="mr-2 inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft aria-hidden="true" className="size-3.5" /> Playground
        </AppLink>
        <span className="font-medium">Recurring tasks</span>
        <span className="rounded-md border border-border px-2 py-0.5 text-muted-foreground">OS-2506 · UX prototype</span>
        <span className="mx-2 h-4 w-px bg-border" />
        <span className="text-muted-foreground">Clock: {format(now, "EEE, MMM d, HH:mm")}</span>
        <Button size="xs" variant="outline" onClick={advance}>
          <FastForward /> Next slot
        </Button>
        <span className="mx-2 h-4 w-px bg-border" />
        <Button
          size="xs"
          variant={empty ? "default" : "outline"}
          onClick={() => {
            setEmpty((value) => !value);
            setView("recurring");
            setSelection(null);
          }}
        >
          No recurring tasks
        </Button>
        <span className="ml-auto max-w-[50%] truncate text-muted-foreground" title={log ?? undefined}>
          {log ??
            "Next slot moves the clock to the next due recurring task and applies the spawn rules. Close an occurrence, then advance again."}
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Project header stub. Recurring is a filter over the whole project, not a list. */}
          <div className="flex h-[49px] shrink-0 items-center gap-3 border-b border-border px-4">
            <span className="text-sm font-medium">Convoy</span>
            <span className="text-muted-foreground">/</span>
            {view === "recurring" ? (
              <span className="text-sm">All lists</span>
            ) : (
              <TaskListIdentity list={LISTS[LIST]} size="compact" className="text-sm" />
            )}
            <Tabs value={view} onValueChange={(next) => setView(next as View)} className="ml-4">
              <TabsList aria-label="View">
                {VIEWS.map((key) => (
                  <TabsTrigger key={key} value={key} className="px-2.5 text-xs">
                    {VIEW_LABEL[key]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <Button
              variant={showClosed ? "secondary" : "ghost"}
              size="sm"
              className="ml-auto"
              aria-pressed={showClosed}
              onClick={() => setShowClosed((value) => !value)}
            >
              Show closed
            </Button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-auto">
            {view === "table" ? (
              <TaskTreeView
                templates={listTemplates}
                allTemplates={templates}
                occurrences={listOccurrences}
                tasks={listTasks}
                now={now}
                selectedId={selection?.id ?? null}
                onSelect={setSelection}
                onSaveRepeat={saveRepeat}
                onAction={act}
              />
            ) : null}
            {view === "board" ? (
              <>
                <p className="shrink-0 px-4 pt-3 text-xs text-muted-foreground">
                  Occurrences have their own cards here. The {listTemplates.length} recurring tasks in this list have none, since they are
                  never worked on. Find them in Table or Recurring.
                </p>
                <BoardView
                  templates={templates}
                  occurrences={listOccurrences}
                  tasks={listTasks}
                  now={now}
                  selectedId={selection?.id ?? null}
                  onSelect={setSelection}
                />
              </>
            ) : null}
            {view === "recurring" ? (
              <RecurringFilterView
                templates={allRecurring}
                now={now}
                selectedId={selection?.kind === "template" ? selection.id : null}
                onSelect={(id) => setSelection({ kind: "template", id })}
                onAction={act}
                onSaveRepeat={saveRepeat}
              />
            ) : null}
          </div>
        </div>

        {selectedTemplate ? (
          <TemplateSidebar
            template={selectedTemplate}
            occurrences={occurrencesOf(selectedTemplate.id)}
            now={now}
            onAction={(action) => act(selectedTemplate, action)}
            onSaveRepeat={saveRepeat}
            onStatusChange={(status) => patchTemplate(selectedTemplate.id, { status })}
            onOpenOccurrence={(id) => setSelection({ kind: "occurrence", id })}
            onClose={close}
          />
        ) : null}
        {selectedOccurrence && occurrenceTemplate ? (
          <OccurrenceSidebar
            occurrence={selectedOccurrence}
            template={occurrenceTemplate}
            previous={series[seriesIndex + 1]}
            isLatest={seriesIndex === 0}
            now={now}
            onStatusChange={(status) =>
              setOccurrences((current) =>
                current.map((occurrence) => (occurrence.id === selectedOccurrence.id ? { ...occurrence, status } : occurrence))
              )
            }
            onOpenTemplate={() => setSelection({ kind: "template", id: occurrenceTemplate.id })}
            onOpenOccurrence={(id) => setSelection({ kind: "occurrence", id })}
            onClose={close}
          />
        ) : null}
        {selectedTask ? (
          <PlainTaskSidebar
            task={selectedTask}
            now={now}
            onStatusChange={(status) =>
              setTasks((current) => current.map((task) => (task.id === selectedTask.id ? { ...task, status } : task)))
            }
            onSaveRepeat={saveRepeat}
            onClose={close}
          />
        ) : null}
      </div>

      <ConfirmDialog
        open={deleting !== null}
        title={`Delete ${deleting?.ref ?? ""}?`}
        text={[
          deletingSubtasks.length > 0
            ? `This also deletes its ${deletingSubtasks.length} occurrences, because they are its subtasks.`
            : null,
          deletingKept.length > 0 ? `Its ${deletingKept.length} occurrences created in a list stay as normal tasks.` : null,
          "To only stop the repeat, mark the task done or pause it.",
        ]
          .filter(Boolean)
          .join(" ")}
        size="md"
        confirm={{
          label: deletingSubtasks.length > 0 ? "Delete task and occurrences" : "Delete task",
          variant: "destructive",
          onClick: () => {
            if (!deleting) return;
            setTemplates((current) => current.filter((template) => template.id !== deleting.id));
            setOccurrences((current) => current.filter((occurrence) => occurrence.templateId !== deleting.id));
            // Occurrences in a list are not subtasks: they stay as plain tasks.
            setTasks((current) => [...current, ...deletingKept.map((occurrence) => toPlainTask(deleting, occurrence))]);
            setSelection(null);
            setLog(`${deleting.ref} deleted.`);
          },
        }}
        onClose={() => setDeleting(null)}
      />
    </main>
  );
}

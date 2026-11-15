"use client";

import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AppLink, routeTarget } from "@/lib/navigation";
import { ChecksCard, EvidenceFiles, EvidenceTab, PreviewDialog, RunChecksButton, TaskChecksSection } from "./evidence-views";
import { ME, SCENARIOS, TASK, TASK_TYPE_DEFAULT, TEAMMATE, THREAD, applyChecklist, type EvidenceFile, type ScenarioKey } from "./fixtures";

/** Thread workspace and task sidebar side by side, on local state (OS-2216). */
export default function EvidencePlaygroundPage() {
  const [scenarioKey, setScenarioKey] = useState<ScenarioKey>("task");
  const [attached, setAttached] = useState(false);
  const [preview, setPreview] = useState<EvidenceFile | null>(null);
  const [tab, setTab] = useState("evidence");
  const [log, setLog] = useState<string | null>(null);
  const [viewer, setViewer] = useState(ME);
  // Undefined until someone switches it: the scenario's checklist (the task type default) applies.
  const [checklist, setChecklist] = useState<string | null | undefined>(undefined);
  const scenario = SCENARIOS[scenarioKey];
  const base = "attached" in scenario && attached ? scenario.attached : scenario.state;
  const state = applyChecklist(base, checklist === undefined ? base.checklist : checklist);
  const hasEvidence = state.files.length > 0 || state.checks.some((check) => check.results.length > 0);
  const activeTab = !hasEvidence && tab === "evidence" ? "changes" : tab;
  // This reply's own results: what Run 7 of this thread reported.
  const replyChecks = state.checks.map((check) => ({ ...check, results: check.results.filter((result) => result.thread === THREAD && result.run === 7) }));
  const replyFiles = state.files.find((group) => group.thread === THREAD && group.run === 7)?.files ?? [];
  const onRun = (what: string) => setLog(`Run checks → sends the thread a prompt for ${what}`);
  const runChecks = <RunChecksButton checklist={state.checklist} hasChecks={state.checks.length > 0} onRun={onRun} onPickChecklist={setChecklist} />;
  const banner = "attached" in scenario && attached ? `3 results moved from this thread to ${TASK.ref}. Tests now shows this thread's pass; the earlier failure is in its history.` : null;

  return (
    <main className="flex h-screen flex-col bg-background text-foreground">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-xs">
        <AppLink href={routeTarget("/playground")} className="mr-2 inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
          <ArrowLeft aria-hidden="true" className="size-3.5" /> Playground
        </AppLink>
        <span className="font-medium">Evidence and checks</span>
        <span className="rounded-md border border-border px-2 py-0.5 text-muted-foreground">OS-2216 · UX prototype</span>
        <span className="mx-2 h-4 w-px bg-border" />
        {(Object.keys(SCENARIOS) as ScenarioKey[]).map((key) => (
          <Button
            key={key}
            size="xs"
            variant={key === scenarioKey ? "default" : "outline"}
            onClick={() => {
              setScenarioKey(key);
              setAttached(false);
              setChecklist(undefined);
              setLog(null);
            }}
          >
            {SCENARIOS[key].label}
          </Button>
        ))}
        {"attached" in scenario ? (
          <>
            <span className="mx-2 h-4 w-px bg-border" />
            <Button size="xs" variant="outline" onClick={() => {
                setAttached((value) => !value);
                setChecklist(undefined);
              }}>
              {attached ? "Detach task" : `Attach ${TASK.ref}`}
            </Button>
          </>
        ) : null}
        <span className="mx-2 h-4 w-px bg-border" />
        <Button size="xs" variant={viewer === ME ? "outline" : "default"} onClick={() => setViewer(viewer === ME ? TEAMMATE : ME)}>
          {viewer === ME ? "View as teammate" : `Viewing as ${TEAMMATE}`}
        </Button>
        <span className="ml-auto truncate text-muted-foreground">{log ?? scenario.note}</span>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Thread transcript stub: the reply's own results. Extra checks are just asked for in the prompt. */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-[41px] shrink-0 items-center gap-2 border-b border-border px-4 text-sm">
            {state.owner?.kind === "task" ? <span className="text-xs text-muted-foreground">{TASK.ref}</span> : null}
            <span className="truncate font-medium">{THREAD}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto flex max-w-2xl flex-col gap-4 px-6 py-8 text-sm">
              <div className="self-end rounded-lg bg-muted px-3 py-2">Run checks: Feature (6). Also check the mobile drawer layout.</div>
              <p>Ran the Feature checklist and the mobile drawer check. Typecheck still fails in one file; details below.</p>
              {replyChecks.some((check) => check.results.length > 0) ? <ChecksCard checks={replyChecks} checklist={state.checklist} onOpen={setPreview} /> : null}
              {replyFiles.length > 0 ? <EvidenceFiles files={replyFiles} onOpen={setPreview} /> : null}
            </div>
          </div>
        </div>

        {/* Thread sidebar */}
        <div className="flex w-[420px] shrink-0 flex-col border-l border-border bg-card">
          <Tabs value={activeTab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col gap-0">
            <TabsList variant="underline" className="shrink-0 px-2">
              <TabsTrigger value="changes">Changes</TabsTrigger>
              <TabsTrigger value="tasks">Tasks</TabsTrigger>
              {hasEvidence ? <TabsTrigger value="evidence">Evidence</TabsTrigger> : null}
            </TabsList>
            <TabsContent value="changes" className="p-4 text-xs text-muted-foreground">
              {hasEvidence ? "Run diffs." : "No evidence yet, so there is no Evidence tab."}
            </TabsContent>
            <TabsContent value="tasks" className="p-4 text-xs text-muted-foreground">
              Project task list.
            </TabsContent>
            <TabsContent value="evidence" className="min-h-0 flex-1 overflow-y-auto">
              <EvidenceTab state={state} viewer={viewer} onOpen={setPreview} runChecks={runChecks} banner={banner} />
            </TabsContent>
          </Tabs>
        </div>

        {/* Task detail sidebar, compact checks */}
        <div className="hidden w-[380px] shrink-0 flex-col overflow-y-auto border-l border-border xl:flex">
          <div className="flex h-[41px] shrink-0 items-center gap-2 border-b border-border px-4 text-sm">
            <span className="text-xs text-muted-foreground">{TASK.ref}</span>
            <span className="text-muted-foreground">Task detail</span>
          </div>
          {state.owner?.kind === "task" ? (
            <div className="flex flex-col gap-6 px-4 py-4">
              <h2 className="text-lg font-semibold">{TASK.title}</h2>
              <div className="flex flex-col gap-3 text-sm">
                {[
                  ["Status", "In Progress"],
                  ["Assignee", ME],
                  ["Threads", THREAD],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center gap-4">
                    <span className="w-24 text-muted-foreground">{label}</span>
                    <span className="truncate">{value}</span>
                  </div>
                ))}
              </div>
              <TaskChecksSection state={state} viewer={viewer} defaultChecklist={TASK_TYPE_DEFAULT} onChecklistChange={setChecklist} onOpen={setPreview} />
              <div>
                <h3 className="mb-2 text-sm font-medium">Subtasks</h3>
                <p className="text-sm text-muted-foreground">No subtasks</p>
              </div>
            </div>
          ) : (
            <p className="p-4 text-xs text-muted-foreground">The thread has no task. Attach {TASK.ref} from the top bar to move its results onto the task.</p>
          )}
        </div>
      </div>

      <PreviewDialog file={preview} onClose={() => setPreview(null)} />
    </main>
  );
}

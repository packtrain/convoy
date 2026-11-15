"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Play, RotateCcw, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { AppLink, routeTarget } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { WorkflowRunRailView, type WorkflowRunRailActions } from "@/components/blocks/workflows/workflow-run-rail";
import { LONG_STEP_COUNT, SCENARIOS, THREAD_ID, buildLongRun } from "./fixtures";

const PARAMS = { organizationSlug: "org", projectAlias: "proj" };

/** Mock thread chrome (list, transcript, sidebar) around the real Run rail (OS-1368); actions log instead of mutating. */
export default function WorkflowRunRailPlaygroundPage() {
  const [scenarioKey, setScenarioKey] = useState<keyof typeof SCENARIOS>("approve");
  const [pinned, setPinned] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  // Long run playback: one step completes per tick so the wheel can be watched scrolling.
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const interval = window.setInterval(() => {
      setPlayhead((value) => {
        if (value >= LONG_STEP_COUNT) {
          window.clearInterval(interval);
          setPlaying(false);
          return value;
        }
        return value + 1;
      });
    }, 1200);
    return () => window.clearInterval(interval);
  }, [playing]);
  const isLong = scenarioKey === "long";
  const finished = playhead >= LONG_STEP_COUNT;
  const scenario = isLong ? { ...SCENARIOS.long, run: buildLongRun(playhead) } : SCENARIOS[scenarioKey];

  const record = (entry: string) => setLog((prev) => [entry, ...prev].slice(0, 8));
  const actions: WorkflowRunRailActions = {
    stepAction: async (stepId, action) => record(`${action} → ${stepId}`),
    resume: async (laneId) => record(`resume → ${laneId}`),
    cancel: async () => record("cancel run"),
    busyStepId: null,
    resumingLaneId: null,
    isCanceling: false,
  };

  return (
    <main className="flex h-screen flex-col bg-background text-foreground">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-xs">
        <AppLink href={routeTarget("/playground")} className="mr-2 inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
          <ArrowLeft aria-hidden="true" className="size-3.5" /> Playground
        </AppLink>
        <span className="font-medium">Workflow run rail</span>
        <span className="rounded-md border border-border px-2 py-0.5 text-muted-foreground">OS-1368 · UX prototype</span>
        <span className="mx-2 h-4 w-px bg-border" />
        {Object.entries(SCENARIOS).map(([key, { label }]) => (
          <Button key={key} size="xs" variant={key === scenarioKey ? "default" : "outline"} onClick={() => setScenarioKey(key)}>
            {label}
          </Button>
        ))}
        {isLong ? (
          <>
            <span className="mx-2 h-4 w-px bg-border" />
            <Button
              size="xs"
              variant="outline"
              onClick={() => {
                if (finished) setPlayhead(0);
                setPlaying(finished || !playing);
              }}
            >
              {playing ? <Square /> : <Play />} {playing ? "Pause" : finished ? "Replay" : "Play"}
            </Button>
            <Button size="xs" variant="ghost" onClick={() => { setPlaying(false); setPlayhead(0); }}>
              <RotateCcw /> Reset
            </Button>
            <span className="text-muted-foreground">
              {Math.min(playhead, LONG_STEP_COUNT)}/{LONG_STEP_COUNT} done
            </span>
          </>
        ) : null}
        <label className="ml-4 flex cursor-pointer items-center gap-1.5">
          <Checkbox checked={pinned} onCheckedChange={(value) => setPinned(value === true)} /> Pin expanded
        </label>
        <span className="ml-auto truncate text-muted-foreground">{log[0] ? `last: ${log[0]}` : "hover the rail, click a control"}</span>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="hidden w-64 shrink-0 flex-col border-r border-border p-2 text-xs lg:flex">
          <div className="mb-2 rounded-md border border-border px-2 py-1.5 text-muted-foreground">+ New thread</div>
          {["OS-914 Test: Bash Only", "Use your native sleep tool…", "OS-913 Poem test", "explore the code base…"].map((title, index) => (
            <div key={title} className={cn("truncate rounded-md px-2 py-1.5", index === 0 ? "bg-muted" : "text-muted-foreground")}>
              {title}
            </div>
          ))}
        </div>

        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex h-[41px] shrink-0 items-center border-b border-border px-4 text-sm">
            <span className="text-muted-foreground">OS-914</span>
            <span className="ml-2 font-medium">{scenario.run.workflowName} — Executor</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-8 pr-16 text-sm">
              <div className="self-end rounded-lg bg-muted px-3 py-2 font-mono text-xs">&gt;_ pnpm web:lint</div>
              <p className="text-muted-foreground">
                bash: warning: setlocale: LC_ALL: cannot change locale (en_US.UTF-8)
                <br />✓ 0 errors, 43 warnings
              </p>
              <p className="text-xs text-muted-foreground">Script: Exited with code 0</p>
            </div>
          </div>
          <div className="mx-auto w-full max-w-2xl shrink-0 px-6 pb-6 pr-16">
            <div className="rounded-xl border border-border px-3 py-3 text-sm text-muted-foreground">Ask a follow-up question…</div>
          </div>

          {/* Docked at the transcript's right edge, clear of header and composer. The
              inner box has a definite height so the rail's percentage max-height resolves. */}
          <div className="pointer-events-none absolute inset-y-0 right-3 py-14">
            <div className="pointer-events-auto flex h-full items-center">
              <WorkflowRunRailView run={scenario.run} threadId={THREAD_ID} params={PARAMS} actions={actions} pinned={pinned} />
            </div>
          </div>
        </div>

        <div className="hidden w-80 shrink-0 flex-col border-l border-border xl:flex">
          <div className="flex h-[41px] items-center gap-4 border-b border-border px-4 text-sm text-muted-foreground">
            <span>Changes</span>
            <span>Tasks</span>
            <span className="border-b-2 border-foreground text-foreground">Workflow</span>
          </div>
          <div className="p-4 text-xs text-muted-foreground">
            The Workflow tab stays as-is. The rail is the shortcut that is always visible while this tab is closed. Rows of other threads are real links here, so they 404.
            <ul className="mt-3 flex flex-col gap-1 font-mono">
              {log.map((entry, index) => (
                <li key={index}>{entry}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </main>
  );
}

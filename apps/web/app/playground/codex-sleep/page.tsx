"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Check, RotateCcw, Square, Terminal } from "lucide-react";
import { SleepRow } from "@/components/blocks/thread/message-parts/sleep-part";
import { Button } from "@/components/ui/button";
import { AppLink, routeTarget } from "@/lib/navigation";

type SleepState = "sleeping" | "completed" | "interrupted" | "overdue";

const STATES: { value: SleepState; label: string }[] = [
  { value: "sleeping", label: "Sleeping" },
  { value: "completed", label: "Completed" },
  { value: "interrupted", label: "Interrupted" },
  { value: "overdue", label: "Overdue" },
];

export default function CodexSleepPlaygroundPage() {
  const [state, setState] = useState<SleepState>("sleeping");
  const [elapsed, setElapsed] = useState(12);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const remaining = Math.max(0, 30 - elapsed);

  useEffect(() => {
    if (startedAt === null) return;
    const interval = window.setInterval(() => {
      const seconds = Math.floor((Date.now() - startedAt) / 1000);
      setElapsed(seconds);
      if (seconds >= 30) setState("overdue");
    }, 250);
    return () => window.clearInterval(interval);
  }, [startedAt]);

  function selectState(next: SleepState) {
    setStartedAt(null);
    setState(next);
    setElapsed(next === "completed" ? 30 : next === "overdue" ? 36 : 12);
  }

  function settle(next: "completed" | "interrupted") {
    if (startedAt !== null) setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    setStartedAt(null);
    setState(next);
  }

  function replay() {
    setElapsed(0);
    setState("sleeping");
    setStartedAt(Date.now());
  }

  const pending = state === "sleeping" || state === "overdue";

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:px-8 sm:py-12">
        <header className="space-y-4">
          <AppLink href={routeTarget("/playground")} className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft aria-hidden="true" className="size-3.5" /> Playground
          </AppLink>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold">Codex sleep</h1>
            <span className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground">OS-1922 · UX prototype</span>
          </div>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            A quiet pause in the thread while the agent waits. Try the states below,
            or replay a 30-second sleep. This preview uses local sample data.
          </p>
        </header>

        <section aria-label="Interactive sleep preview" className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_240px]">
          <div className="min-w-0 overflow-hidden rounded-xl border border-border">
            <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/20 px-5 py-3 text-xs">
              <span className="font-medium">Check the deployment</span>
              <span className="text-muted-foreground">Codex</span>
            </div>
            <div className="space-y-6 px-5 py-6 sm:px-7">
              <div className="ml-auto max-w-[90%] rounded-lg bg-muted px-3 py-2 text-sm leading-6">
                Keep an eye on the deployment and tell me when it is ready.
              </div>
              <div className="space-y-4">
                <p className="text-sm leading-6">The deployment is still building. I&apos;ll check again in 30 seconds.</p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Terminal aria-hidden="true" className="size-3.5" />
                  <span>Checked deployment status</span>
                  <Check aria-hidden="true" className="size-3" />
                </div>
                <div data-testid="active-sleep-row" className="min-h-20">
                  <SleepRow state={state} requested={30} elapsed={elapsed} remaining={remaining} />
                  {state === "overdue" && <p className="ml-5 text-xs leading-5 text-muted-foreground">The requested wait has elapsed. The agent has not resumed yet.</p>}
                </div>
                {state === "completed" && <p className="text-sm leading-6">I&apos;ll check the deployment status now.</p>}
                {state === "interrupted" && <p className="text-xs text-muted-foreground">The turn was interrupted during the wait.</p>}
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/10 px-5 py-3 text-xs text-muted-foreground" role="status">
              <span>{pending ? "Turn in progress" : state === "completed" ? "Agent resumed" : "Turn interrupted"}</span>
              <span>Sample thread</span>
            </div>
          </div>

          <aside className="space-y-5">
            <div className="space-y-3">
              <h2 className="text-sm font-medium">Preview state</h2>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Preview state">
                {STATES.map((item) => (
                  <Button key={item.value} size="sm" variant={state === item.value ? "secondary" : "outline"}
                    aria-pressed={state === item.value} onClick={() => selectState(item.value)}>
                    {item.label}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-3 border-t border-border pt-4">
              <h2 className="text-sm font-medium">Simulate events</h2>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={replay}><RotateCcw /> Replay 30s</Button>
                <Button size="sm" variant="outline" disabled={!pending} onClick={() => settle("completed")}><Check /> Complete sleep</Button>
                <Button size="sm" variant="outline" disabled={!pending} onClick={() => settle("interrupted")}><Square /> Interrupt turn</Button>
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                {startedAt !== null ? "Timer running. Completion is simulated separately." : "Frozen preview. Replay starts the timer."}
              </p>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              Click a sleep row to inspect its timing. The countdown is an estimate;
              reaching zero does not complete the event.
            </p>
          </aside>
        </section>

        <section className="space-y-4" aria-labelledby="other-states">
          <div className="space-y-1">
            <h2 id="other-states" className="text-base font-medium">Other states</h2>
            <p className="text-sm text-muted-foreground">The same row adapts to the timing data available.</p>
          </div>
          <div className="divide-y divide-border border-y border-border">
            {[
              { title: "Long wait", note: "Minutes keep the countdown compact.", state: "sleeping" as const, requested: 300, elapsed: 12, remaining: 288 },
              { title: "Completed without a start", note: "Requested duration does not claim actual elapsed time.", state: "completed" as const, requested: 20 },
              { title: "Duration unavailable", note: "A sleep is still readable without a countdown.", state: "sleeping" as const },
              { title: "Interrupted", note: "A neutral end state when the turn stops during a sleep.", state: "interrupted" as const, requested: 30, elapsed: 8 },
            ].map((example) => (
              <div key={example.title} className="grid gap-2 py-5 sm:grid-cols-[220px_minmax(0,1fr)] sm:gap-8">
                <div className="space-y-1">
                  <h3 className="text-xs font-medium">{example.title}</h3>
                  <p className="text-xs leading-5 text-muted-foreground">{example.note}</p>
                </div>
                <SleepRow {...example} />
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

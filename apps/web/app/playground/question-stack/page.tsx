"use client";

import { useState } from "react";
import { ArrowLeft, Plus, RotateCcw, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppLink, routeTarget } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { QUESTIONS, type DemoQuestion } from "./fixtures";
import { QuestionStack, type Draft, type MotionFeel } from "./question-cards";

export default function QuestionStackPlaygroundPage() {
  const [count, setCount] = useState(3);
  const [pending, setPending] = useState(QUESTIONS.slice(0, 3));
  const [selectedId, setSelectedId] = useState<string | null>(QUESTIONS[0].id);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [answers, setAnswers] = useState<Array<{ title: string; answer: string }>>([]);
  const [restingGap, setRestingGap] = useState(12);
  const [spreadGap, setSpreadGap] = useState(44);
  const [feel, setFeel] = useState<MotionFeel>("gentle");
  const [narrow, setNarrow] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  function reset(nextCount = count) {
    setCount(nextCount);
    setPending(QUESTIONS.slice(0, nextCount));
    setSelectedId(QUESTIONS[0].id);
    setDrafts({});
    setAnswers([]);
    setResetKey(value => value + 1);
  }

  function answer(question: DemoQuestion, value: string) {
    const remaining = pending.filter(item => item.id !== question.id);
    setPending(remaining);
    setSelectedId(remaining[0]?.id ?? null);
    setAnswers(previous => [...previous, { title: question.title, answer: value }]);
  }

  const nextQuestion = QUESTIONS.find(question => !pending.some(item => item.id === question.id));

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-8">
        <header className="space-y-3">
          <AppLink href={routeTarget("/playground")} className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft aria-hidden="true" className="size-3.5" /> Playground
          </AppLink>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold">Question stack</h1>
            <span className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground">Design experiment</span>
          </div>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Hover to spread the cards. Bring any question forward and answer it first.
            Try a draft, switch cards, then come back.
          </p>
        </header>

        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_240px]">
          <div className="min-w-0">
            <div className={cn("mx-auto flex h-[740px] w-full flex-col overflow-hidden rounded-xl border border-border bg-background", narrow && "max-w-[390px]")}>
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3 text-xs">
                <span className="font-medium">Create the welcome page</span>
                <span className="text-muted-foreground">Sample thread</span>
              </div>
              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-6 text-sm leading-6">
                <p className="ml-auto w-fit max-w-[90%] rounded-lg bg-muted px-3 py-2">Let&apos;s give the welcome page some personality.</p>
                <div className="space-y-2">
                  <p>I have a few questions while I work on the layout. You can answer them in any order.</p>
                  <p className="text-xs text-muted-foreground">Agent is still working</p>
                </div>
              </div>
              <div className="relative shrink-0 space-y-3 px-3 pb-3 sm:px-4 sm:pb-4">
                <QuestionStack key={resetKey} questions={pending} selectedId={selectedId} drafts={drafts}
                  restingGap={restingGap} spreadGap={spreadGap} feel={feel} onSelect={setSelectedId}
                  onDraft={(id, draft) => setDrafts(previous => ({ ...previous, [id]: draft }))} onAnswer={answer} />
                <div className="relative rounded-xl border border-border bg-background px-3 py-3">
                  <textarea aria-label="Sample message composer" placeholder="Send a message…" rows={1}
                    className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
                  <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>Codex · Astra</span>
                    <Button disabled size="icon-sm" aria-label="Send sample message"><ArrowUp aria-hidden="true" /></Button>
                  </div>
                </div>
              </div>
            </div>
            <p className="mt-3 text-center text-xs text-muted-foreground">Local sample data. Answers stay in this preview.</p>
          </div>

          <aside aria-label="Design controls" className="space-y-6">
            <div className="space-y-3">
              <h2 className="text-sm font-medium">Try the stack</h2>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Starting question count">
                {[1, 3, 5, 8].map(value => (
                  <Button key={value} size="sm" variant={count === value ? "secondary" : "outline"}
                    aria-pressed={count === value} onClick={() => reset(value)}>{value} {value === 1 ? "card" : "cards"}</Button>
                ))}
              </div>
              <p className="text-xs leading-5 text-muted-foreground">Up to four cards in the deck. Use All to choose from a longer queue.</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={!nextQuestion} onClick={() => {
                  if (!nextQuestion) return;
                  setPending(previous => [...previous, nextQuestion]);
                  setDrafts(previous => ({ ...previous, [nextQuestion.id]: { choice: "", custom: "" } }));
                }}><Plus aria-hidden="true" /> Add one</Button>
                <Button size="sm" variant="ghost" onClick={() => reset()}><RotateCcw aria-hidden="true" /> Reset</Button>
              </div>
            </div>

            <div className="space-y-4 border-t border-border pt-5">
              <h2 className="text-sm font-medium">Spacing</h2>
              <label className="block space-y-2 text-xs">
                <span className="flex justify-between">Resting overlap <span className="tabular-nums text-muted-foreground">{restingGap}px</span></span>
                <input type="range" min="8" max="18" value={restingGap} onChange={event => setRestingGap(Number(event.target.value))} className="w-full cursor-pointer accent-current" />
              </label>
              <label className="block space-y-2 text-xs">
                <span className="flex justify-between">Hover spread <span className="tabular-nums text-muted-foreground">{spreadGap}px</span></span>
                <input type="range" min="36" max="56" value={spreadGap} onChange={event => setSpreadGap(Number(event.target.value))} className="w-full cursor-pointer accent-current" />
              </label>
            </div>

            <div className="space-y-3 border-t border-border pt-5">
              <h2 className="text-sm font-medium">Motion</h2>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Animation feel">
                {(["gentle", "snappy", "none"] as const).map(value => (
                  <Button key={value} size="sm" variant={feel === value ? "secondary" : "outline"}
                    aria-pressed={feel === value} onClick={() => setFeel(value)}>{value === "none" ? "Off" : value === "gentle" ? "Gentle" : "Snappy"}</Button>
                ))}
              </div>
              <p className="text-xs leading-5 text-muted-foreground">Follows your system&apos;s reduced-motion preference.</p>
            </div>

            <div className="space-y-3 border-t border-border pt-5">
              <h2 className="text-sm font-medium">Preview width</h2>
              <div className="flex gap-1.5" role="group" aria-label="Preview width">
                <Button size="sm" variant={!narrow ? "secondary" : "outline"} aria-pressed={!narrow} onClick={() => setNarrow(false)}>Wide</Button>
                <Button size="sm" variant={narrow ? "secondary" : "outline"} aria-pressed={narrow} onClick={() => setNarrow(true)}>Narrow</Button>
              </div>
            </div>

            <div className="space-y-3 border-t border-border pt-5" role="status" aria-live="polite">
              <h2 className="text-sm font-medium">Answers sent</h2>
              {answers.length === 0 ? <p className="text-xs leading-5 text-muted-foreground">Choose a card and send an answer to watch the next one move forward.</p> : (
                <ol className="max-h-48 space-y-3 overflow-y-auto">
                  {answers.map((item, index) => <li key={index} className="text-xs"><span className="text-muted-foreground">{item.title}</span><p className="mt-1 break-words">{item.answer}</p></li>)}
                </ol>
              )}
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}

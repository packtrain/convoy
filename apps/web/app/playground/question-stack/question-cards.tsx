"use client";

import { useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, ChevronUp, List, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { DemoQuestion } from "./fixtures";

export type MotionFeel = "gentle" | "snappy" | "none";
export type Draft = { choice: string; custom: string };

export function QuestionStack({
  questions, selectedId, drafts, restingGap, spreadGap, feel, onSelect, onDraft, onAnswer,
}: {
  questions: DemoQuestion[];
  selectedId: string | null;
  drafts: Record<string, Draft>;
  restingGap: number;
  spreadGap: number;
  feel: MotionFeel;
  onSelect: (id: string) => void;
  onDraft: (id: string, draft: Draft) => void;
  onAnswer: (question: DemoQuestion, answer: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const activeHeader = useRef<HTMLButtonElement>(null);
  const pickerButton = useRef<HTMLButtonElement>(null);
  const reducedMotion = useReducedMotion();
  const expanded = hovered || pinned;
  const active = questions.find(question => question.id === selectedId) ?? questions[0];
  const ordered = active ? [active, ...questions.filter(question => question.id !== active.id)] : [];
  const visible = ordered.slice(0, 4);
  const backCount = Math.max(0, visible.length - 1);
  const transition = reducedMotion || feel === "none"
    ? { duration: 0 }
    : { type: "spring" as const, stiffness: feel === "snappy" ? 520 : 280, damping: feel === "snappy" ? 38 : 29, mass: 0.85 };

  function select(id: string) {
    onSelect(id);
    setPickerOpen(false);
    setPinned(false);
    setHovered(false);
    requestAnimationFrame(() => activeHeader.current?.focus({ preventScroll: true }));
  }

  return (
    <section aria-label="Pending questions" className="relative flex flex-col">
      <div className="relative order-last mt-3 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          {questions.length === 0 ? "All caught up" : `${questions.length} pending ${questions.length === 1 ? "question" : "questions"}`}
        </span>
        <div className="flex items-center gap-1">
          {questions.length > 1 ? (
            <Button size="sm" variant="ghost" aria-expanded={expanded} aria-controls="question-deck"
              onClick={() => { setPinned(!expanded); setHovered(false); }}>
              <ChevronUp aria-hidden="true" className={cn("size-3.5", expanded && "rotate-180")} />
              {expanded ? "Collapse" : "Spread cards"}
            </Button>
          ) : null}
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <Button ref={pickerButton} size="sm" variant="ghost" disabled={questions.length === 0} aria-label="Choose any pending question">
                <List aria-hidden="true" className="size-3.5" /> All
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="max-h-64 w-72 overflow-y-auto p-1"
              onCloseAutoFocus={(event) => { event.preventDefault(); (activeHeader.current ?? pickerButton.current)?.focus({ preventScroll: true }); }}>
              <p className="px-2 py-2 text-xs text-muted-foreground">Answer in any order</p>
              {questions.map(question => (
                <button key={question.id} type="button" onClick={() => select(question.id)}
                  aria-pressed={question.id === active?.id}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
                  <Check aria-hidden="true" className={cn("size-3.5 shrink-0", question.id !== active?.id && "opacity-0")} />
                  <span className="min-w-0 flex-1 truncate">{question.title}</span>
                  {drafts[question.id]?.choice ? <span className="text-xs text-muted-foreground">Draft</span> : null}
                </button>
              ))}
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <div id="question-deck" className="relative isolate" style={{ height: 312 + backCount * restingGap }}
        onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
        {questions.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-background text-sm">
            <Check aria-hidden="true" className="mb-1 size-5 text-muted-foreground" />
            <p>Every question answered.</p>
            <p className="text-xs text-muted-foreground">Add a question or reset to try again.</p>
          </div>
        ) : null}
        <AnimatePresence initial={false}>
          {visible.map((question, depth) => {
            const front = depth === 0;
            const draft = drafts[question.id] ?? { choice: "", custom: "" };
            const answer = draft.choice === "other" ? draft.custom.trim() : draft.choice;
            return (
              <motion.article key={question.id} aria-label={question.title}
                className="absolute inset-x-0 bottom-0 flex h-[312px] origin-top flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm"
                style={{ zIndex: 10 - depth }}
                initial={{ opacity: 0, y: -24, scale: 0.97 }}
                animate={{ opacity: 1, y: -depth * (expanded ? spreadGap : restingGap), scale: front ? 1 : 1 - depth * (expanded ? 0.012 : 0.025) }}
                exit={{ opacity: 0, x: reducedMotion ? 0 : 28, y: reducedMotion ? 0 : -16, scale: reducedMotion ? 1 : 0.98 }}
                transition={transition}>
                <button ref={front ? activeHeader : undefined} type="button" onClick={() => select(question.id)}
                  aria-label={`${front ? "Answering" : "Answer"}: ${question.title}`} aria-pressed={front}
                  className={cn("flex h-11 w-full shrink-0 cursor-pointer items-center justify-between gap-3 px-4 text-left text-xs focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring", front ? "border-b border-border/60" : "bg-muted/40 hover:bg-muted/70")}
                  onFocus={() => { if (!front) setPinned(true); }}>
                  <span className="min-w-0 truncate font-medium">{question.title}</span>
                  <span className="shrink-0 text-muted-foreground">{front ? "Answering now" : draft.choice ? "Draft saved" : "Answer this"}</span>
                </button>
                {front ? (
                  <form className="flex min-h-0 flex-1 flex-col" onSubmit={event => {
                    event.preventDefault();
                    if (!answer) return;
                    onAnswer(question, answer);
                    requestAnimationFrame(() => activeHeader.current?.focus({ preventScroll: true }));
                  }}>
                    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
                      <p className="text-sm font-medium leading-5">{question.question}</p>
                      <fieldset className="space-y-1.5">
                        <legend className="sr-only">{question.question}</legend>
                        {question.options.map(option => (
                          <label key={option} className={cn("flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 text-xs transition-colors", draft.choice === option ? "border-foreground/25 bg-muted" : "border-border/60 hover:bg-muted/50")}>
                            <input type="radio" name={question.id} value={option} checked={draft.choice === option}
                              onChange={() => onDraft(question.id, { ...draft, choice: option })} className="size-3.5 accent-current" />
                            {option}
                          </label>
                        ))}
                        <label className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-xs text-muted-foreground">
                          <input type="radio" name={question.id} value="other" checked={draft.choice === "other"}
                            onChange={() => onDraft(question.id, { ...draft, choice: "other" })} className="size-3.5 accent-current" />
                          Something else
                        </label>
                        {draft.choice === "other" ? (
                          <Input aria-label={`Custom answer for ${question.title}`} placeholder="Your answer"
                            value={draft.custom} onChange={event => onDraft(question.id, { ...draft, custom: event.target.value })} />
                        ) : null}
                      </fieldset>
                    </div>
                    <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border/60 px-4 py-2.5">
                      <span className="text-xs text-muted-foreground">{questions.length > 1 ? `${questions.length - 1} more waiting` : "Last question"}</span>
                      <Button type="submit" size="sm" disabled={!answer}>Send answer <ArrowUpRight aria-hidden="true" className="size-3.5" /></Button>
                    </div>
                  </form>
                ) : <div aria-hidden="true" className="flex-1 bg-card" />}
              </motion.article>
            );
          })}
        </AnimatePresence>
      </div>
    </section>
  );
}

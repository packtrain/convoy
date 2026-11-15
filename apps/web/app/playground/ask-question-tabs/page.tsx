"use client";

import { useState } from "react";
import type { DemoQuestion } from "./question-answers";
import {
  StackedQuestionCard,
  TabbedQuestionCard,
  type OverflowStrategy,
} from "./question-cards";

const OVERFLOW_OPTIONS: Array<{
  overflow: OverflowStrategy;
  title: string;
  description: string;
}> = [
  {
    overflow: "scroll",
    title: "A — Scroll the strip",
    description:
      "Headers keep their full text; the strip scrolls horizontally with a faded trailing edge. Nothing is abbreviated, but tabs past the fold are not visible until scrolled.",
  },
  {
    overflow: "truncate",
    title: "B — Equal widths, truncated labels",
    description:
      "Every tab is visible at once and shares the width equally, with long headers truncated (full text in the tooltip). Predictable layout; headers become unreadable when narrow.",
  },
  {
    overflow: "numbered",
    title: "C — Numbered tabs, header in the body",
    description:
      "The strip shows only 1-2-3-4 with a checkmark once answered, and the header moves above the question. Always fits any width; loses at-a-glance topic scanning.",
  },
  {
    overflow: "stepper",
    title: "D — Stepper, no strip",
    description:
      "Prev/next arrows with position dots and the header above the question. The most compact and fully width-proof, but jumping to a specific question means clicking a small dot.",
  },
];

/**
 * Fixtures mirror the real `question` interaction-request payload
 * (`{ questions: [{ question, header?, multiSelect?, options: [{ label,
 * description? }] }] }`) as produced by the CLI runtimes and parsed in
 * `components/blocks/thread/interaction-request-cards.tsx`.
 */
const THREE_QUESTIONS: DemoQuestion[] = [
  {
    header: "Metadata bag",
    question: "Which selections should the denormalized thread.metadata bag hold?",
    options: [
      { label: "Model + effort + mode (Rec.)", description: "Everything the composer restores." },
      { label: "Model + effort only", description: "Mode is re-derived per run." },
    ],
  },
  {
    header: "Pre-existing threads",
    question:
      "How should pre-existing threads (no metadata.lastUsed) resolve composer defaults?",
    options: [
      { label: "Keep scan as fallback (Rec.)", description: "Slower, always correct." },
      { label: "Drop the scan entirely", description: "Fast, loses history." },
      { label: "Lazy backfill on read", description: "Writes on first open." },
    ],
  },
  {
    header: "Rollout",
    question: "Which surfaces should read the denormalized bag first?",
    multiSelect: true,
    options: [
      { label: "Thread composer" },
      { label: "Watch Tower" },
      { label: "Sidebar thread list" },
    ],
  },
];

const LONG_HEADERS: DemoQuestion[] = [
  {
    header: "Authentication strategy",
    question: "Which auth provider should the preview deployments use?",
    options: [{ label: "Clerk dev instance" }, { label: "Shared prod instance" }],
  },
  {
    header: "Convex preview data seeding",
    question: "How much dev data should be copied into a new preview deployment?",
    options: [{ label: "Full snapshot" }, { label: "Schema only" }, { label: "Curated subset" }],
  },
  {
    header: "Worktree cleanup",
    question: "When should idle preview deployments be torn down?",
    options: [{ label: "On wt remove" }, { label: "After 24h idle" }, { label: "Never, manual" }],
  },
  {
    header: "CI",
    question: "Should preview deployments run the full test suite on every push?",
    options: [{ label: "Yes" }, { label: "Only on PR open" }, { label: "No" }],
  },
];

const SINGLE_QUESTION: DemoQuestion[] = [
  {
    header: "Scope",
    question: "Should this change also cover the OpenCode runtime?",
    options: [
      { label: "Yes, both runtimes" },
      { label: "Claude Code only", description: "OpenCode follows in a separate task." },
    ],
  },
];

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-base font-medium text-foreground">{title}</h2>
        <p className="text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

export default function AskQuestionTabsPlaygroundPage() {
  const [lastResponse, setLastResponse] = useState<string | null>(null);

  const handleRespond = (response: unknown) => {
    setLastResponse(JSON.stringify(response, null, 2));
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-6 py-10">
        <header className="space-y-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            AskUserQuestion — tabbed prompt (OS-1456)
          </h1>
          <p className="text-sm leading-6 text-muted-foreground">
            UX review for rendering multiple agent questions one at a time. These
            cards are local-state only — nothing is sent to a thread. The response
            JSON below is the exact shape{" "}
            <code className="text-xs">cli.interactionRequests.respond</code> would
            receive.
          </p>
        </header>

        <Section
          title="Current: all questions stacked"
          description="What ships today — every question rendered at once, one Send answers button at the bottom. Long question sets push the composer far down the thread."
        >
          <StackedQuestionCard questions={THREE_QUESTIONS} onRespond={handleRespond} />
        </Section>

        <Section
          title="Proposed: one question per tab"
          description="Tabs labeled from the question header, a checkmark once answered, Next until the last tab, then Send answers — disabled until every question has an answer."
        >
          <TabbedQuestionCard questions={THREE_QUESTIONS} onRespond={handleRespond} />
        </Section>

        <Section
          title="Single question: tab strip dropped"
          description="With questions.length === 1 the strip carries no information, so the card degrades to the plain prompt plus Send answers."
        >
          <TabbedQuestionCard questions={SINGLE_QUESTION} onRespond={handleRespond} />
        </Section>

        <div className="space-y-3">
          <div className="space-y-1">
            <h2 className="text-base font-medium text-foreground">
              Tab overflow: four long headers
            </h2>
            <p className="text-sm leading-6 text-muted-foreground">
              Each option below is shown twice — at full thread width
              (<code className="text-xs">max-w-3xl</code>) and clamped to 340px to
              stand in for the narrow mini preview, where the embeddable-view spec
              requires the card to shrink rather than widen its host.
            </p>
          </div>

          {OVERFLOW_OPTIONS.map((option) => (
            <div key={option.overflow} className="space-y-2 pt-2">
              <div className="space-y-1">
                <h3 className="text-sm font-medium text-foreground">{option.title}</h3>
                <p className="text-sm leading-6 text-muted-foreground">
                  {option.description}
                </p>
              </div>
              <TabbedQuestionCard
                questions={LONG_HEADERS}
                onRespond={handleRespond}
                overflow={option.overflow}
              />
              <div className="w-[340px] max-w-full">
                <TabbedQuestionCard
                  questions={LONG_HEADERS}
                  onRespond={handleRespond}
                  overflow={option.overflow}
                />
              </div>
            </div>
          ))}
        </div>

        <Section
          title="Submitted response"
          description="Answers are comma-joined per question and keyed by question text, matching the current response contract."
        >
          <pre className="max-h-72 overflow-auto rounded-lg border border-border bg-muted/30 p-3 font-mono text-xs text-foreground">
            {lastResponse ?? "No answers sent yet."}
          </pre>
        </Section>
      </div>
    </main>
  );
}

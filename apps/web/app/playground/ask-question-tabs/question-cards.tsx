"use client";

import { useState } from "react";
import { Check, ChevronLeft, ChevronRight, MessageCircleQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useQuestionAnswers, type DemoQuestion } from "./question-answers";
import { QuestionBody } from "./question-body";

function CardShell({
  title,
  children,
  toolbar,
}: {
  title: string;
  children: React.ReactNode;
  toolbar?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
          <MessageCircleQuestion className="size-4 shrink-0" />
          <span className="truncate">{title}</span>
        </div>
        {toolbar}
      </div>
      {children}
    </div>
  );
}

function SendAnswers({
  disabled,
  onSend,
}: {
  disabled: boolean;
  onSend: () => void;
}) {
  return (
    <Button size="sm" className="cursor-pointer" disabled={disabled} onClick={onSend}>
      <Check className="size-3.5" /> Send answers
    </Button>
  );
}

/** Variant A — today's shipped card: every question stacked at once. */
export function StackedQuestionCard({
  questions,
  onRespond,
}: {
  questions: DemoQuestion[];
  onRespond: (response: unknown) => void;
}) {
  const answers = useQuestionAnswers(questions);

  return (
    <CardShell title="Claude has a question">
      <div className="space-y-3">
        {questions.map((question, index) => (
          <QuestionBody
            key={index}
            question={question}
            index={index}
            answers={answers}
          />
        ))}
        <SendAnswers
          disabled={!answers.allAnswered}
          onSend={() => onRespond(answers.buildResponse())}
        />
      </div>
    </CardShell>
  );
}

/**
 * How the tab strip handles more headers than fit the card width. The card
 * renders both at `max-w-3xl` in the thread and inside narrow mini previews
 * (see `docs/specs/cli-thread-embeddable-view.md`), so the strip must survive
 * roughly 340px.
 */
export type OverflowStrategy = "scroll" | "truncate" | "numbered" | "stepper";

function TabStrip({
  questions,
  strategy,
  answers,
}: {
  questions: DemoQuestion[];
  strategy: Exclude<OverflowStrategy, "stepper">;
  answers: ReturnType<typeof useQuestionAnswers>;
}) {
  return (
    <TabsList
      variant="underline"
      className={cn(
        // The fade in the parent, not a scrollbar, signals more tabs exist.
        strategy === "scroll" && "flex-nowrap overflow-x-auto",
        strategy === "truncate" && "w-full"
      )}
    >
      {questions.map((question, index) => {
        const answered = answers.isAnswered(index);
        const label = question.header?.trim() || `Question ${index + 1}`;

        return (
          <TabsTrigger
            key={index}
            value={String(index)}
            title={label}
            className={cn(
              strategy === "scroll" && "shrink-0",
              strategy === "truncate" && "min-w-0 flex-1",
              strategy === "numbered" && "shrink-0 px-2"
            )}
          >
            <span
              className={cn(
                "flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] font-medium transition-colors",
                answered
                  ? "bg-primary text-primary-foreground"
                  : strategy === "numbered"
                    ? "border border-border text-muted-foreground"
                    : "text-transparent"
              )}
            >
              {answered ? (
                <Check className="size-2.5" />
              ) : strategy === "numbered" ? (
                index + 1
              ) : (
                <Check className="size-2.5 text-muted-foreground/30" />
              )}
            </span>
            {strategy !== "numbered" ? (
              <span className={cn(strategy === "truncate" && "truncate")}>
                {label}
              </span>
            ) : null}
          </TabsTrigger>
        );
      })}
    </TabsList>
  );
}

/**
 * One question per tab (OS-1456).
 *
 * With a single question the tab strip is redundant and is dropped entirely —
 * the card degrades to the plain prompt plus Send answers.
 */
export function TabbedQuestionCard({
  questions,
  onRespond,
  overflow = "scroll",
}: {
  questions: DemoQuestion[];
  onRespond: (response: unknown) => void;
  overflow?: OverflowStrategy;
}) {
  const answers = useQuestionAnswers(questions);
  const [activeIndex, setActiveIndex] = useState(0);

  const isSingle = questions.length === 1;
  const isLast = activeIndex === questions.length - 1;
  const activeQuestion = questions[activeIndex];
  const nextUnanswered =
    answers.unansweredIndexes.find((index) => index > activeIndex) ??
    answers.unansweredIndexes[0];

  const footer = (
    <div className="mt-3 flex items-center gap-2">
      {isLast ? (
        <SendAnswers
          disabled={!answers.allAnswered}
          onSend={() => onRespond(answers.buildResponse())}
        />
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="cursor-pointer"
          onClick={() => setActiveIndex(activeIndex + 1)}
        >
          Next <ChevronRight className="size-3.5" />
        </Button>
      )}

      {/*
        On the last tab the primary action is Send, so an unanswered question
        earlier in the set would otherwise be a dead end: this jumps there.
      */}
      {isLast && !answers.allAnswered && nextUnanswered !== undefined ? (
        <Button
          size="sm"
          variant="ghost"
          className="cursor-pointer text-muted-foreground"
          onClick={() => setActiveIndex(nextUnanswered)}
        >
          Go to unanswered
        </Button>
      ) : null}
    </div>
  );

  if (isSingle) {
    return (
      <CardShell title="Claude has a question">
        <QuestionBody question={questions[0]} index={0} answers={answers} />
        <div className="mt-3">
          <SendAnswers
            disabled={!answers.allAnswered}
            onSend={() => onRespond(answers.buildResponse())}
          />
        </div>
      </CardShell>
    );
  }

  const progress = (
    <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
      {answers.answeredCount} of {questions.length} answered
    </span>
  );

  // Stepper drops the strip entirely: dots for position, header as a heading.
  if (overflow === "stepper") {
    return (
      <CardShell title="Claude has a question" toolbar={progress}>
        <div className="mb-2 flex items-center gap-2">
          <Button
            size="icon-sm"
            variant="ghost"
            className="cursor-pointer"
            disabled={activeIndex === 0}
            aria-label="Previous question"
            onClick={() => setActiveIndex(activeIndex - 1)}
          >
            <ChevronLeft />
          </Button>
          <div className="flex flex-1 items-center justify-center gap-1.5">
            {questions.map((question, index) => (
              <button
                key={index}
                type="button"
                aria-label={question.header?.trim() || `Question ${index + 1}`}
                aria-current={index === activeIndex}
                className={cn(
                  "size-1.5 cursor-pointer rounded-full transition-colors",
                  index === activeIndex
                    ? "bg-foreground"
                    : answers.isAnswered(index)
                      ? "bg-primary"
                      : "bg-muted-foreground/30"
                )}
                onClick={() => setActiveIndex(index)}
              />
            ))}
          </div>
          <Button
            size="icon-sm"
            variant="ghost"
            className="cursor-pointer"
            disabled={isLast}
            aria-label="Next question"
            onClick={() => setActiveIndex(activeIndex + 1)}
          >
            <ChevronRight />
          </Button>
        </div>
        {activeQuestion?.header?.trim() ? (
          <p className="mb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {activeQuestion.header.trim()}
          </p>
        ) : null}
        <QuestionBody
          question={activeQuestion}
          index={activeIndex}
          answers={answers}
        />
        {footer}
      </CardShell>
    );
  }

  return (
    <CardShell title="Claude has a question" toolbar={progress}>
      <Tabs
        className="gap-0"
        value={String(activeIndex)}
        onValueChange={(value) => setActiveIndex(Number(value))}
      >
        <div
          className={cn(
            "min-w-0",
            // Fade the trailing edge so a clipped strip reads as scrollable
            // rather than as a cut-off label.
            overflow === "scroll" &&
              "[mask-image:linear-gradient(to_right,black_calc(100%-1.5rem),transparent)]"
          )}
        >
          <TabStrip questions={questions} strategy={overflow} answers={answers} />
        </div>

        {questions.map((question, index) => (
          <TabsContent key={index} value={String(index)} className="pt-3">
            {/* Numbered tabs hide the header, so the body has to carry it. */}
            {overflow === "numbered" && question.header?.trim() ? (
              <p className="mb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {question.header.trim()}
              </p>
            ) : null}
            <QuestionBody question={question} index={index} answers={answers} />
          </TabsContent>
        ))}
      </Tabs>

      {footer}
    </CardShell>
  );
}

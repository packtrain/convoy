"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import {
  Check,
  ChevronRight,
  MessageCircleQuestion,
  ShieldQuestion,
  X,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  buildQuestionKey,
  QuestionOptionList,
  QuestionOptionRow,
} from "@/components/blocks/thread/question-option-list";
import { isRecord } from "@/lib/type-guards";
import { McpElicitationCard } from "./mcp-elicitation-card";
import { ToolSurface } from "./message-parts/components/tool-surface";
import { InteractionRequestStack } from "./interaction-request-stack";
import { cn } from "@/lib/utils";

type InteractionRequest = FunctionReturnType<
  typeof api.cli.interactionRequests.listPendingByThread
>[number];

function parsePayload(request: InteractionRequest): Record<string, unknown> {
  const parsed = safeJsonParse(request.payloadJson);
  return isRecord(parsed) ? parsed : {};
}

type QuestionOption = { label: string; description?: string };
type Question = {
  id?: string;
  isOther?: boolean;
  isSecret?: boolean;
  question: string;
  header?: string;
  options: QuestionOption[];
  multiSelect?: boolean;
};

function parseQuestions(payload: Record<string, unknown>): Question[] {
  if (!Array.isArray(payload.questions)) {
    return [];
  }
  return payload.questions.filter(isRecord).map((raw) => ({
    id: typeof raw.id === "string" ? raw.id : undefined,
    isOther: raw.isOther !== false,
    isSecret: raw.isSecret === true,
    question: typeof raw.question === "string" ? raw.question : "",
    header: typeof raw.header === "string" ? raw.header : undefined,
    multiSelect: raw.multiSelect === true,
    options: Array.isArray(raw.options)
      ? raw.options.filter(isRecord).map((option) => ({
          label: typeof option.label === "string" ? option.label : "",
          description:
            typeof option.description === "string" ? option.description : undefined,
        }))
      : [],
  }));
}

/**
 * Human-readable preview of what the tool will actually do, from the runtime's
 * `inputJson`. Without it the card only says "Claude wants to use Bash" and the
 * user has no idea which command they are approving.
 */
function toolInputPreview(payload: Record<string, unknown>): string | undefined {
  if (typeof payload.inputJson !== "string") {
    return undefined;
  }
  const input = safeJsonParse(payload.inputJson);
  if (!isRecord(input)) {
    return payload.inputJson.slice(0, 600) || undefined;
  }
  // ponytail: first matching key wins; add more when a runtime needs it.
  for (const key of ["command", "file_path", "path", "url", "pattern"]) {
    if (typeof input[key] === "string" && input[key]) {
      return input[key];
    }
  }
  return JSON.stringify(input, null, 2).slice(0, 600);
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

/**
* Caps the scrollable body of a question card.
*
* These cards sit in an auto-height row *outside* the scrolling conversation, so nothing
* upstream bounds them and a tall question set grows the thread column past its host — in the
* mini preview that clamped the composer (OS-1602). Only the option list scrolls: a question
* whose `Send answers` button is offscreen is unanswerable.
*
* The rem term is 3.5 option rows, not 4, on purpose — a half-row cap always leaves a row
* visibly cut, which is the affordance that more options exist (`frontend-development.md`).
*/
const QUESTION_BODY_SCROLL = "max-h-[min(32vh,13.125rem)] overflow-y-auto";

/**
 * Fades whichever edge of the question body still has content past it, reusing the tab
 * strip's `mask-image` language.
 *
 * The peek alone is weak in a mini preview — a cut row can read as a cramped one. It
 * must follow scroll position, not just overflow: a fade left on at the bottom dims the
 * final option, which reads as disabled.
 */
// Each variant is a whole literal class: Tailwind only compiles arbitrary
// values it can see in the source, so these must never be built by
// interpolation.
const QUESTION_BODY_FADE_BOTTOM =
  "[mask-image:linear-gradient(to_bottom,black_calc(100%-2rem),transparent)]";
const QUESTION_BODY_FADE_TOP =
  "[mask-image:linear-gradient(to_bottom,transparent,black_2rem)]";
const QUESTION_BODY_FADE_BOTH =
  "[mask-image:linear-gradient(to_bottom,transparent,black_2rem,black_calc(100%-2rem),transparent)]";

function questionBodyFadeClass(atTop: boolean, atBottom: boolean): string | false {
  if (atTop && atBottom) {
    return false;
  }
  if (atTop) {
    return QUESTION_BODY_FADE_BOTTOM;
  }
  return atBottom ? QUESTION_BODY_FADE_TOP : QUESTION_BODY_FADE_BOTH;
}

type EdgeState = { atTop: boolean; atBottom: boolean };

/**
 * Which edges of a scroller are flush against their content.
 *
 * Both `true` means the content fits and no fade is warranted — dimming the last row of
 * a short list advertises options that don't exist. Scroll position is read passively
 * and committed only when an edge flips, so scrolling doesn't rerender this card on
 * every frame (it already rerenders throughout a streaming run).
 */
function useScrollEdges(): [
  (node: HTMLDivElement | null) => void,
  EdgeState,
] {
  const [edges, setEdges] = useState<EdgeState>({ atTop: true, atBottom: true });
  const [node, setNode] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!node) {
      return;
    }

    const measure = () => {
      // 1px tolerance: sub-pixel layout rounding otherwise reports a
      // pixel-perfect fit as a permanent overflow, and a fully scrolled box as
      // still having a pixel to go.
      const remaining = node.scrollHeight - node.clientHeight - node.scrollTop;
      const next = {
        atTop: node.scrollTop <= 1,
        atBottom: remaining <= 1,
      };
      setEdges((previous) =>
        previous.atTop === next.atTop && previous.atBottom === next.atBottom
          ? previous
          : next
      );
    };

    measure();
    node.addEventListener("scroll", measure, { passive: true });

    if (typeof ResizeObserver === "undefined") {
      return () => node.removeEventListener("scroll", measure);
    }
    // Remeasure as content or size changes: switching tabs, revealing the
    // `Other…` field, resizing the host.
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    // The box is capped, so growth shows up on the content, not the scroller.
    for (const child of Array.from(node.children)) {
      observer.observe(child);
    }
    return () => {
      node.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [node]);

  return [setNode, edges];
}

/** One question's option list, capped and faded toward whichever edge has more. */
function QuestionBodyScrollArea({ children }: { children: React.ReactNode }) {
  const [ref, { atTop, atBottom }] = useScrollEdges();

  return (
    <div
      ref={ref}
      className={cn(QUESTION_BODY_SCROLL, questionBodyFadeClass(atTop, atBottom))}
    >
      {children}
    </div>
  );
}

function CardShell({
  icon,
  title,
  children,
  toolbar,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  toolbar?: React.ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-card p-3">
      <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
          {icon}
          <span className="truncate">{title}</span>
        </div>
        {toolbar}
      </div>
      {children}
    </div>
  );
}

function approvalDecisionLabel(decision: unknown): string | null {
  if (decision === "accept") return "Allow";
  if (decision === "acceptForSession") return "Allow for session";
  if (decision === "decline") return "Deny";
  if (decision === "cancel") return "Cancel";
  if (isRecord(decision) && isRecord(decision.acceptWithExecpolicyAmendment)) return "Allow and save command rule";
  if (isRecord(decision) && isRecord(decision.applyNetworkPolicyAmendment)) return "Apply network rule";
  return null;
}

function ToolApprovalCard({
  request,
  onRespond,
  disabled,
}: {
  request: InteractionRequest;
  onRespond: (responseJson: string) => void;
  disabled: boolean;
}) {
  const payload = parsePayload(request);
  const title =
    (typeof payload.title === "string" && payload.title) ||
    `Claude wants to use ${typeof payload.toolName === "string" ? payload.toolName : "a tool"}`;
  const description =
    typeof payload.description === "string" ? payload.description : undefined;
  const hasSuggestions = payload.hasSuggestions === true;
  const preview = toolInputPreview(payload);
  const decisions = Array.isArray(payload.availableDecisions) ? payload.availableDecisions : null;
  const context = Object.fromEntries(
    ["permissions", "additionalPermissions", "networkApprovalContext", "proposedExecpolicyAmendment", "proposedNetworkPolicyAmendments", "availableDecisions"]
      .filter(key => payload[key] != null).map(key => [key, payload[key]])
  );

  return (
    <CardShell icon={<ShieldQuestion className="size-4 shrink-0" />} title={title}>
      {preview ? (
        <ToolSurface className="mb-2 max-h-48 overflow-auto p-2">
          <pre className="whitespace-pre-wrap break-all font-mono text-xs text-foreground">
            {preview}
          </pre>
        </ToolSurface>
      ) : null}
      {description ? (
        <p className="mb-2 text-xs text-muted-foreground">{description}</p>
      ) : null}
      {Object.keys(context).length > 0 ? (
        <details className="mb-2 text-xs">
          <summary className="cursor-pointer">Permission details</summary>
          <ToolSurface className="mt-1 max-h-48 overflow-auto p-2">
            <pre className="whitespace-pre-wrap break-all font-mono text-foreground">{JSON.stringify(context, null, 2)}</pre>
          </ToolSurface>
        </details>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {decisions ? decisions.map((decision, index) => {
          const label = approvalDecisionLabel(decision);
          return label ? <Button key={index} size="sm" variant="outline" className="cursor-pointer" disabled={disabled}
            onClick={() => onRespond(JSON.stringify({ decisionIndex: index }))}>{label}</Button> : null;
        }) : <>
        <Button
          size="sm"
          className="cursor-pointer"
          disabled={disabled}
          onClick={() => onRespond(JSON.stringify({ decision: "allow" }))}
        >
          <Check className="size-3.5" /> Allow
        </Button>
        {hasSuggestions ? (
          <Button
            size="sm"
            variant="outline"
            className="cursor-pointer"
            disabled={disabled}
            onClick={() => onRespond(JSON.stringify({ decision: "allow-always" }))}
          >
            {payload.permissionRequest === true ? "Allow for session" : "Always allow"}
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          className="cursor-pointer"
          disabled={disabled}
          onClick={() => onRespond(JSON.stringify({ decision: "deny" }))}
        >
          <X className="size-3.5" /> Deny
        </Button>
        </>}
      </div>
    </CardShell>
  );
}

/**
 * One question's prompt, its options as a radio/checkbox list, and the free-text
 * "Other…" row (OS-1602).
 *
 * Answer state is keyed by question *index*, not text: two questions in one request may
 * carry identical text and would share a single answer slot.
 */
function QuestionFields({
  question,
  index,
  questionKey,
  answers,
  disabled,
}: {
  question: Question;
  index: number;
  questionKey: string;
  answers: QuestionAnswersState;
  disabled: boolean;
}) {
  const multiSelect = question.multiSelect === true;
  const isOtherOpen = answers.otherOpen[index] === true;

  return (
    <div>
      <p className="mb-1.5 text-sm text-foreground">{question.question}</p>
      {question.options.length === 0 ? (
        <Input aria-label={question.question} type={question.isSecret ? "password" : "text"}
          autoComplete="off" disabled={disabled} value={answers.otherText[index] ?? ""}
          onChange={event => answers.setOther(index, event.target.value)} />
      ) : <QuestionOptionList
        name={questionKey}
        options={question.options}
        multiSelect={multiSelect}
        selectedLabels={answers.selected[index] ?? []}
        disabled={disabled}
        onToggle={(label) => answers.toggleOption(index, label, multiSelect)}
      >
        {question.isOther !== false ? <QuestionOptionRow
          id={`${questionKey}-other`}
          name={questionKey}
          label="Other…"
          multiSelect={multiSelect}
          checked={isOtherOpen}
          disabled={disabled}
          onToggle={() => answers.toggleOther(index, multiSelect)}
        >
          {isOtherOpen ? (
            <Input
              autoFocus
              placeholder="Type a custom answer"
              aria-label={question.question}
              type={question.isSecret ? "password" : "text"}
              autoComplete="off"
              disabled={disabled}
              value={answers.otherText[index] ?? ""}
              onChange={(event) => answers.setOther(index, event.target.value)}
            />
          ) : null}
        </QuestionOptionRow> : null}
      </QuestionOptionList>}
    </div>
  );
}

type QuestionAnswersState = {
  selected: Record<number, string[]>;
  otherOpen: Record<number, boolean>;
  otherText: Record<number, string>;
  isAnswered: (index: number) => boolean;
  answeredCount: number;
  allAnswered: boolean;
  firstUnansweredIndex: number | undefined;
  toggleOption: (index: number, label: string, multiSelect: boolean) => void;
  toggleOther: (index: number, multiSelect: boolean) => void;
  setOther: (index: number, value: string) => void;
  buildAnswers: () => Record<string, string>;
};

function useQuestionAnswers(questions: Question[]): QuestionAnswersState {
  const [selected, setSelected] = useState<Record<number, string[]>>({});
  const [otherOpen, setOtherOpen] = useState<Record<number, boolean>>({});
  const [otherText, setOtherText] = useState<Record<number, string>>({});

  const answerFor = (index: number): string => {
    const labels = selected[index] ?? [];
    const raw = otherText[index] ?? "";
    const custom = otherOpen[index] || questions[index]?.options.length === 0
      ? questions[index]?.isSecret ? raw : raw.trim()
      : "";
    return [...labels, ...(custom ? [custom] : [])].join(", ");
  };

  const isAnswered = (index: number) => answerFor(index).length > 0;
  const unanswered = questions
    .map((_, index) => index)
    .filter((index) => !isAnswered(index));

  return {
    selected,
    otherOpen,
    otherText,
    isAnswered,
    answeredCount: questions.length - unanswered.length,
    allAnswered: questions.length > 0 && unanswered.length === 0,
    firstUnansweredIndex: unanswered[0],
    toggleOption: (index, label, multiSelect) => {
      setSelected((previous) => {
        const current = previous[index] ?? [];
        if (multiSelect) {
          return {
            ...previous,
            [index]: current.includes(label)
              ? current.filter((item) => item !== label)
              : [...current, label],
          };
        }
        return { ...previous, [index]: [label] };
      });
      if (!multiSelect) {
        setOtherOpen((previous) => ({ ...previous, [index]: false }));
      }
    },
    toggleOther: (index, multiSelect) => {
      setOtherOpen((previous) => ({ ...previous, [index]: !previous[index] }));
      if (!multiSelect) {
        setSelected((previous) => ({ ...previous, [index]: [] }));
      }
    },
    setOther: (index, value) => {
      setOtherText((previous) => ({ ...previous, [index]: value }));
    },
    buildAnswers: () =>
      Object.fromEntries(
        questions.map((question, index) => [question.id ?? question.question, answerFor(index)])
      ),
  };
}

/**
 * Agent questions, one per tab (OS-1456). Multiple questions get a tab strip labeled
 * from each `header`, with a checkmark once answered, `Next` until the last tab, then
 * `Send answers` — disabled until every question has an answer. A single question drops
 * the strip, which would carry no information.
 */
function QuestionCard({
  request,
  onRespond,
  disabled,
  runtimeLabel,
}: {
  request: InteractionRequest;
  onRespond: (responseJson: string) => void;
  disabled: boolean;
  runtimeLabel: string;
}) {
  const payload = parsePayload(request);
  const questions = parseQuestions(payload);
  const title = `${runtimeLabel} has a question`;
  const answers = useQuestionAnswers(questions);
  const [activeIndex, setActiveIndex] = useState(0);

  const send = () => onRespond(JSON.stringify({ answers: answers.buildAnswers() }));

  const sendButton = (
    <Button
      size="sm"
      className="cursor-pointer"
      disabled={disabled || !answers.allAnswered || questions.length === 0}
      onClick={send}
    >
      <Check className="size-3.5" /> Send answers
    </Button>
  );

  if (questions.length <= 1) {
    return (
      <CardShell
        icon={<MessageCircleQuestion className="size-4 shrink-0" />}
        title={title}
      >
        {/* Body scrolls, Send stays pinned below it. */}
        <QuestionBodyScrollArea>
          {questions.map((question, index) => (
            <QuestionFields
              key={index}
              question={question}
              index={index}
              questionKey={buildQuestionKey(request.requestId, index)}
              answers={answers}
              disabled={disabled}
            />
          ))}
        </QuestionBodyScrollArea>
        <div className="mt-3">{sendButton}</div>
      </CardShell>
    );
  }

  const isLast = activeIndex === questions.length - 1;

  return (
    <CardShell
      icon={<MessageCircleQuestion className="size-4 shrink-0" />}
      title={title}
      toolbar={
        <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
          {answers.answeredCount} of {questions.length} answered
        </span>
      }
    >
      <Tabs
        className="gap-0"
        value={String(activeIndex)}
        onValueChange={(value) => setActiveIndex(Number(value))}
      >
        {/*
          The card also renders inside narrow mini previews, where it must
          shrink rather than widen its host (cli-thread-embeddable-view.md), so
          the strip scrolls instead of wrapping. The mask fades the trailing
          edge so a clipped strip reads as scrollable, not as a cut-off label.
        */}
        <div className="min-w-0 [mask-image:linear-gradient(to_right,black_calc(100%-1.5rem),transparent)]">
          <TabsList variant="underline" className="flex-nowrap overflow-x-auto">
            {questions.map((question, index) => {
              const label = question.header?.trim() || `Question ${index + 1}`;
              return (
                <TabsTrigger
                  key={index}
                  value={String(index)}
                  title={label}
                  className="shrink-0"
                >
                  <Check
                    className={cn(
                      "size-3.5 transition-opacity",
                      answers.isAnswered(index) ? "opacity-100" : "opacity-25"
                    )}
                  />
                  {label}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>

        {questions.map((question, index) => (
          <TabsContent key={index} value={String(index)} className="pt-3">
            <QuestionBodyScrollArea>
              <QuestionFields
                question={question}
                index={index}
                questionKey={buildQuestionKey(request.requestId, index)}
                answers={answers}
                disabled={disabled}
              />
            </QuestionBodyScrollArea>
          </TabsContent>
        ))}
      </Tabs>

      <div className="mt-3 flex items-center gap-2">
        {isLast ? (
          sendButton
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="cursor-pointer"
            disabled={disabled}
            onClick={() => setActiveIndex(activeIndex + 1)}
          >
            Next <ChevronRight className="size-3.5" />
          </Button>
        )}

        {/*
          On the last tab the primary action is Send, so an unanswered question
          earlier in the set would otherwise be a dead end: this jumps there.
        */}
        {isLast && !answers.allAnswered && answers.firstUnansweredIndex !== undefined ? (
          <Button
            size="sm"
            variant="ghost"
            className="cursor-pointer text-muted-foreground"
            disabled={disabled}
            onClick={() => setActiveIndex(answers.firstUnansweredIndex ?? 0)}
          >
            Go to unanswered
          </Button>
        ) : null}
      </div>
    </CardShell>
  );
}

function requestLabel(request: InteractionRequest, index: number): string {
  const payload = parsePayload(request);
  const question = parseQuestions(payload)[0];
  const candidates = [question?.header, question?.question, payload.title, payload.serverName, payload.toolName];
  return candidates.find((value): value is string => typeof value === "string" && value.trim().length > 0)
    ?? `Request ${index + 1}`;
}

/**
 * Pending interactive approval requests for a thread — tool approvals and
 * questions, answered inline while the agent run waits. Plan approvals are
 * excluded: their decision belongs to the plan panel in the thread (OS-1458).
 */
export function InteractionRequestCards({
  threadId,
  className,
  runtimeLabel = "Claude",
}: {
  threadId: Id<"cliThreads">;
  className?: string;
  /** The thread runtime's display name, e.g. "Antigravity". */
  runtimeLabel?: string;
}) {
  const pending = useQuery(api.cli.interactionRequests.listPendingByThread, {
    threadId,
  });
  const respond = useMutation(api.cli.interactionRequests.respond);
  const [respondingIds, setRespondingIds] = useState<Set<string>>(new Set());

  const cards = Array.isArray(pending)
    ? pending.filter((request) => request.kind !== "plan-approval")
    : [];

  if (cards.length === 0) {
    return null;
  }

  const handleRespond = (request: InteractionRequest, responseJson: string) => {
    setRespondingIds((previous) => new Set(previous).add(request.requestId));
    void respond({
      threadId,
      requestId: request.requestId,
      responseJson,
    }).catch(() => {
      toast.error("Could not send the response — the request may have expired.");
      setRespondingIds((previous) => {
        const next = new Set(previous);
        next.delete(request.requestId);
        return next;
      });
    });
  };

  return (
    <InteractionRequestStack
      className={className}
      noun={cards.every(request => request.kind === "question" && parsePayload(request).elicitation !== true) ? "questions" : "requests"}
      items={cards.map((request, index) => ({
        id: request.requestId,
        label: requestLabel(request, index),
        render: (inactive) => {
          const disabled = inactive || respondingIds.has(request.requestId);
          const payload = parsePayload(request);
          const props = {
            request,
            disabled,
            onRespond: (responseJson: string) => {
              if (!disabled) handleRespond(request, responseJson);
            },
          };
          return payload.elicitation === true ? (
            <McpElicitationCard payload={payload} disabled={disabled} onRespond={props.onRespond} />
          ) : request.kind === "question" ? (
            <QuestionCard {...props} runtimeLabel={runtimeLabel} />
          ) : (
            <ToolApprovalCard {...props} />
          );
        },
      }))}
    />
  );
}

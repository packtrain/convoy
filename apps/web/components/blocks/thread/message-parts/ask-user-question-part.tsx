import { useEffect, useMemo, useState } from "react";
import type { DynamicToolUIPart } from "ai";
import { Check, ChevronRight, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CardBlock, CardBlockError, CardBlockFooter } from "@/components/custom/card-block";
import { Input } from "@/components/ui/input";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  buildQuestionKey,
  QuestionOptionList,
} from "@/components/blocks/thread/question-option-list";
import {
  parseAskUserQuestionToolPart,
  type AskUserQuestionResponsePayload,
} from "@/lib/ai-tools/ask-user-question";
import { cn } from "@/lib/utils";
import { getErrorMessage } from "@/lib/errors";

interface AskUserQuestionPartProps {
  part: DynamicToolUIPart;
  onSubmit?: (payload: AskUserQuestionResponsePayload) => Promise<void> | void;
  submittedResponse?: AskUserQuestionResponsePayload;
}

type DraftAnswer = {
  selectedOptionLabels: string[];
  customAnswer: string;
};

function createDraftAnswers(count: number): DraftAnswer[] {
  return Array.from({ length: count }).map(() => ({
    selectedOptionLabels: [],
    customAnswer: "",
  }));
}

function toDraftAnswers(
  questionCount: number,
  response?: AskUserQuestionResponsePayload
): DraftAnswer[] {
  const drafts = createDraftAnswers(questionCount);
  if (!response) {
    return drafts;
  }

  for (const answer of response.answers) {
    if (answer.questionIndex < 0 || answer.questionIndex >= drafts.length) {
      continue;
    }

    drafts[answer.questionIndex] = {
      selectedOptionLabels: answer.selectedOptionLabels,
      customAnswer: answer.customAnswer ?? "",
    };
  }

  return drafts;
}

function hasAnswerSource(answer: DraftAnswer): boolean {
  return (
    answer.selectedOptionLabels.length > 0 ||
    answer.customAnswer.trim().length > 0
  );
}

function findFirstUnansweredIndex(drafts: DraftAnswer[]): number {
  const index = drafts.findIndex((answer) => !hasAnswerSource(answer));
  return index === -1 ? 0 : index;
}

function findNextUnansweredIndex(
  drafts: DraftAnswer[],
  currentIndex: number
): number {
  if (drafts.length === 0) {
    return 0;
  }

  for (let step = 1; step <= drafts.length; step += 1) {
    const index = (currentIndex + step) % drafts.length;
    const answer = drafts[index] ?? { selectedOptionLabels: [], customAnswer: "" };
    if (!hasAnswerSource(answer)) {
      return index;
    }
  }

  return currentIndex;
}

export function AskUserQuestionPart({
  part,
  onSubmit,
  submittedResponse,
}: AskUserQuestionPartProps) {
  const parsed = useMemo(() => parseAskUserQuestionToolPart(part), [part]);
  const [draftAnswers, setDraftAnswers] = useState<DraftAnswer[]>(
    toDraftAnswers(parsed?.questions.length ?? 0, submittedResponse)
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [localSubmittedResponse, setLocalSubmittedResponse] =
    useState<AskUserQuestionResponsePayload | null>(null);
  const [activeTabIndex, setActiveTabIndex] = useState(0);

  useEffect(() => {
    if (!parsed) {
      setDraftAnswers([]);
      setLocalSubmittedResponse(null);
      setSubmissionError(null);
      setActiveTabIndex(0);
      return;
    }

    const nextDrafts = toDraftAnswers(parsed.questions.length, submittedResponse);
    setDraftAnswers(nextDrafts);
    setLocalSubmittedResponse(null);
    setSubmissionError(null);
    setActiveTabIndex(findFirstUnansweredIndex(nextDrafts));
  }, [parsed, submittedResponse]);

  if (!parsed) {
    return null;
  }

  const effectiveSubmitted = submittedResponse ?? localSubmittedResponse;
  const isLocked = effectiveSubmitted !== null;

  const setDraftAnswer = (
    questionIndex: number,
    update: (current: DraftAnswer) => DraftAnswer
  ) => {
    setDraftAnswers((current) =>
      current.map((answer, index) =>
        index === questionIndex ? update(answer) : answer
      )
    );
  };

  const toggleOption = (
    questionIndex: number,
    optionLabel: string,
    multiSelect: boolean
  ) => {
    if (isLocked || isSubmitting) {
      return;
    }

    setDraftAnswer(questionIndex, (current) => {
      if (!multiSelect) {
        const nextSelected =
          current.selectedOptionLabels[0] === optionLabel ? [] : [optionLabel];
        return {
          selectedOptionLabels: nextSelected,
          customAnswer: "",
        };
      }

      const isSelected = current.selectedOptionLabels.includes(optionLabel);
      const nextSelected = isSelected
        ? current.selectedOptionLabels.filter((label) => label !== optionLabel)
        : [...current.selectedOptionLabels, optionLabel];
      return {
        ...current,
        selectedOptionLabels: nextSelected,
      };
    });
  };

  const updateCustomAnswer = (
    questionIndex: number,
    value: string,
    multiSelect: boolean
  ) => {
    if (isLocked || isSubmitting) {
      return;
    }

    setDraftAnswer(questionIndex, (current) => {
      if (!multiSelect && value.trim().length > 0) {
        return {
          selectedOptionLabels: [],
          customAnswer: value,
        };
      }

      return {
        ...current,
        customAnswer: value,
      };
    });
  };

  const canSubmit =
    Boolean(onSubmit) &&
    !isLocked &&
    !isSubmitting &&
    draftAnswers.length === parsed.questions.length &&
    draftAnswers.every((answer) => hasAnswerSource(answer));
  const allAnswered =
    draftAnswers.length === parsed.questions.length &&
    draftAnswers.every((answer) => hasAnswerSource(answer));
  const nextUnansweredIndex = findNextUnansweredIndex(draftAnswers, activeTabIndex);
  const answeredCount = draftAnswers.filter((answer) =>
    hasAnswerSource(answer)
  ).length;
  const isLastTab = activeTabIndex >= parsed.questions.length - 1;

  const handleSubmit = async () => {
    if (!onSubmit || !canSubmit || isSubmitting) {
      return;
    }

    setSubmissionError(null);
    setIsSubmitting(true);

    const answers = parsed.questions.map((question, questionIndex) => {
      const draft = draftAnswers[questionIndex] ?? {
        selectedOptionLabels: [],
        customAnswer: "",
      };
      const customAnswer = draft.customAnswer.trim();

      return {
        questionIndex,
        header: question.header,
        question: question.question,
        multiSelect: question.multiSelect,
        selectedOptionLabels: draft.selectedOptionLabels,
        ...(customAnswer ? { customAnswer } : {}),
      };
    });

    const payload: AskUserQuestionResponsePayload = {
      toolName: "AskUserQuestion",
      toolCallId: parsed.toolCallId,
      submittedAt: Date.now(),
      answers,
    };

    try {
      await onSubmit(payload);
      setLocalSubmittedResponse(payload);
    } catch (error) {
      const message =
        getErrorMessage(error, "Could not submit answers.");
      setSubmissionError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const goToNextUnansweredQuestion = () => {
    if (isLocked || isSubmitting || draftAnswers.length === 0) {
      return;
    }

    setActiveTabIndex(nextUnansweredIndex);
  };

  return (
    <CardBlock>
      <Tabs
        className="gap-0"
        value={String(activeTabIndex)}
        onValueChange={(v) => setActiveTabIndex(Number(v))}
      >
        {/*
          A single question needs no strip — it would carry no information.
          The strip scrolls rather than wraps so the panel shrinks inside narrow
          embeds instead of widening its host; the mask fades the trailing edge
          so a clipped strip reads as scrollable.
        */}
        {parsed.questions.length > 1 && (
          <div className="min-w-0 [mask-image:linear-gradient(to_right,black_calc(100%-1.5rem),transparent)]">
            <TabsList
              variant="underline"
              className="flex-nowrap overflow-x-auto bg-muted/60"
            >
              {parsed.questions.map((question, questionIndex) => {
                const label =
                  question.header?.trim() || `Question ${questionIndex + 1}`;
                const answered = hasAnswerSource(
                  draftAnswers[questionIndex] ?? {
                    selectedOptionLabels: [],
                    customAnswer: "",
                  }
                );

                return (
                  <TabsTrigger
                    key={buildQuestionKey(parsed.toolCallId, questionIndex)}
                    value={String(questionIndex)}
                    title={label}
                    className="shrink-0"
                  >
                    <Check
                      className={cn(
                        "size-3.5 transition-opacity",
                        answered ? "opacity-100" : "opacity-25"
                      )}
                    />
                    {label}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </div>
        )}

        {parsed.questions.map((question, questionIndex) => {
          const draft = draftAnswers[questionIndex] ?? {
            selectedOptionLabels: [],
            customAnswer: "",
          };
          const questionKey = buildQuestionKey(parsed.toolCallId, questionIndex);

          return (
            <TabsContent
              key={questionKey}
              value={String(questionIndex)}
              className="space-y-3 px-3 py-3"
            >
              <p className="text-sm text-foreground">{question.question}</p>

              <QuestionOptionList
                name={questionKey}
                options={question.options}
                multiSelect={question.multiSelect}
                selectedLabels={draft.selectedOptionLabels}
                disabled={isLocked || isSubmitting}
                onToggle={(label) =>
                  toggleOption(questionIndex, label, question.multiSelect)
                }
              />

              {isLocked ? (
                draft.customAnswer.trim() && (
                  <div className="rounded-md bg-muted/40 px-3 py-2">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Custom answer
                    </p>
                    <p className="mt-1 text-sm text-foreground">
                      {draft.customAnswer.trim()}
                    </p>
                  </div>
                )
              ) : (
                <Input
                  value={draft.customAnswer}
                  disabled={isSubmitting}
                  placeholder="Other"
                  onChange={(event) =>
                    updateCustomAnswer(
                      questionIndex,
                      event.target.value,
                      question.multiSelect
                    )
                  }
                />
              )}
            </TabsContent>
          );
        })}
      </Tabs>

      {submissionError && <CardBlockError>{submissionError}</CardBlockError>}

      {!isLocked && onSubmit && (
        <CardBlockFooter className="justify-between gap-2">
          {parsed.questions.length > 1 ? (
            <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
              {answeredCount} of {parsed.questions.length} answered
            </span>
          ) : (
            <span />
          )}

          <span className="flex items-center gap-2">
            {/*
              The last tab's primary action is Submit, so an unanswered earlier
              question would be a dead end: this jumps to the first one.
            */}
            {isLastTab && !allAnswered && (
              <Button
                size="sm"
                type="button"
                variant="ghost"
                className="text-muted-foreground"
                disabled={isSubmitting}
                onClick={goToNextUnansweredQuestion}
              >
                Go to unanswered
              </Button>
            )}

            {isLastTab ? (
              <Button
                size="sm"
                type="button"
                disabled={!canSubmit}
                onClick={handleSubmit}
              >
                <Send className="size-3.5" />
                Submit answers
              </Button>
            ) : (
              <Button
                size="sm"
                type="button"
                variant="outline"
                disabled={isSubmitting}
                onClick={() => setActiveTabIndex(activeTabIndex + 1)}
              >
                Next
                <ChevronRight className="size-3.5" />
              </Button>
            )}
          </span>
        </CardBlockFooter>
      )}
    </CardBlock>
  );
}

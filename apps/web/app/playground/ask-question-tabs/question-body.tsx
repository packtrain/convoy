"use client";

import { useId } from "react";
import { Input } from "@/components/ui/input";
import {
  buildQuestionKey,
  QuestionOptionList,
  QuestionOptionRow,
} from "@/components/blocks/thread/question-option-list";
import type { DemoQuestion, QuestionAnswers } from "./question-answers";

/**
 * One question's prompt + option rows + "Other…" free-text field. Shared by
 * every demo variant so the variants differ only in navigation shell, not in
 * how a single question looks or behaves, and rendered through the same
 * `QuestionOptionList` the thread cards use so the demo cannot drift from what
 * ships (OS-1602).
 */
export function QuestionBody({
  question,
  index,
  answers,
}: {
  question: DemoQuestion;
  index: number;
  answers: QuestionAnswers;
}) {
  const multiSelect = question.multiSelect === true;
  const isOtherOpen = answers.otherOpen[index] ?? false;
  // The page renders several cards at once, so the radio-group name has to be
  // unique per card instance, not just per question index.
  const questionKey = buildQuestionKey(useId(), index);

  return (
    <div>
      <p className="mb-1.5 text-sm text-foreground">{question.question}</p>
      <QuestionOptionList
        name={questionKey}
        options={question.options}
        multiSelect={multiSelect}
        selectedLabels={answers.selected[index] ?? []}
        onToggle={(label) => answers.toggleOption(index, label, multiSelect)}
      >
        <QuestionOptionRow
          id={`${questionKey}-other`}
          name={questionKey}
          label="Other…"
          multiSelect={multiSelect}
          checked={isOtherOpen}
          onToggle={() => answers.toggleOther(index, multiSelect)}
        >
          {isOtherOpen ? (
            <Input
              autoFocus
              placeholder="Type a custom answer"
              value={answers.otherText[index] ?? ""}
              onChange={(event) => answers.setOther(index, event.target.value)}
            />
          ) : null}
        </QuestionOptionRow>
      </QuestionOptionList>
    </div>
  );
}

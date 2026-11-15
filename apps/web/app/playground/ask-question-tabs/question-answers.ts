"use client";

import { useCallback, useMemo, useState } from "react";

export type DemoQuestionOption = {
  label: string;
  description?: string;
};

export type DemoQuestion = {
  question: string;
  header?: string;
  options: DemoQuestionOption[];
  multiSelect?: boolean;
};

/**
 * Answer state for the demo question cards, keyed by question *index* rather than text: the
 * shipped card keys by `question.question`, so two identically-worded questions share one
 * answer slot. Index keys make each tab independent.
 */
export function useQuestionAnswers(questions: DemoQuestion[]) {
  const [selected, setSelected] = useState<Record<number, string[]>>({});
  const [otherOpen, setOtherOpen] = useState<Record<number, boolean>>({});
  const [otherText, setOtherText] = useState<Record<number, string>>({});

  const answerFor = useCallback(
    (index: number): string => {
      const labels = selected[index] ?? [];
      const custom = otherOpen[index] ? (otherText[index] ?? "").trim() : "";
      return [...labels, ...(custom ? [custom] : [])].join(", ");
    },
    [selected, otherOpen, otherText]
  );

  const isAnswered = useCallback(
    (index: number) => answerFor(index).length > 0,
    [answerFor]
  );

  const unansweredIndexes = useMemo(
    () =>
      questions
        .map((_, index) => index)
        .filter((index) => !isAnswered(index)),
    [questions, isAnswered]
  );

  const allAnswered = questions.length > 0 && unansweredIndexes.length === 0;

  const toggleOption = useCallback(
    (index: number, label: string, multiSelect: boolean) => {
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
        // Single-select: re-clicking the selected option clears it.
        return { ...previous, [index]: current.includes(label) ? [] : [label] };
      });
      if (!multiSelect) {
        setOtherOpen((previous) => ({ ...previous, [index]: false }));
      }
    },
    []
  );

  const toggleOther = useCallback((index: number, multiSelect: boolean) => {
    setOtherOpen((previous) => ({ ...previous, [index]: !previous[index] }));
    if (!multiSelect) {
      setSelected((previous) => ({ ...previous, [index]: [] }));
    }
  }, []);

  const setOther = useCallback((index: number, value: string) => {
    setOtherText((previous) => ({ ...previous, [index]: value }));
  }, []);

  const buildResponse = useCallback(
    () => ({
      answers: Object.fromEntries(
        questions.map((question, index) => [question.question, answerFor(index)])
      ),
    }),
    [questions, answerFor]
  );

  return {
    selected,
    otherOpen,
    otherText,
    answerFor,
    isAnswered,
    unansweredIndexes,
    answeredCount: questions.length - unansweredIndexes.length,
    allAnswered,
    toggleOption,
    toggleOther,
    setOther,
    buildResponse,
  };
}

export type QuestionAnswers = ReturnType<typeof useQuestionAnswers>;

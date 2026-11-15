import { describe, expect, test } from "vitest";
import {
  extractLatestAskUserQuestionResponses,
  formatAskUserQuestionResponse,
  parseAskUserQuestionResponse,
  parseAskUserQuestionToolPart,
  type AskUserQuestionResponsePayload,
} from "./ask-user-question";

function makePayload(
  overrides: Partial<AskUserQuestionResponsePayload> = {}
): AskUserQuestionResponsePayload {
  return {
    toolName: "AskUserQuestion",
    toolCallId: "toolu_123",
    submittedAt: 1739299200000,
    answers: [
      {
        questionIndex: 0,
        header: "Testing",
        question: "Which testing frameworks do you prefer?",
        multiSelect: true,
        selectedOptionLabels: ["Vitest"],
      },
    ],
    ...overrides,
  };
}

describe("ask-user-question helpers", () => {
  test("parses options-only responses", () => {
    const payload = makePayload();
    const formatted = formatAskUserQuestionResponse(payload);
    const parsed = parseAskUserQuestionResponse(formatted);

    expect(parsed).toEqual(payload);
  });

  test("parses custom-only responses", () => {
    const payload = makePayload({
      answers: [
        {
          questionIndex: 0,
          header: "Autonomy",
          question: "How autonomous should I be?",
          multiSelect: false,
          selectedOptionLabels: [],
          customAnswer: "Please check before major refactors",
        },
      ],
    });
    const parsed = parseAskUserQuestionResponse(
      formatAskUserQuestionResponse(payload)
    );

    expect(parsed).toEqual(payload);
  });

  test("parses mixed option and custom responses", () => {
    const payload = makePayload({
      answers: [
        {
          questionIndex: 0,
          header: "Focus areas",
          question: "Which areas are you touching?",
          multiSelect: true,
          selectedOptionLabels: ["Web frontend", "Convex backend"],
          customAnswer: "Also docs updates",
        },
      ],
    });
    const parsed = parseAskUserQuestionResponse(
      formatAskUserQuestionResponse(payload)
    );

    expect(parsed).toEqual(payload);
  });

  test("rejects malformed payload", () => {
    const malformed = [
      "<convoy:ask-user-question-response>",
      '{"toolName":"AskUserQuestion","toolCallId":"toolu_1","answers":"bad"}',
      "</convoy:ask-user-question-response>",
    ].join("\n");

    const parsed = parseAskUserQuestionResponse(malformed);
    expect(parsed).toBeNull();
  });

  test("extractLatestAskUserQuestionResponses uses latest message", () => {
    const first = makePayload({
      toolCallId: "toolu_same",
      submittedAt: 1,
      answers: [
        {
          questionIndex: 0,
          question: "Q",
          multiSelect: false,
          selectedOptionLabels: ["First"],
        },
      ],
    });
    const second = makePayload({
      toolCallId: "toolu_same",
      submittedAt: 2,
      answers: [
        {
          questionIndex: 0,
          question: "Q",
          multiSelect: false,
          selectedOptionLabels: ["Second"],
        },
      ],
    });

    const responses = extractLatestAskUserQuestionResponses([
      {
        role: "user",
        content: [{ data: formatAskUserQuestionResponse(first) }],
      },
      {
        role: "assistant",
        content: [{ data: formatAskUserQuestionResponse(first) }],
      },
      {
        role: "user",
        content: [{ data: formatAskUserQuestionResponse(second) }],
      },
    ]);

    expect(responses["toolu_same"]).toEqual(second);
  });

  test("parses AskUserQuestion dynamic tool input", () => {
    const part = {
      type: "dynamic-tool",
      toolName: "AskUserQuestion",
      toolCallId: "toolu_abc",
      state: "output-error",
      input: {
        questions: [
          {
            question: "Which testing frameworks do you prefer?",
            header: "Testing",
            multiSelect: true,
            options: [
              { label: "Vitest", description: "Fast tests" },
              { label: "Jest" },
            ],
          },
        ],
      },
      errorText: "Answer questions?",
    } as const;

    const parsed = parseAskUserQuestionToolPart(part);
    expect(parsed).toEqual({
      toolName: "AskUserQuestion",
      toolCallId: "toolu_abc",
      questions: [
        {
          question: "Which testing frameworks do you prefer?",
          header: "Testing",
          multiSelect: true,
          options: [
            { label: "Vitest", description: "Fast tests" },
            { label: "Jest" },
          ],
        },
      ],
    });
  });
});

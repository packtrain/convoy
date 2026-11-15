/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { AskUserQuestionPart } from "./ask-user-question-part";
import type { AskUserQuestionResponsePayload } from "@/lib/ai-tools/ask-user-question";

const basePart = {
  type: "dynamic-tool",
  toolName: "AskUserQuestion",
  toolCallId: "toolu_ask_1",
  state: "output-error",
  input: {
    questions: [
      {
        question: "Which testing frameworks do you prefer?",
        header: "Testing",
        multiSelect: true,
        options: [
          { label: "Vitest", description: "Fast Vite-native tests" },
          { label: "Jest", description: "Popular ecosystem" },
        ],
      },
      {
        question: "How autonomous should I be?",
        header: "Autonomy",
        multiSelect: false,
        options: [
          { label: "Ask before acting", description: "High confirmation" },
          { label: "Moderate", description: "Balanced" },
        ],
      },
    ],
  },
  errorText: "Answer questions?",
} as const;

function renderPart(props?: {
  onSubmit?: (payload: AskUserQuestionResponsePayload) => Promise<void> | void;
  submittedResponse?: AskUserQuestionResponsePayload;
}) {
  return render(
    <AskUserQuestionPart
      part={basePart}
      onSubmit={props?.onSubmit}
      submittedResponse={props?.submittedResponse}
    />
  );
}

describe("AskUserQuestionPart", () => {
  afterEach(() => {
    cleanup();
  });

  test("multi-select allows options and custom answer together", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderPart({ onSubmit });

    fireEvent.click(screen.getByLabelText("Vitest"));
    fireEvent.change(screen.getByPlaceholderText("Other"), {
      target: { value: "Also contract tests with Pact" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByLabelText("Moderate"));
    fireEvent.click(screen.getByRole("button", { name: "Submit answers" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    const payload = onSubmit.mock.calls[0]?.[0] as AskUserQuestionResponsePayload;
    expect(payload.answers[0]?.selectedOptionLabels).toEqual(["Vitest"]);
    expect(payload.answers[0]?.customAnswer).toBe("Also contract tests with Pact");
  });

  test("single-select custom answer clears selected option", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderPart({ onSubmit });

    fireEvent.click(screen.getByLabelText("Vitest"));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByLabelText("Moderate"));
    fireEvent.change(screen.getByPlaceholderText("Other"), {
      target: { value: "Please ask before major refactors" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit answers" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    const payload = onSubmit.mock.calls[0]?.[0] as AskUserQuestionResponsePayload;
    expect(payload.answers[1]?.selectedOptionLabels).toEqual([]);
    expect(payload.answers[1]?.customAnswer).toBe(
      "Please ask before major refactors"
    );
  });

  test("single-select option clears existing custom answer", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderPart({ onSubmit });

    fireEvent.click(screen.getByLabelText("Vitest"));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.change(screen.getByPlaceholderText("Other"), {
      target: { value: "Custom autonomy response" },
    });
    fireEvent.click(screen.getByLabelText("Moderate"));
    fireEvent.click(screen.getByRole("button", { name: "Submit answers" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    const payload = onSubmit.mock.calls[0]?.[0] as AskUserQuestionResponsePayload;
    expect(payload.answers[1]?.selectedOptionLabels).toEqual(["Moderate"]);
    expect(payload.answers[1]?.customAnswer).toBeUndefined();
  });

  test("a single question renders no tab strip", () => {
    const singleQuestionPart = {
      ...basePart,
      input: { questions: [basePart.input.questions[1]] },
    } as const;

    render(
      <AskUserQuestionPart part={singleQuestionPart} onSubmit={vi.fn()} />
    );

    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
    expect(screen.getByText("How autonomous should I be?")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Submit answers" }).hasAttribute("disabled")
    ).toBe(true);
  });

  test("trim-only validation blocks whitespace-only custom answers", () => {
    renderPart({ onSubmit: vi.fn() });

    fireEvent.click(screen.getByLabelText("Vitest"));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.change(screen.getByPlaceholderText("Other"), {
      target: { value: "   " },
    });

    // On the last tab Submit is shown but stays disabled: a whitespace-only
    // custom answer is not an answer.
    expect(
      screen.getByRole("button", { name: "Submit answers" }).hasAttribute("disabled")
    ).toBe(true);
    expect(screen.getByRole("button", { name: /go to unanswered/i })).toBeDefined();
  });

  test("locks and shows submitted custom answer when already answered", () => {
    const submittedResponse: AskUserQuestionResponsePayload = {
      toolName: "AskUserQuestion",
      toolCallId: "toolu_ask_1",
      submittedAt: 1739299200000,
      answers: [
        {
          questionIndex: 0,
          header: "Testing",
          question: "Which testing frameworks do you prefer?",
          multiSelect: true,
          selectedOptionLabels: ["Vitest"],
          customAnswer: "Use mutation tests too",
        },
        {
          questionIndex: 1,
          header: "Autonomy",
          question: "How autonomous should I be?",
          multiSelect: false,
          selectedOptionLabels: [],
          customAnswer: "Ask before broad changes",
        },
      ],
    };

    renderPart({ submittedResponse });

    expect(screen.queryByText("Submitted answers")).toBeNull();
    expect(screen.getByText("Use mutation tests too")).toBeDefined();
    expect(screen.getByRole("tab", { name: "Autonomy" })).toBeDefined();
    expect(
      screen.queryByRole("button", { name: "Submit answers" })
    ).toBeNull();
  });

  test("keeps later AskUserQuestion radio inputs interactive across messages", () => {
    const firstSubmittedResponse: AskUserQuestionResponsePayload = {
      toolName: "AskUserQuestion",
      toolCallId: "toolu_ask_1",
      submittedAt: 1739299200000,
      answers: [
        {
          questionIndex: 0,
          header: "Only one",
          question: "Pick one option",
          multiSelect: false,
          selectedOptionLabels: ["Option A"],
        },
      ],
    };

    const firstPart = {
      ...basePart,
      toolCallId: "toolu_ask_1",
      input: {
        questions: [
          {
            question: "Pick one option",
            header: "Only one",
            multiSelect: false,
            options: [{ label: "Option A" }, { label: "Option B" }],
          },
        ],
      },
    } as const;

    const secondPart = {
      ...basePart,
      toolCallId: "toolu_ask_2",
      input: firstPart.input,
    } as const;

    render(
      <div>
        <div data-testid="first-ask">
          <AskUserQuestionPart
            part={firstPart}
            submittedResponse={firstSubmittedResponse}
          />
        </div>
        <div data-testid="second-ask">
          <AskUserQuestionPart part={secondPart} />
        </div>
      </div>
    );

    const second = screen.getByTestId("second-ask");
    const secondRadios = within(second).getAllByRole("radio", {
      hidden: true,
    }) as HTMLInputElement[];
    fireEvent.click(within(second).getByText("Option B"));
    expect(secondRadios[1]?.checked).toBe(true);
  });
});

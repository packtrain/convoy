/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import {
  buildQuestionKey,
  QuestionOptionList,
  QuestionOptionRow,
} from "./question-option-list";

const OPTIONS = [
  { label: "Comments", description: "Someone posts a comment on a posting." },
  { label: "Candidates" },
];

afterEach(cleanup);

describe("buildQuestionKey", () => {
  test("namespaces by prompt identity and strips id-unsafe characters", () => {
    expect(buildQuestionKey("toolu_ask 1", 2)).toBe("toolu_ask-1-question-2");
  });

  test("keeps two prompts' controls from sharing a radio group", () => {
    expect(buildQuestionKey("req_a", 0)).not.toBe(buildQuestionKey("req_b", 0));
  });
});

describe("QuestionOptionList", () => {
  test("renders each option's label and description", () => {
    render(
      <QuestionOptionList
        name="q"
        options={OPTIONS}
        multiSelect={false}
        selectedLabels={[]}
        onToggle={vi.fn()}
      />
    );

    expect(screen.getByText("Comments")).toBeTruthy();
    expect(
      screen.getByText("Someone posts a comment on a posting.")
    ).toBeTruthy();
    // An option without a description renders just its label.
    expect(screen.getByText("Candidates")).toBeTruthy();
  });

  test("single-select renders a radio group of radios", () => {
    const onToggle = vi.fn();
    render(
      <QuestionOptionList
        name="q"
        options={OPTIONS}
        multiSelect={false}
        selectedLabels={["Comments"]}
        onToggle={onToggle}
      />
    );

    const group = screen.getByRole("radiogroup");
    const radios = within(group).getAllByRole("radio", {
      hidden: true,
    }) as HTMLInputElement[];
    expect(radios).toHaveLength(2);
    expect(radios[0]?.checked).toBe(true);
    // Every radio in one question shares the group name, so the browser
    // enforces "pick one" instead of the component doing it by hand.
    expect(radios.every((radio) => radio.name === "q")).toBe(true);

    fireEvent.click(screen.getByLabelText("Candidates"));
    expect(onToggle).toHaveBeenCalledWith("Candidates");
  });

  test("multi-select renders checkboxes and no radio group", () => {
    const onToggle = vi.fn();
    render(
      <QuestionOptionList
        name="q"
        options={OPTIONS}
        multiSelect
        selectedLabels={["Candidates"]}
        onToggle={onToggle}
      />
    );

    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(
      screen.getByRole("checkbox", { name: "Candidates" }).getAttribute("data-state")
    ).toBe("checked");

    fireEvent.click(screen.getByLabelText("Comments"));
    expect(onToggle).toHaveBeenCalledWith("Comments");
  });

  test("disabled options do not report toggles", () => {
    const onToggle = vi.fn();
    render(
      <QuestionOptionList
        name="q"
        options={OPTIONS}
        multiSelect
        selectedLabels={[]}
        disabled
        onToggle={onToggle}
      />
    );

    fireEvent.click(screen.getByLabelText("Comments"));
    expect(onToggle).not.toHaveBeenCalled();
  });

  test("children render as an extra row inside the same group", () => {
    render(
      <QuestionOptionList
        name="q"
        options={OPTIONS}
        multiSelect={false}
        selectedLabels={[]}
        onToggle={vi.fn()}
      >
        <p>Other row</p>
      </QuestionOptionList>
    );

    expect(within(screen.getByRole("radiogroup")).getByText("Other row")).toBeTruthy();
  });
});

describe("QuestionOptionRow", () => {
  function renderRow(children: React.ReactNode) {
    return render(
      <QuestionOptionRow
        id="other"
        name="q"
        label="Other…"
        multiSelect={false}
        checked
        onToggle={vi.fn()}
      >
        {children}
      </QuestionOptionRow>
    );
  }

  test("keeps a revealed field inside the row's selected surface", () => {
    const { container } = renderRow(<input placeholder="Type a custom answer" />);

    // The highlight has to live on the wrapper that holds *both* the label and
    // the field, or the field hangs off the bottom of the highlighted box.
    const surface = container.querySelector(".bg-muted");
    expect(surface).toBeTruthy();
    expect(
      surface?.contains(screen.getByPlaceholderText("Type a custom answer"))
    ).toBe(true);
  });

  test("keeps a revealed field outside the label", () => {
    renderRow(<input placeholder="Type a custom answer" />);

    // Nested in the label, every click into the field would re-toggle the row.
    const label = screen.getByText("Other…").closest("label");
    expect(label).toBeTruthy();
    expect(
      label?.contains(screen.getByPlaceholderText("Type a custom answer"))
    ).toBe(false);
  });
});

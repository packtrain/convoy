/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import { InteractionRequestCards } from "./interaction-request-cards";

Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });

const respondMock = vi.fn().mockResolvedValue(null);
let pendingRequests: unknown[] = [];

vi.mock("convex/react", () => ({
  useQuery: () => pendingRequests,
  useMutation: () => respondMock,
}));

vi.mock("@/components/ai-elements/message", () => ({
  MessageResponse: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

const threadId = "thread_1" as Id<"cliThreads">;

function questionRequest(questions: unknown[]) {
  return {
    requestId: "req_1",
    kind: "question",
    payloadJson: JSON.stringify({ toolName: "AskUserQuestion", questions }),
  };
}

function toolRequest(payload: Record<string, unknown>) {
  return {
    requestId: "req_1",
    kind: "tool-approval",
    payloadJson: JSON.stringify(payload),
  };
}

describe("ToolApprovalCard input preview", () => {
  afterEach(() => {
    cleanup();
    respondMock.mockClear();
    pendingRequests = [];
  });

  test("shows the bash command being approved", () => {
    pendingRequests = [
      toolRequest({
        toolName: "Bash",
        inputJson: JSON.stringify({ command: "rm -rf node_modules" }),
      }),
    ];

    render(<InteractionRequestCards threadId={threadId} />);

    expect(screen.getByText("rm -rf node_modules")).toBeTruthy();
  });

  test("shows the input preview on the shared tool surface", () => {
    pendingRequests = [
      toolRequest({
        toolName: "Bash",
        inputJson: JSON.stringify({ command: "rm -rf node_modules" }),
      }),
    ];

    render(<InteractionRequestCards threadId={threadId} />);

    expect(screen.getByText("rm -rf node_modules").closest("[data-slot='tool-surface']")).not.toBeNull();
  });

  test("falls back to the raw input when there is no known key", () => {
    pendingRequests = [
      toolRequest({
        toolName: "Weird",
        inputJson: JSON.stringify({ foo: 1 }),
      }),
    ];

    render(<InteractionRequestCards threadId={threadId} />);

    expect(screen.getByText(/"foo": 1/)).toBeTruthy();
  });

  test("renders without a preview when the payload has no input", () => {
    pendingRequests = [toolRequest({ toolName: "Bash" })];

    render(<InteractionRequestCards threadId={threadId} />);

    expect(screen.getByRole("button", { name: /allow/i })).toBeTruthy();
  });
});

describe("QuestionCard custom answers", () => {
  afterEach(() => {
    cleanup();
    respondMock.mockClear();
    pendingRequests = [];
  });

  test("names the thread's runtime in the title", () => {
    pendingRequests = [questionRequest([{ question: "Pick", options: [{ label: "A" }] }])];

    render(<InteractionRequestCards threadId={threadId} runtimeLabel="Antigravity" />);

    expect(screen.getByText("Antigravity has a question")).toBeTruthy();
  });

  test("sends a free-text answer typed under Other…", () => {
    pendingRequests = [
      questionRequest([
        {
          question: "Did the test work?",
          options: [{ label: "Success" }, { label: "Failed" }],
        },
      ]),
    ];

    render(<InteractionRequestCards threadId={threadId} />);

    const sendButton = screen.getByRole("button", { name: /send answers/i });
    expect(sendButton.hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByLabelText("Other…"));
    fireEvent.change(screen.getByPlaceholderText("Type a custom answer"), {
      target: { value: "Partially — one case flaked" },
    });
    fireEvent.click(sendButton);

    expect(respondMock).toHaveBeenCalledWith({
      threadId,
      requestId: "req_1",
      responseJson: JSON.stringify({
        answers: { "Did the test work?": "Partially — one case flaked" },
      }),
    });
  });

  test("single-select: picking an option clears Other, and vice versa", () => {
    pendingRequests = [
      questionRequest([
        {
          question: "Pick one",
          options: [{ label: "A" }, { label: "B" }],
        },
      ]),
    ];

    render(<InteractionRequestCards threadId={threadId} />);

    fireEvent.click(screen.getByLabelText("Other…"));
    fireEvent.change(screen.getByPlaceholderText("Type a custom answer"), {
      target: { value: "custom" },
    });
    fireEvent.click(screen.getByLabelText("A"));

    expect(screen.queryByPlaceholderText("Type a custom answer")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /send answers/i }));
    expect(respondMock).toHaveBeenCalledWith({
      threadId,
      requestId: "req_1",
      responseJson: JSON.stringify({ answers: { "Pick one": "A" } }),
    });
  });

  test("multi-select: combines picked labels with the custom answer", () => {
    pendingRequests = [
      questionRequest([
        {
          question: "Which features?",
          multiSelect: true,
          options: [{ label: "A" }, { label: "B" }],
        },
      ]),
    ];

    render(<InteractionRequestCards threadId={threadId} />);

    fireEvent.click(screen.getByLabelText("A"));
    fireEvent.click(screen.getByLabelText("Other…"));
    fireEvent.change(screen.getByPlaceholderText("Type a custom answer"), {
      target: { value: "C" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send answers/i }));

    expect(respondMock).toHaveBeenCalledWith({
      threadId,
      requestId: "req_1",
      responseJson: JSON.stringify({ answers: { "Which features?": "A, C" } }),
    });
  });

  test("a single question renders no tab strip", () => {
    pendingRequests = [
      questionRequest([{ question: "Only one?", options: [{ label: "Yes" }] }]),
    ];

    render(<InteractionRequestCards threadId={threadId} />);

    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("button", { name: /^next$/i })).toBeNull();
    expect(screen.getByText("Only one?")).toBeTruthy();
  });
});

describe("QuestionCard tabs", () => {
  afterEach(() => {
    cleanup();
    respondMock.mockClear();
    pendingRequests = [];
  });

  const TWO_QUESTIONS = [
    {
      header: "First",
      question: "Pick one option?",
      options: [{ label: "Alpha" }, { label: "Beta" }],
    },
    {
      header: "Second",
      question: "Pick several options?",
      multiSelect: true,
      options: [{ label: "Gamma" }, { label: "Delta" }],
    },
  ];

  test("shows one question at a time and advances with Next", () => {
    pendingRequests = [questionRequest(TWO_QUESTIONS)];

    render(<InteractionRequestCards threadId={threadId} />);

    expect(screen.getByText("Pick one option?")).toBeTruthy();
    expect(screen.queryByText("Pick several options?")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    expect(screen.getByText("Pick several options?")).toBeTruthy();
    expect(screen.queryByText("Pick one option?")).toBeNull();
  });

  test("labels tabs from the header and falls back to a numbered label", () => {
    pendingRequests = [
      questionRequest([
        { header: "First", question: "A?", options: [{ label: "x" }] },
        { question: "B?", options: [{ label: "y" }] },
      ]),
    ];

    render(<InteractionRequestCards threadId={threadId} />);

    const tabs = screen.getByRole("tablist");
    expect(within(tabs).getByText("First")).toBeTruthy();
    expect(within(tabs).getByText("Question 2")).toBeTruthy();
  });

  test("Send answers appears only on the last tab and unlocks once all are answered", () => {
    pendingRequests = [questionRequest(TWO_QUESTIONS)];

    render(<InteractionRequestCards threadId={threadId} />);

    expect(screen.queryByRole("button", { name: /send answers/i })).toBeNull();
    expect(screen.getByText("0 of 2 answered")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Alpha"));
    expect(screen.getByText("1 of 2 answered")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    const send = screen.getByRole("button", { name: /send answers/i });
    expect(screen.queryByRole("button", { name: /^next$/i })).toBeNull();
    expect(send.hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByLabelText("Gamma"));
    fireEvent.click(screen.getByLabelText("Delta"));
    expect(send.hasAttribute("disabled")).toBe(false);

    fireEvent.click(send);
    expect(respondMock).toHaveBeenCalledWith({
      threadId,
      requestId: "req_1",
      responseJson: JSON.stringify({
        answers: {
          "Pick one option?": "Alpha",
          "Pick several options?": "Gamma, Delta",
        },
      }),
    });
  });

  test("jumps back to an unanswered question from the last tab", () => {
    pendingRequests = [questionRequest(TWO_QUESTIONS)];

    render(<InteractionRequestCards threadId={threadId} />);

    // Skip the first question entirely and answer only the last one.
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(screen.getByLabelText("Gamma"));

    fireEvent.click(screen.getByRole("button", { name: /go to unanswered/i }));

    expect(screen.getByText("Pick one option?")).toBeTruthy();
  });

  test("single-select renders a radio group, multi-select renders checkboxes", () => {
    pendingRequests = [
      questionRequest([
        { header: "One", question: "Pick one?", options: [{ label: "Single" }] },
        {
          header: "Many",
          question: "Pick many?",
          multiSelect: true,
          options: [{ label: "Multi" }],
        },
      ]),
    ];

    render(<InteractionRequestCards threadId={threadId} />);

    expect(screen.getByRole("radiogroup")).toBeTruthy();
    // The radio input is visually hidden but must still carry the semantics.
    expect(screen.getByRole("radio", { name: "Single", hidden: true })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Multi" })).toBeTruthy();
  });

  test("shows each option's description next to its label", () => {
    pendingRequests = [
      questionRequest([
        {
          question: "Which notifications?",
          multiSelect: true,
          options: [
            {
              label: "Comments",
              description: "Get notified when someone posts a comment.",
            },
          ],
        },
      ]),
    ];

    render(<InteractionRequestCards threadId={threadId} />);

    // A chip could only carry this in a tooltip (OS-1602).
    expect(
      screen.getByText("Get notified when someone posts a comment.")
    ).toBeTruthy();
  });

  test("bounds the question body so a long option set cannot grow the host", () => {
    const manyOptions = Array.from({ length: 12 }, (_, index) => ({
      label: `Option ${index}`,
      description: `Description ${index}`,
    }));
    pendingRequests = [
      questionRequest([{ question: "Pick one?", options: manyOptions }]),
    ];

    const { container } = render(<InteractionRequestCards threadId={threadId} />);

    // These cards sit outside the scrolling conversation, so nothing upstream
    // bounds them: unbounded, they push the mini preview's fixed-height column
    // past the viewport and clamp the composer.
    const scroller = container.querySelector(".overflow-y-auto");
    expect(scroller).toBeTruthy();
    expect(scroller?.className).toMatch(/max-h-/);
    expect(scroller?.contains(screen.getByLabelText("Option 11"))).toBe(true);

    // Send must stay outside the scroller — pushed offscreen, the question
    // becomes unanswerable.
    const send = screen.getByRole("button", { name: /send answers/i });
    expect(scroller?.contains(send)).toBe(false);
  });

  describe("body fade follows scroll position", () => {
    // jsdom reports zero layout, so drive the measurements directly.
    function mockScroller({
      scrollHeight,
      clientHeight,
      scrollTop,
    }: {
      scrollHeight: number;
      clientHeight: number;
      scrollTop: number;
    }) {
      vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(
        scrollHeight
      );
      vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(
        clientHeight
      );
      vi.spyOn(HTMLElement.prototype, "scrollTop", "get").mockReturnValue(
        scrollTop
      );

      pendingRequests = [
        questionRequest([
          {
            question: "Pick one?",
            options: Array.from({ length: 8 }, (_, index) => ({
              label: `Option ${index}`,
              description: `Description ${index}`,
            })),
          },
        ]),
      ];

      const { container } = render(<InteractionRequestCards threadId={threadId} />);
      const scroller = container.querySelector(".overflow-y-auto");
      expect(scroller).toBeTruthy();
      return scroller as HTMLElement;
    }

    afterEach(() => {
      vi.restoreAllMocks();
    });

    test("fades the bottom edge while more content is below", () => {
      const scroller = mockScroller({
        scrollHeight: 400,
        clientHeight: 200,
        scrollTop: 0,
      });

      expect(scroller.className).toContain("black_calc(100%-2rem),transparent)");
      expect(scroller.className).not.toContain("transparent,black_2rem");
    });

    test("fades both edges mid-scroll", () => {
      const scroller = mockScroller({
        scrollHeight: 400,
        clientHeight: 200,
        scrollTop: 100,
      });

      expect(scroller.className).toContain(
        "transparent,black_2rem,black_calc(100%-2rem),transparent"
      );
    });

    test("drops the bottom fade at the end of the list", () => {
      const scroller = mockScroller({
        scrollHeight: 400,
        clientHeight: 200,
        scrollTop: 200,
      });

      // Left on, it dims the final option for no reason — it reads as disabled.
      expect(scroller.className).not.toContain("black_calc(100%-2rem),transparent)");
      expect(scroller.className).toContain("transparent,black_2rem)");
    });

    test("does not fade a list that fits", () => {
      const scroller = mockScroller({
        scrollHeight: 200,
        clientHeight: 200,
        scrollTop: 0,
      });

      // Dimming the last row here advertises options that do not exist.
      expect(scroller.className).not.toContain("mask-image");
    });
  });

  test("keeps answers independent when two questions share identical text", () => {
    pendingRequests = [
      questionRequest([
        { header: "One", question: "Same text?", options: [{ label: "Yes" }] },
        { header: "Two", question: "Same text?", options: [{ label: "Yes" }] },
      ]),
    ];

    render(<InteractionRequestCards threadId={threadId} />);

    fireEvent.click(screen.getByLabelText("Yes"));

    // Answering the first tab must not mark the second one answered.
    expect(screen.getByText("1 of 2 answered")).toBeTruthy();
  });
});


describe("Codex input semantics", () => {
  afterEach(() => { cleanup(); respondMock.mockClear(); pendingRequests = []; });

  test("hides custom input when the provider disallows it and submits the question ID", () => {
    pendingRequests = [questionRequest([{ id: "q1", question: "Choose", isOther: false, options: [{ label: "A" }] }])];
    render(<InteractionRequestCards threadId={threadId} />);
    expect(screen.queryByLabelText("Other…")).toBeNull();
    fireEvent.click(screen.getByLabelText("A"));
    fireEvent.click(screen.getByRole("button", { name: /send answers/i }));
    expect(respondMock).toHaveBeenCalledWith(expect.objectContaining({ responseJson: JSON.stringify({ answers: { q1: "A" } }) }));
  });

  test("masks freeform secret answers", () => {
    pendingRequests = [questionRequest([{ id: "secret", question: "Token", isSecret: true, options: [] }])];
    render(<InteractionRequestCards threadId={threadId} />);
    const input = screen.getByLabelText("Token");
    expect(input.getAttribute("type")).toBe("password");
  });

  test("preserves whitespace in secret answers", () => {
    pendingRequests = [questionRequest([{ id: "secret", question: "Token", isSecret: true, options: [] }])];
    render(<InteractionRequestCards threadId={threadId} />);
    fireEvent.change(screen.getByLabelText("Token"), { target: { value: "  secret  " } });
    fireEvent.click(screen.getByRole("button", { name: /send answers/i }));
    expect(respondMock).toHaveBeenCalledWith(expect.objectContaining({ responseJson: JSON.stringify({ answers: { secret: "  secret  " } }) }));
  });

  test("MCP single-choice fields use shared Select triggers", () => {
    pendingRequests = [{ requestId: "mcp", kind: "question", payloadJson: JSON.stringify({ elicitation: true, mode: "form", requestedSchema: { type: "object", properties: {
      color: { type: "string", title: "Color", enum: ["Blue", "Green"], default: "Blue" },
      enabled: { type: "boolean", title: "Enabled", default: false },
    } } }) }];
    render(<InteractionRequestCards threadId={threadId} />);
    for (const name of ["Color", "Enabled"]) {
      expect(screen.getByRole("combobox", { name }).getAttribute("data-slot")).toBe("select-trigger");
    }
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(respondMock).toHaveBeenCalledWith(expect.objectContaining({ responseJson: JSON.stringify({ action: "accept", content: { color: "Blue", enabled: false } }) }));
  });

  test("MCP required Select stays unanswered without a default", () => {
    pendingRequests = [{ requestId: "mcp", kind: "question", payloadJson: JSON.stringify({ elicitation: true, mode: "form", requestedSchema: { type: "object", properties: {
      choice: { type: "string", title: "Choice", enum: ["undefined", "Other"] },
    }, required: ["choice"] } }) }];
    render(<InteractionRequestCards threadId={threadId} />);
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(respondMock).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Choice" }), { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: "Other" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(respondMock).toHaveBeenCalledWith(expect.objectContaining({ responseJson: JSON.stringify({ action: "accept", content: { choice: "Other" } }) }));
  });

  test("MCP scrollable fields reserve space for focus rings", () => {
    pendingRequests = [{ requestId: "mcp", kind: "question", payloadJson: JSON.stringify({ elicitation: true, mode: "form", requestedSchema: { type: "object", properties: { nickname: { type: "string", title: "Nickname" } } } }) }];
    render(<InteractionRequestCards threadId={threadId} />);
    const scrollArea = screen.getByLabelText("Nickname").closest(".overflow-y-auto");
    expect(scrollArea?.classList.contains("p-1")).toBe(true);
    expect(scrollArea?.classList.contains("-m-1")).toBe(true);
  });

  test("renders MCP form fields with typed values and explicit decline/cancel", () => {
    pendingRequests = [{ requestId: "mcp", kind: "question", payloadJson: JSON.stringify({ elicitation: true, mode: "form", serverName: "Test", message: "Fill details", requestedSchema: { type: "object", properties: { count: { type: "integer", title: "Count", minimum: 1 }, enabled: { type: "boolean", title: "Enabled" } }, required: ["count", "enabled"] } }) }];
    render(<InteractionRequestCards threadId={threadId} />);
    fireEvent.change(screen.getByLabelText("Count"), { target: { value: "3" } });
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Enabled" }), { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: "No" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(respondMock).toHaveBeenCalledWith(expect.objectContaining({ responseJson: JSON.stringify({ action: "accept", content: { count: 3, enabled: false } }) }));
    expect(screen.getByRole("button", { name: "Decline" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  test("renders an MCP URL without opening it automatically", () => {
    pendingRequests = [{ requestId: "url", kind: "question", payloadJson: JSON.stringify({ elicitation: true, mode: "url", serverName: "Test", message: "Sign in", url: "https://example.com/auth" }) }];
    render(<InteractionRequestCards threadId={threadId} />);
    expect(screen.getByRole("link", { name: "Open in browser" }).getAttribute("href")).toBe("https://example.com/auth");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(respondMock).toHaveBeenCalledWith(expect.objectContaining({ responseJson: JSON.stringify({ action: "accept", content: null }) }));
  });

  test("only offers the provider's available decisions", () => {
    pendingRequests = [toolRequest({ availableDecisions: ["acceptForSession", "cancel"] })];
    render(<InteractionRequestCards threadId={threadId} />);
    expect(screen.queryByRole("button", { name: "Allow" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Allow for session" }));
    expect(respondMock).toHaveBeenCalledWith(expect.objectContaining({ responseJson: JSON.stringify({ decisionIndex: 0 }) }));
  });
});

describe("Pending request stack", () => {
  afterEach(() => {
    cleanup();
    respondMock.mockClear();
    pendingRequests = [];
  });

  function request(requestId: string, question: string, label: string) {
    return {
      ...questionRequest([{ id: requestId, question, options: [{ label }] }]),
      requestId,
    };
  }

  const color = request("color", "Choose a color", "Red");
  const animal = request("animal", "Choose an animal", "Cat");

  function switchTo(name: string) {
    fireEvent.click(screen.getByRole("button", { name: `Open request: ${name}` }));
  }

  test("shows only one answer card when requests arrive separately", () => {
    pendingRequests = [color, animal];
    render(<InteractionRequestCards threadId={threadId} />);

    expect(screen.getAllByRole("button", { name: /send answers/i })).toHaveLength(1);
    expect(screen.queryByRole("tablist", { name: "Pending requests" })).toBeNull();
    expect(screen.queryByRole("button", { name: /spread cards|^all$/i })).toBeNull();
    expect(screen.getByRole("button", { name: "2 pending questions" })).toBeTruthy();
    switchTo("Choose an animal");
    expect(screen.getByRole("button", { name: /send answers/i })).toBeTruthy();
    expect(screen.getByLabelText("Cat").closest("[data-request-body]")?.hasAttribute("hidden")).toBe(false);
    expect(screen.getByLabelText("Red").closest("[data-request-body]")?.hasAttribute("hidden")).toBe(true);
  });

  test("preserves drafts across card switches and sends only the active request", () => {
    pendingRequests = [color, animal];
    render(<InteractionRequestCards threadId={threadId} />);

    fireEvent.click(screen.getByLabelText("Red"));
    switchTo("Choose an animal");
    const activePanel = screen.getByRole("group", { name: "Pending request: Choose an animal" });
    fireEvent.click(within(activePanel).getByLabelText("Other…"));
    fireEvent.change(within(activePanel).getByPlaceholderText("Type a custom answer"), {
      target: { value: "Otter" },
    });
    switchTo("Choose a color");
    expect((screen.getByLabelText("Red") as HTMLInputElement).checked).toBe(true);
    switchTo("Choose an animal");
    expect((screen.getByPlaceholderText("Type a custom answer") as HTMLInputElement).value).toBe("Otter");
    fireEvent.click(screen.getByRole("button", { name: /send answers/i }));
    expect(respondMock).toHaveBeenCalledExactlyOnceWith({
      threadId, requestId: "animal", responseJson: JSON.stringify({ answers: { animal: "Otter" } }),
    });
  });

  test("keeps drafts when another request arrives or the active request disappears", () => {
    pendingRequests = [color];
    const { rerender } = render(<InteractionRequestCards threadId={threadId} />);
    fireEvent.click(screen.getByLabelText("Red"));
    expect(screen.queryByRole("tablist", { name: "Pending requests" })).toBeNull();

    pendingRequests = [color, animal];
    rerender(<InteractionRequestCards threadId={threadId} />);
    expect((screen.getByLabelText("Red") as HTMLInputElement).checked).toBe(true);
    switchTo("Choose an animal");
    pendingRequests = [color];
    rerender(<InteractionRequestCards threadId={threadId} />);
    expect(screen.queryByRole("tablist", { name: "Pending requests" })).toBeNull();
    expect((screen.getByLabelText("Red") as HTMLInputElement).checked).toBe(true);
    expect(screen.getAllByRole("button", { name: /send answers/i })).toHaveLength(1);

    pendingRequests = [];
    rerender(<InteractionRequestCards threadId={threadId} />);
    expect(screen.queryByRole("button", { name: /send answers/i })).toBeNull();
  });

  test("keeps mixed approvals in the stack and does not switch when new requests arrive", () => {
    const approval = { ...toolRequest({ title: "Run command", toolName: "Shell" }), requestId: "approval" };
    pendingRequests = [color, approval];
    const { rerender } = render(<InteractionRequestCards threadId={threadId} />);
    expect(screen.queryByRole("button", { name: "Allow" })).toBeNull();
    switchTo("Run command");
    pendingRequests = [color, approval, animal];
    rerender(<InteractionRequestCards threadId={threadId} />);
    expect(screen.getByRole("group", { name: "Pending request: Run command" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "3 pending requests" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Allow" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /send answers/i })).toBeNull();
  });

  test("preserves an MCP form draft while switching requests", () => {
    pendingRequests = [color, {
      requestId: "mcp",
      kind: "question",
      payloadJson: JSON.stringify({
        elicitation: true, mode: "form", serverName: "Details", message: "Fill details",
        requestedSchema: {
          type: "object", properties: { count: { type: "integer", title: "Count" }, color: { type: "string", title: "Color", enum: ["Blue", "Green"] } },
          required: ["count"],
        },
      }),
    }];
    render(<InteractionRequestCards threadId={threadId} />);
    switchTo("Details");
    fireEvent.change(screen.getByLabelText("Count"), { target: { value: "3" } });
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Color" }), { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: "Green" }));
    switchTo("Choose a color");
    expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
    switchTo("Details");
    expect((screen.getByLabelText("Count") as HTMLInputElement).value).toBe("3");
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(respondMock).toHaveBeenCalledExactlyOnceWith({
      threadId, requestId: "mcp",
      responseJson: JSON.stringify({ action: "accept", content: { count: 3, color: "Green" } }),
    });
  });

  test("bounds the deck and exposes every request through the count button", () => {
    pendingRequests = Array.from({ length: 20 }, (_, index) =>
      request(`request-${index}`, `Choose option ${index}`, `Option ${index}`)
    );
    render(<InteractionRequestCards threadId={threadId} />);
    expect(screen.getAllByRole("button", { name: /^Open request:/ })).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: /send answers/i })).toHaveLength(1);
    fireEvent.keyDown(screen.getByRole("button", { name: "20 pending questions" }), { key: "ArrowDown" });
    expect(screen.getByRole("menuitemradio", { name: "Choose option 0" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Choose option 19" }));
    const active = screen.getByRole("group", { name: "Pending request: Choose option 19" });
    expect(within(active).getByLabelText("Option 19")).toBeTruthy();
    fireEvent.click(within(active).getByLabelText("Option 19"));
    fireEvent.click(screen.getByRole("button", { name: /send answers/i }));
    expect(respondMock).toHaveBeenCalledWith(expect.objectContaining({ requestId: "request-19" }));
  });

  test("spreads on hover or preview focus without adding layout height", () => {
    pendingRequests = [color, animal];
    render(<InteractionRequestCards threadId={threadId} />);
    const deck = screen.getByTestId("request-deck");
    const initialPadding = deck.style.paddingTop;
    fireEvent.mouseEnter(deck);
    expect(deck.getAttribute("data-expanded")).toBe("true");
    expect(deck.style.paddingTop).toBe(initialPadding);
    fireEvent.mouseLeave(deck);
    expect(deck.getAttribute("data-expanded")).toBe("false");
    fireEvent.focus(screen.getByRole("button", { name: "Open request: Choose an animal" }));
    expect(deck.getAttribute("data-expanded")).toBe("true");
  });

  test("inactive request controls are disabled and cannot respond", () => {
    pendingRequests = [color, animal];
    render(<InteractionRequestCards threadId={threadId} />);
    const inactive = screen.getByLabelText("Cat").closest("[data-request-body]")!;
    expect((screen.getByLabelText("Cat") as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(within(inactive as HTMLElement).getByText("Send answers"));
    expect(respondMock).not.toHaveBeenCalled();
  });

  test("collapses keyboard expansion if the focused preview expires", () => {
    pendingRequests = [color, animal];
    const { rerender } = render(<InteractionRequestCards threadId={threadId} />);
    fireEvent.focus(screen.getByRole("button", { name: "Open request: Choose an animal" }));
    pendingRequests = [color];
    rerender(<InteractionRequestCards threadId={threadId} />);
    expect(screen.getByTestId("request-deck").getAttribute("data-expanded")).toBe("false");
  });

  test("keeps a submitted request disabled when switching away and back", () => {
    pendingRequests = [color, animal];
    render(<InteractionRequestCards threadId={threadId} />);
    fireEvent.click(screen.getByLabelText("Red"));
    fireEvent.click(screen.getByRole("button", { name: /send answers/i }));
    switchTo("Choose an animal");
    fireEvent.click(screen.getByLabelText("Cat"));
    switchTo("Choose a color");
    expect((screen.getByRole("button", { name: /send answers/i }) as HTMLButtonElement).disabled).toBe(true);
    switchTo("Choose an animal");
    fireEvent.click(screen.getByRole("button", { name: /send answers/i }));
    expect(respondMock.mock.calls.map(([args]) => args.requestId)).toEqual(["color", "animal"]);
  });

  test("keeps the active draft and enables retry after a failed response", async () => {
    respondMock.mockRejectedValueOnce(new Error("Offline"));
    pendingRequests = [color, animal];
    render(<InteractionRequestCards threadId={threadId} />);
    switchTo("Choose an animal");
    fireEvent.click(screen.getByLabelText("Cat"));
    fireEvent.click(screen.getByRole("button", { name: /send answers/i }));
    await waitFor(() => {
      expect((screen.getByRole("button", { name: /send answers/i }) as HTMLButtonElement).disabled).toBe(false);
    });
    expect((screen.getByLabelText("Cat") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("group", { name: "Pending request: Choose an animal" })).toBeTruthy();
  });
});

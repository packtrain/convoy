/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { AssistantCliMessage } from "./assistant-cli-thread-message";
import type { AskUserQuestionResponsePayload } from "@/lib/ai-tools/ask-user-question";
import type { CliUiPart, ComposerMessageState } from "@/lib/cli-stream-ui";

const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

// The run's full diff file list loads lazily, only once the Changes card is
// expanded (OS-1600); unexpanded, the query is skipped.
vi.mock("./response-attachments", () => ({
  ResponseAttachments: ({ attachments }: { attachments: Array<{ fileName: string }> }) => (
    <div data-testid="reply-files">{attachments.map((attachment) => attachment.fileName).join(",")}</div>
  ),
}));

vi.mock("convex/react", () => ({
  useQuery: () => undefined,
}));

// The real card needs the task's results; this stand-in keeps the files' host visible.
vi.mock("@/components/blocks/checks", () => ({
  ReplyChecks: ({ attachments }: { attachments?: Array<{ fileName: string }> }) => (
    <div data-testid="reply-checks">
      {attachments?.length ? <div data-testid="reply-files">{attachments.map((attachment) => attachment.fileName).join(",")}</div> : null}
    </div>
  ),
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    disabled,
    onClick,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      data-disabled={disabled ? "" : undefined}
      onClick={disabled ? undefined : onClick}
    >
      {children}
    </button>
  ),
  DropdownMenuSub: ({ children }: { children: ReactNode }) => <div data-submenu="">{children}</div>,
  DropdownMenuSubTrigger: ({ children, disabled }: { children: ReactNode; disabled?: boolean }) => (
    <button type="button" role="menuitem" disabled={disabled} data-disabled={disabled ? "" : undefined}>
      {children}
    </button>
  ),
  DropdownMenuSubContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

// Branch and Handoff both offer "In a new thread" / "In a new tab"; find the item under its trigger.
function submenuItem(trigger: string, name: string) {
  const submenu = screen.getByRole("menuitem", { name: trigger }).closest<HTMLElement>("[data-submenu]")!;
  return within(submenu).getByRole("menuitem", { name });
}

function createRenderState(
  overrides: Partial<ComposerMessageState> = {}
): ComposerMessageState {
  return {
    normalizedEvents: [],
    parts: [],
    metadata: {},
    warnings: [],
    toolPartIndexById: new Map(),
    toolTimingsByCallId: new Map(),
    taskNoticeGroupIndexByKey: new Map(),
    taskNoticeGroupIndexByParentToolUseId: new Map(),
    deltaPartIndices: new Set(),
    narrativePartIndexByKey: new Map(),
    completedNarrativeKeys: new Set(),
    ...overrides,
  };
}

test.each([
  ["failed", "Sleep interrupted"],
  ["completed", "Sleep ended"],
] as const)("settles an unfinished sleep when the message is %s", (status, label) => {
  const renderState = createRenderState({ parts: [{ type: "sleep", state: "sleeping", startedAt: 1_000, durationMs: 30_000 }] });
  render(<AssistantCliMessage messageId="sleep-message" status={status} renderState={renderState} />);
  expect(screen.getByText(label)).toBeTruthy();
  expect(screen.queryByText(/left$/)).toBeNull();
  expect(renderState.parts[0]).toMatchObject({ state: "sleeping" });
  cleanup();
});

describe("AssistantCliMessage", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
    vi.restoreAllMocks();
  });

  test("renders text parts from renderState", () => {
    const renderState = createRenderState({
      parts: [{ type: "text", text: "Converted assistant text" }],
    });

    render(
      <AssistantCliMessage
        messageId="msg_assistant_1"
        cliType="claude-code"
        timestamp={Date.UTC(2026, 1, 9, 12, 0, 0)}
        renderState={renderState}
      />
    );
    expect(screen.getByText("Converted assistant text")).toBeDefined();
  });

  test("returns null when renderState is undefined", () => {
    const { container } = render(
      <AssistantCliMessage messageId="msg_assistant_1" renderState={undefined} />
    );
    expect(container.innerHTML).toBe("");
  });

  test("renders fallback when renderState has empty parts and no metadata", () => {
    const renderState = createRenderState();

    render(
      <AssistantCliMessage
        messageId="msg_assistant_1"
        renderState={renderState}
      />
    );
    expect(
      screen.getByText("Assistant render fallback")
    ).toBeDefined();
    expect(
      screen.getByText(
        "No renderable chunk events found for this assistant response."
      )
    ).toBeDefined();
  });

  test("renders runtime notice parts without falling back when a message has no text/tool parts", () => {
    const renderState = createRenderState({
      parts: [
        {
          type: "runtime-notice",
          code: "claude-api-retry",
          title: "Claude API retry",
          message: "Attempt 2 of 10. Retrying in 1.2s.",
          sessionId: "session-1",
          detailsJson: JSON.stringify({
            subtype: "api_retry",
            attempt: 2,
            maxRetries: 10,
          }),
        },
      ] as CliUiPart[],
    });

    render(
      <AssistantCliMessage
        messageId="msg_assistant_1"
        renderState={renderState}
      />
    );

    const noticeTrigger = screen.getByRole("button", {
      name: "Claude API retry: Attempt 2 of 10. Retrying in 1.2s.",
    });
    expect(noticeTrigger).toBeDefined();
    expect(screen.queryByText("Notice")).toBeNull();
    expect(screen.queryByText("Assistant render fallback")).toBeNull();

    fireEvent.click(noticeTrigger);
    expect(screen.getByText(/"subtype": "api_retry"/)).toBeDefined();
  });

  test("renders inline notice parts in chronological order", () => {
    const renderState = createRenderState({
      parts: [
        { type: "text", text: "Before" },
        {
          type: "runtime-notice",
          code: "claude-api-retry",
          title: "Claude API retry",
          message: "Attempt 2 of 10. Retrying in 1.2s.",
          detailsJson: JSON.stringify({ attempt: 2 }),
        },
        { type: "text", text: "After" },
      ] as CliUiPart[],
    });

    render(
      <AssistantCliMessage
        messageId="msg_assistant_1"
        renderState={renderState}
      />
    );

    const before = screen.getByText("Before");
    const noticeTrigger = screen.getByRole("button", {
      name: "Claude API retry: Attempt 2 of 10. Retrying in 1.2s.",
    });
    const after = screen.getByText("After");

    expect(
      before.compareDocumentPosition(noticeTrigger) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      noticeTrigger.compareDocumentPosition(after) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  test("renders task notice groups inline", () => {
    const renderState = createRenderState({
      parts: [
        { type: "text", text: "Before" },
        {
          type: "task-notice-group",
          groupKey: "task-1::tool-1",
          notices: [
            {
              code: "claude-system-task_started",
              title: "Claude runtime notice",
              message: "Claude reported task_started.",
              detailsJson: JSON.stringify({
                subtype: "task_started",
                payload: {
                  task_id: "task-1",
                  tool_use_id: "tool-1",
                  description: "Explore thread mark-as-read",
                  prompt: "Find the read-state flow",
                },
              }),
            },
            {
              code: "claude-system-task_notification",
              title: "Claude runtime notice",
              message: "Claude reported task_notification.",
              detailsJson: JSON.stringify({
                subtype: "task_notification",
                payload: {
                  task_id: "task-1",
                  tool_use_id: "tool-1",
                  status: "completed",
                  summary: "Explore thread mark-as-read",
                  output_file: "report.md",
                },
              }),
            },
          ],
        },
        { type: "text", text: "After" },
      ] as CliUiPart[],
    });

    render(
      <AssistantCliMessage
        messageId="msg_assistant_1"
        renderState={renderState}
      />
    );

    expect(
      screen.getByRole("button", {
        name: /Explore thread mark-as-read/i,
      })
    ).toBeDefined();
    expect(screen.getByText("Before")).toBeDefined();
    expect(screen.getByText("After")).toBeDefined();
  });

  test("renders when renderState has metadata but empty parts", () => {
    const renderState = createRenderState({
      metadata: {
        sessionId: "session-1",
        totalCostUsd: 0.05,
        durationMs: 2000,
      },
    });

    render(
      <AssistantCliMessage
        messageId="msg_assistant_1"
        cliType="claude-code"
        timestamp={Date.UTC(2026, 1, 9, 12, 0, 0)}
        renderState={renderState}
      />
    );
    // Should render (metadata exists), even with no parts.
    const runDetailsTrigger = screen.getByRole("button", {
      name: "Run details",
    });
    expect(runDetailsTrigger).toBeDefined();
  });

  test("renders warnings from renderState in composer", () => {
    const renderState = createRenderState({
      parts: [{ type: "text", text: "Content" }],
      warnings: ["tool-output for unknown toolCallId: orphan-1"],
    });

    render(
      <AssistantCliMessage
        messageId="msg_assistant_1"
        renderState={renderState}
      />
    );
    // Warnings don't block rendering — content should still appear.
    expect(screen.getByText("Content")).toBeDefined();
  });

  test("renders streaming indicator when message is streaming", () => {
    const renderState = createRenderState({
      parts: [{ type: "text", text: "Assistant body" }],
    });

    render(
      <div>
        <AssistantCliMessage
          messageId="msg_assistant_1"
          status="streaming"
          renderState={renderState}
        />
        <div data-testid="external-indicator">External status</div>
      </div>
    );

    expect(screen.getByText("Assistant body")).toBeDefined();
    expect(screen.getByText("Working")).toBeDefined();
    expect(screen.getByTestId("external-indicator")).toBeDefined();
  });

  test("renders streaming indicator above run stats", () => {
    const renderState = createRenderState({
      parts: [{ type: "text", text: "Assistant body" }],
      metadata: {
        sessionId: "session-1",
        totalCostUsd: 0.203,
        durationMs: 7525,
      },
    });

    render(
      <AssistantCliMessage
        messageId="msg_assistant_1"
        status="streaming"
        cliType="claude-code"
        renderState={renderState}
      />
    );
    const streamingText = screen.getByText("Working");
    const runDetailsTrigger = screen.getByRole("button", {
      name: "Run details",
    });
    expect(
      streamingText.compareDocumentPosition(runDetailsTrigger) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  test("hides the streaming indicator while an interactive prompt waits", () => {
    const renderState = createRenderState({
      parts: [
        { type: "text", text: "Assistant body" },
        {
          type: "dynamic-tool",
          toolName: "ExitPlanMode",
          toolCallId: "toolu_exit_pending",
          state: "input-available",
          input: { plan: "# Plan" },
        },
      ],
    });

    render(
      <AssistantCliMessage
        messageId="msg_assistant_1"
        status="streaming"
        renderState={renderState}
      />
    );

    expect(screen.queryByText("Working")).toBeNull();
  });

  test.each([
    ["codex", "gpt-6-astra", "max", "GPT-6 Astra", "Max"],
    ["claude-code", "opus", "high", "Opus", "High"],
    ["cursor", "gpt-5.6-sol", "xhigh", "GPT-5.6 Sol", "Extra high"],
    ["opencode", "openai/custom-model", "custom-effort", "custom-model", "custom-effort"],
    ["amp", "custom-model", "high", "custom-model", "high"],
    ["droid", "custom-model", "high", "custom-model", "high"],
    ["gemini", "custom-model", "high", "custom-model", "high"],
    ["coderabbit", "custom-model", "high", "custom-model", "high"],
    ["github-copilot", "custom-model", "high", "custom-model", "high"],
    ["other", "custom-model", "custom-effort", "custom-model", "custom-effort"],
  ] as const)("shows model and reasoning in %s run details", (cliType, cliModel, cliEffort, modelLabel, effortLabel) => {
    render(
      <AssistantCliMessage
        messageId="model-details"
        cliType={cliType}
        cliModel={cliModel}
        cliEffort={cliEffort}
        renderState={createRenderState({ parts: [{ type: "text", text: "Response" }] })}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Run details" }));
    expect(screen.getByText("Reasoning").parentElement?.textContent).toBe(`Reasoning${effortLabel}`);
    expect(screen.getByText("Model").parentElement?.textContent).toBe(`Model${modelLabel}`);
  });

  test.each([
    ["gpt-5.6-sol", "GPT-5.6 Sol"], ["custom-runtime-model", "custom-runtime-model"],
  ])("shows the persisted resolved model %s instead of Default", (resolvedCliModel, label) => {
    render(<AssistantCliMessage
      messageId="resolved-model" cliType="codex" cliModel="default" cliEffort="default"
      resolvedCliModel={resolvedCliModel}
      renderState={createRenderState({ metadata: { model: "gpt-5.5" } })}
    />);
    fireEvent.click(screen.getByRole("button", { name: "Run details" }));
    expect(screen.getByText("Model").parentElement?.textContent).toBe(`Model${label}`);
    expect(screen.getByText("Reasoning").parentElement?.textContent).toBe("ReasoningDefault");
  });

  test.each([
    { model: "provider/actual-model" },
    { systemInit: { model: "provider/actual-model" } },
  ])("prefers the reported model over the requested selection: %j", (metadata) => {
    render(
      <AssistantCliMessage
        messageId="reported-model"
        cliType="claude-code"
        cliModel="opus"
        cliEffort="default"
        renderState={createRenderState({ metadata })}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Run details" }));
    expect(screen.getByText("Model").parentElement?.textContent).toBe("Modelprovider/actual-model");
    expect(screen.getByText("Reasoning").parentElement?.textContent).toBe("ReasoningDefault");
  });

  test.each([
    { cliModel: "default", cliEffort: "default", model: "Default", effort: "Default" },
    { cliModel: undefined, cliEffort: undefined, model: "Not reported", effort: "Not reported" },
  ])("does not invent unreported model or reasoning settings: %j", ({ cliModel, cliEffort, model, effort }) => {
    render(
      <AssistantCliMessage
        messageId="default-details"
        cliType="codex"
        cliModel={cliModel}
        cliEffort={cliEffort}
        renderState={createRenderState({ parts: [{ type: "text", text: "Response" }] })}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Run details" }));
    expect(screen.getByText("Model").parentElement?.textContent).toBe(`Model${model}`);
    expect(screen.getByText("Reasoning").parentElement?.textContent).toBe(`Reasoning${effort}`);
  });

  test("renders run stats from metadata", () => {
    const renderState = createRenderState({
      parts: [{ type: "text", text: "Assistant body" }],
      metadata: {
        sessionId: "session-1",
        totalCostUsd: 0.203,
        durationMs: 7525,
        usage: {
          inputTokens: 4,
          outputTokens: 235,
        },
      },
    });

    render(
      <AssistantCliMessage
        messageId="msg_assistant_1"
        cliType="claude-code"
        timestamp={Date.UTC(2026, 1, 9, 12, 0, 0)}
        renderState={renderState}
      />
    );
    // Cost stays out of the footer chip (thread indicator owns that surface,
    // OS-1132) but remains in the run-details popover.
    expect(screen.queryByText("$0.203")).toBeNull();
    expect(screen.getByText("7.5s")).toBeDefined();
    const runDetailsTrigger = screen.getByRole("button", {
      name: "Run details",
    });
    expect(runDetailsTrigger).toBeDefined();
    fireEvent.click(runDetailsTrigger);
    expect(screen.getByText("$0.203")).toBeDefined();
    expect(screen.getByText("Cost")).toBeDefined();
    expect(screen.getByText("session-1")).toBeDefined();
    expect(screen.getByText("Session")).toBeDefined();
  });

  test("renders the run timestamp in run stats (OS-1480)", () => {
    const timestamp = Date.UTC(2026, 1, 9, 12, 34, 0);
    const formattedTimestamp = new Date(timestamp).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    const renderState = createRenderState({
      parts: [{ type: "text", text: "Assistant body" }],
    });

    render(
      <AssistantCliMessage
        messageId="msg_assistant_1"
        cliType="claude-code"
        timestamp={timestamp}
        renderState={renderState}
      />
    );

    expect(screen.getByText(formattedTimestamp)).toBeDefined();
  });

  test("renders result, model usage, and system init details from metadata", () => {
    const renderState = createRenderState({
      parts: [{ type: "text", text: "Assistant body" }],
      metadata: {
        sessionId: "session-1",
        resultSubtype: "success",
        totalCostUsd: 0.203,
        durationMs: 7525,
        usage: {
          inputTokens: 4,
          outputTokens: 235,
        },
        modelUsage: {
          "us.anthropic.claude-opus-4-6-v1": {
            inputTokens: 4,
            outputTokens: 235,
          },
        },
        systemInit: {
          model: "us.anthropic.claude-opus-4-6-v1",
          claudeCodeVersion: "2.1.71",
          permissionMode: "bypassPermissions",
        },
      },
    });

    render(
      <AssistantCliMessage
        messageId="msg_assistant_1"
        cliType="claude-code"
        timestamp={Date.UTC(2026, 1, 9, 12, 0, 0)}
        renderState={renderState}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Run details" }));

    expect(screen.getByText("Result")).toBeDefined();
    expect(screen.getByText("success")).toBeDefined();
    expect(screen.getByText("Model usage")).toBeDefined();
    expect(screen.getByText("System init")).toBeDefined();
  });

  test("renders legacy subtype and flat system metadata for backward compatibility", () => {
    const renderState = createRenderState({
      parts: [{ type: "text", text: "Assistant body" }],
      metadata: {
        sessionId: "session-1",
        subtype: "success",
        model: "claude-opus-4-6",
        claudeCodeVersion: "2.1.34",
        permissionMode: "default",
        tools: ["Bash", "Read"],
      },
    });

    render(
      <AssistantCliMessage
        messageId="msg_assistant_1"
        cliType="claude-code"
        timestamp={Date.UTC(2026, 1, 9, 12, 0, 0)}
        renderState={renderState}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Run details" }));

    expect(screen.getByText("Result")).toBeDefined();
    expect(screen.getByText("success")).toBeDefined();
    expect(screen.getByText("System init")).toBeDefined();
  });

  test("renders attached files after the reply text and before the run footer (OS-2091)", () => {
    render(
      <AssistantCliMessage
        messageId="msg_assistant_1"
        cliType="claude-code"
        renderState={createRenderState({ parts: [{ type: "text", text: "Assistant body" }] })}
        attachments={[{ storageId: "storage_1", fileName: "shot.png", fileSize: 4, contentType: "image/png", uploadedAt: 1 }]}
      />
    );

    const files = screen.getByTestId("reply-files");
    const following = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(following(screen.getByText("Assistant body"), files)).toBe(true);
    expect(following(files, screen.getByRole("button", { name: "Message actions" }))).toBe(true);
  });

  test("an attachment-only reply, with no chunks, still renders its files and footer (OS-2091)", () => {
    render(
      <AssistantCliMessage
        messageId="msg_assistant_1"
        cliType="claude-code"
        renderState={undefined}
        attachments={[{ storageId: "storage_1", fileName: "shot.png", fileSize: 4, contentType: "image/png", uploadedAt: 1 }]}
      />
    );

    expect(screen.getByTestId("reply-files")).toBeDefined();
    expect(screen.queryByText(/No renderable chunk events/)).toBeNull();
    expect(screen.getByRole("button", { name: "Message actions" })).toBeDefined();
  });

  test("a check-only reply, with no chunks or files, still renders its checks card and footer (OS-2291)", () => {
    render(<AssistantCliMessage messageId="msg_assistant_1" cliType="claude-code" renderState={undefined} hasCheckResults />);

    expect(screen.getByTestId("reply-checks")).toBeDefined();
    expect(screen.queryByText(/No renderable chunk events/)).toBeNull();
  });

  test("renders message actions trigger instead of standalone raw JSON trigger", () => {
    const renderState = createRenderState({
      parts: [{ type: "text", text: "Assistant body" }],
    });

    render(
      <AssistantCliMessage
        messageId="msg_assistant_1"
        cliType="claude-code"
        renderState={renderState}
      />
    );

    expect(
      screen.getByRole("button", { name: "Message actions" })
    ).toBeDefined();
    expect(
      screen.queryByRole("button", { name: "View raw JSON" })
    ).toBeNull();
  });

  test("opens raw data dialog from the message actions menu", () => {
    const renderState = createRenderState({
      parts: [{ type: "text", text: "Assistant body" }],
    });

    render(
      <AssistantCliMessage
        messageId="msg_assistant_1"
        cliType="claude-code"
        renderState={renderState}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Message actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Raw data" }));

    expect(screen.getByText("Raw JSON")).toBeDefined();
    expect(screen.getByText("Composer parts")).toBeDefined();
    expect(screen.getByText("Normalized events")).toBeDefined();
  });

  test("copies a continuation command from the selected assistant message", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const renderState = createRenderState({
      parts: [{ type: "text", text: "Assistant body" }],
    });

    render(
      <AssistantCliMessage
        messageId="msg_assistant_1"
        cliType="claude-code"
        continuationId="session-123"
        renderState={renderState}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Message actions" }));
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Continue locally from here" })
    );

    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("claude --resume session-123");
    });
    expect(toastSuccessMock).toHaveBeenCalledWith("Command copied to clipboard");
  });

  test("disables continue locally when the message has no continuation id", () => {
    const renderState = createRenderState({
      parts: [{ type: "text", text: "Assistant body" }],
    });

    render(
      <AssistantCliMessage
        messageId="msg_assistant_1"
        cliType="claude-code"
        renderState={renderState}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Message actions" }));

    const item = screen.getByRole("menuitem", {
      name: "Continue locally from here",
    });
    expect(item.getAttribute("data-disabled")).not.toBeNull();
  });

  test("disables continue locally for unsupported CLI types", () => {
    const renderState = createRenderState({
      parts: [{ type: "text", text: "Assistant body" }],
    });

    render(
      <AssistantCliMessage
        messageId="msg_assistant_1"
        cliType="droid"
        continuationId="thread-123"
        renderState={renderState}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Message actions" }));

    const item = screen.getByRole("menuitem", {
      name: "Continue locally from here",
    });
    expect(item.getAttribute("data-disabled")).not.toBeNull();
  });

  test("copies the response text from a footer icon button", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const renderState = createRenderState({
      parts: [
        { type: "text", text: "First paragraph" },
        { type: "reasoning", text: "hidden thinking" },
        { type: "text", text: "Second paragraph" },
      ],
    });

    render(
      <AssistantCliMessage
        messageId="msg_assistant_1"
        status="completed"
        cliType="claude-code"
        renderState={renderState}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy response" }));

    expect(writeText).toHaveBeenCalledWith("First paragraph\n\nSecond paragraph");
    await vi.waitFor(() => expect(toastSuccessMock).toHaveBeenCalledWith("Response copied"));
    fireEvent.click(screen.getByRole("button", { name: "Message actions" }));
    expect(screen.queryByRole("menuitem", { name: "Copy response" })).toBeNull();
  });

  test("offers no copy button while streaming or without text", () => {
    const { rerender } = render(
      <AssistantCliMessage
        messageId="msg_assistant_1"
        status="streaming"
        renderState={createRenderState({ parts: [{ type: "text", text: "Partial" }] })}
      />
    );
    expect(screen.queryByRole("button", { name: "Copy response" })).toBeNull();

    rerender(
      <AssistantCliMessage
        messageId="msg_assistant_1"
        status="completed"
        renderState={createRenderState({ parts: [{ type: "reasoning", text: "Only thinking" }] })}
      />
    );
    expect(screen.queryByRole("button", { name: "Copy response" })).toBeNull();
  });

  test("uses an icon for the message actions trigger", () => {
    render(
      <AssistantCliMessage
        messageId="msg_assistant_1"
        renderState={createRenderState({ parts: [{ type: "text", text: "Body" }] })}
      />
    );
    const trigger = screen.getByRole("button", { name: "Message actions" });
    expect(trigger.textContent).toBe("");
    expect(trigger.querySelector("svg.lucide-ellipsis, svg.lucide-more-horizontal")).not.toBeNull();
  });

  test("the footer branch icon forks a completed Claude reply into a new thread", () => {
    const onBranchFromHere = vi.fn();
    render(
      <AssistantCliMessage
        messageId="msg_assistant_1"
        status="completed"
        cliType="claude-code"
        continuationId="session-123"
        renderState={createRenderState({ parts: [{ type: "text", text: "Assistant body" }] })}
        onBranchFromHere={onBranchFromHere}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Branch from here" }));
    expect(onBranchFromHere).toHaveBeenCalledWith("msg_assistant_1");
  });

  test("hides the footer branch icon when the reply cannot be forked", () => {
    render(
      <AssistantCliMessage
        messageId="msg_assistant_1"
        status="failed"
        cliType="claude-code"
        renderState={createRenderState({ parts: [{ type: "text", text: "Assistant body" }] })}
        onBranchFromHere={vi.fn()}
      />
    );
    expect(screen.queryByRole("button", { name: "Branch from here" })).toBeNull();
  });

  test("branch from here hands the message id to the host for a completed Claude reply", () => {
    const onBranchFromHere = vi.fn();
    render(
      <AssistantCliMessage
        messageId="msg_assistant_1"
        status="completed"
        cliType="claude-code"
        continuationId="session-123"
        renderState={createRenderState({ parts: [{ type: "text", text: "Assistant body" }] })}
        onBranchFromHere={onBranchFromHere}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Message actions" }));
    const item = screen.getByRole("menuitem", { name: "Branch from here" });
    expect(item.getAttribute("data-disabled")).toBeNull();
    fireEvent.click(item);
    fireEvent.click(submenuItem("Branch from here", "In a new thread"));
    expect(onBranchFromHere).toHaveBeenCalledWith("msg_assistant_1");
  });

  test("branch from here in a new tab hands the message id to the host's tab handler", () => {
    const onBranchFromHere = vi.fn();
    const onBranchIntoTab = vi.fn();
    render(
      <AssistantCliMessage
        messageId="msg_assistant_1"
        status="completed"
        cliType="claude-code"
        continuationId="session-123"
        renderState={createRenderState({ parts: [{ type: "text", text: "Assistant body" }] })}
        onBranchFromHere={onBranchFromHere}
        onBranchIntoTab={onBranchIntoTab}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Message actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Branch from here" }));
    fireEvent.click(submenuItem("Branch from here", "In a new tab"));
    expect(onBranchIntoTab).toHaveBeenCalledWith("msg_assistant_1");
    expect(onBranchFromHere).not.toHaveBeenCalled();
  });

  test("disables In a new tab when the host has no tab handler (full group, no workspace)", () => {
    render(
      <AssistantCliMessage
        messageId="msg_assistant_1"
        status="completed"
        cliType="claude-code"
        continuationId="session-123"
        renderState={createRenderState({ parts: [{ type: "text", text: "Assistant body" }] })}
        onBranchFromHere={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Message actions" }));
    expect(submenuItem("Branch from here", "In a new thread").getAttribute("data-disabled")).toBeNull();
    expect(submenuItem("Branch from here", "In a new tab").getAttribute("data-disabled")).not.toBeNull();
  });

  test("handoff in a new thread hands a Codex reply without a continuation to the host", () => {
    const onHandoffToNewThread = vi.fn();
    render(
      <AssistantCliMessage
        messageId="msg_assistant_1"
        status="failed"
        cliType="codex"
        renderState={createRenderState({ parts: [{ type: "text", text: "Assistant body" }] })}
        onHandoffToNewThread={onHandoffToNewThread}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Message actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Handoff from here" }));
    fireEvent.click(submenuItem("Handoff from here", "In a new thread"));
    expect(onHandoffToNewThread).toHaveBeenCalledWith("msg_assistant_1");
  });

  test("handoff in a new tab hands the reply to the host's tab handler, and is disabled without one", () => {
    const onHandoffToNewTab = vi.fn();
    const { rerender } = render(
      <AssistantCliMessage
        messageId="msg_assistant_1"
        status="completed"
        cliType="codex"
        renderState={createRenderState({ parts: [{ type: "text", text: "Assistant body" }] })}
        onHandoffToNewThread={vi.fn()}
        onHandoffToNewTab={onHandoffToNewTab}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Message actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Handoff from here" }));
    fireEvent.click(submenuItem("Handoff from here", "In a new tab"));
    expect(onHandoffToNewTab).toHaveBeenCalledWith("msg_assistant_1");

    rerender(
      <AssistantCliMessage
        messageId="msg_assistant_1"
        status="completed"
        cliType="codex"
        renderState={createRenderState({ parts: [{ type: "text", text: "Assistant body" }] })}
        onHandoffToNewThread={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Message actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Handoff from here" }));
    expect(submenuItem("Handoff from here", "In a new tab").getAttribute("data-disabled")).not.toBeNull();
  });

  test.each([
    ["a streaming reply", { status: "streaming" as const, withHandler: true }],
    ["a read-only viewer", { status: "completed" as const, withHandler: false }],
  ])("disables handoff for %s", (_label, { withHandler, status }) => {
    render(
      <AssistantCliMessage
        messageId="msg_assistant_1"
        status={status}
        cliType="codex"
        renderState={createRenderState({ parts: [{ type: "text", text: "Assistant body" }] })}
        onHandoffToNewThread={withHandler ? vi.fn() : undefined}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Message actions" }));
    expect(screen.getByRole("menuitem", { name: "Handoff from here" }).getAttribute("data-disabled")).not.toBeNull();
  });

  test.each([
    ["another runtime", { cliType: "codex" as const, status: "completed" as const, continuationId: "t", withHandler: true }],
    ["a streaming reply", { cliType: "claude-code" as const, status: "streaming" as const, continuationId: "s", withHandler: true }],
    ["a reply without a continuation", { cliType: "claude-code" as const, status: "completed" as const, continuationId: undefined, withHandler: true }],
    ["a failed reply without a session", { cliType: "claude-code" as const, status: "failed" as const, continuationId: undefined, withHandler: true }],
    ["a read-only viewer", { cliType: "claude-code" as const, status: "completed" as const, continuationId: "s", withHandler: false }],
  ])("disables branch from here for %s", (_label, { withHandler, ...props }) => {
    render(
      <AssistantCliMessage
        messageId="msg_assistant_1"
        {...props}
        renderState={createRenderState({ parts: [{ type: "text", text: "Assistant body" }] })}
        onBranchFromHere={withHandler ? vi.fn() : undefined}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Message actions" }));
    expect(
      screen.getByRole("menuitem", { name: "Branch from here" }).getAttribute("data-disabled")
    ).not.toBeNull();
  });

  test("enables branch from here on a Codex reply that recorded its turn (OS-2073)", () => {
    render(
      <AssistantCliMessage
        messageId="msg_assistant_1"
        cliType="codex"
        status="completed"
        continuationId="t-parent"
        turnId="turn-2"
        renderState={createRenderState({ parts: [{ type: "text", text: "Assistant body" }] })}
        onBranchFromHere={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Message actions" }));
    expect(screen.getByRole("menuitem", { name: "Branch from here" }).getAttribute("data-disabled")).toBeNull();
  });

  test("enables branch from here for a stopped reply that recorded a session", () => {
    const onBranchFromHere = vi.fn();
    render(
      <AssistantCliMessage
        messageId="msg_assistant_1"
        cliType="claude-code"
        status="failed"
        continuationId="session-stopped"
        renderState={createRenderState({ parts: [{ type: "text", text: "Assistant body" }] })}
        onBranchFromHere={onBranchFromHere}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Message actions" }));
    const item = screen.getByRole("menuitem", { name: "Branch from here" });
    expect(item.getAttribute("data-disabled")).toBeNull();
    fireEvent.click(item);
    fireEvent.click(submenuItem("Branch from here", "In a new thread"));
    expect(onBranchFromHere).toHaveBeenCalledWith("msg_assistant_1");
  });

  test("renders AskUserQuestion as answered when submitted response exists", () => {
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
          customAnswer: "Add mutation tests too",
        },
      ],
    };

    const renderState = createRenderState({
      parts: [
        {
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
                options: [{ label: "Vitest" }, { label: "Jest" }],
              },
            ],
          },
          errorText: "Answer questions?",
        },
      ],
    });

    render(
      <AssistantCliMessage
        messageId="msg_assistant_1"
        renderState={renderState}
        submittedAskUserQuestionResponses={{ toolu_ask_1: submittedResponse }}
      />
    );

    expect(screen.queryByText("Submitted answers")).toBeNull();
    expect(screen.getByText(/Vitest/)).toBeDefined();
    expect(screen.getByText("Add mutation tests too")).toBeDefined();
    expect(
      screen.queryByRole("button", { name: "Submit answers" })
    ).toBeNull();
  });

  test("passes the plan decision callback through to the plan panel", () => {
    const onPlanDecision = vi.fn().mockResolvedValue(undefined);
    const renderState = createRenderState({
      parts: [
        {
          type: "dynamic-tool",
          toolName: "ExitPlanMode",
          toolCallId: "toolu_exit_1",
          state: "output-error",
          input: {
            plan: "# Exit plan",
          },
          errorText: "Exit plan mode?",
        },
      ],
    });

    render(
      <AssistantCliMessage
        messageId="msg_assistant_1"
        renderState={renderState}
        onPlanDecision={onPlanDecision}
        showPlanDecisions
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Approve & continue in auto/i })
    );
    expect(onPlanDecision).toHaveBeenCalledWith({ nextMode: "auto" });
  });

  test("hides plan decisions when showPlanDecisions is false", () => {
    const onPlanDecision = vi.fn().mockResolvedValue(undefined);
    const renderState = createRenderState({
      parts: [
        {
          type: "dynamic-tool",
          toolName: "ExitPlanMode",
          toolCallId: "toolu_exit_1",
          state: "output-error",
          input: {
            plan: "# Exit plan",
          },
          errorText: "Exit plan mode?",
        },
      ],
    });

    render(
      <AssistantCliMessage
        messageId="msg_assistant_1"
        renderState={renderState}
        onPlanDecision={onPlanDecision}
        showPlanDecisions={false}
      />
    );

    expect(screen.queryByRole("button", { name: /Approve/ })).toBeNull();
  });

  test("keeps pending tool calls spinning while the message streams", () => {
    const renderState = createRenderState({
      parts: [
        {
          type: "dynamic-tool",
          toolName: "Bash",
          toolCallId: "toolu_bash_1",
          state: "input-available",
          input: { command: "sleep 30" },
        },
      ],
    });

    render(
      <AssistantCliMessage
        messageId="msg_assistant_1"
        status="streaming"
        renderState={renderState}
      />
    );

    expect(screen.queryAllByRole("status").length).toBeGreaterThan(0);
  });

  test("settles pending tool calls as interrupted once the message failed (OS-1435)", () => {
    const renderState = createRenderState({
      parts: [
        {
          type: "dynamic-tool",
          toolName: "Bash",
          toolCallId: "toolu_bash_1",
          state: "input-available",
          input: { command: "sleep 30" },
        },
      ],
    });

    render(
      <AssistantCliMessage
        messageId="msg_assistant_1"
        status="failed"
        renderState={renderState}
      />
    );

    expect(screen.queryAllByRole("status")).toHaveLength(0);
  });

  describe("tool groups (OS-1440)", () => {
    function bash(toolCallId: string, command: string): CliUiPart {
      return {
        type: "dynamic-tool",
        toolName: "Bash",
        toolCallId,
        state: "output-available",
        input: { command },
        output: "",
      };
    }

    const groupParts: CliUiPart[] = [
      bash("toolu_1", "pnpm lint"),
      { type: "reasoning", text: "Considering the lint output" },
      bash("toolu_2", "pnpm test"),
      { type: "reasoning", text: "Both commands passed" },
    ];

    const groupTimings = new Map([
      ["toolu_1", { startedAt: 1_000, endedAt: 3_000 }],
      ["toolu_2", { startedAt: 3_200, endedAt: 6_000 }],
    ]);

    test("collapses a finished group into one 'Worked for' accordion", () => {
      const renderState = createRenderState({
        parts: groupParts,
        toolTimingsByCallId: groupTimings,
      });

      render(
        <AssistantCliMessage
          messageId="msg_assistant_1"
          status="completed"
          renderState={renderState}
        />
      );

      expect(screen.getByText("Worked for 5s")).toBeDefined();
      // The collapsed row is the duration alone — no tool-call count.
      expect(screen.queryByText("2 tool calls")).toBeNull();
      // Collapsed: children stay unmounted, trailing reasoning included.
      expect(screen.queryByText("pnpm lint")).toBeNull();
      expect(screen.queryByText("pnpm test")).toBeNull();
      expect(screen.queryAllByText("Reasoning")).toHaveLength(0);
    });

    test("expanding shows every part of the group, collapsing hides them again", () => {
      const renderState = createRenderState({
        parts: groupParts,
        toolTimingsByCallId: groupTimings,
      });

      render(
        <AssistantCliMessage
          messageId="msg_assistant_1"
          status="completed"
          renderState={renderState}
        />
      );

      const trigger = screen.getByText("Worked for 5s");
      fireEvent.click(trigger);

      expect(screen.getByText("pnpm lint")).toBeDefined();
      expect(screen.getByText("pnpm test")).toBeDefined();
      expect(screen.queryAllByText("Reasoning")).toHaveLength(2);

      fireEvent.click(trigger);
      expect(screen.queryByText("pnpm lint")).toBeNull();
    });

    test("renders a live trailing group as individual parts while streaming", () => {
      const renderState = createRenderState({
        parts: groupParts,
        toolTimingsByCallId: groupTimings,
      });

      render(
        <AssistantCliMessage
          messageId="msg_assistant_1"
          status="streaming"
          renderState={renderState}
        />
      );

      expect(screen.queryByText("Worked for 5s")).toBeNull();
      expect(screen.getByText("pnpm lint")).toBeDefined();
      expect(screen.getByText("pnpm test")).toBeDefined();
    });

    test("keeps a group live while one of its calls has no result", () => {
      const renderState = createRenderState({
        parts: [
          bash("toolu_1", "pnpm lint"),
          {
            type: "dynamic-tool",
            toolName: "Bash",
            toolCallId: "toolu_2",
            state: "input-available",
            input: { command: "pnpm test" },
          },
        ],
        toolTimingsByCallId: new Map([
          ["toolu_1", { startedAt: 1_000, endedAt: 3_000 }],
          ["toolu_2", { startedAt: 3_200 }],
        ]),
      });

      render(
        <AssistantCliMessage
          messageId="msg_assistant_1"
          status="streaming"
          renderState={renderState}
        />
      );

      expect(screen.getByText("pnpm lint")).toBeDefined();
      expect(screen.getByText("pnpm test")).toBeDefined();
    });

    test("falls back to the tool-call count when the span is unknown", () => {
      const renderState = createRenderState({
        parts: groupParts,
        toolTimingsByCallId: new Map(),
      });

      render(
        <AssistantCliMessage
          messageId="msg_assistant_1"
          status="completed"
          renderState={renderState}
        />
      );

      expect(screen.queryByText(/Worked for/)).toBeNull();
      expect(screen.getByText("2 tool calls")).toBeDefined();
    });

    test("keeps a failed call visible outside the collapsed group", () => {
      const renderState = createRenderState({
        parts: [
          bash("toolu_1", "pnpm lint"),
          bash("toolu_2", "pnpm build"),
          {
            type: "dynamic-tool",
            toolName: "Bash",
            toolCallId: "toolu_3",
            state: "output-error",
            input: { command: "pnpm test" },
            errorText: "Exit code 1",
          },
        ],
        toolTimingsByCallId: new Map([
          ["toolu_1", { startedAt: 1_000, endedAt: 3_000 }],
          ["toolu_2", { startedAt: 3_200, endedAt: 6_000 }],
          ["toolu_3", { startedAt: 6_100, endedAt: 7_000 }],
        ]),
      });

      render(
        <AssistantCliMessage
          messageId="msg_assistant_1"
          status="completed"
          renderState={renderState}
        />
      );

      expect(screen.getByText("Worked for 5s")).toBeDefined();
      expect(screen.queryByText("pnpm lint")).toBeNull();
      expect(screen.getByText("pnpm test")).toBeDefined();
    });

    test("does not group a single tool call", () => {
      const renderState = createRenderState({
        parts: [bash("toolu_1", "pnpm lint")],
        toolTimingsByCallId: new Map([
          ["toolu_1", { startedAt: 1_000, endedAt: 3_000 }],
        ]),
      });

      render(
        <AssistantCliMessage
          messageId="msg_assistant_1"
          status="completed"
          renderState={renderState}
        />
      );

      expect(screen.queryByText(/Worked for/)).toBeNull();
      expect(screen.getByText("pnpm lint")).toBeDefined();
    });
  });

  test("leaves interactive tool calls untouched when the message failed", () => {
    const renderState = createRenderState({
      parts: [
        {
          type: "dynamic-tool",
          toolName: "AskUserQuestion",
          toolCallId: "toolu_ask_1",
          state: "input-available",
          input: {
            questions: [
              {
                question: "Which testing frameworks do you prefer?",
                header: "Testing",
                multiSelect: true,
                options: [{ label: "Vitest" }, { label: "Jest" }],
              },
            ],
          },
        },
      ],
    });

    render(
      <AssistantCliMessage
        messageId="msg_assistant_1"
        status="failed"
        renderState={renderState}
      />
    );

    // Settling this one to output-error would pop the question form back open.
    expect(
      screen.queryByText("Which testing frameworks do you prefer?")
    ).toBeNull();
  });
});

test("shows one agent accordion and keeps a successful wait out of its body", () => {
  window.localStorage.setItem("convoy.dev-setting.tool-call-debug", "1");
  const wait = { type: "collabAgentToolCall", id: "wait", tool: "wait", receiverThreadIds: [], agentsStates: {} };
  const renderState = createRenderState({ parts: [{
    type: "task-notice-group", groupKey: "codex-agents", notices: [],
    childTaskNoticeGroups: [{ type: "task-notice-group", groupKey: "codex:child", notices: [{
      code: "codex-subagent", title: "/root/dummy_test", message: "completed",
      detailsJson: JSON.stringify({ subtype: "codex_subagent", payload: { task_id: "codex:child", description: "/root/dummy_test", status: "completed" } }),
    }] }],
    childToolEvents: [
      { kind: "tool-input", toolCallId: "wait", toolName: "Agent wait", inputJson: JSON.stringify({ ...wait, status: "inProgress" }) },
      { kind: "tool-output", toolCallId: "wait", outputJson: JSON.stringify({ ...wait, status: "completed" }) },
    ],
  }] });
  render(<AssistantCliMessage messageId="agent-group" cliType="codex" status="completed" renderState={renderState} />);
  fireEvent.click(screen.getByRole("button", { name: "/root/dummy_test (completed)" }));
  expect(screen.queryByText("Agent wait")).toBeNull();
  expect(screen.queryByText(/collabAgentToolCall/)).toBeNull();
  expect(screen.getAllByRole("button", { name: "Copy raw tool call JSON" })).toHaveLength(1);
  cleanup();
  window.localStorage.clear();
});

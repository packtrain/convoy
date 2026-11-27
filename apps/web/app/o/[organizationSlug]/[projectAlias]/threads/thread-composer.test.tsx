/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { ComponentProps } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { ThreadComposer } from "@/components/blocks/thread/thread-composer";
import type { TaskSelectorOption } from "@/lib/tasks/task-selector";
import { getDefaultTaskTypeSummary } from "@/lib/tasks/task-types";
import { setTaskDragPayload, type TaskDragPayload } from "@/lib/tasks/task-drag";
import { setTestHotkeyPlatform } from "@/test-utils/hotkeys";

const useQueryMock = vi.hoisted(() => vi.fn());
const useFileMentionSearchMock = vi.hoisted(() => vi.fn(() => ({ files: [] as string[], isLoading: false })));
const createObjectUrlMock = vi.fn(() => "blob:mock-file");
const revokeObjectUrlMock = vi.fn();

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () =>
    ({
      bottom: 0,
      height: 0,
      left: 0,
      right: 0,
      top: 0,
      width: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
});

Object.defineProperty(URL, "createObjectURL", {
  configurable: true,
  value: createObjectUrlMock,
});

Object.defineProperty(URL, "revokeObjectURL", {
  configurable: true,
  value: revokeObjectUrlMock,
});

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  // The top-bar working-directory selector mounts without a provider (OS-1218).
  useMutation: () => vi.fn(),
  // No provider in tests → file-mention search stays inert (OS-1144).
  useConvex: () => undefined,
}));

vi.mock("@/lib/threads/hooks/use-file-mention-search", () => ({
  useFileMentionSearch: () => useFileMentionSearchMock(),
}));

vi.mock("@/components/blocks/tasks/attachment-lightbox", () => ({
  AttachmentLightbox: ({ open, textPreview }: { open: boolean; textPreview?: { fileName: string } | null }) =>
    open || textPreview ? <div role="dialog" aria-label="Attachment preview" /> : null,
}));

vi.mock("@/components/blocks/thread/thread-task-selector-dialog", () => ({
  ThreadTaskSelectorDialog: ({
    open,
    onOpenChange,
    onSelectTask,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSelectTask: (task: TaskSelectorOption) => void;
  }) =>
    open ? (
      <div data-testid="task-selector-dialog">
        <button
          type="button"
          onClick={() => {
            onSelectTask({
              _id: "task_1" as Id<"tasks">,
              parentId: null,
              refId: "OS-569",
              name: "Implement task selector",
              list: null,
              taskType: {
                key: "task",
                name: "Task",
                icon: "SquareCheckBig",
                color: "#64748b",
                isSystem: true,
              },
              status: "To Do",
              priority: "None",
              assignee: null,
              createdByName: "Tester",
              isArchived: false,
            });
            onOpenChange(false);
          }}
        >
          Select task
        </button>
        <button
          type="button"
          onClick={() => {
            onSelectTask({
              _id: "task_2" as Id<"tasks">,
              parentId: null,
              refId: "OS-570",
              name: "Ship task attachments",
              list: null,
              taskType: {
                key: "task",
                name: "Task",
                icon: "SquareCheckBig",
                color: "#0f766e",
                isSystem: true,
              },
              status: "To Do",
              priority: "None",
              assignee: null,
              createdByName: "Tester",
              isArchived: false,
            });
            onOpenChange(false);
          }}
        >
          Select replacement task
        </button>
        <button type="button" onClick={() => onOpenChange(false)}>
          Close task selector
        </button>
      </div>
    ) : null,
}));

vi.mock("@/components/blocks/thread/thread-context-selectors", () => ({
  ThreadContextSelectors: ({ disabled }: { disabled?: boolean }) => (
    <div data-testid="thread-context-selectors" data-disabled={disabled ? "true" : "false"} />
  ),
}));

function createSelectorsProps(
  overrides: Partial<ComponentProps<typeof ThreadComposer>["selectorsProps"]> = {}
): ComponentProps<typeof ThreadComposer>["selectorsProps"] {
  return {
    profiles: [
      {
        _id: "profile_1" as Id<"cliProfiles">,
        name: "Default profile",
        isOnline: true,
        paths: [{ id: "path_1", path: "/tmp/project", label: "project" }],
      },
    ],
    profileId: "profile_1",
    pathId: "path_1",
    cliType: "codex",
    mode: "agent",
    cliModel: undefined,
    onPathChange: vi.fn(),
    onCliTypeChange: vi.fn(),
    onCliModelChange: vi.fn(),
    onModeChange: vi.fn(),
    ...overrides,
  };
}

function createInitialAttachedTask() {
  return {
    _id: "task_3" as Id<"tasks">,
    refId: "OS-635",
    name: "Wire task preselection into threads page",
    taskType: getDefaultTaskTypeSummary(),
  };
}

const pullRequest = {
  provider: "github" as const,
  number: 1438,
  title: "Move PR info into the composer",
  url: "https://github.com/contoso/contoso/pull/1438",
  state: "open" as const,
  headBranch: "feat/os-1438-pr-info",
  baseBranch: "main",
  capturedAt: Date.now(),
};

function taskDataTransfer(payload: TaskDragPayload): DataTransfer {
  const store = new Map<string, string>();
  const dataTransfer = {
    dropEffect: "none",
    get types() {
      return [...store.keys()];
    },
    setData: (type: string, value: string) => {
      store.set(type, value);
    },
    getData: (type: string) => store.get(type) ?? "",
  } as unknown as DataTransfer;
  setTaskDragPayload(dataTransfer, payload);
  return dataTransfer;
}

function openAttachMenu() {
  fireEvent.pointerDown(screen.getByRole("button", { name: "Open attach menu" }), {
    button: 0,
  });
}

/** The `/` menu loads two catalogs (Prompts and Skills), so a mock has to say which. */
function mockSlashCommandCatalog(commands: unknown[], skills: unknown[] = []) {
  useQueryMock.mockImplementation((query: Parameters<typeof getFunctionName>[0]) => {
    const functionName = getFunctionName(query);
    if (functionName === "slashCommands/core:listComposerCatalog") {
      return commands;
    }

    return functionName === "skills/core:listByProject" ? skills : undefined;
  });
}

describe("ThreadComposer", () => {
  afterEach(() => {
    setTestHotkeyPlatform({
      platform: "Linux x86_64",
      userAgent: "Mozilla/5.0",
    });
    createObjectUrlMock.mockReset();
    revokeObjectUrlMock.mockReset();
    useQueryMock.mockReset();
    cleanup();
  });

  test("renders with initial input", () => {
    const selectorsProps = createSelectorsProps();

    render(
      <ThreadComposer
        onSubmit={vi.fn()}
        initialInput="Saved draft"
        textareaPlaceholder="Ask a question..."
        selectorsProps={selectorsProps}
      />
    );

    expect(screen.getByRole("textbox", { name: "Message" }).textContent).toBe("Saved draft");
  });

  test("renders pull-request info after the branch summary in the top bar", () => {
    const selectorsProps = createSelectorsProps({
      profiles: [
        {
          _id: "profile_1" as Id<"cliProfiles">,
          name: "Default profile",
          isOnline: true,
          paths: [
            {
              id: "path_1",
              path: "/tmp/project-worktrees/os-1438",
              label: "os-1438",
              kind: "worktree",
              parentPathId: "parent_1",
              branch: pullRequest.headBranch,
            },
          ],
        },
      ],
      lockAgentContext: true,
    });

    render(
      <ThreadComposer
        onSubmit={vi.fn()}
        pullRequests={[pullRequest]}
        textareaPlaceholder="Ask a follow-up question..."
        selectorsProps={selectorsProps}
      />
    );

    const branchSummary = screen.getByText(pullRequest.headBranch);
    const pullRequestBadge = screen.getByLabelText(
      "PR #1438 · Open — Move PR info into the composer"
    );

    expect(
      branchSummary.compareDocumentPosition(pullRequestBadge) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  test("renders the context window meter only when usage is provided", () => {
    const selectorsProps = createSelectorsProps();

    const { rerender } = render(
      <ThreadComposer onSubmit={vi.fn()} textareaPlaceholder="Ask a question..." selectorsProps={selectorsProps} />
    );

    expect(screen.queryByRole("button", { name: "Context window 30% used" })).toBeNull();

    rerender(
      <ThreadComposer
        onSubmit={vi.fn()}
        textareaPlaceholder="Ask a question..."
        selectorsProps={selectorsProps}
        contextWindowUsage={{
          usedTokens: 100_000,
          maxTokens: 333_333,
          remainingTokens: 233_333,
          usedPercentage: 30,
          remainingPercentage: 70,
          inputTokens: 1_000,
          cachedInputTokens: 95_000,
          outputTokens: 4_000,
        }}
      />
    );

    const trigger = screen.getByRole("button", {
      name: "Context window 30% used",
    });
    expect(trigger).toBeDefined();

    fireEvent.click(trigger);

    expect(screen.getByText("30% used (70% left)")).toBeDefined();
    expect(screen.getByText("100k / 333k tokens used")).toBeDefined();
  });

  test("calls onInputChange when composer text changes", async () => {
    const onInputChange = vi.fn();
    const selectorsProps = createSelectorsProps();

    render(
      <ThreadComposer
        onSubmit={vi.fn()}
        onInputChange={onInputChange}
        textareaPlaceholder="Ask a question..."
        selectorsProps={selectorsProps}
      />
    );

    const editor = screen.getByRole("textbox", { name: "Message" });
    fireEvent.paste(editor, {
      clipboardData: {
        getData: () => "Working on draft text",
        items: [],
      },
    });

    await vi.waitFor(() => {
      expect(onInputChange).toHaveBeenCalledWith("Working on draft text");
    });
  });

  test("serializes selected slash commands as command markdown links", async () => {
    const onInputChange = vi.fn();
    const onSubmit = vi.fn();
    const selectorsProps = createSelectorsProps();
    mockSlashCommandCatalog([
      {
        id: "cmd_1" as Id<"slashCommands">,
        scope: "organization",
        key: "client-summary",
        canonicalKey: "org:client-summary",
        displayLabel: "/client-summary",
        description: "Summarize client context",
        content: "Summarize the client context.",
        autoExpand: false,
        autoSubmit: false,
      },
    ]);

    render(
      <ThreadComposer
        organizationId={"org_1" as Id<"organizations">}
        onSubmit={onSubmit}
        onInputChange={onInputChange}
        textareaPlaceholder="Ask a question..."
        selectorsProps={selectorsProps}
      />
    );

    const editor = screen.getByRole("textbox", { name: "Message" });
    fireEvent.paste(editor, {
      clipboardData: {
        getData: () => "/",
        items: [],
      },
    });

    fireEvent.click(await screen.findByRole("button", { name: /\/client-summary/ }));

    await vi.waitFor(() => {
      expect(onInputChange).toHaveBeenCalledWith(expect.stringContaining("[/client-summary](convoy://command/org:client-summary)"));
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  // OS-1784: the project's Skills join the same menu, from their own query.
  test("lists project skills in the / menu alongside prompts", async () => {
    const selectorsProps = createSelectorsProps();
    mockSlashCommandCatalog(
      [
        {
          id: "cmd_1" as Id<"slashCommands">,
          scope: "organization",
          key: "client-summary",
          canonicalKey: "org:client-summary",
          displayLabel: "/client-summary",
          content: "Summarize the client context.",
          autoExpand: false,
          autoSubmit: false,
        },
      ],
      [{ _id: "skill_pdf" as Id<"skills">, name: "pdf-tools", description: "Fill PDFs" }]
    );

    render(
      <ThreadComposer
        organizationId={"org_1" as Id<"organizations">}
        projectId={"project_1" as Id<"projects">}
        onSubmit={vi.fn()}
        textareaPlaceholder="Ask a question..."
        selectorsProps={selectorsProps}
      />
    );

    fireEvent.paste(screen.getByRole("textbox", { name: "Message" }), {
      clipboardData: { getData: () => "/", items: [] },
    });

    expect(await screen.findByRole("button", { name: /\/pdf-tools/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /\/client-summary/ })).toBeDefined();
    expect(screen.getByText("Skill")).toBeDefined();
  });

  test("shows colliding project and organization prompts with scope badges and explicit filtering", async () => {
    const selectorsProps = createSelectorsProps();
    mockSlashCommandCatalog([
      {
        id: "project_cmd" as Id<"slashCommands">,
        scope: "project",
        key: "review",
        canonicalKey: "project:review",
        displayLabel: "/review",
        content: "Review this project.",
        autoExpand: false,
        autoSubmit: false,
      },
      {
        id: "org_cmd" as Id<"slashCommands">,
        scope: "organization",
        key: "review",
        canonicalKey: "org:review",
        displayLabel: "/review",
        content: "Review organization standards.",
        autoExpand: false,
        autoSubmit: false,
      },
    ]);

    render(
      <ThreadComposer
        projectId={"project_1" as Id<"projects">}
        organizationId={"org_1" as Id<"organizations">}
        onSubmit={vi.fn()}
        textareaPlaceholder="Ask a question..."
        selectorsProps={selectorsProps}
      />
    );

    expect(useQueryMock).toHaveBeenCalledWith(expect.anything(), {
      organizationId: "org_1",
      projectId: "project_1",
    });
    const editor = screen.getByRole("textbox", { name: "Message" });
    fireEvent.paste(editor, { clipboardData: { getData: () => "/", items: [] } });
    expect(await screen.findByText("Project")).toBeDefined();
    expect(screen.getByText("Organization")).toBeDefined();
    expect(screen.getAllByRole("button", { name: /\/review/ })).toHaveLength(2);

    fireEvent.keyDown(editor, { key: "Escape" });
    fireEvent.keyDown(editor, { key: "a", ctrlKey: true });
    fireEvent.keyDown(editor, { key: "Backspace" });
    fireEvent.paste(editor, { clipboardData: { getData: () => "/org:", items: [] } });
    await vi.waitFor(() => {
      expect(screen.queryByText("Project")).toBeNull();
      expect(screen.getByText("Organization")).toBeDefined();
    });
  });

  test("autosubmits a compact stored prompt selected in an empty composer", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const selectorsProps = createSelectorsProps();
    mockSlashCommandCatalog([
      {
        id: "cmd_1" as Id<"slashCommands">,
        scope: "organization",
        key: "client-summary",
        canonicalKey: "org:client-summary",
        displayLabel: "/client-summary",
        description: "Summarize client context",
        content: "Summarize the client context.",
        autoExpand: false,
        autoSubmit: true,
      },
    ]);

    render(
      <ThreadComposer
        organizationId={"org_1" as Id<"organizations">}
        onSubmit={onSubmit}
        textareaPlaceholder="Ask a question..."
        selectorsProps={selectorsProps}
      />
    );

    const editor = screen.getByRole("textbox", { name: "Message" });
    fireEvent.paste(editor, {
      clipboardData: {
        getData: () => "/",
        items: [],
      },
    });
    fireEvent.click(await screen.findByRole("button", { name: /\/client-summary/ }));

    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          text: "[/client-summary](convoy://command/org:client-summary) ",
          composerDocument: {
            version: 1,
            refs: [
              expect.objectContaining({
                id: "cmd_1",
                canonicalKey: "org:client-summary",
              }),
            ],
          },
        })
      );
    });
  });

  test("autosubmits expanded prompt content from keyboard selection", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const selectorsProps = createSelectorsProps();
    mockSlashCommandCatalog([
      {
        id: "cmd_1" as Id<"slashCommands">,
        scope: "organization",
        key: "client-summary",
        canonicalKey: "org:client-summary",
        displayLabel: "/client-summary",
        description: "Summarize client context",
        content: "Summarize the client context.",
        autoExpand: true,
        autoSubmit: true,
      },
    ]);

    render(
      <ThreadComposer
        organizationId={"org_1" as Id<"organizations">}
        onSubmit={onSubmit}
        textareaPlaceholder="Ask a question..."
        selectorsProps={selectorsProps}
      />
    );

    const editor = screen.getByRole("textbox", { name: "Message" });
    fireEvent.paste(editor, {
      clipboardData: {
        getData: () => "/client",
        items: [],
      },
    });
    await screen.findByRole("button", { name: /\/client-summary/ });
    fireEvent.keyDown(editor, { key: "Enter" });

    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          text: "Summarize the client context. ",
          composerDocument: { version: 1, refs: [] },
        })
      );
    });
  });

  test("does not autosubmit when the composer contains other text", async () => {
    const onInputChange = vi.fn();
    const onSubmit = vi.fn();
    const selectorsProps = createSelectorsProps();
    mockSlashCommandCatalog([
      {
        id: "cmd_1" as Id<"slashCommands">,
        scope: "organization",
        key: "client-summary",
        canonicalKey: "org:client-summary",
        displayLabel: "/client-summary",
        description: "Summarize client context",
        content: "Summarize the client context.",
        autoExpand: false,
        autoSubmit: true,
      },
    ]);

    render(
      <ThreadComposer
        organizationId={"org_1" as Id<"organizations">}
        onSubmit={onSubmit}
        onInputChange={onInputChange}
        textareaPlaceholder="Ask a question..."
        selectorsProps={selectorsProps}
      />
    );

    const editor = screen.getByRole("textbox", { name: "Message" });
    fireEvent.paste(editor, {
      clipboardData: {
        getData: () => "Context /",
        items: [],
      },
    });
    fireEvent.click(await screen.findByRole("button", { name: /\/client-summary/ }));

    await vi.waitFor(() => {
      expect(onInputChange).toHaveBeenCalledWith(expect.stringContaining("Context [/client-summary]"));
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("does not autosubmit in prompt configuration mode", async () => {
    const onInputChange = vi.fn();
    const onSubmit = vi.fn();
    const selectorsProps = createSelectorsProps();
    mockSlashCommandCatalog([
      {
        id: "cmd_1" as Id<"slashCommands">,
        scope: "organization",
        key: "client-summary",
        canonicalKey: "org:client-summary",
        displayLabel: "/client-summary",
        description: "Summarize client context",
        content: "Summarize the client context.",
        autoExpand: true,
        autoSubmit: true,
      },
    ]);

    render(
      <ThreadComposer
        organizationId={"org_1" as Id<"organizations">}
        onSubmit={onSubmit}
        onInputChange={onInputChange}
        textareaPlaceholder="Configure a prompt..."
        selectorsProps={selectorsProps}
        hideSubmit
      />
    );

    const editor = screen.getByRole("textbox", { name: "Message" });
    fireEvent.paste(editor, {
      clipboardData: {
        getData: () => "/",
        items: [],
      },
    });
    fireEvent.click(await screen.findByRole("button", { name: /\/client-summary/ }));

    await vi.waitFor(() => {
      expect(onInputChange).toHaveBeenCalledWith("Summarize the client context. ");
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("does not bypass the normal submit-disabled state", async () => {
    const onInputChange = vi.fn();
    const onSubmit = vi.fn();
    const selectorsProps = createSelectorsProps();
    mockSlashCommandCatalog([
      {
        id: "cmd_1" as Id<"slashCommands">,
        scope: "organization",
        key: "client-summary",
        canonicalKey: "org:client-summary",
        displayLabel: "/client-summary",
        description: "Summarize client context",
        content: "Summarize the client context.",
        autoExpand: false,
        autoSubmit: true,
      },
    ]);

    render(
      <ThreadComposer
        organizationId={"org_1" as Id<"organizations">}
        onSubmit={onSubmit}
        onInputChange={onInputChange}
        textareaPlaceholder="Ask a question..."
        selectorsProps={selectorsProps}
        submitDisabled
      />
    );

    const editor = screen.getByRole("textbox", { name: "Message" });
    fireEvent.paste(editor, {
      clipboardData: {
        getData: () => "/",
        items: [],
      },
    });
    fireEvent.click(await screen.findByRole("button", { name: /\/client-summary/ }));

    await vi.waitFor(() => {
      expect(onInputChange).toHaveBeenCalledWith(expect.stringContaining("[/client-summary](convoy://command/org:client-summary)"));
    });
    expect(screen.getByRole("button", { name: "Submit" }).hasAttribute("disabled")).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  // No-argument runtime commands submit once when selected.
  test.each(["typed", "menu", "keyboard"])("submits /usage as a command before the first run: %s", async entry => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    useQueryMock.mockReturnValue([]);
    render(<ThreadComposer
      onSubmit={onSubmit}
      textareaPlaceholder="Ask a question..."
      selectorsProps={createSelectorsProps()}
    />);
    const editor = screen.getByRole("textbox", { name: "Message" });
    fireEvent.paste(editor, { clipboardData: { getData: () => entry === "menu" ? "/" : "/usage", items: [] } });
    if (entry === "menu") fireEvent.click(await screen.findByRole("button", { name: /\/usage/ }));
    if (entry === "keyboard") {
      await screen.findByRole("button", { name: /\/usage/ });
      fireEvent.keyDown(editor, { key: "Enter", code: "Enter" });
    }
    if (entry === "typed") fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ runtimeCommand: true })));
  });

  test.each(["compact", "usage"])("autosends /%s selected from the agent-command menu", async command => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const selectorsProps = createSelectorsProps();
    useQueryMock.mockReturnValue([]);

    render(
      <ThreadComposer
        organizationId={"org_1" as Id<"organizations">}
        onSubmit={onSubmit}
        textareaPlaceholder="Ask a question..."
        selectorsProps={selectorsProps}
        runtimeSlashCommands={[{ name: "compact" }, { name: "review" }]}
      />
    );

    const editor = screen.getByRole("textbox", { name: "Message" });
    fireEvent.paste(editor, {
      clipboardData: {
        getData: () => "/",
        items: [],
      },
    });
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(`/${command}`) }));

    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          text: `/${command} `,
          // Forwarded verbatim to the runtime, not expanded server-side.
          runtimeCommand: true,
        })
      );
    });
  });

  // Custom commands and skills still take free-text arguments, so selecting
  // one must leave the draft editable.
  test("does not autosend other agent commands", async () => {
    const onInputChange = vi.fn();
    const onSubmit = vi.fn();
    const selectorsProps = createSelectorsProps();
    useQueryMock.mockReturnValue([]);

    render(
      <ThreadComposer
        organizationId={"org_1" as Id<"organizations">}
        onSubmit={onSubmit}
        onInputChange={onInputChange}
        textareaPlaceholder="Ask a question..."
        selectorsProps={selectorsProps}
        runtimeSlashCommands={[{ name: "review" }]}
      />
    );

    const editor = screen.getByRole("textbox", { name: "Message" });
    fireEvent.paste(editor, {
      clipboardData: {
        getData: () => "/",
        items: [],
      },
    });
    fireEvent.click(await screen.findByRole("button", { name: /\/review/ }));

    await vi.waitFor(() => {
      expect(onInputChange).toHaveBeenCalledWith("/review ");
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  // Typing the command out is not a menu selection: the inventory may be
  // stale and a name can be a prefix of a longer one.
  test("does not autosend a typed /compact without menu selection", async () => {
    const onInputChange = vi.fn();
    const onSubmit = vi.fn();
    const selectorsProps = createSelectorsProps();
    useQueryMock.mockReturnValue([]);

    render(
      <ThreadComposer
        organizationId={"org_1" as Id<"organizations">}
        onSubmit={onSubmit}
        onInputChange={onInputChange}
        textareaPlaceholder="Ask a question..."
        selectorsProps={selectorsProps}
        runtimeSlashCommands={[{ name: "compact" }]}
      />
    );

    const editor = screen.getByRole("textbox", { name: "Message" });
    fireEvent.paste(editor, {
      clipboardData: {
        getData: () => "/compact",
        items: [],
      },
    });

    await vi.waitFor(() => {
      expect(onInputChange).toHaveBeenCalledWith("/compact");
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("serializes selected @-file mentions as inline @path text", async () => {
    const onInputChange = vi.fn();
    const selectorsProps = createSelectorsProps();
    useFileMentionSearchMock.mockReturnValue({
      files: ["src/components/button.tsx"],
      isLoading: false,
    });

    render(
      <ThreadComposer
        onSubmit={vi.fn()}
        onInputChange={onInputChange}
        textareaPlaceholder="Ask a question..."
        selectorsProps={selectorsProps}
      />
    );

    const editor = screen.getByRole("textbox", { name: "Message" });
    fireEvent.paste(editor, {
      clipboardData: {
        getData: () => "@",
        items: [],
      },
    });

    fireEvent.click(await screen.findByRole("button", { name: /button\.tsx/ }));

    await vi.waitFor(() => {
      expect(onInputChange).toHaveBeenCalledWith(expect.stringContaining("@src/components/button.tsx"));
    });
  });

  test("toggles to plan with Shift+Tab", () => {
    setTestHotkeyPlatform({
      platform: "MacIntel",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    });
    const onModeChange = vi.fn();
    const selectorsProps = createSelectorsProps({
      cliType: "claude-code",
      mode: "agent",
      onModeChange,
    });

    render(<ThreadComposer onSubmit={vi.fn()} textareaPlaceholder="Ask a question..." selectorsProps={selectorsProps} />);

    fireEvent.keyDown(screen.getByPlaceholderText("Ask a question..."), {
      code: "Tab",
      key: "Tab",
      shiftKey: true,
    });

    expect(onModeChange).toHaveBeenCalledWith("plan");
  });

  test("toggles to agent with Shift+Tab when currently in plan mode", () => {
    setTestHotkeyPlatform({
      platform: "Linux x86_64",
      userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
    });
    const onModeChange = vi.fn();
    const selectorsProps = createSelectorsProps({
      cliType: "claude-code",
      mode: "plan",
      onModeChange,
    });

    render(<ThreadComposer onSubmit={vi.fn()} textareaPlaceholder="Ask a follow-up question..." selectorsProps={selectorsProps} />);

    fireEvent.keyDown(screen.getByPlaceholderText("Ask a follow-up question..."), {
      code: "Tab",
      key: "Tab",
      shiftKey: true,
    });

    expect(onModeChange).toHaveBeenCalledWith("agent");
  });

  test("does not toggle mode when active cli type has no plan mode", () => {
    setTestHotkeyPlatform({
      platform: "MacIntel",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    });
    const onModeChange = vi.fn();
    const selectorsProps = createSelectorsProps({
      cliType: "other",
      mode: "agent",
      onModeChange,
    });

    render(
      <ThreadComposer
        projectId={"project_1" as Id<"projects">}
        onSubmit={vi.fn()}
        textareaPlaceholder="Type message..."
        selectorsProps={selectorsProps}
      />
    );

    fireEvent.keyDown(screen.getByPlaceholderText("Type message..."), {
      code: "Tab",
      key: "Tab",
      shiftKey: true,
    });

    expect(onModeChange).not.toHaveBeenCalled();
  });

  test("uses stop action when processing is active and input is empty", () => {
    const onStop = vi.fn();
    const onSubmit = vi.fn();
    const selectorsProps = createSelectorsProps();

    render(
      <ThreadComposer
        onSubmit={onSubmit}
        onStop={onStop}
        showStopWhenIdleInput
        textareaPlaceholder="Type message..."
        selectorsProps={selectorsProps}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));

    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("Escape in the composer stops a run, but only while Stop is offered", () => {
    const onStop = vi.fn();
    const selectorsProps = createSelectorsProps();

    const { unmount } = render(
      <ThreadComposer onSubmit={vi.fn()} onStop={onStop} showStopWhenIdleInput selectorsProps={selectorsProps} />
    );
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Message" }), { key: "Escape" });
    expect(onStop).toHaveBeenCalledTimes(1);
    unmount();

    render(
      <ThreadComposer
        onSubmit={vi.fn()}
        onStop={onStop}
        showStopWhenIdleInput
        initialInput="Queue this"
        selectorsProps={selectorsProps}
      />
    );
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Message" }), { key: "Escape" });
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  test("defaults the placeholder to describing a task", () => {
    render(<ThreadComposer onSubmit={vi.fn()} selectorsProps={createSelectorsProps()} />);

    expect(screen.getByRole("textbox", { name: "Message" }).getAttribute("aria-placeholder")).toBe(
      "Describe a task or ask a question"
    );
  });

  test("submits queued message instead of stopping when input has text", async () => {
    const onStop = vi.fn();
    const onSubmit = vi.fn();
    const selectorsProps = createSelectorsProps();

    render(
      <ThreadComposer
        onSubmit={onSubmit}
        onStop={onStop}
        showStopWhenIdleInput
        initialInput="Queue this follow-up"
        textareaPlaceholder="Type message..."
        selectorsProps={selectorsProps}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          text: "Queue this follow-up",
        })
      );
    });
    expect(onStop).not.toHaveBeenCalled();
  });

  test("blocks submit when pending attachment is in error state", async () => {
    const onSubmit = vi.fn();
    const selectorsProps = createSelectorsProps();

    render(
      <ThreadComposer
        onSubmit={onSubmit}
        initialInput="Retry with attachment"
        pendingAttachments={[
          {
            id: "upload_1",
            fileName: "broken.png",
            fileSize: 42,
            contentType: "image/png",
            status: "error",
            error: "Upload failed",
          },
        ]}
        textareaPlaceholder="Type message..."
        selectorsProps={selectorsProps}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await vi.waitFor(() => {
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  test("renders a plus attach menu with file and task actions", () => {
    const selectorsProps = createSelectorsProps();

    render(
      <ThreadComposer
        projectId={"project_1" as Id<"projects">}
        onSubmit={vi.fn()}
        textareaPlaceholder="Type message..."
        selectorsProps={selectorsProps}
      />
    );

    expect(screen.getByRole("button", { name: "Open attach menu" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Attach file" })).toBeNull();

    openAttachMenu();

    expect(screen.getByText("Attach files or photos")).toBeDefined();
    expect(screen.getByText("Attach task")).toBeDefined();
    expect(screen.getByText("Attach task").closest("[role='menuitem']")?.hasAttribute("data-disabled")).toBe(false);
  });

  test("opens the file dialog from the attach menu action", () => {
    const inputClickSpy = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    const selectorsProps = createSelectorsProps();

    render(<ThreadComposer onSubmit={vi.fn()} textareaPlaceholder="Type message..." selectorsProps={selectorsProps} />);

    openAttachMenu();
    fireEvent.click(screen.getByText("Attach files or photos"));

    expect(inputClickSpy).toHaveBeenCalledTimes(1);

    inputClickSpy.mockRestore();
  });

  test("opens the file dialog with Cmd+U", () => {
    setTestHotkeyPlatform({
      platform: "MacIntel",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    });
    const inputClickSpy = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    const selectorsProps = createSelectorsProps();

    render(<ThreadComposer onSubmit={vi.fn()} textareaPlaceholder="Type message..." selectorsProps={selectorsProps} />);

    fireEvent.keyDown(screen.getByPlaceholderText("Type message..."), {
      code: "KeyU",
      key: "U",
      metaKey: true,
    });

    expect(inputClickSpy).toHaveBeenCalledTimes(1);

    inputClickSpy.mockRestore();
  });

  test("opens the task selector from the attach task menu action", () => {
    const selectorsProps = createSelectorsProps();

    render(
      <ThreadComposer
        projectId={"project_1" as Id<"projects">}
        onSubmit={vi.fn()}
        textareaPlaceholder="Type message..."
        selectorsProps={selectorsProps}
      />
    );

    openAttachMenu();
    fireEvent.click(screen.getByText("Attach task"));

    expect(screen.getByTestId("task-selector-dialog")).toBeDefined();
  });

  test("renders a selected task pill before file pills and closes the selector", () => {
    const selectorsProps = createSelectorsProps();

    render(
      <ThreadComposer
        projectId={"project_1" as Id<"projects">}
        onSubmit={vi.fn()}
        textareaPlaceholder="Type message..."
        selectorsProps={selectorsProps}
      />
    );

    fireEvent.change(screen.getByLabelText("Upload files"), {
      target: {
        files: [new File(["notes"], "notes.txt", { type: "text/plain" })],
      },
    });

    openAttachMenu();
    fireEvent.click(screen.getByText("Attach task"));
    fireEvent.click(screen.getByRole("button", { name: "Select task" }));

    expect(screen.queryByTestId("task-selector-dialog")).toBeNull();
    expect(screen.getByText("OS-569")).toBeDefined();
    expect(screen.getByText("Implement task selector")).toBeDefined();
    expect(screen.getByText("notes.txt")).toBeDefined();
    expect(
      screen.getByText("OS-569").compareDocumentPosition(screen.getByText("notes.txt")) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(document.querySelectorAll(".bg-border.h-5.w-px").length).toBe(1);
  });

  test("shows two inline files before grouping when there is no task", () => {
    const selectorsProps = createSelectorsProps();

    render(<ThreadComposer onSubmit={vi.fn()} textareaPlaceholder="Type message..." selectorsProps={selectorsProps} />);

    fireEvent.change(screen.getByLabelText("Upload files"), {
      target: {
        files: [
          new File(["notes"], "notes.txt", { type: "text/plain" }),
          new File(["design"], "design.png", { type: "image/png" }),
          new File(["spec"], "spec.pdf", { type: "application/pdf" }),
        ],
      },
    });

    expect(screen.getByText("notes.txt")).toBeDefined();
    expect(screen.getByText("design.png")).toBeDefined();
    expect(screen.getByRole("button", { name: "1 more attachment" })).toBeDefined();
    expect(screen.queryByText("spec.pdf")).toBeNull();
  });

  test("shows the blue drop highlight when files are dragged over the composer", () => {
    const selectorsProps = createSelectorsProps();

    render(<ThreadComposer onSubmit={vi.fn()} textareaPlaceholder="Type message..." selectorsProps={selectorsProps} />);

    const form = screen.getByPlaceholderText("Type message...").closest("form");
    if (!form) {
      throw new Error("Expected composer form");
    }

    fireEvent.dragEnter(form, {
      dataTransfer: {
        types: ["Files"],
        files: [],
      },
    });

    expect(screen.getByText("Drop files to attach")).toBeDefined();
  });

  test("shows grouped attachments in a dropdown and removes hidden files", async () => {
    const selectorsProps = createSelectorsProps();

    render(<ThreadComposer onSubmit={vi.fn()} textareaPlaceholder="Type message..." selectorsProps={selectorsProps} />);

    fireEvent.change(screen.getByLabelText("Upload files"), {
      target: {
        files: [
          new File(["notes"], "notes.txt", { type: "text/plain" }),
          new File(["design"], "design.png", { type: "image/png" }),
          new File(["spec"], "spec.pdf", { type: "application/pdf" }),
        ],
      },
    });

    fireEvent.pointerDown(screen.getByRole("button", { name: "1 more attachment" }), {
      button: 0,
    });

    expect(screen.getByText("spec.pdf")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Remove spec.pdf" }));

    await vi.waitFor(() => {
      expect(screen.queryByRole("button", { name: "1 more attachment" })).toBeNull();
    });

    expect(screen.getByText("design.png")).toBeDefined();
    expect(screen.queryByText("spec.pdf")).toBeNull();
  });

  test("opens an image attachment preview before sending", () => {
    const selectorsProps = createSelectorsProps();

    render(<ThreadComposer onSubmit={vi.fn()} textareaPlaceholder="Type message..." selectorsProps={selectorsProps} />);

    fireEvent.change(screen.getByLabelText("Upload files"), {
      target: {
        files: [new File(["design"], "design.png", { type: "image/png" })],
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Preview design.png" }));

    expect(screen.getByRole("dialog", { name: "Attachment preview" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Remove design.png" })).toBeDefined();
  });

  test("mounts with a draft's restored attachments and reports them to the host (OS-2141)", () => {
    const selectorsProps = createSelectorsProps();
    const onAttachmentsChange = vi.fn();
    const restored = [{ id: "part-1", type: "file" as const, filename: "design.png", mediaType: "image/png", url: "https://files.test/design" }];

    render(
      <ThreadComposer
        onSubmit={vi.fn()}
        textareaPlaceholder="Type message..."
        selectorsProps={selectorsProps}
        initialAttachments={restored}
        onAttachmentsChange={onAttachmentsChange}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Preview design.png" }));
    expect(screen.getByRole("dialog", { name: "Attachment preview" })).toBeDefined();
    expect(onAttachmentsChange).toHaveBeenLastCalledWith(restored);
  });

  test("opens a text attachment preview before sending, e.g. a handoff file", () => {
    const selectorsProps = createSelectorsProps();
    const restored = [{ id: "part-1", type: "file" as const, filename: "handoff.md", mediaType: "text/markdown", url: "https://files.test/handoff" }];

    render(
      <ThreadComposer
        onSubmit={vi.fn()}
        textareaPlaceholder="Type message..."
        selectorsProps={selectorsProps}
        initialAttachments={restored}
        pendingAttachments={[
          { id: "upload-1", filePartId: "part-1", fileName: "handoff.md", fileSize: 120, contentType: "text/markdown", status: "uploaded" },
        ]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Preview handoff.md" }));

    expect(screen.getByRole("dialog", { name: "Attachment preview" })).toBeDefined();
  });

  test("opens a queued image preview from the grouped attachments menu", () => {
    const selectorsProps = createSelectorsProps();

    render(<ThreadComposer onSubmit={vi.fn()} textareaPlaceholder="Type message..." selectorsProps={selectorsProps} />);

    fireEvent.change(screen.getByLabelText("Upload files"), {
      target: {
        files: [
          new File(["notes"], "notes.txt", { type: "text/plain" }),
          new File(["spec"], "spec.pdf", { type: "application/pdf" }),
          new File(["design"], "design.png", { type: "image/png" }),
        ],
      },
    });

    fireEvent.pointerDown(screen.getByRole("button", { name: "1 more attachment" }), {
      button: 0,
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview design.png" }));

    expect(screen.getByRole("dialog", { name: "Attachment preview" })).toBeDefined();
  });

  test("shows only one inline file when a task is attached", () => {
    const selectorsProps = createSelectorsProps();

    render(
      <ThreadComposer
        projectId={"project_1" as Id<"projects">}
        onSubmit={vi.fn()}
        textareaPlaceholder="Type message..."
        selectorsProps={selectorsProps}
      />
    );

    fireEvent.change(screen.getByLabelText("Upload files"), {
      target: {
        files: [new File(["notes"], "notes.txt", { type: "text/plain" }), new File(["design"], "design.png", { type: "image/png" })],
      },
    });

    openAttachMenu();
    fireEvent.click(screen.getByText("Attach task"));
    fireEvent.click(screen.getByRole("button", { name: "Select task" }));

    expect(screen.getByText("OS-569")).toBeDefined();
    expect(screen.getByText("notes.txt")).toBeDefined();
    expect(screen.getByRole("button", { name: "1 more attachment" })).toBeDefined();
    expect(screen.queryByText("design.png")).toBeNull();
  });

  test("centers the task separator with attachment pills", () => {
    const selectorsProps = createSelectorsProps();

    render(
      <ThreadComposer
        projectId={"project_1" as Id<"projects">}
        onSubmit={vi.fn()}
        textareaPlaceholder="Type message..."
        selectorsProps={selectorsProps}
      />
    );

    fireEvent.change(screen.getByLabelText("Upload files"), {
      target: {
        files: [new File(["notes"], "notes.txt", { type: "text/plain" })],
      },
    });

    openAttachMenu();
    fireEvent.click(screen.getByText("Attach task"));
    fireEvent.click(screen.getByRole("button", { name: "Select task" }));

    const header = document.querySelector('[data-slot="input-group-addon"]');
    const separatorWrapper = document.querySelector(".bg-border.h-5.w-px")?.parentElement;
    const separator = document.querySelector(".bg-border.h-5.w-px");

    expect(header?.className).toContain("items-center");
    expect(separatorWrapper?.className).toContain("items-center");
    expect(separator?.className).toContain("h-5");
  });

  test("selecting another task replaces the existing task pill", () => {
    const selectorsProps = createSelectorsProps();

    render(
      <ThreadComposer
        projectId={"project_1" as Id<"projects">}
        onSubmit={vi.fn()}
        textareaPlaceholder="Type message..."
        selectorsProps={selectorsProps}
      />
    );

    openAttachMenu();
    fireEvent.click(screen.getByText("Attach task"));
    fireEvent.click(screen.getByRole("button", { name: "Select task" }));

    openAttachMenu();
    fireEvent.click(screen.getByText("Attach task"));
    fireEvent.click(screen.getByRole("button", { name: "Select replacement task" }));

    expect(screen.queryByText("OS-569")).toBeNull();
    expect(screen.queryByText("Implement task selector")).toBeNull();
    expect(screen.getByText("OS-570")).toBeDefined();
    expect(screen.getByText("Ship task attachments")).toBeDefined();
  });

  test("removing the task pill clears it", () => {
    const selectorsProps = createSelectorsProps();

    render(
      <ThreadComposer
        projectId={"project_1" as Id<"projects">}
        onSubmit={vi.fn()}
        textareaPlaceholder="Type message..."
        selectorsProps={selectorsProps}
      />
    );

    openAttachMenu();
    fireEvent.click(screen.getByText("Attach task"));
    fireEvent.click(screen.getByRole("button", { name: "Select task" }));

    fireEvent.click(screen.getByRole("button", { name: "Remove OS-569" }));

    expect(screen.queryByText("OS-569")).toBeNull();
    expect(screen.queryByText("Implement task selector")).toBeNull();
  });

  test("renders an initial attached task from props and allows removing it by default", () => {
    const selectorsProps = createSelectorsProps();

    render(
      <ThreadComposer
        onSubmit={vi.fn()}
        initialAttachedTask={createInitialAttachedTask()}
        textareaPlaceholder="Type message..."
        selectorsProps={selectorsProps}
      />
    );

    expect(screen.getByText("OS-635")).toBeDefined();
    expect(screen.getByText("Wire task preselection into threads page")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Remove OS-635" }));

    expect(screen.queryByText("OS-635")).toBeNull();
  });

  // OS-1685: the drop target used to be gated on an `onTaskDrop` prop, so every
  // surface that did not pass one (the group draft tab) had a dead drop zone.
  // Attaching is the composer's own state, so a drag attaches without one.
  test("attaches a dropped task without an onTaskDrop prop", () => {
    const selectorsProps = createSelectorsProps();
    useQueryMock.mockImplementation((query: Parameters<typeof getFunctionName>[0], args: unknown) => {
      if (args === "skip" || getFunctionName(query) !== "tasks/core:getSummariesByIds") {
        return undefined;
      }
      return [
        {
          _id: "task_1" as Id<"tasks">,
          refId: "OS-569",
          name: "Implement task selector",
          taskType: getDefaultTaskTypeSummary(),
          isArchived: false,
        },
      ];
    });

    render(
      <ThreadComposer
        projectId={"project_1" as Id<"projects">}
        onSubmit={vi.fn()}
        textareaPlaceholder="Type message..."
        selectorsProps={selectorsProps}
      />
    );

    const dataTransfer = taskDataTransfer({
      projectId: "project_1",
      taskIds: ["task_1"],
      taskRefIds: ["OS-569"],
    });
    const zone = screen.getByRole("textbox", { name: "Message" }).closest("div.relative");
    if (!zone) {
      throw new Error("drop zone is missing");
    }

    fireEvent.dragOver(zone, { dataTransfer });
    expect(screen.getByTestId("thread-composer-task-drop-overlay")).toBeDefined();

    fireEvent.drop(zone, { dataTransfer });

    expect(screen.getByText("OS-569")).toBeDefined();

    // Re-dropping the same task after removing the pill must re-attach it.
    fireEvent.click(screen.getByRole("button", { name: "Remove OS-569" }));
    expect(screen.queryByText("OS-569")).toBeNull();

    fireEvent.drop(zone, { dataTransfer });
    expect(screen.getByText("OS-569")).toBeDefined();
  });

  test("keeps the initial attached task locked when removal is disabled", () => {
    const selectorsProps = createSelectorsProps();

    render(
      <ThreadComposer
        projectId={"project_1" as Id<"projects">}
        onSubmit={vi.fn()}
        initialAttachedTask={createInitialAttachedTask()}
        isAttachedTaskRemovable={false}
        textareaPlaceholder="Type message..."
        selectorsProps={selectorsProps}
      />
    );

    expect(screen.getByText("OS-635")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Remove OS-635" })).toBeNull();

    openAttachMenu();

    expect(screen.getByText("Attach task").closest("[role='menuitem']")?.hasAttribute("data-disabled")).toBe(true);
  });

  test("submits a task-only message with taskId", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const selectorsProps = createSelectorsProps();

    render(
      <ThreadComposer
        projectId={"project_1" as Id<"projects">}
        onSubmit={onSubmit}
        textareaPlaceholder="Type message..."
        selectorsProps={selectorsProps}
      />
    );

    openAttachMenu();
    fireEvent.click(screen.getByText("Attach task"));
    fireEvent.click(screen.getByRole("button", { name: "Select task" }));

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          text: "",
          files: [],
          taskId: "task_1",
        })
      );
    });
  });

  test("clears the task pill after a successful submit", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const selectorsProps = createSelectorsProps();

    render(
      <ThreadComposer
        projectId={"project_1" as Id<"projects">}
        onSubmit={onSubmit}
        textareaPlaceholder="Type message..."
        selectorsProps={selectorsProps}
      />
    );

    openAttachMenu();
    fireEvent.click(screen.getByText("Attach task"));
    fireEvent.click(screen.getByRole("button", { name: "Select task" }));

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await vi.waitFor(() => {
      expect(screen.queryByText("OS-569")).toBeNull();
    });
  });

  test("keeps the task pill after a failed submit", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("submit failed"));
    const selectorsProps = createSelectorsProps();

    render(
      <ThreadComposer
        projectId={"project_1" as Id<"projects">}
        onSubmit={onSubmit}
        textareaPlaceholder="Type message..."
        selectorsProps={selectorsProps}
      />
    );

    openAttachMenu();
    fireEvent.click(screen.getByText("Attach task"));
    fireEvent.click(screen.getByRole("button", { name: "Select task" }));

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });

    expect(screen.getByText("OS-569")).toBeDefined();
  });

  test("does not show the stop action when an attached task is the only queued content", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onStop = vi.fn();
    const selectorsProps = createSelectorsProps();

    render(
      <ThreadComposer
        projectId={"project_1" as Id<"projects">}
        onSubmit={onSubmit}
        onStop={onStop}
        showStopWhenIdleInput
        textareaPlaceholder="Type message..."
        selectorsProps={selectorsProps}
      />
    );

    openAttachMenu();
    fireEvent.click(screen.getByText("Attach task"));
    fireEvent.click(screen.getByRole("button", { name: "Select task" }));

    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: "task_1",
        })
      );
    });
    expect(onStop).not.toHaveBeenCalled();
  });

  test("disables attach task when no project is available", () => {
    const selectorsProps = createSelectorsProps();

    render(<ThreadComposer onSubmit={vi.fn()} textareaPlaceholder="Type message..." selectorsProps={selectorsProps} />);

    openAttachMenu();

    expect(screen.getByText("Attach task").closest("[role='menuitem']")?.hasAttribute("data-disabled")).toBe(true);
  });

  test("keeps the composer shell enabled when only submit is disabled", () => {
    const selectorsProps = createSelectorsProps();

    render(<ThreadComposer onSubmit={vi.fn()} textareaPlaceholder="Type message..." selectorsProps={selectorsProps} />);

    const inputGroup = document.querySelector('[data-slot="input-group"]');

    expect(screen.getByRole("button", { name: "Submit" }).hasAttribute("disabled")).toBe(true);
    expect(inputGroup?.className).not.toContain("has-disabled:opacity-50");
    expect(inputGroup?.className).toContain("has-[[data-slot=input-group-control]:disabled]:opacity-50");
  });

  test("does not open the file dialog shortcut while submitting", () => {
    setTestHotkeyPlatform({
      platform: "MacIntel",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    });
    const inputClickSpy = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    const selectorsProps = createSelectorsProps();

    render(<ThreadComposer onSubmit={vi.fn()} isSubmitting textareaPlaceholder="Type message..." selectorsProps={selectorsProps} />);

    fireEvent.keyDown(screen.getByPlaceholderText("Type message..."), {
      code: "KeyU",
      key: "U",
      metaKey: true,
    });

    expect(inputClickSpy).not.toHaveBeenCalled();

    inputClickSpy.mockRestore();
  });

  test("shows submitting state and disables composer controls", () => {
    const selectorsProps = createSelectorsProps();

    render(
      <ThreadComposer
        onSubmit={vi.fn()}
        isSubmitting
        initialInput="Submitting draft"
        textareaPlaceholder="Type message..."
        selectorsProps={selectorsProps}
      />
    );

    expect(screen.getByPlaceholderText("Type message...").hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Submit" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByTestId("thread-context-selectors").getAttribute("data-disabled")).toBe("true");
    expect(screen.getByRole("button", { name: "Open attach menu" }).hasAttribute("disabled")).toBe(true);
  });

  test("does not toggle mode shortcut while submitting", () => {
    setTestHotkeyPlatform({
      platform: "MacIntel",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    });
    const onModeChange = vi.fn();
    const selectorsProps = createSelectorsProps({ onModeChange });

    render(<ThreadComposer onSubmit={vi.fn()} isSubmitting textareaPlaceholder="Type message..." selectorsProps={selectorsProps} />);

    fireEvent.keyDown(screen.getByPlaceholderText("Type message..."), {
      code: "Tab",
      key: "Tab",
      shiftKey: true,
    });

    expect(onModeChange).not.toHaveBeenCalled();
  });
});

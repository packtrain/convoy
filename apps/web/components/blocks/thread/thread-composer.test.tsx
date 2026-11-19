/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { ComponentProps, ReactNode } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { ThreadComposer } from "./thread-composer";

test("shows live background tasks beside the composer meters", () => {
  render(<ThreadComposer
    onSubmit={vi.fn()}
    textareaPlaceholder="Ask"
    backgroundTasks={{ messageId: "message_1" as Id<"cliMessages">, totalCount: 1,
      tasks: [{ id: "task-1", type: "local_bash", description: "Run integration tests" }] }}
    selectorsProps={{ profiles: [], profileId: "", pathId: "", cliType: "claude-code", mode: "agent", cliModel: undefined, onModeChange: vi.fn(), hideWorkingDirectory: true }}
  />);
  fireEvent.click(screen.getByRole("button", { name: "1 job running" }));
  expect(screen.getByText("Run integration tests")).toBeTruthy();
});

test.each([
  [[{ name: "goal" }], true],
  [[{ name: "compact" }], false],
])("offers Clear goal only when the runtime advertises /goal (OS-2276)", (runtimeSlashCommands, offered) => {
  const onClearGoal = vi.fn();
  render(<ThreadComposer
    onSubmit={vi.fn()}
    textareaPlaceholder="Ask"
    goal={{ objective: "a.txt exists", status: "active", iterations: 0 }}
    onClearGoal={onClearGoal}
    runtimeSlashCommands={runtimeSlashCommands}
    selectorsProps={{ profiles: [], profileId: "", pathId: "", cliType: "claude-code", mode: "agent", cliModel: undefined, onModeChange: vi.fn(), hideWorkingDirectory: true }}
  />);
  fireEvent.click(screen.getByRole("button", { name: "Goal active: a.txt exists" }));
  const clear = screen.queryByRole("button", { name: "Clear goal" });
  expect(clear !== null).toBe(offered);
  if (clear) fireEvent.click(clear);
  expect(onClearGoal).toHaveBeenCalledTimes(offered ? 1 : 0);
  cleanup();
});

test.each([
  [[{ name: "compact" }], true],
  [[{ name: "goal" }], false],
])("passes Compact to the context meter only when the runtime advertises /compact (OS-2339)", (runtimeSlashCommands, offered) => {
  const onCompact = vi.fn();
  render(<ThreadComposer
    onSubmit={vi.fn()}
    textareaPlaceholder="Ask"
    showContextWindowMeter
    onCompact={onCompact}
    runtimeSlashCommands={runtimeSlashCommands}
    selectorsProps={{ profiles: [], profileId: "", pathId: "", cliType: "claude-code", mode: "agent", cliModel: undefined, onModeChange: vi.fn(), hideWorkingDirectory: true }}
  />);
  const compact = screen.queryByRole("button", { name: "Compact context" });
  expect(compact !== null).toBe(offered);
  if (compact) fireEvent.click(compact);
  expect(onCompact).toHaveBeenCalledTimes(offered ? 1 : 0);
  cleanup();
});

vi.mock("@tanstack/react-hotkeys", () => ({
  useHotkey: () => {},
}));

const setInputMock = vi.fn();
const attachmentFilesMock = vi.hoisted(() => ({
  files: [] as Array<{ id: string; type: "file"; filename: string; mediaType: string; url: string }>,
}));

vi.mock("@/components/ai-elements/prompt-input", () => ({
  PromptInput: ({
    children,
    onSubmit,
    as,
    className,
  }: {
    children: ReactNode;
    onSubmit?: (message: { text: string; files: [] }) => void;
    multiple?: boolean;
    as?: "form" | "div";
    className?: string;
  }) => {
    const content = (
      <>
        {children}
        <button type="button" onClick={() => onSubmit?.({ text: "", files: [] })}>
          Submit
        </button>
      </>
    );

    return as === "div" ? (
      <div className={className}>{content}</div>
    ) : (
      <form className={className}>{content}</form>
    );
  },
  PromptInputFooter: ({ children, className }: { children: ReactNode; className?: string }) => <div className={className}>{children}</div>,
  PromptInputHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PromptInputProvider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PromptInputSubmit: ({ children }: { children?: ReactNode }) => <button type="button">{children ?? "Send"}</button>,
  PromptInputTextarea: () => <textarea name="message" />,
  PromptInputTools: ({ children, className }: { children: ReactNode; className?: string }) => <div className={className}>{children}</div>,
  usePromptInputAttachments: () => ({
    files: attachmentFilesMock.files,
    remove: vi.fn(),
    openFileDialog: vi.fn(),
  }),
  usePromptInputController: () => ({
    attachments: {
      files: [],
    },
    textInput: { value: "", setInput: setInputMock },
  }),
}));

vi.mock("@/components/blocks/thread/context-window-meter", () => ({
  ContextWindowMeter: ({ onCompact }: { onCompact?: () => void }) => (
    <div>Context Window{onCompact ? <button type="button" onClick={onCompact}>Compact context</button> : null}</div>
  ),
}));

vi.mock("@/components/blocks/tasks/task-ref-with-type", () => ({
  TaskRefWithType: ({ refId }: { refId: string }) => <span>{refId}</span>,
}));

vi.mock("@/components/blocks/thread/thread-attachment-menu", () => ({
  ThreadAttachmentMenu: () => <div>Attachment Menu</div>,
}));

vi.mock("@/components/blocks/thread/working-directory-selector", () => ({
  WorkingDirectorySelector: ({ compact }: { compact?: boolean }) => (
    <div
      data-testid="working-directory-selector"
      data-compact={String(Boolean(compact))}
    />
  ),
}));

vi.mock("@/components/blocks/thread/base-ref-selector", () => ({
  BaseRefSelector: ({
    compact,
    iconOnly,
  }: {
    compact?: boolean;
    iconOnly?: boolean;
  }) => (
    <div
      data-testid="base-ref-selector"
      data-compact={String(Boolean(compact))}
      data-icon-only={String(Boolean(iconOnly))}
    />
  ),
  WorkspaceSelectors: () => <div data-testid="workspace-selectors" />,
}));

vi.mock("@/components/blocks/thread/thread-context-selectors", () => ({
  ThreadContextSelectors: (props: {
    cliModel?: string;
    onProjectAgentChange?: unknown;
  }) => (
    <div
      data-cli-model={props.cliModel ?? ""}
      data-has-agent-handler={String(Boolean(props.onProjectAgentChange))}
    >
      Selectors
    </div>
  ),
}));

vi.mock("@/components/blocks/thread/thread-agent-selector", () => ({
  ThreadAgentSelector: ({
    value,
    compact,
  }: {
    value: string | undefined;
    compact?: boolean;
  }) => (
    <div
      data-testid="wide-thread-agent-selector"
      data-value={value ?? ""}
      data-compact={String(Boolean(compact))}
    />
  ),
}));

vi.mock("@/components/blocks/thread/thread-task-selector-dialog", () => ({
  ThreadTaskSelectorDialog: ({ getTaskHref }: { getTaskHref: (task: { refId: string; isArchived: boolean }) => string }) => (
    <a href={getTaskHref({ refId: "WEB-7", isArchived: false })}>Task link</a>
  ),
}));

vi.mock("@/components/blocks/integrations", () => ({
  AttachedPullRequestPill: ({ pullRequest, onRemove }: { pullRequest: { ref: string }; onRemove?: () => void }) => (
    <button type="button" onClick={onRemove}>Remove {pullRequest.ref}</button>
  ),
  PullRequestSelectorDialog: ({ onSelect }: { onSelect: (pr: { owner: string; name: string; number: number; ref: string }) => void }) => (
    <button type="button" onClick={() => onSelect({ owner: "contoso", name: "convoy", number: 482, ref: "contoso/convoy#482" })}>
      Pick PR
    </button>
  ),
}));

vi.mock("@/lib/navigation/use-route-params", () => ({
  useRouteParams: () => ({ organizationSlug: "acme", threadId: "thread_1" }),
}));

vi.mock("@/components/custom/tooltip-ext", () => ({
  TooltipExt: ({ children, content, delayDuration }: { children: ReactNode; content: string; delayDuration?: number }) => (
    <span data-tooltip-content={content} data-tooltip-delay={delayDuration}>
      {children}
    </span>
  ),
}));

const uiTooltipDelays = vi.hoisted(() => [] as (number | undefined)[]);
vi.mock("@/components/ui/tooltip", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ui/tooltip")>()),
  Tooltip: ({ children, delayDuration }: { children: ReactNode; delayDuration?: number }) => {
    uiTooltipDelays.push(delayDuration);
    return children;
  },
  TooltipTrigger: ({ children }: { children: ReactNode }) => children,
  TooltipContent: () => null,
}));

const selectorsWithCli = (appVersion: string | undefined) => ({
  profiles: [{ _id: "profile_1" as Id<"cliProfiles">, name: "Laptop", isOnline: true, appVersion, paths: [] }],
  profileId: "profile_1",
  pathId: "",
  cliType: "claude-code" as const,
  mode: "agent",
  cliModel: undefined,
  onModeChange: vi.fn(),
  hideWorkingDirectory: true,
});

describe("ThreadComposer", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    attachmentFilesMock.files = [];
  });

  // The tooltip flashed on every move toward Send (OS-2384).
  test("delays the send-button tooltip until a 2-second hover", () => {
    uiTooltipDelays.length = 0;
    render(
      <ThreadComposer
        onSubmit={vi.fn()}
        textareaPlaceholder="Ask"
        selectorsProps={{ profiles: [], profileId: "", pathId: "", cliType: "claude-code", mode: "agent", cliModel: undefined, onModeChange: vi.fn(), hideWorkingDirectory: true }}
      />
    );
    expect(uiTooltipDelays.at(-1)).toBe(2000);
  });

  // A relative `?task=` on a thread page points at the thread (OS-2326).
  test("task selector links to the task page when the host passes no getTaskHref", () => {
    window.history.pushState({}, "", "/o/acme/WEB/threads/thread_1");
    render(
      <ThreadComposer
        onSubmit={vi.fn()}
        textareaPlaceholder="Ask"
        selectorsProps={{ profiles: [], profileId: "", pathId: "", cliType: "claude-code", mode: "agent", cliModel: undefined, onModeChange: vi.fn(), hideWorkingDirectory: true }}
      />
    );
    expect(screen.getByRole("link", { name: "Task link" }).getAttribute("href")).toBe("/o/acme/WEB?task=WEB-7");
  });

  // Pending rows without a file-part id fall back to a name match; each row
  // may back only one pill, so two same-named files get two different rows.
  test("matches same-named pending attachments to distinct file parts (OS-514)", () => {
    attachmentFilesMock.files = [
      { id: "file_1", type: "file", filename: "paste.png", mediaType: "image/png", url: "" },
      { id: "file_2", type: "file", filename: "paste.png", mediaType: "image/png", url: "" },
    ];
    render(
      <ThreadComposer
        onSubmit={vi.fn()}
        textareaPlaceholder="Ask"
        selectorsProps={{ profiles: [], profileId: "", pathId: "", cliType: "claude-code", mode: "agent", cliModel: undefined, onModeChange: vi.fn(), hideWorkingDirectory: true }}
        pendingAttachments={[
          { id: "upload_1", fileName: "paste.png", fileSize: 3, contentType: "image/png", status: "uploading" },
          { id: "upload_2", fileName: "paste.png", fileSize: 3, contentType: "image/png", status: "error", error: "Upload failed" },
        ]}
      />
    );

    expect(document.querySelectorAll('[data-tooltip-content="Upload failed"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-tooltip-content="paste.png"]')).toHaveLength(1);
  });

  // OS-1716: the artifact-comments handoff can seed the draft of the thread
  // already on screen, where the composer never remounts — `initialInput` alone
  // would only seed the editor on mount, so the seeded text has to be pushed in.
  describe("out-of-band seeds", () => {
    const seedProps = {
      projectId: undefined,
      onSubmit: vi.fn(),
      textareaPlaceholder: "Ask",
      selectorsProps: {
        profiles: [],
        profileId: "profile_1",
        pathId: "path_1",
        cliType: "claude-code" as const,
        mode: "agent",
        cliModel: undefined,
        onModeChange: vi.fn(),
      },
    };

    test("does not touch the editor on mount", () => {
      render(<ThreadComposer {...seedProps} initialInput="Seeded" seedKey="seed:1" />);

      expect(setInputMock).not.toHaveBeenCalled();
    });

    test("pushes the text in when the seed key changes", () => {
      const { rerender } = render(
        <ThreadComposer {...seedProps} initialInput="" seedKey={undefined} />
      );

      rerender(
        <ThreadComposer {...seedProps} initialInput="Seeded" seedKey="seed:1" />
      );
      expect(setInputMock).toHaveBeenCalledWith("Seeded");

      // A re-render that does not re-seed leaves the editor alone, so typing
      // after a seed is never reverted.
      setInputMock.mockClear();
      rerender(
        <ThreadComposer {...seedProps} initialInput="Seeded" seedKey="seed:1" />
      );
      expect(setInputMock).not.toHaveBeenCalled();

      // Re-sending the same artifact seeds again, even with identical text.
      rerender(
        <ThreadComposer {...seedProps} initialInput="Seeded" seedKey="seed:2" />
      );
      expect(setInputMock).toHaveBeenCalledWith("Seeded");
    });
  });

  // An older CLI drops `pr(github):`, so a PR-only message would reach the agent empty.
  test("offers the pull request picker only when the selected profile's CLI is 0.142.0 or newer", () => {
    const renderWithCli = (appVersion: string | undefined) =>
      render(
        <ThreadComposer
          projectId={"project_1" as Id<"projects">}
          onSubmit={vi.fn()}
          textareaPlaceholder="Ask"
          selectorsProps={selectorsWithCli(appVersion)}
        />
      );
    renderWithCli("0.141.9");
    expect(screen.queryByRole("button", { name: "Pick PR" })).toBeNull();
    cleanup();
    renderWithCli(undefined);
    expect(screen.queryByRole("button", { name: "Pick PR" })).toBeNull();
    cleanup();
    renderWithCli("0.142.0");
    expect(screen.getByRole("button", { name: "Pick PR" })).toBeTruthy();
  });

  test("an attached pull request goes out with the message as a URL and clears after send", async () => {
    const onSubmit = vi.fn();
    render(
      <ThreadComposer
        projectId={"project_1" as Id<"projects">}
        onSubmit={onSubmit}
        textareaPlaceholder="Ask"
        selectorsProps={selectorsWithCli("0.142.0")}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Pick PR" }));
    expect(screen.getByRole("button", { name: "Remove contoso/convoy#482" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ pullRequestUrl: "https://github.com/contoso/convoy/pull/482" })
    ));
    await vi.waitFor(() => expect(screen.queryByRole("button", { name: "Remove contoso/convoy#482" })).toBeNull());
  });

  test("a removed pull request is not sent", async () => {
    const onSubmit = vi.fn();
    render(
      <ThreadComposer
        projectId={"project_1" as Id<"projects">}
        onSubmit={onSubmit}
        textareaPlaceholder="Ask"
        initialAttachedPullRequest={{ owner: "contoso", name: "convoy", number: 482, ref: "contoso/convoy#482" }}
        selectorsProps={selectorsWithCli("0.142.0")}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove contoso/convoy#482" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]![0].pullRequestUrl).toBeUndefined();
  });

  test("a picked pull request survives a task attachment that remounts the composer (OS-2193)", () => {
    const props = {
      projectId: "project_1" as Id<"projects">,
      onSubmit: vi.fn(),
      textareaPlaceholder: "Ask",
      selectorsProps: selectorsWithCli("0.142.0"),
    };
    const { rerender } = render(<ThreadComposer {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Pick PR" }));

    rerender(
      <ThreadComposer
        {...props}
        initialAttachedTask={{ _id: "task_1" as Id<"tasks">, refId: "WEB-1", name: "Task", taskType: { key: "task", name: "Task", color: "#000", icon: "SquareCheckBig", isSystem: true } }}
      />
    );

    expect(screen.getByRole("button", { name: "Remove contoso/convoy#482" })).toBeTruthy();
  });

  test("a locked pull request has no remove action (OS-2193)", () => {
    render(
      <ThreadComposer
        projectId={"project_1" as Id<"projects">}
        onSubmit={vi.fn()}
        textareaPlaceholder="Ask"
        initialAttachedPullRequest={{ owner: "contoso", name: "convoy", number: 482, ref: "contoso/convoy#482" }}
        isAttachedPullRequestRemovable={false}
        selectorsProps={{ profiles: [], profileId: "", pathId: "", cliType: "claude-code", mode: "agent", cliModel: undefined, onModeChange: vi.fn(), hideWorkingDirectory: true }}
      />
    );

    // The mocked pill renders its remove action as the button's click handler.
    fireEvent.click(screen.getByRole("button", { name: "Remove contoso/convoy#482" }));
    expect(screen.getByRole("button", { name: "Remove contoso/convoy#482" })).toBeTruthy();
  });

  test("attached task pill can open the task and still be removed separately", () => {
    const onOpenAttachedTask = vi.fn();
    const onAttachedTaskChange = vi.fn();

    const { container } = render(
      <ThreadComposer
        projectId={undefined}
        onSubmit={vi.fn()}
        textareaPlaceholder="Ask"
        initialAttachedTask={{
          _id: "task_1" as Id<"tasks">,
          refId: "OS-1",
          name: "Attached task",
          taskType: {
            key: "task",
            name: "Task",
            icon: "SquareCheckBig",
            color: "#64748b",
            isSystem: true,
          },
        }}
        onOpenAttachedTask={onOpenAttachedTask}
        onAttachedTaskChange={onAttachedTaskChange}
        selectorsProps={{
          profiles: [],
          profileId: "profile_1",
          pathId: "path_1",
          cliType: "claude-code",
          mode: "agent",
          cliModel: undefined,
          onModeChange: vi.fn(),
        }}
      />
    );

    expect(
      container
        .querySelector('[data-tooltip-content="OS-1 Attached task"]')
        ?.getAttribute("data-tooltip-delay")
    ).toBe("500");

    fireEvent.click(screen.getByRole("button", { name: "Open OS-1" }));
    expect(onOpenAttachedTask).toHaveBeenCalledWith(
      expect.objectContaining({ refId: "OS-1", name: "Attached task" })
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove OS-1" }));
    expect(onAttachedTaskChange).toHaveBeenCalledWith(null);
  });

  test("config mode can be embedded in a parent form without nesting forms", () => {
    const { container } = render(
      <form>
        <ThreadComposer
          hideSubmit
          onSubmit={vi.fn()}
          textareaPlaceholder="Configure automation"
          selectorsProps={{
            profiles: [],
            profileId: "",
            pathId: "",
            cliType: "codex",
            mode: "agent",
            cliModel: undefined,
            onModeChange: vi.fn(),
          }}
        />
      </form>
    );

    expect(container.querySelectorAll("form")).toHaveLength(1);
  });

  test("renders the project agent selector in the top bar of wide composers", () => {
    render(
      <ThreadComposer
        projectId={undefined}
        onSubmit={vi.fn()}
        textareaPlaceholder="Ask"
        selectorsProps={{
          profiles: [],
          profileId: "profile_1",
          pathId: "path_1",
          cliType: "claude-code",
          mode: "agent",
          cliModel: undefined,
          projectAgents: [
            {
              _id: "agent_1",
              name: "Reviewer",
              appearance: { color: "#22c55e" },
            },
          ],
          projectAgentId: "agent_1",
          onProjectAgentChange: vi.fn(),
          onModeChange: vi.fn(),
        }}
      />
    );

    const selector = screen.getByTestId("wide-thread-agent-selector");
    expect(selector.getAttribute("data-value")).toBe("agent_1");
    expect(selector.getAttribute("data-compact")).toBe("false");
  });

  test("keeps the agent selector when a stored agent id has no active agents left to list", () => {
    render(
      <ThreadComposer
        projectId={undefined}
        onSubmit={vi.fn()}
        textareaPlaceholder="Ask"
        selectorsProps={{
          profiles: [],
          profileId: "profile_1",
          pathId: "path_1",
          cliType: "claude-code",
          mode: "agent",
          cliModel: undefined,
          projectAgents: [],
          projectAgentId: "agent_gone",
          onProjectAgentChange: vi.fn(),
          onModeChange: vi.fn(),
        }}
      />
    );

    // The stored id must stay clearable even though the active-agent list is empty.
    expect(screen.getByTestId("wide-thread-agent-selector").getAttribute("data-value")).toBe("agent_gone");
  });

  test("always renders the context bar above labeled footer selectors (single layout)", () => {
    const { container } = render(
      <ThreadComposer
        projectId={undefined}
        onSubmit={vi.fn()}
        textareaPlaceholder="Ask"
        showContextWindowMeter
        selectorsProps={{
          profiles: [
            {
              _id: "profile_1" as Id<"cliProfiles">,
              name: "Mobile",
              isOnline: true,
              paths: [
                {
                  id: "path_1",
                  label: "workspace",
                  path: "/workspace",
                  gitRemoteUrl: "https://github.com/contoso/contoso.git",
                },
              ],
            },
          ],
          profileId: "profile_1",
          pathId: "path_1",
          cliType: "claude-code",
          mode: "agent",
          cliModel: "opus",
          projectAgents: [
            {
              _id: "agent_1",
              name: "Reviewer",
              appearance: { color: "#22c55e" },
            },
          ],
          projectAgentId: "agent_1",
          onProjectAgentChange: vi.fn(),
          onBaseRefChange: vi.fn(),
          onModeChange: vi.fn(),
        }}
      />
    );

    // One layout everywhere: full-text context controls in the top bar (no
    // compact variants, no combined icon-only base-ref selector) and labeled
    // footer selectors.
    expect(
      screen.getByTestId("working-directory-selector").getAttribute("data-compact")
    ).toBe("false");
    expect(screen.queryByTestId("base-ref-selector")).toBeNull();
    expect(screen.getByTestId("workspace-selectors")).toBeDefined();
    expect(
      screen.getByTestId("wide-thread-agent-selector").getAttribute("data-compact")
    ).toBe("false");
    expect(
      container.querySelector("[data-cli-model]")?.getAttribute("data-cli-model")
    ).toBe("opus");
    expect(screen.getAllByText("Context Window")).toHaveLength(1);

    const contextBar = container.querySelector(".rounded-t-xl");
    expect(contextBar?.classList.contains("mx-2")).toBe(false);
    expect(contextBar?.classList.contains("-mb-2")).toBe(true);
    expect(contextBar?.classList.contains("pb-3")).toBe(true);
    expect(contextBar?.classList.contains("border")).toBe(true);
    expect(contextBar?.classList.contains("border-b-0")).toBe(true);
    expect(contextBar?.classList.contains("border-border/70")).toBe(true);

    const promptInput = container.querySelector("form");
    expect(promptInput?.className).toContain(
      "[&>[data-slot=input-group]]:bg-thread-composer-input"
    );
  });

  test("explains why worktree options are unavailable for paths without a Git origin", () => {
    render(
      <ThreadComposer
        projectId={undefined}
        onSubmit={vi.fn()}
        textareaPlaceholder="Ask"
        selectorsProps={{
          profiles: [
            {
              _id: "profile_1" as Id<"cliProfiles">,
              name: "Sandbox",
              isOnline: true,
              paths: [{ id: "path_1", label: "workspace", path: "/workspace" }],
            },
          ],
          profileId: "profile_1",
          pathId: "path_1",
          cliType: "codex",
          mode: "agent",
          cliModel: undefined,
          onBaseRefChange: vi.fn(),
          onModeChange: vi.fn(),
        }}
      />
    );

    const workspaceSummary = screen.getByText("Work locally").parentElement;
    expect(workspaceSummary?.parentElement?.getAttribute("data-tooltip-content")).toBe(
      "Worktree options are unavailable because no Git origin was detected for this directory. Add an origin remote, then reconnect the CLI."
    );
    expect(workspaceSummary?.parentElement?.getAttribute("data-tooltip-delay")).toBe("500");
    expect(workspaceSummary?.getAttribute("tabindex")).toBe("0");
  });

  describe("read-only workspace metadata", () => {
    const props = {
      projectId: undefined,
      onSubmit: vi.fn(),
      textareaPlaceholder: "Ask",
      selectorsProps: {
        profiles: [{
          _id: "profile_1" as Id<"cliProfiles">,
          name: "Sandbox",
          isOnline: true,
          paths: [{ id: "path_1", label: "workspace", path: "/workspace", gitRemoteUrl: "https://github.com/example/repo" }],
        }],
        profileId: "profile_1",
        pathId: "path_1",
        cliType: "codex",
        mode: "agent",
        cliModel: undefined,
        onModeChange: vi.fn(),
        lockAgentContext: true,
      },
    } satisfies ComponentProps<typeof ThreadComposer>;

    test("places extra submit actions directly before Send", () => {
      render(<ThreadComposer {...props} extraSubmitActions={<button type="button">Cancel</button>} />);
      const cancel = screen.getByRole("button", { name: "Cancel" });
      const send = screen.getByRole("button", { name: "Send" });
      expect(cancel.parentElement).toBe(send.parentElement);
      expect(cancel.nextElementSibling).toBe(send);
      expect(cancel.parentElement?.className).toContain("shrink-0");
    });

    test("hides the context bar while retaining the editable footer", () => {
      render(<ThreadComposer {...props} hideContextBar readOnlyWorkspace={{ kind: "local", branch: "feat/current" }} />);
      expect(screen.queryByText("Work locally")).toBeNull();
      expect(screen.queryByText("feat/current")).toBeNull();
      expect(screen.queryByTestId("working-directory-selector")).toBeNull();
      expect(screen.getByText("Selectors")).toBeDefined();
      expect(screen.getByRole("button", { name: "Send" })).toBeDefined();
    });

    test("collapses the workspace summary to its icon in a narrow bar (OS-2144)", () => {
      render(<ThreadComposer {...props} readOnlyWorkspace={{ kind: "local" }} />);
      const label = screen.getByText("Work locally");
      expect(label.className).toContain("hidden");
      expect(label.className).toContain("@lg/composer-bar:inline");
      expect(screen.getByLabelText("Workspace: Work locally")).toBe(label.parentElement);
    });

    test("footer cannot widen the composer's host (OS-2144)", () => {
      render(<ThreadComposer {...props} />);
      const send = screen.getByRole("button", { name: "Send" });
      const footer = send.parentElement?.parentElement;
      expect(footer?.className).toContain("[contain:inline-size]");
      expect(screen.getByText("Selectors").parentElement?.className).toContain("min-w-0");
    });

    test("keeps the laptop icon for a local follow-up", () => {
      render(<ThreadComposer {...props} />);
      expect(screen.getByText("Work locally").parentElement?.querySelector(".lucide-laptop")).not.toBeNull();
    });

    test("shows the execution branch after switching to a follow-up and updates later reports", () => {
      const { rerender } = render(
        <ThreadComposer {...props} selectorsProps={{ ...props.selectorsProps, onBaseRefChange: vi.fn() }} />
      );
      expect(screen.getByTestId("workspace-selectors")).toBeDefined();

      rerender(<ThreadComposer {...props} readOnlyWorkspace={{ kind: "local", branch: "feat/current" }} />);
      expect(screen.getByText("feat/current")).toBeDefined();
      expect(screen.queryByTestId("workspace-selectors")).toBeNull();
      expect(screen.getByText("Work locally")).toBeDefined();

      rerender(<ThreadComposer {...props} readOnlyWorkspace={{ kind: "local", branch: "feat/updated" }} />);
      expect(screen.getByText("feat/updated")).toBeDefined();
      expect(screen.queryByText("feat/current")).toBeNull();

      rerender(<ThreadComposer {...props} readOnlyWorkspace={{ kind: "local" }} />);
      expect(screen.queryByText("feat/updated")).toBeNull();
      expect(screen.getByText("Work locally")).toBeDefined();
    });

    test("middle-truncates a long branch so its end stays visible", () => {
      render(<ThreadComposer {...props} readOnlyWorkspace={{ kind: "worktree", branch: "feat/os-2289-evidence-tab-with-agent-attached" }} />);
      expect(screen.getByText("-agent-attached").classList.contains("shrink-0")).toBe(true);
    });

    test("uses the canonical branch instead of stale worktree path metadata", () => {
      render(<ThreadComposer {...props}
        selectorsProps={{ ...props.selectorsProps, profiles: [{
          ...props.selectorsProps.profiles[0],
          paths: [{ ...props.selectorsProps.profiles[0].paths[0], kind: "worktree", branch: "feat/stale" }],
        }] }}
        readOnlyWorkspace={{ kind: "worktree", branch: "feat/actual" }}
      />);
      expect(screen.getByText("feat/actual")).toBeDefined();
      expect(screen.queryByText("feat/stale")).toBeNull();
      expect(screen.getByText("Worktree")).toBeDefined();
    });

    test("preserves worktree metadata when the profile path is unavailable", () => {
      render(<ThreadComposer {...props}
        selectorsProps={{ ...props.selectorsProps, profiles: [] }}
        readOnlyWorkspace={{ kind: "worktree", branch: "feat/removed-path" }}
      />);
      expect(screen.getByText("feat/removed-path")).toBeDefined();
      expect(screen.getByText("Worktree").parentElement?.querySelector(".lucide-git-branch")).not.toBeNull();
      expect(screen.queryByText("Work locally")).toBeNull();
    });
  });

  test("renders read-only workspace and persona metadata in the top bar of existing-thread composers", () => {
    render(
      <ThreadComposer
        projectId={undefined}
        onSubmit={vi.fn()}
        textareaPlaceholder="Ask"
        readOnlyAgent={{
          name: "Persona Check",
          color: "#8b5cf6",
          isDeleted: false,
        }}
        selectorsProps={{
          profiles: [
            {
              _id: "profile_1" as Id<"cliProfiles">,
              name: "DevContainer",
              isOnline: true,
              paths: [
                {
                  id: "path_1",
                  label: "workspace",
                  path: "/workspace",
                  kind: "worktree",
                  branch: "feat/persona-check",
                },
              ],
            },
          ],
          profileId: "profile_1",
          pathId: "path_1",
          cliType: "claude-code",
          mode: "agent",
          cliModel: undefined,
          onModeChange: vi.fn(),
        }}
      />
    );

    expect(screen.getByText("feat/persona-check")).toBeDefined();
    expect(screen.getByTitle("Persona Check").className).toContain("px-2");
  });
});

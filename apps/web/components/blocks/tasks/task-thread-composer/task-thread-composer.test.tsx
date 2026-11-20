/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import { TaskSidebarThreadComposerMock } from "@/test-utils/mocks/thread-composer";
import { CurrentOrgProjectProvider } from "@/lib/routing/current-org-project-context";
import { TaskThreadComposer } from "./task-thread-composer";

const useMutationMock = vi.fn();
const useQueryMock = vi.fn();
const useCliProfilesMock = vi.fn();
const useNewThreadComposerMock = vi.fn();
const useThreadDraftMock = vi.fn();
const useThreadMessageAttachmentUploadMock = vi.fn();
const useRememberedNewThreadCliModelsMock = vi.fn();

const createThreadMutationMock = vi.fn();
const rememberCliModelMock = vi.fn();
const setDraftMock = vi.fn();
const clearDraftMock = vi.fn();
const prepareAttachmentsForSubmitMock = vi.fn();
const clearAfterSubmitMock = vi.fn();
const syncFilePartsMock = vi.fn();

vi.mock("convex/react", () => ({
  useMutation: (...args: unknown[]) => useMutationMock(...args),
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

vi.mock("@/components/blocks/thread/thread-draft-provider", () => ({
  ThreadDraftProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useThreadDraft: (...args: unknown[]) => useThreadDraftMock(...args),
}));

vi.mock("@/components/blocks/thread/thread-composer", () => ({
  ThreadComposer: TaskSidebarThreadComposerMock,
}));

vi.mock("@/lib/threads/hooks/use-cli-profiles", () => ({
  useCliProfiles: (...args: unknown[]) => useCliProfilesMock(...args),
}));

vi.mock("@/lib/threads/hooks/use-new-thread-composer", () => ({
  useNewThreadComposer: (...args: unknown[]) => useNewThreadComposerMock(...args),
}));

vi.mock("@/lib/threads/hooks/use-thread-message-attachment-upload", () => ({
  useThreadMessageAttachmentUpload: (...args: unknown[]) =>
    useThreadMessageAttachmentUploadMock(...args),
  isThreadAttachmentSubmitError: (error: unknown) =>
    error instanceof Error && error.message === "Attachment upload failed",
}));

vi.mock("@/lib/threads/hooks/use-remembered-new-thread-cli-models", () => ({
  useRememberedNewThreadCliModels: (...args: unknown[]) =>
    useRememberedNewThreadCliModelsMock(...args),
}));

const projectId = "project_1" as Id<"projects">;
const organizationId = "organization_1" as Id<"organizations">;

function renderFooter(
  // Loose: an override may swap the task subject for a PR, which the props union types as one or the other.
  overrides?: Record<string, unknown>
) {
  return render(
    <CurrentOrgProjectProvider
      organizationId={organizationId}
      organizationSlug="contoso"
      projectAlias="OS"
    >
      <TaskThreadComposer
        projectId={projectId}
        organizationSlug="contoso"
        projectAlias="OS"
        task={{
          _id: "task_1" as Id<"tasks">,
          refId: "OS-1",
          name: "Current task",
          taskType: {
            key: "task",
            name: "Task",
            color: "#64748b",
            icon: "SquareCheckBig",
            isSystem: true,
          },
          isArchived: false,
        }}
        {...(overrides as object)}
      />
    </CurrentOrgProjectProvider>
  );
}

describe("TaskThreadComposer", () => {
  beforeEach(() => {
    useMutationMock.mockReset();
    useQueryMock.mockReset();
    useCliProfilesMock.mockReset();
    useNewThreadComposerMock.mockReset();
    useThreadDraftMock.mockReset();
    useThreadMessageAttachmentUploadMock.mockReset();
    useRememberedNewThreadCliModelsMock.mockReset();
    createThreadMutationMock.mockReset();
    rememberCliModelMock.mockReset();
    setDraftMock.mockReset();
    clearDraftMock.mockReset();
    prepareAttachmentsForSubmitMock.mockReset();
    clearAfterSubmitMock.mockReset();
    syncFilePartsMock.mockReset();

    useMutationMock.mockReturnValue(createThreadMutationMock);
    // Project agents list backing the composer's Agent pill.
    useQueryMock.mockReturnValue([]);
    useCliProfilesMock.mockReturnValue({
      profiles: [
        {
          _id: "profile_1",
          name: "Primary profile",
          isOnline: true,
          availableClis: [{ type: "claude-code", version: "2.1.0" }],
          paths: [{ id: "path_1", path: "/tmp/project", label: "project" }],
        },
      ],
      hasProfiles: true,
      isLoading: false,
    });
    useThreadDraftMock.mockReturnValue({
      draft: {
        text: "Draft for task 1",
        cliType: "claude-code",
        cliModel: "opus",
        mode: "agent",
        profileId: "profile_1",
        pathId: "path_1",
        updatedAt: Date.now(),
      },
      setDraft: setDraftMock,
      clearDraft: clearDraftMock,
    });
    useNewThreadComposerMock.mockReturnValue({
      resolvedDraftState: {
        text: "Draft for task 1",
        cliType: "claude-code",
        cliModel: "opus",
        mode: "agent",
        profileId: "profile_1",
        pathId: "path_1",
      },
      handleTextChange: vi.fn(),
      handleWorkingDirectoryChange: vi.fn(),
      handleCliTypeChange: vi.fn(),
      handleModeChange: vi.fn(),
      handleCliModelChange: vi.fn(),
    });
    useThreadMessageAttachmentUploadMock.mockReturnValue({
      pendingAttachments: [],
      syncFileParts: syncFilePartsMock,
      prepareAttachmentsForSubmit: prepareAttachmentsForSubmitMock,
      clearAfterSubmit: clearAfterSubmitMock,
    });
    useRememberedNewThreadCliModelsMock.mockReturnValue({
      rememberedCliModels: {},
      rememberCliModel: rememberCliModelMock,
    });
    createThreadMutationMock.mockResolvedValue("thread_new");
    prepareAttachmentsForSubmitMock.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  test("without CLI profiles, asks to connect a CLI profile", () => {
    useCliProfilesMock.mockReturnValue({ profiles: [], hasProfiles: false, isLoading: false });

    renderFooter();

    expect(screen.getByText(/Connect a CLI profile to start a thread from here\./)).toBeTruthy();
  });

  test("binds composer attachments to the task draft (OS-2141)", () => {
    const attachments = { pending: true, uploaded: [{ filePartId: "part-1", storageId: "storage-1", fileName: "a.png", fileSize: 3, contentType: "image/png" }] };
    useThreadDraftMock.mockReturnValue({
      draft: { text: "", attachments, updatedAt: Date.now() },
      setDraft: setDraftMock,
      clearDraft: clearDraftMock,
    });

    renderFooter();

    const binding = useThreadMessageAttachmentUploadMock.mock.calls.at(-1)?.[1] as
      | { attachments: unknown; save: (value: { pending: boolean }) => void }
      | undefined;
    expect(binding?.attachments).toBe(attachments);
    binding?.save({ pending: false });
    expect(setDraftMock).toHaveBeenCalledWith({ attachments: { pending: false } });
  });

  test("uses a locked attached task and submits new task-scoped threads", async () => {
    renderFooter();

    expect(screen.getByTestId("thread-composer-attached-task-ref").textContent).toBe("OS-1");
    expect(screen.getByTestId("thread-composer-attached-task-name").textContent).toBe(
      "Current task"
    );
    expect(screen.getByTestId("thread-composer-attached-task-removable").textContent).toBe(
      "false"
    );
    expect(screen.getByTestId("thread-composer-selector-model").textContent).toBe(
      "opus"
    );

    fireEvent.click(screen.getByRole("button", { name: "Submit task thread" }));

    await waitFor(() => {
      expect(createThreadMutationMock).toHaveBeenCalledWith({
        profileId: "profile_1",
        pathId: "path_1",
        cliType: "claude-code",
        cliMode: "agent",
        cliModel: "opus",
        content: "Start a task thread",
        attachments: undefined,
        taskId: "task_1",
      });
    });
    expect(clearAfterSubmitMock).toHaveBeenCalledTimes(1);
    expect(setDraftMock).toHaveBeenCalledWith({ text: "", composerContent: undefined, attachments: { pending: false } });
  });

  test("a PR composer keys its draft by the PR, and a seed appends the text once and refocuses (OS-2193)", () => {
    const pullRequest = { owner: "Contoso", name: "Convoy", number: 482, ref: "contoso/convoy#482" };
    const onSeeded = vi.fn();
    const view = renderFooter({ task: undefined, pullRequest, seed: undefined, onSeeded });
    expect(useThreadDraftMock).toHaveBeenCalledWith("pr:contoso/convoy#482");

    view.rerender(
      <CurrentOrgProjectProvider organizationId={organizationId} organizationSlug="contoso" projectAlias="OS">
        <TaskThreadComposer projectId={projectId} organizationSlug="contoso" projectAlias="OS" pullRequest={pullRequest} seed="Fix lint" onSeeded={onSeeded} />
      </CurrentOrgProjectProvider>
    );
    // Appended below the typed draft, so an earlier Fix or the member's own text stays.
    expect(setDraftMock).toHaveBeenCalledWith({ text: "Draft for task 1\n\nFix lint", composerContent: undefined });
    expect(onSeeded).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("thread-composer-focus-request").textContent).toBe("1");
  });

  test("a PR composer offers workflows; the checks composer does not (OS-2383)", () => {
    const pullRequest = { owner: "Contoso", name: "Convoy", number: 482, ref: "contoso/convoy#482" };
    const view = renderFooter({ task: undefined, pullRequest });
    expect(screen.getByTestId("thread-composer-has-workflow-selector").textContent).toBe("true");

    view.unmount();
    renderFooter({ task: undefined, pullRequest, pullRequestChecks: { headSha: "abc123" } });
    expect(screen.getByTestId("thread-composer-has-workflow-selector").textContent).toBe("false");
  });

  test("a PR checks run keeps its own draft, replaces its text with the seed, and starts a checks thread (OS-2400)", async () => {
    const pullRequest = { owner: "Contoso", name: "Convoy", number: 482, ref: "contoso/convoy#482" };
    const onSeeded = vi.fn();
    renderFooter({
      task: undefined,
      pullRequest,
      draftKey: "pull-request-checks:user_1",
      seed: "Run the checks",
      seedReplacesDraft: true,
      onSeeded,
      pullRequestChecks: { headSha: "abc123" },
    });

    expect(useThreadDraftMock).toHaveBeenCalledWith("pull-request-checks:user_1");
    // Replaced, not appended: the prompt names the current head, so last time's text is stale.
    expect(setDraftMock).toHaveBeenCalledWith({ text: "Run the checks", composerContent: undefined });
    fireEvent.click(screen.getByRole("button", { name: "Submit task thread" }));
    await waitFor(() => expect(createThreadMutationMock).toHaveBeenCalledWith(expect.objectContaining({ pullRequestChecks: { headSha: "abc123" } })));
  });

  test("forwards the route organization so the task composer can load prompts", () => {
    renderFooter();

    expect(screen.getByTestId("thread-composer-organization-id").textContent).toBe(
      organizationId
    );
  });

  test("forwards a host textarea class while preserving the sidebar default", () => {
    const { rerender } = renderFooter();

    expect(screen.getByTestId("thread-composer-textarea-class").textContent).toBe(
      "min-h-[88px] p-3"
    );

    rerender(
      <TaskThreadComposer
        projectId={projectId}
        organizationSlug="contoso"
        projectAlias="OS"
        task={{
          _id: "task_1" as Id<"tasks">,
          refId: "OS-1",
          name: "Current task",
          taskType: {
            key: "task",
            name: "Task",
            color: "#64748b",
            icon: "SquareCheckBig",
            isSystem: true,
          },
          isArchived: false,
        }}
        composerTextareaClassName="min-h-14 p-3"
      />
    );

    expect(screen.getByTestId("thread-composer-textarea-class").textContent).toBe(
      "min-h-14 p-3"
    );
  });

  test("passes through focus requests so repeated quick-open actions can refocus the composer", () => {
    const { rerender } = renderFooter({ focusRequestKey: 1 });

    expect(screen.getByTestId("thread-composer-focus-request").textContent).toBe("1");

    rerender(
      <TaskThreadComposer
        projectId={projectId}
        organizationSlug="contoso"
        projectAlias="OS"
        task={{
          _id: "task_1" as Id<"tasks">,
          refId: "OS-1",
          name: "Current task",
          taskType: {
            key: "task",
            name: "Task",
            color: "#64748b",
            icon: "SquareCheckBig",
            isSystem: true,
          },
          isArchived: false,
        }}
        focusRequestKey={2}
      />
    );

    expect(screen.getByTestId("thread-composer-focus-request").textContent).toBe("2");
  });
});

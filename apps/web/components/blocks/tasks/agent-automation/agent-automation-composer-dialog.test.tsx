/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getFunctionName, type FunctionReference } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { ProjectAgentListItem } from "@/components/blocks/agents/agent-list-utils";
import type { Task } from "@/lib/tasks/types";
import { AgentAutomationComposerDialog } from "./agent-automation-composer-dialog";

const useQueryMock = vi.fn();
const useMutationMock = vi.fn();
const useCliProfilesMock = vi.fn();
const useThreadMessageAttachmentUploadMock = vi.fn();
const useRememberedNewThreadCliModelsMock = vi.fn();

const createThreadMock = vi.fn();
const upsertPreferencesMock = vi.fn();
const prepareAttachmentsForSubmitMock = vi.fn();
const clearAfterSubmitMock = vi.fn();
const syncFilePartsMock = vi.fn();
const rememberCliModelMock = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: (...args: unknown[]) => useMutationMock(...args),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onSelect }: { children: ReactNode; onSelect?: () => void }) => (
    <button type="button" onClick={onSelect}>
      {children}
    </button>
  ),
}));

vi.mock("@/lib/threads/hooks/use-cli-profiles", () => ({
  useCliProfiles: (...args: unknown[]) => useCliProfilesMock(...args),
}));

vi.mock("@/lib/threads/hooks/use-thread-message-attachment-upload", () => ({
  useThreadMessageAttachmentUpload: (...args: unknown[]) => useThreadMessageAttachmentUploadMock(...args),
  isThreadAttachmentSubmitError: () => false,
}));

vi.mock("@/lib/threads/hooks/use-remembered-new-thread-cli-models", () => ({
  useRememberedNewThreadCliModels: (...args: unknown[]) => useRememberedNewThreadCliModelsMock(...args),
}));

// Minimal composer surface: exposes the Agent-pill selector props and a submit
// button that sends the prefilled automation prompt, like the real composer.
vi.mock("@/components/blocks/thread/thread-composer", () => ({
  ThreadComposer: (props: {
    onSubmit: (message: { text: string; files: never[]; taskId?: Id<"tasks"> }) => void | Promise<void>;
    initialInput?: string;
    initialAttachedTask?: { _id: Id<"tasks"> } | null;
    isAttachedTaskRemovable?: boolean;
    selectorsProps: {
      projectAgentId?: string;
      projectAgents?: Array<{ _id: string }>;
      projectAgentLocked?: boolean;
    };
  }) => (
    <div>
      <button
        type="button"
        onClick={() => {
          void props.onSubmit({
            text: props.initialInput ?? "",
            files: [],
            taskId: props.initialAttachedTask?._id,
          });
        }}
      >
        Send automation thread
      </button>
      <p data-testid="composer-project-agent-id">{props.selectorsProps.projectAgentId ?? ""}</p>
      <p data-testid="composer-project-agents">
        {(props.selectorsProps.projectAgents ?? []).map((agent) => agent._id).join(",")}
      </p>
      <p data-testid="composer-project-agent-locked">
        {String(Boolean(props.selectorsProps.projectAgentLocked))}
      </p>
      <p data-testid="composer-attached-task-removable">{String(props.isAttachedTaskRemovable !== false)}</p>
    </div>
  ),
}));

const projectId = "project_1" as Id<"projects">;
const agentId = "agent_1" as Id<"projectAgents">;
const userId = "user_1" as Id<"users">;

const agent = {
  _id: agentId,
  _creationTime: 1,
  projectId,
  sourceAgentId: undefined,
  name: "Reviewer",
  description: undefined,
  prompt: "You are a meticulous reviewer.",
  category: undefined,
  appearance: { color: "#22c55e" },
  automation: {
    enabled: true,
    prompt: { displayContent: "Review the assigned task" },
    cliType: "claude-code",
    cliModel: "opus",
    mode: "agent",
    workspace: "local",
  },
  createdBy: userId,
  updatedBy: userId,
  createdAt: 1,
  updatedAt: 1,
  isDeleted: false,
  deletedAt: undefined,
  deletedBy: undefined,
} as ProjectAgentListItem;

const task: Task = {
  _id: "task_1" as Id<"tasks">,
  clientId: "client_1",
  refNumber: 1,
  refId: "OS-1",
  name: "Fix the login crash",
  description: null,
  taskType: { key: "bug", name: "Bug", color: "#ef4444", icon: "Bug", isSystem: true },
  priority: "Medium",
  dueDate: null,
  status: "To Do",
  assignee: null,
  delegatedToAgent: {
    type: "projectAgent",
    projectAgentId: agentId,
    name: "Reviewer",
    appearance: { color: "#22c55e" },
    isDeleted: false,
  },
  tags: [],
  rank: "0|aaaaaa:",
  parentId: null,
  createdAt: 1,
  isArchived: false,
};

function renderDialog() {
  return render(
    <AgentAutomationComposerDialog
      projectId={projectId}
      organizationId={"org_1" as Id<"organizations">}
      organizationSlug="contoso"
      projectAlias="os"
      task={task}
      agent={agent}
      onClose={vi.fn()}
    />
  );
}

describe("AgentAutomationComposerDialog", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useQueryMock.mockReturnValue({ agentAutoStart: false });
    useMutationMock.mockImplementation((ref: FunctionReference<"mutation">) =>
      getFunctionName(ref) === getFunctionName(api.cli.threads.core.create) ? createThreadMock : upsertPreferencesMock
    );
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
    useThreadMessageAttachmentUploadMock.mockReturnValue({
      pendingAttachments: [],
      syncFileParts: syncFilePartsMock,
      prepareAttachmentsForSubmit: prepareAttachmentsForSubmitMock,
      clearAfterSubmit: clearAfterSubmitMock,
    });
    useRememberedNewThreadCliModelsMock.mockReturnValue({
      rememberedCliModels: {},
      rememberedCliType: undefined,
      rememberCliModel: rememberCliModelMock,
    });
    createThreadMock.mockResolvedValue("thread_new");
    prepareAttachmentsForSubmitMock.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  test("preselects and locks the assigned agent in the Agent pill", async () => {
    renderDialog();

    await waitFor(() => {
      expect(screen.getByTestId("composer-project-agent-id").textContent).toBe(String(agentId));
    });
    expect(screen.getByTestId("composer-project-agents").textContent).toBe(String(agentId));
    expect(screen.getByTestId("composer-project-agent-locked").textContent).toBe("true");
    // The assigned task stays locked too (unchanged behavior).
    expect(screen.getByTestId("composer-attached-task-removable").textContent).toBe("false");
  });

  test("submitting binds the agent on the created thread alongside the automation config", async () => {
    renderDialog();

    await waitFor(() => {
      expect(screen.getByTestId("composer-project-agent-id").textContent).toBe(String(agentId));
    });

    fireEvent.click(screen.getByRole("button", { name: "Send automation thread" }));

    await waitFor(() => {
      expect(createThreadMock).toHaveBeenCalledTimes(1);
    });
    expect(createThreadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectAgentId: agentId,
        profileId: "profile_1",
        pathId: "path_1",
        cliType: "claude-code",
        cliModel: "opus",
        cliMode: "agent",
        content: "Review the assigned task",
        taskId: task._id,
        agentWorkSource: "assignment_automation",
      })
    );
  });
});

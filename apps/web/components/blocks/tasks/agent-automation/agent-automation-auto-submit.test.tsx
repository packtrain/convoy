/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import type { ProjectAgentListItem } from "@/components/blocks/agents/agent-list-utils";
import type { Task } from "@/lib/tasks/types";
import { AgentAutomationAutoSubmit } from "./agent-automation-auto-submit";

const useMutationMock = vi.fn();
const useCliProfilesMock = vi.fn();
const useRememberedNewThreadCliModelsMock = vi.fn();

const createThreadMock = vi.fn();
const navigationPushMock = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: vi.fn(),
  useMutation: (...args: unknown[]) => useMutationMock(...args),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/navigation", () => ({
  appRoute: {
    projectThreadDetail: (...segments: string[]) => `/o/${segments.join("/")}`,
  },
  useNavigation: () => ({ push: navigationPushMock }),
}));

vi.mock("@/lib/threads/hooks/use-cli-profiles", () => ({
  useCliProfiles: (...args: unknown[]) => useCliProfilesMock(...args),
}));

vi.mock("@/lib/threads/hooks/use-remembered-new-thread-cli-models", () => ({
  useRememberedNewThreadCliModels: (...args: unknown[]) => useRememberedNewThreadCliModelsMock(...args),
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

function renderAutoSubmit(overrides?: { onFallback?: () => void; onDone?: () => void }) {
  return render(
    <AgentAutomationAutoSubmit
      projectId={projectId}
      organizationSlug="contoso"
      projectAlias="os"
      task={task}
      agent={agent}
      onFallback={overrides?.onFallback ?? vi.fn()}
      onDone={overrides?.onDone ?? vi.fn()}
    />
  );
}

describe("AgentAutomationAutoSubmit", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useMutationMock.mockReturnValue(createThreadMock);
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
    useRememberedNewThreadCliModelsMock.mockReturnValue({
      rememberedCliModels: {},
      rememberedCliType: undefined,
      rememberCliModel: vi.fn(),
    });
    createThreadMock.mockResolvedValue("thread_new");
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  test("binds the assigned agent on the auto-created thread", async () => {
    const onDone = vi.fn();
    renderAutoSubmit({ onDone });

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
    await waitFor(() => {
      expect(onDone).toHaveBeenCalledTimes(1);
    });
  });
});

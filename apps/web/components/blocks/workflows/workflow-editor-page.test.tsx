/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import type { ReactNode } from "react";
import type { WorkflowDefinition } from "@/convex/lib/contracts/workflowDefinition";
import { AGENT_COLOR_PALETTE } from "@/lib/colors/palette";
import { WorkflowEditorPage } from "./workflow-editor-page";

const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const createWorkflowMock = vi.hoisted(() => vi.fn());
const updateWorkflowMock = vi.hoisted(() => vi.fn());
const removeWorkflowMock = vi.hoisted(() => vi.fn());
const navigationPushMock = vi.hoisted(() => vi.fn());
const navigationReplaceMock = vi.hoisted(() => vi.fn());
const useProjectPermissionsMock = vi.hoisted(() => vi.fn());
const useDevSettingsMock = vi.hoisted(() => vi.fn());
const unsavedChangesGuardMock = vi.hoisted(() => vi.fn());

vi.mock("convex/react", () => ({
  useQuery: useQueryMock,
  useMutation: useMutationMock,
}));

vi.mock("@/lib/auth/hooks", () => ({
  useAppConvexAuth: () => ({ isAuthenticated: true }),
}));

vi.mock("@/lib/authz/use-project-permissions", () => ({
  useProjectPermissions: useProjectPermissionsMock,
}));

vi.mock("@/lib/dev-mode/use-dev-mode", () => ({
  useDevSettings: useDevSettingsMock,
}));

vi.mock("@/lib/navigation", () => ({
  useNavigation: () => ({ push: navigationPushMock, replace: navigationReplaceMock }),
  // The guard's own behavior is covered in lib/navigation; here only the
  // enabled flag (does the page know it is dirty?) matters.
  useUnsavedChangesGuard: unsavedChangesGuardMock,
  appRoute: {
    projectSettings: (organizationSlug: string, projectAlias: string, section: string) => ({
      pathname: `/o/${organizationSlug}/${projectAlias}/settings/${section}`,
    }),
  },
  AppLink: ({ href, children, ...props }: { href: { pathname: string }; children: ReactNode }) => (
    <a href={href.pathname} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    organizations: { core: { getBySlug: "organizations.core.getBySlug" } },
    projects: { core: { getByAlias: "projects.core.getByAlias" } },
    agents: { projectAgents: { listByProject: "agents.projectAgents.listByProject" } },
    workflows: {
      core: {
        get: "workflows.core.get",
        create: "workflows.core.create",
        update: "workflows.core.update",
        remove: "workflows.core.remove",
      },
    },
  },
}));

vi.mock("@/lib/errors", () => ({
  showConvexErrorToast: vi.fn(),
}));

const PROJECT_ID = "project_1" as Id<"projects">;

interface WorkflowStub {
  _id: Id<"workflows">;
  projectId: Id<"projects">;
  name: string;
  description?: string;
  category?: string;
  color?: string;
  draftDefinition: WorkflowDefinition;
}

const STORED_DEFINITION: WorkflowDefinition = {
  lanes: [{ laneId: "lane-1", name: "Lane 1", type: "single" }],
  stages: [{ stageId: "stage-1", name: "Stage 1", steps: [] }],
};

function workflowStub(overrides: Partial<WorkflowStub> = {}): WorkflowStub {
  return {
    _id: "workflow_1" as Id<"workflows">,
    projectId: PROJECT_ID,
    name: "Release Train",
    description: "Ships a release end to end",
    category: "Delivery",
    draftDefinition: STORED_DEFINITION,
    ...overrides,
  };
}

function mockQueries({ workflow }: { workflow?: WorkflowStub | null } = {}) {
  useQueryMock.mockImplementation((query, args) => {
    if (args === "skip") {
      return undefined;
    }
    if (query === "organizations.core.getBySlug") {
      return { _id: "org_1" };
    }
    if (query === "projects.core.getByAlias") {
      return { _id: PROJECT_ID };
    }
    if (query === "workflows.core.get") {
      return workflow;
    }
    return undefined;
  });
  useMutationMock.mockImplementation((mutation) => {
    if (mutation === "workflows.core.create") {
      return createWorkflowMock;
    }
    if (mutation === "workflows.core.update") {
      return updateWorkflowMock;
    }
    return removeWorkflowMock;
  });
}

function mockEnvironment({
  workflowsEnabled = true,
  canManage = true,
  permissionsLoading = false,
  workflow,
}: {
  workflowsEnabled?: boolean;
  canManage?: boolean;
  permissionsLoading?: boolean;
  workflow?: WorkflowStub | null;
} = {}) {
  useDevSettingsMock.mockReturnValue({
    extraProjectSettings: workflowsEnabled,
    taskListShowRank: false,
    showUnfinishedItems: false,
  });
  useProjectPermissionsMock.mockReturnValue({
    canManageWorkflows: canManage,
    isLoading: permissionsLoading,
  });
  unsavedChangesGuardMock.mockReturnValue({ blockedHref: null, stay: vi.fn(), leave: vi.fn() });
  mockQueries({ workflow });
}

/** The `enabled` flag from the page's last render. */
function guardEnabled() {
  const calls = unsavedChangesGuardMock.mock.calls;
  return calls[calls.length - 1]?.[0];
}

function renderCreate() {
  return render(<WorkflowEditorPage mode="create" organizationSlug="acme" projectAlias="WEB" />);
}

function renderDetail(workflowId = "workflow_1") {
  return render(
    <WorkflowEditorPage mode="detail" workflowId={workflowId} organizationSlug="acme" projectAlias="WEB" />
  );
}

describe("WorkflowEditorPage", () => {
  beforeAll(() => {
    // Radix Checkbox measures itself through ResizeObserver, absent in jsdom.
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }

    vi.stubGlobal("ResizeObserver", ResizeObserver);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  test("keeps the workflow editor available when extra project settings are off", () => {
    mockEnvironment({ workflowsEnabled: false });

    renderCreate();

    expect(navigationReplaceMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Name")).toBeDefined();
  });

  test("treats a workflow from another project as not found", () => {
    mockEnvironment({ workflow: workflowStub({ projectId: "project_2" as Id<"projects"> }) });

    renderDetail();

    const heading = screen.getByRole("heading", { level: 1, name: "Workflow not found" });
    expect(heading.closest('[data-slot="empty"]')).not.toBeNull();
    expect(screen.queryByLabelText("Name")).toBeNull();
  });

  test("holds the skeleton while permissions load instead of denying", () => {
    mockEnvironment({ canManage: false, permissionsLoading: true });

    renderCreate();

    expect(screen.queryByText("You do not have permission to create workflows.")).toBeNull();
    expect(document.querySelector('[aria-label="Loading workflow"]')).not.toBeNull();
  });

  test("create sends undefined for blank optional fields", async () => {
    mockEnvironment();
    createWorkflowMock.mockResolvedValue(null);

    renderCreate();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Release Train" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(createWorkflowMock).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        name: "Release Train",
        description: undefined,
        category: undefined,
        color: AGENT_COLOR_PALETTE[0],
        definition: expect.objectContaining({
          lanes: [expect.objectContaining({ name: "Lane 1", type: "single" })],
          stages: [expect.objectContaining({ name: "Stage 1", steps: [] })],
        }),
      });
    });
    expect(navigationPushMock).toHaveBeenCalledWith({ pathname: "/o/acme/WEB/settings/workflows" });
  });

  test("create mode shows an editable grid seeded with a starter lane and stage", () => {
    mockEnvironment();

    renderCreate();

    expect(screen.getByTestId("workflow-grid")).toBeDefined();
    expect(screen.getByRole("button", { name: "Add lane" })).toBeDefined();
    expect(screen.getByLabelText("Stage 1 name")).toHaveProperty("value", "Stage 1");
  });

  test("editing clears blanked optional fields with null", async () => {
    mockEnvironment({ workflow: workflowStub() });
    updateWorkflowMock.mockResolvedValue(null);

    renderDetail();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Release Train v2" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateWorkflowMock).toHaveBeenCalledWith({
        workflowId: "workflow_1",
        name: "Release Train v2",
        description: null,
        category: "Delivery",
        color: null,
        definition: STORED_DEFINITION,
      });
    });
  });

  test("grid edits are sent with Save as the definition", async () => {
    mockEnvironment({ workflow: workflowStub() });
    updateWorkflowMock.mockResolvedValue(null);

    renderDetail();

    fireEvent.click(screen.getByRole("button", { name: "Add stage" }));
    fireEvent.click(screen.getByRole("button", { name: "Add lane" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Run in a new worktree" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateWorkflowMock).toHaveBeenCalled();
    });
    const definition = updateWorkflowMock.mock.calls[0][0].definition as WorkflowDefinition;
    expect(definition.stages.map((stage) => stage.name)).toEqual(["Stage 1", "Stage 2"]);
    expect(definition.lanes.map((lane) => lane.name)).toEqual(["Lane 1", "Lane 2"]);
    expect(definition.runInNewWorktree).toBe(true);
  });

  test("Enter leaves lane/stage rename mode", () => {
    mockEnvironment({ workflow: workflowStub() });

    renderDetail();

    const laneInput = screen.getByLabelText("Lane 1 name") as HTMLInputElement;
    laneInput.focus();
    expect(document.activeElement).toBe(laneInput);
    fireEvent.keyDown(laneInput, { key: "Enter" });
    expect(document.activeElement).not.toBe(laneInput);

    const stageInput = screen.getByLabelText("Stage 1 name") as HTMLInputElement;
    stageInput.focus();
    fireEvent.keyDown(stageInput, { key: "Enter" });
    expect(document.activeElement).not.toBe(stageInput);
  });

  test("an empty stored draft opens seeded with a starter lane and stage", () => {
    mockEnvironment({ workflow: workflowStub({ draftDefinition: { lanes: [], stages: [] } }) });

    renderDetail();

    expect(screen.getByLabelText("Lane 1 name")).toHaveProperty("value", "Lane 1");
    expect(screen.getByLabelText("Stage 1 name")).toHaveProperty("value", "Stage 1");
  });

  test("viewers with an empty stored draft see it as-is, not a fabricated seed", () => {
    mockEnvironment({ canManage: false, workflow: workflowStub({ draftDefinition: { lanes: [], stages: [] } }) });

    renderDetail();

    expect(screen.getByTestId("workflow-grid")).toBeDefined();
    expect(screen.queryByLabelText("Lane 1 name")).toBeNull();
    expect(screen.queryByLabelText("Stage 1 name")).toBeNull();
  });

  test("grid edits are blocked while Save is in flight", async () => {
    mockEnvironment({ workflow: workflowStub() });
    updateWorkflowMock.mockReturnValue(new Promise(() => {}));

    renderDetail();

    expect((screen.getByLabelText("Lane 1 name") as HTMLInputElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect((screen.getByLabelText("Lane 1 name") as HTMLInputElement).disabled).toBe(true);
    });
    expect((screen.getByRole("button", { name: "Add lane" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("viewers get a read-only form and grid without write actions", () => {
    mockEnvironment({ canManage: false, workflow: workflowStub() });

    renderDetail();

    expect((screen.getByLabelText("Name") as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Delete/ })).toBeNull();
    expect(screen.getByTestId("workflow-grid")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Add lane" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add stage" })).toBeNull();
    expect((screen.getByLabelText("Lane 1 name") as HTMLInputElement).disabled).toBe(true);
  });

  test("the leave guard turns on with grid edits and identity edits, not on load", () => {
    mockEnvironment({ workflow: workflowStub() });

    renderDetail();
    expect(guardEnabled()).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Add stage" }));
    expect(guardEnabled()).toBe(true);

    cleanup();
    renderDetail();
    expect(guardEnabled()).toBe(false);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Release Train v2" } });
    expect(guardEnabled()).toBe(true);
  });

  test("viewers who cannot save are never guarded", () => {
    mockEnvironment({ canManage: false, workflow: workflowStub() });

    renderDetail();

    expect(guardEnabled()).toBe(false);
  });

  test("a blocked link offers staying or leaving without saving", () => {
    const stay = vi.fn();
    const leave = vi.fn();
    mockEnvironment({ workflow: workflowStub() });
    unsavedChangesGuardMock.mockReturnValue({ blockedHref: "/o/acme/WEB/settings/workflows", stay, leave });

    renderDetail();

    expect(screen.getByText("Unsaved changes")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Leave without saving" }));
    expect(leave).toHaveBeenCalled();
    expect(stay).not.toHaveBeenCalled();
  });

  test("the editor column stays fluid below the md breakpoint", () => {
    mockEnvironment();

    renderCreate();

    const column = screen.getByTestId("workflow-editor-page").firstElementChild;
    expect(column?.className).toContain("w-full");
    expect(column?.className).toContain("md:w-84");
  });
});

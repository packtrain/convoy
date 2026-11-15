/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { ProjectAgentsSection } from "./project-agents-section";
import type { OrganizationAgentListItem, ProjectAgentListItem } from "@/components/blocks/agents/agent-list-utils";
import { ProjectAgentRow } from "./project-agent-list";
import { expectEmptyState, expectVerticallyCentered } from "@/test-utils/empty-state";

const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const createProjectAgentMock = vi.hoisted(() => vi.fn());
const updateProjectAgentMock = vi.hoisted(() => vi.fn());
const deleteProjectAgentMock = vi.hoisted(() => vi.fn());
const copyFromAgentMock = vi.hoisted(() => vi.fn());
const replaceFromAgentMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());
const navigationPushMock = vi.hoisted(() => vi.fn());

vi.mock("convex/react", () => ({
  useQuery: useQueryMock,
  useMutation: useMutationMock,
}));

vi.mock("@/lib/navigation", () => ({
  AppLink: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode;
    href: { pathname: string } | string;
  } & Omit<ComponentProps<"a">, "href">) => (
    <a href={typeof href === "string" ? href : href.pathname} {...props}>
      {children}
    </a>
  ),
  useNavigation: () => ({ push: navigationPushMock, replace: vi.fn() }),
  appRoute: {
    projectAgentNew: (organizationSlug: string, projectAlias: string) => ({
      pathname: `/o/${organizationSlug}/${projectAlias}/settings/agents/new`,
    }),
    projectAgentDetail: (
      organizationSlug: string,
      projectAlias: string,
      projectAgentId: string
    ) => ({
      pathname: `/o/${organizationSlug}/${projectAlias}/settings/agents/${projectAgentId}`,
    }),
  },
}));

vi.mock("sonner", () => ({
  toast: Object.assign(toastMock, { dismiss: vi.fn(), success: toastSuccessMock }),
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    agents: {
      core: {
        listByOrganization: "agents.core.listByOrganization",
      },
      projectAgents: {
        listByProject: "agents.projectAgents.listByProject",
        create: "agents.projectAgents.create",
        update: "agents.projectAgents.update",
        deleteProjectAgent: "agents.projectAgents.deleteProjectAgent",
        copyFromAgent: "agents.projectAgents.copyFromAgent",
        replaceFromAgent: "agents.projectAgents.replaceFromAgent",
      },
    },
    projects: {
      core: {
        listAccessible: "projects.core.listAccessible",
      },
    },
  },
}));

vi.mock("@/lib/errors", () => ({
  showConvexErrorToast: vi.fn(),
}));

vi.mock("next/dynamic", () => ({
  default: () =>
    function MockMdxEditor({ value }: { value: string }) {
      return <div data-testid="agent-prompt">{value}</div>;
    },
}));

function projectAgent(overrides: Partial<ProjectAgentListItem> = {}): ProjectAgentListItem {
  return {
    _id: "project_agent_1" as Id<"projectAgents">,
    _creationTime: 1,
    projectId: "project_1" as Id<"projects">,
    name: "Code Reviewer",
    description: "Reviews code changes",
    category: "Engineering",
    prompt: "Review code changes",
    appearance: { color: "#3b82f6" },
    createdBy: "user_1" as Id<"users">,
    updatedBy: "user_1" as Id<"users">,
    createdAt: 1,
    updatedAt: 1,
    isDeleted: false,
    ...overrides,
  };
}

function orgAgent(overrides: Partial<OrganizationAgentListItem> = {}): OrganizationAgentListItem {
  return {
    _id: "agent_1" as Id<"agents">,
    _creationTime: 1,
    organizationId: "org_1" as Id<"organizations">,
    name: "Template Reviewer",
    version: 1,
    description: "Reviews pull requests",
    category: "Engineering",
    prompt: "Review pull requests",
    appearance: { color: "#22c55e" },
    createdBy: "user_1" as Id<"users">,
    updatedBy: "user_1" as Id<"users">,
    createdAt: 1,
    updatedAt: 1,
    isDeleted: false,
    ...overrides,
  };
}

function mockQueries(args: { projectAgents: ProjectAgentListItem[] | undefined; orgAgents: OrganizationAgentListItem[] | undefined }) {
  useQueryMock.mockImplementation((query) => {
    if (query === "agents.projectAgents.listByProject") {
      return args.projectAgents;
    }
    if (query === "agents.core.listByOrganization") {
      return args.orgAgents;
    }
    return undefined;
  });
  useMutationMock.mockImplementation((mutation) => {
    if (mutation === "agents.projectAgents.create") {
      return createProjectAgentMock;
    }
    if (mutation === "agents.projectAgents.update") {
      return updateProjectAgentMock;
    }
    if (mutation === "agents.projectAgents.deleteProjectAgent") {
      return deleteProjectAgentMock;
    }
    if (mutation === "agents.projectAgents.copyFromAgent") {
      return copyFromAgentMock;
    }
    if (mutation === "agents.projectAgents.replaceFromAgent") {
      return replaceFromAgentMock;
    }
    return vi.fn();
  });
}

function renderSection(canManage: boolean) {
  return render(
    <ProjectAgentsSection
      projectId={"project_1" as Id<"projects">}
      organizationId={"org_1" as Id<"organizations">}
      organizationSlug="acme"
      projectAlias="WEB"
      canManage={canManage}
    />
  );
}

function openAgentCreationMenu() {
  fireEvent.pointerDown(
    screen.getByRole("button", { name: "More agent creation options" })
  );
}

describe("ProjectAgentsSection", () => {
  afterEach(() => {
    cleanup();
    useQueryMock.mockReset();
    useMutationMock.mockReset();
    createProjectAgentMock.mockReset();
    updateProjectAgentMock.mockReset();
    deleteProjectAgentMock.mockReset();
    copyFromAgentMock.mockReset();
    replaceFromAgentMock.mockReset();
    toastMock.mockReset();
    toastSuccessMock.mockReset();
    navigationPushMock.mockReset();
  });

  test("viewers can browse project agents without management actions", () => {
    mockQueries({
      projectAgents: [projectAgent({ sourceAgentId: "agent_1" as Id<"agents"> })],
      orgAgents: [orgAgent()],
    });

    renderSection(false);

    expect(screen.getByText("Code Reviewer")).toBeDefined();
    expect(screen.queryByText("Project-created")).toBeNull();
    expect(screen.queryByText("Copied from org template")).toBeNull();
    expect(screen.queryByRole("button", { name: "New agent" })).toBeNull();
    expect(screen.queryByRole("button", { name: "From template" })).toBeNull();
  });

  test("project agent rows hide missing categories and keep the editable row pointer-friendly", () => {
    render(<ProjectAgentRow agent={projectAgent({ category: undefined })} href="/agent" />);

    const rowLink = screen.getByRole("link", { name: /Code Reviewer/ });
    const name = screen.getByRole("heading", { name: "Code Reviewer" });
    expect(name.className).not.toContain("cursor-default");
    expect(rowLink.className).toContain("cursor-pointer");
    expect(rowLink.getAttribute("href")).toBe("/agent");
    expect(screen.queryByText("Uncategorized")).toBeNull();
  });

  test("project agent row category is part of the edit target", () => {
    render(<ProjectAgentRow agent={projectAgent()} href="/agent" />);

    const rowLink = screen.getByRole("link", {
      name: /Code Reviewer[\s\S]*Engineering/,
    });
    const category = screen.getByText("Engineering");

    expect(rowLink.className).toContain("cursor-pointer");
    expect(rowLink.contains(category)).toBe(true);
  });

  test("New agent navigates to the dedicated create page", () => {
    mockQueries({
      projectAgents: [projectAgent()],
      orgAgents: [],
    });

    renderSection(true);
    fireEvent.click(screen.getByRole("button", { name: "New agent" }));

    expect(navigationPushMock).toHaveBeenCalledWith({
      pathname: "/o/acme/WEB/settings/agents/new",
    });
  });

  test("managers can import suggested organization templates from the empty state", async () => {
    copyFromAgentMock.mockResolvedValue("project_agent_2");
    mockQueries({
      projectAgents: [],
      orgAgents: [
        orgAgent({ _id: "agent_1" as Id<"agents">, name: "Template Reviewer" }),
        orgAgent({ _id: "agent_2" as Id<"agents">, name: "Release Drafter" }),
      ],
    });

    renderSection(true);

    const section = screen.getByTestId("project-agents-section");
    const empty = expectEmptyState("Import organization agents", {
      boundary: section,
      action: { role: "button", name: "Import" },
    });
    expectVerticallyCentered(empty, section);
    expect(within(empty).getByRole("checkbox", { name: "Select Template Reviewer" })).toBeDefined();
    expect(within(empty).getByRole("button", { name: "New agent" })).toBeDefined();
    expect(screen.getAllByRole("button", { name: "New agent" })).toHaveLength(1);
    expect(screen.queryByRole("searchbox", { name: "Search project agents" })).toBeNull();
    const importButton = screen.getByRole("button", { name: "Import" });
    expect(importButton).toHaveProperty("disabled", true);

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Template Reviewer" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Release Drafter" }));
    expect(importButton).toHaveProperty("disabled", false);
    fireEvent.click(importButton);

    await waitFor(() => {
      expect(copyFromAgentMock).toHaveBeenNthCalledWith(1, {
        projectId: "project_1",
        agentId: "agent_1",
      });
      expect(copyFromAgentMock).toHaveBeenNthCalledWith(2, {
        projectId: "project_1",
        agentId: "agent_2",
      });
    });
  });

  test("with no organization templates, the empty state is a plain Empty with the New agent action", () => {
    mockQueries({
      projectAgents: [],
      orgAgents: [],
    });

    renderSection(true);

    const section = screen.getByTestId("project-agents-section");
    const empty = expectEmptyState("No project agents yet", {
      boundary: section,
      action: { role: "button", name: "New agent" },
    });
    expectVerticallyCentered(empty, section);
    expect(screen.getAllByRole("button", { name: "New agent" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Create agent" })).toBeNull();
    expect(screen.queryByRole("searchbox", { name: "Search project agents" })).toBeNull();
    expect(screen.queryByText("Import organization agents")).toBeNull();

    fireEvent.click(within(empty).getByRole("button", { name: "New agent" }));
    expect(navigationPushMock).toHaveBeenCalledWith({
      pathname: "/o/acme/WEB/settings/agents/new",
    });
  });

  test("managers can copy organization templates into the project", async () => {
    copyFromAgentMock.mockResolvedValue("project_agent_2");
    mockQueries({
      projectAgents: [projectAgent()],
      orgAgents: [orgAgent()],
    });

    renderSection(true);
    openAgentCreationMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "From template" }));
    expect(screen.getByRole("heading", { name: "From template" })).toBeDefined();
    expect(screen.getByText("Code Reviewer")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Copy" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add Template Reviewer to project" }));

    await waitFor(() => {
      expect(copyFromAgentMock).toHaveBeenCalledWith({
        projectId: "project_1",
        agentId: "agent_1",
      });
    });
  });

  test("the template dialog stays open after installing, so several can be installed in a row", async () => {
    copyFromAgentMock.mockResolvedValue("project_agent_2");
    mockQueries({
      projectAgents: [projectAgent()],
      orgAgents: [orgAgent()],
    });

    renderSection(true);
    openAgentCreationMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "From template" }));
    fireEvent.click(screen.getByRole("button", { name: "Add Template Reviewer to project" }));

    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith("Agent installed into this project");
    });
    expect(screen.getByRole("heading", { name: "From template" })).toBeDefined();
  });

  test("an installed template keeps its row, marked and without an install action", () => {
    mockQueries({
      projectAgents: [
        projectAgent({
          name: "Template Reviewer",
          sourceAgentId: "agent_1" as Id<"agents">,
          installedVersion: 1,
        }),
      ],
      orgAgents: [orgAgent({ _id: "agent_1" as Id<"agents">, version: 1 })],
    });

    renderSection(true);
    openAgentCreationMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "From template" }));

    expect(screen.getByText("Installed")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Add Template Reviewer to project" })).toBeNull();
  });

  test("a template ahead of its installed copy offers an update from the dialog", () => {
    mockQueries({
      projectAgents: [
        projectAgent({
          name: "Template Reviewer",
          sourceAgentId: "agent_1" as Id<"agents">,
          installedVersion: 1,
        }),
      ],
      orgAgents: [orgAgent({ _id: "agent_1" as Id<"agents">, version: 3 })],
    });

    renderSection(true);
    openAgentCreationMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "From template" }));
    fireEvent.click(screen.getByRole("button", { name: "Update Template Reviewer to v3" }));

    expect(screen.getByRole("heading", { name: "Update to v3?" })).toBeDefined();
  });

  test("clicking a template previews its prompt, and the preview installs it", async () => {
    copyFromAgentMock.mockResolvedValue("project_agent_2");
    mockQueries({
      projectAgents: [projectAgent()],
      orgAgents: [orgAgent({ prompt: "# Review\nRead the diff first." })],
    });

    renderSection(true);
    openAgentCreationMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "From template" }));
    fireEvent.click(screen.getByRole("heading", { name: "Template Reviewer" }));

    expect(screen.getByTestId("agent-prompt").textContent).toBe("# Review\nRead the diff first.");
    fireEvent.click(screen.getByRole("button", { name: "Install" }));

    await waitFor(() => {
      expect(copyFromAgentMock).toHaveBeenCalledWith({
        projectId: "project_1",
        agentId: "agent_1",
      });
    });
  });

  test("managers can import selected organization templates sequentially", async () => {
    copyFromAgentMock.mockResolvedValue("project_agent_2");
    mockQueries({
      projectAgents: [projectAgent()],
      orgAgents: [
        orgAgent({ _id: "agent_1" as Id<"agents">, name: "Template Reviewer" }),
        orgAgent({ _id: "agent_2" as Id<"agents">, name: "Release Drafter" }),
      ],
    });

    renderSection(true);
    openAgentCreationMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "From template" }));
    fireEvent.click(screen.getByRole("button", { name: "Select multiple" }));

    const importButton = screen.getByRole("button", { name: "Import" });
    expect(importButton).toHaveProperty("disabled", true);
    expect(screen.queryByRole("button", { name: "Add Template Reviewer to project" })).toBeNull();

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Template Reviewer" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Release Drafter" }));
    expect(importButton).toHaveProperty("disabled", false);
    fireEvent.click(importButton);

    await waitFor(() => {
      expect(copyFromAgentMock).toHaveBeenNthCalledWith(1, {
        projectId: "project_1",
        agentId: "agent_1",
      });
      expect(copyFromAgentMock).toHaveBeenNthCalledWith(2, {
        projectId: "project_1",
        agentId: "agent_2",
      });
    });
  });

  test("cancel selection clears selected organization templates", () => {
    mockQueries({
      projectAgents: [projectAgent()],
      orgAgents: [orgAgent()],
    });

    renderSection(true);
    openAgentCreationMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "From template" }));
    fireEvent.click(screen.getByRole("button", { name: "Select multiple" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Template Reviewer" }));
    expect(screen.getByRole("button", { name: "Import" })).toHaveProperty("disabled", false);

    fireEvent.click(screen.getByRole("button", { name: "Cancel selection" }));
    fireEvent.click(screen.getByRole("button", { name: "Select multiple" }));

    expect(screen.getByRole("button", { name: "Import" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("checkbox", { name: "Select Template Reviewer" }).getAttribute("aria-checked")).toBe("false");
  });

  test("multi-select checkboxes are pointer-friendly", () => {
    mockQueries({
      projectAgents: [projectAgent()],
      orgAgents: [orgAgent()],
    });

    renderSection(true);
    openAgentCreationMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "From template" }));
    fireEvent.click(screen.getByRole("button", { name: "Select multiple" }));

    expect(screen.getByRole("checkbox", { name: "Select Template Reviewer" }).className).toContain("cursor-pointer");
  });

  test("multi-import can skip selected organization templates that already exist", async () => {
    copyFromAgentMock.mockResolvedValue("project_agent_2");
    replaceFromAgentMock.mockResolvedValue(null);
    mockQueries({
      projectAgents: [
        projectAgent({
          _id: "project_agent_1" as Id<"projectAgents">,
          name: "Template Reviewer",
        }),
      ],
      orgAgents: [
        orgAgent({ _id: "agent_1" as Id<"agents">, name: "Template Reviewer" }),
        orgAgent({ _id: "agent_2" as Id<"agents">, name: "Release Drafter" }),
      ],
    });

    renderSection(true);
    openAgentCreationMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "From template" }));
    fireEvent.click(screen.getByRole("button", { name: "Select multiple" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Template Reviewer" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Release Drafter" }));
    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    const conflictDialog = screen.getByRole("heading", { name: "Agent name conflicts" }).closest('[role="dialog"]');
    if (!(conflictDialog instanceof HTMLElement)) {
      throw new Error("Conflict dialog was not rendered");
    }
    expect(within(conflictDialog).getByText("Template Reviewer")).toBeDefined();
    expect(screen.getByRole("radio", { name: /Skip existing/ })).toHaveProperty("checked", true);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(copyFromAgentMock).toHaveBeenCalledWith({
        projectId: "project_1",
        agentId: "agent_2",
      });
    });
    expect(replaceFromAgentMock).not.toHaveBeenCalled();
  });

  test("multi-import can replace selected organization templates that already exist", async () => {
    copyFromAgentMock.mockResolvedValue("project_agent_2");
    replaceFromAgentMock.mockResolvedValue(null);
    mockQueries({
      projectAgents: [
        projectAgent({
          _id: "project_agent_1" as Id<"projectAgents">,
          name: "Template Reviewer",
        }),
      ],
      orgAgents: [
        orgAgent({ _id: "agent_1" as Id<"agents">, name: "Template Reviewer" }),
        orgAgent({ _id: "agent_2" as Id<"agents">, name: "Release Drafter" }),
      ],
    });

    renderSection(true);
    openAgentCreationMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "From template" }));
    fireEvent.click(screen.getByRole("button", { name: "Select multiple" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Template Reviewer" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Release Drafter" }));
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    fireEvent.click(screen.getByRole("radio", { name: /Replace existing/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(replaceFromAgentMock).toHaveBeenCalledWith({
        projectAgentId: "project_agent_1",
        agentId: "agent_1",
        overwriteLocalEdits: true,
      });
      expect(copyFromAgentMock).toHaveBeenCalledWith({
        projectId: "project_1",
        agentId: "agent_2",
      });
    });
  });

  test("multi-import can create conflicting organization templates with new names", async () => {
    copyFromAgentMock.mockResolvedValue("project_agent_2");
    replaceFromAgentMock.mockResolvedValue(null);
    mockQueries({
      projectAgents: [
        projectAgent({
          _id: "project_agent_1" as Id<"projectAgents">,
          name: "Template Reviewer",
        }),
      ],
      orgAgents: [
        orgAgent({ _id: "agent_1" as Id<"agents">, name: "Template Reviewer" }),
        orgAgent({ _id: "agent_2" as Id<"agents">, name: "Release Drafter" }),
      ],
    });

    renderSection(true);
    openAgentCreationMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "From template" }));
    fireEvent.click(screen.getByRole("button", { name: "Select multiple" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Template Reviewer" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Release Drafter" }));
    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    expect(screen.getByRole("radio", { name: /Create with new name/ })).toBeDefined();
    expect(screen.getByText("Import only templates without conflicts.")).toBeDefined();
    expect(screen.getByText("Copy conflicts with a timestamp suffix.")).toBeDefined();
    expect(screen.getByText("Update matching project agents.")).toBeDefined();

    fireEvent.click(screen.getByRole("radio", { name: /Create with new name/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(copyFromAgentMock).toHaveBeenCalledWith({
        projectId: "project_1",
        agentId: "agent_1",
        name: expect.stringMatching(/^Template Reviewer \d{8}-\d{6}$/),
      });
      expect(copyFromAgentMock).toHaveBeenCalledWith({
        projectId: "project_1",
        agentId: "agent_2",
      });
    });
    expect(replaceFromAgentMock).not.toHaveBeenCalled();
  });

  test("editing a project agent from the row actions menu navigates to its page", () => {
    mockQueries({
      projectAgents: [projectAgent()],
      orgAgents: [],
    });

    renderSection(true);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Project agent actions" }));

    expect(screen.getByRole("menuitem", { name: "Edit" }).getAttribute("href")).toBe(
      "/o/acme/WEB/settings/agents/project_agent_1"
    );
  });

  test("a project agent row links to its page", () => {
    mockQueries({
      projectAgents: [projectAgent()],
      orgAgents: [],
    });

    renderSection(true);

    expect(screen.getByRole("link", { name: /Code Reviewer/ }).getAttribute("href")).toBe(
      "/o/acme/WEB/settings/agents/project_agent_1"
    );
  });

  test("locally edited copies show a red installed-version badge that reads as diverged", () => {
    mockQueries({
      projectAgents: [
        projectAgent({
          sourceAgentId: "agent_1" as Id<"agents">,
          installedVersion: 1,
          locallyEdited: true,
        }),
      ],
      orgAgents: [orgAgent({ _id: "agent_1" as Id<"agents">, version: 3 })],
    });

    renderSection(true);

    const badge = screen.getByRole("img", {
      name: "Edited in this project since installing v1",
    });
    expect(badge.textContent).toBe("v1");
    expect(badge.className).toContain("text-destructive");
    expect(screen.getByRole("img", { name: "New version 3 is available" })).toBeDefined();
  });

  test("up-to-date copies show a neutral installed-version badge and no status hints", () => {
    mockQueries({
      projectAgents: [
        projectAgent({
          sourceAgentId: "agent_1" as Id<"agents">,
          installedVersion: 3,
        }),
      ],
      orgAgents: [orgAgent({ _id: "agent_1" as Id<"agents">, version: 3 })],
    });

    renderSection(true);

    const badge = screen.getByRole("img", { name: "Installed from organization template v3" });
    expect(badge.textContent).toBe("v3");
    expect(badge.className).not.toContain("text-destructive");
    expect(screen.queryByLabelText(/is available/)).toBeNull();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Project agent actions" }));
    expect(screen.queryByRole("menuitem", { name: "Update" })).toBeNull();
  });

  test("project-created agents carry no version badge", () => {
    mockQueries({
      projectAgents: [projectAgent()],
      orgAgents: [orgAgent()],
    });

    renderSection(true);

    expect(screen.queryByText(/^v\d+$/)).toBeNull();
  });

  test("organization templates show their own version in the template dialog", () => {
    mockQueries({
      projectAgents: [projectAgent()],
      orgAgents: [orgAgent({ _id: "agent_1" as Id<"agents">, version: 4 })],
    });

    renderSection(true);
    openAgentCreationMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "From template" }));

    expect(screen.getByRole("img", { name: "Organization template v4" }).textContent).toBe("v4");
  });

  test("refreshing an unedited copy still confirms, because the overwrite cannot be undone", async () => {
    replaceFromAgentMock.mockResolvedValue(null);
    mockQueries({
      projectAgents: [
        projectAgent({
          sourceAgentId: "agent_1" as Id<"agents">,
          installedVersion: 1,
        }),
      ],
      orgAgents: [orgAgent({ _id: "agent_1" as Id<"agents">, version: 2 })],
    });

    renderSection(true);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Project agent actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Update" }));

    expect(screen.getByRole("heading", { name: "Update to v2?" })).toBeDefined();
    expect(replaceFromAgentMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => {
      expect(replaceFromAgentMock).toHaveBeenCalledWith({
        projectAgentId: "project_agent_1",
        agentId: "agent_1",
        overwriteLocalEdits: true,
      });
      expect(toastSuccessMock).toHaveBeenCalledWith("Code Reviewer updated to v2");
    });
  });

  test("a locally edited copy whose template is current can be reset to it", async () => {
    replaceFromAgentMock.mockResolvedValue(null);
    mockQueries({
      projectAgents: [
        projectAgent({
          sourceAgentId: "agent_1" as Id<"agents">,
          installedVersion: 2,
          locallyEdited: true,
        }),
      ],
      orgAgents: [orgAgent({ _id: "agent_1" as Id<"agents">, version: 2 })],
    });

    renderSection(true);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Project agent actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Reset" }));

    expect(screen.getByRole("heading", { name: "Reset to the organization version?" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    await waitFor(() => {
      expect(replaceFromAgentMock).toHaveBeenCalledWith({
        projectAgentId: "project_agent_1",
        agentId: "agent_1",
        overwriteLocalEdits: true,
      });
      expect(toastSuccessMock).toHaveBeenCalledWith("Code Reviewer reset to its template");
    });
  });

  test("refreshing a locally edited copy asks before overwriting it", async () => {
    replaceFromAgentMock.mockResolvedValue(null);
    mockQueries({
      projectAgents: [
        projectAgent({
          sourceAgentId: "agent_1" as Id<"agents">,
          installedVersion: 1,
          locallyEdited: true,
        }),
      ],
      orgAgents: [orgAgent({ _id: "agent_1" as Id<"agents">, version: 2 })],
    });

    renderSection(true);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Project agent actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Update" }));

    expect(screen.getByRole("heading", { name: "Overwrite local changes?" })).toBeDefined();
    expect(replaceFromAgentMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => {
      expect(replaceFromAgentMock).toHaveBeenCalledWith({
        projectAgentId: "project_agent_1",
        agentId: "agent_1",
        overwriteLocalEdits: true,
      });
    });
  });

  test("refreshing a copy installed before versioning asks before overwriting it", async () => {
    replaceFromAgentMock.mockResolvedValue(null);
    mockQueries({
      projectAgents: [projectAgent({ sourceAgentId: "agent_1" as Id<"agents"> })],
      orgAgents: [orgAgent({ _id: "agent_1" as Id<"agents">, version: 2 })],
    });

    renderSection(true);

    // Nothing is known about how it diverged, so the badge stays neutral...
    const badge = screen.getByRole("img", { name: "Installed from organization template v1" });
    expect(badge.className).not.toContain("text-destructive");

    // ...but the overwrite still has to be confirmed.
    fireEvent.pointerDown(screen.getByRole("button", { name: "Project agent actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Update" }));
    expect(screen.getByRole("heading", { name: "Overwrite local changes?" })).toBeDefined();
    expect(replaceFromAgentMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => {
      expect(replaceFromAgentMock).toHaveBeenCalledWith({
        projectAgentId: "project_agent_1",
        agentId: "agent_1",
        overwriteLocalEdits: true,
      });
    });
  });

  test("category navigation filters project agents, like skills and prompts", () => {
    mockQueries({
      projectAgents: [
        projectAgent({ _id: "project_agent_1" as Id<"projectAgents">, name: "Code Reviewer", category: "Engineering" }),
        projectAgent({ _id: "project_agent_2" as Id<"projectAgents">, name: "Support Triage", category: "Support" }),
      ],
      orgAgents: [],
    });

    renderSection(true);

    fireEvent.click(
      within(screen.getByLabelText("Agent categories")).getByRole("button", {
        name: /Support/,
      })
    );

    expect(screen.getByText("Support Triage")).toBeDefined();
    expect(screen.queryByText("Code Reviewer")).toBeNull();
  });

  test("a search with no matches says so instead of showing a skeleton while the catalog loads", () => {
    mockQueries({
      projectAgents: [projectAgent()],
      orgAgents: undefined,
    });

    renderSection(true);
    fireEvent.change(screen.getByLabelText("Search project agents"), {
      target: { value: "nothing matches this" },
    });

    expect(screen.getByText("No project agents match this search.")).toBeDefined();
  });

  test("viewers get no refresh action on outdated copies", () => {
    mockQueries({
      projectAgents: [
        projectAgent({
          sourceAgentId: "agent_1" as Id<"agents">,
          installedVersion: 1,
        }),
      ],
      orgAgents: [orgAgent({ _id: "agent_1" as Id<"agents">, version: 2 })],
    });

    renderSection(false);

    expect(screen.queryByRole("button", { name: "Project agent actions" })).toBeNull();
  });

  test("managers can delete project agents from the row actions menu", async () => {
    deleteProjectAgentMock.mockResolvedValue(null);
    mockQueries({
      projectAgents: [projectAgent()],
      orgAgents: [],
    });

    renderSection(true);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Project agent actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(deleteProjectAgentMock).toHaveBeenCalledWith({
        projectAgentId: "project_agent_1",
      });
    });
  });
});

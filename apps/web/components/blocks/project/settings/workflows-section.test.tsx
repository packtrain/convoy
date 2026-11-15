/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import type { ReactNode } from "react";
import { WorkflowsSection } from "./workflows-section";
import { expectEmptyState, expectVerticallyCentered } from "@/test-utils/empty-state";

const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const removeWorkflowMock = vi.hoisted(() => vi.fn());
const navigationPushMock = vi.hoisted(() => vi.fn());

vi.mock("convex/react", () => ({
  useQuery: useQueryMock,
  useMutation: useMutationMock,
}));

vi.mock("@/lib/navigation", () => ({
  useNavigation: () => ({ push: navigationPushMock, replace: vi.fn() }),
  appRoute: {
    projectWorkflowNew: (organizationSlug: string, projectAlias: string) => ({
      pathname: `/o/${organizationSlug}/${projectAlias}/settings/workflows/new`,
    }),
    projectWorkflowDetail: (organizationSlug: string, projectAlias: string, workflowId: string) => ({
      pathname: `/o/${organizationSlug}/${projectAlias}/settings/workflows/${workflowId}`,
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
    workflows: {
      core: {
        listByProject: "workflows.core.listByProject",
        remove: "workflows.core.remove",
      },
    },
  },
}));

vi.mock("@/lib/errors", () => ({
  showConvexErrorToast: vi.fn(),
}));

interface WorkflowSummaryStub {
  _id: Id<"workflows">;
  name: string;
  description?: string;
  category?: string;
}

function workflowSummary(overrides: Partial<WorkflowSummaryStub> = {}): WorkflowSummaryStub {
  return {
    _id: "workflow_1" as Id<"workflows">,
    name: "Release Train",
    description: "Ships a release end to end",
    category: "Delivery",
    ...overrides,
  };
}

function mockQueries(workflows: WorkflowSummaryStub[] | undefined) {
  useQueryMock.mockImplementation((query) => (query === "workflows.core.listByProject" ? workflows : undefined));
  useMutationMock.mockImplementation((mutation) => (mutation === "workflows.core.remove" ? removeWorkflowMock : vi.fn()));
}

function renderSection(canManage: boolean) {
  return render(
    <WorkflowsSection
      projectId={"project_1" as Id<"projects">}
      organizationSlug="acme"
      projectAlias="WEB"
      canManage={canManage}
    />
  );
}

describe("WorkflowsSection", () => {
  afterEach(() => {
    cleanup();
    useQueryMock.mockReset();
    useMutationMock.mockReset();
    removeWorkflowMock.mockReset();
    navigationPushMock.mockReset();
  });

  test("viewers can browse workflows without write affordances", () => {
    mockQueries([workflowSummary()]);

    renderSection(false);

    // The page shell owns the title.
    expect(screen.queryByRole("heading", { name: "Workflows" })).toBeNull();
    expect(screen.getByText("Release Train")).toBeDefined();
    expect(screen.queryByRole("link", { name: /New workflow/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Workflow actions" })).toBeNull();
  });

  test("managers get a create link and row navigation to the editor", () => {
    mockQueries([workflowSummary()]);

    renderSection(true);

    const createLink = screen.getByRole("link", { name: /New workflow/ });
    expect(createLink.getAttribute("href")).toBe("/o/acme/WEB/settings/workflows/new");

    expect(screen.getByRole("link", { name: /Release Train/ }).getAttribute("href")).toBe(
      "/o/acme/WEB/settings/workflows/workflow_1"
    );
  });

  test("category nav groups workflows and filters the list", () => {
    mockQueries([
      workflowSummary(),
      workflowSummary({ _id: "workflow_2" as Id<"workflows">, name: "Ops Sweep", category: "Ops" }),
    ]);

    renderSection(true);

    const nav = screen.getByRole("navigation", { name: "Workflow categories" });
    expect(nav).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /Ops\s*1/ }));
    expect(screen.getByText("Ops Sweep")).toBeDefined();
    expect(screen.queryByText("Release Train")).toBeNull();
  });

  test("empty state offers create to managers only", () => {
    mockQueries([]);

    renderSection(true);
    expect(screen.getByText("No workflows yet")).toBeDefined();
    expect(screen.getByRole("link", { name: /Create workflow/ }).getAttribute("href")).toBe(
      "/o/acme/WEB/settings/workflows/new"
    );

    cleanup();
    mockQueries([]);
    renderSection(false);
    expect(screen.queryByRole("link", { name: /Create workflow/ })).toBeNull();
  });

  test("the empty state is the shared unframed pattern, centered in the section", () => {
    mockQueries([]);

    renderSection(true);
    const section = screen.getByTestId("workflows-section");
    const empty = expectEmptyState("No workflows yet", {
      boundary: section,
      action: { role: "link", name: /Create workflow/ },
    });
    expectVerticallyCentered(empty, section);
  });

  test("a search with no matches shows the shared empty state", () => {
    mockQueries([workflowSummary()]);

    renderSection(true);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search workflows" }), { target: { value: "zzz" } });

    const message = screen.getByText("No workflows match this search.");
    expect(message.closest('[data-slot="empty"]')).not.toBeNull();
  });

  test("delete confirms through the dialog and calls the remove mutation", async () => {
    removeWorkflowMock.mockResolvedValue(null);
    mockQueries([workflowSummary()]);

    renderSection(true);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Workflow actions" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Delete/ }));

    expect(await screen.findByText("Delete workflow?")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(removeWorkflowMock).toHaveBeenCalledWith({ workflowId: "workflow_1" });
    });
  });
});

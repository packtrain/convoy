/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { OrganizationProjectDetailPage } from "./organization-project-detail-page";

const useQueryMock = vi.hoisted(() => vi.fn());
const updateProjectMock = vi.hoisted(() => vi.fn());
const updateAliasMock = vi.hoisted(() => vi.fn());
const pushMock = vi.hoisted(() => vi.fn());

vi.mock("convex/react", () => ({
  useQuery: useQueryMock,
  useMutation: (ref: string) =>
    ref === "updateAlias" ? updateAliasMock : updateProjectMock,
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    projects: {
      core: {
        getForOrganizationManagement: "get",
        update: "update",
        updateAlias: "updateAlias",
      },
    },
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
vi.mock("@/lib/errors", () => ({ showConvexErrorToast: vi.fn() }));

vi.mock("@/lib/navigation", () => ({
  AppLink: ({
    href,
    children,
    ...props
  }: {
    href: { pathname: string };
    children: React.ReactNode;
  }) => (
    <a href={href.pathname} {...props}>
      {children}
    </a>
  ),
  appRoute: {
    organizationProjects: (slug: string) => ({
      pathname: `/o/${slug}/settings/projects`,
    }),
  },
  useNavigation: () => ({ push: pushMock }),
}));

vi.mock("@/lib/routing/current-org-project-context", () => ({
  useCurrentOrgProject: () => ({
    organizationId: "org_1",
    organizationSlug: "acme",
  }),
}));

vi.mock("@/components/blocks/project/settings/members-section", () => ({
  MembersSection: ({
    projectId,
    canManage,
  }: {
    projectId: string;
    canManage?: boolean;
  }) => (
    <div>
      members for {projectId} canManage={String(canManage)}
    </div>
  ),
}));

vi.mock("@/components/custom/color-picker", () => ({
  ColorPicker: ({ value }: { value: string | null }) => (
    <div>color {value ?? "none"}</div>
  ),
}));

const PROJECT = {
  _id: "p_1",
  name: "Website Redesign",
  alias: "WEB",
  description: "Ships the thing",
  color: null,
  isArchived: false,
  createdAt: Date.now(),
  creator: { _id: "u_1", name: "Ada", email: "ada@example.com" },
};

function renderPage() {
  return render(<OrganizationProjectDetailPage projectId="p_1" />);
}

describe("OrganizationProjectDetailPage", () => {
  afterEach(() => {
    cleanup();
    useQueryMock.mockReset();
    updateProjectMock.mockReset();
    updateAliasMock.mockReset();
    pushMock.mockReset();
  });

  test("uses the prompt-editor layout: back link plus an Edit title", () => {
    useQueryMock.mockReturnValue(PROJECT);

    renderPage();

    const back = screen.getByRole("link", { name: "Back to projects" });
    expect(back.getAttribute("href")).toBe("/o/acme/settings/projects");
    expect(screen.getByRole("heading", { name: "Edit project" })).toBeDefined();
  });

  test("prefills the form from the project and shows the members section", () => {
    useQueryMock.mockReturnValue(PROJECT);

    renderPage();

    expect(screen.getByLabelText("Project name")).toHaveProperty(
      "value",
      "Website Redesign"
    );
    expect(screen.getByLabelText("Project key")).toHaveProperty("value", "WEB");
    expect(screen.getByLabelText("Description")).toHaveProperty(
      "value",
      "Ships the thing"
    );
    expect(screen.getByText("members for p_1 canManage=true")).toBeDefined();
  });

  test("saves details without touching the alias mutation when it is unchanged", async () => {
    useQueryMock.mockReturnValue(PROJECT);
    updateProjectMock.mockResolvedValue(null);

    renderPage();
    fireEvent.change(screen.getByLabelText("Project name"), {
      target: { value: "Renamed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateProjectMock).toHaveBeenCalledWith({
        id: "p_1",
        name: "Renamed",
        description: "Ships the thing",
        color: null,
      });
    });
    expect(updateAliasMock).not.toHaveBeenCalled();
  });

  test("calls the alias mutation only when the key changed", async () => {
    useQueryMock.mockReturnValue(PROJECT);
    updateProjectMock.mockResolvedValue(null);
    updateAliasMock.mockResolvedValue(null);

    renderPage();
    fireEvent.change(screen.getByLabelText("Project key"), {
      target: { value: "new" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateAliasMock).toHaveBeenCalledWith({ id: "p_1", alias: "NEW" });
    });
  });

  test("rejects an invalid project key before calling any mutation", async () => {
    useQueryMock.mockReturnValue(PROJECT);

    renderPage();
    fireEvent.change(screen.getByLabelText("Project key"), {
      target: { value: "A" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(
        screen.getByText(/Must be 2-5 characters, start with a letter/)
      ).toBeDefined();
    });
    expect(updateProjectMock).not.toHaveBeenCalled();
    expect(updateAliasMock).not.toHaveBeenCalled();
  });

  test("offers only Save — delete lives in the list row menu", () => {
    useQueryMock.mockReturnValue(PROJECT);

    renderPage();

    expect(screen.getByRole("button", { name: "Save" })).toBeDefined();
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /cancel/i })).toBeNull();
  });

  test("disables Save until the form is dirty", () => {
    useQueryMock.mockReturnValue(PROJECT);

    renderPage();
    expect(screen.getByRole("button", { name: "Save" })).toHaveProperty(
      "disabled",
      true
    );

    fireEvent.change(screen.getByLabelText("Project name"), {
      target: { value: "Renamed" },
    });
    expect(screen.getByRole("button", { name: "Save" })).toHaveProperty(
      "disabled",
      false
    );
  });

  test("stays on the page after saving", async () => {
    useQueryMock.mockReturnValue(PROJECT);
    updateProjectMock.mockResolvedValue(null);

    renderPage();
    fireEvent.change(screen.getByLabelText("Project name"), {
      target: { value: "Renamed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateProjectMock).toHaveBeenCalled();
    });
    expect(pushMock).not.toHaveBeenCalled();
  });

  test("shows a not-found state when the query returns null", () => {
    useQueryMock.mockReturnValue(null);

    renderPage();

    const heading = screen.getByRole("heading", { level: 1, name: "Project not found" });
    expect(heading.closest('[data-slot="empty"]')).not.toBeNull();
    expect(screen.queryByText(/members for/)).toBeNull();
  });

  test("renders skeletons while loading", () => {
    useQueryMock.mockReturnValue(undefined);

    const { container } = renderPage();

    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull();
    expect(screen.queryByText(/members for/)).toBeNull();
  });
});

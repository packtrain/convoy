/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import OrganizationPage from "./page";
import { useRedirectToLastProject } from "@/lib/routing/use-last-project";

const useQueryMock = vi.hoisted(() => vi.fn());

vi.mock("convex/react", () => ({ useQuery: useQueryMock }));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    organizations: {
      core: { getBySlug: "getBySlug" },
      members: { getMyRole: "getMyRole" },
    },
    projects: { core: { listByOrganization: "listByOrganization" } },
  },
}));

vi.mock("@/lib/navigation", () => ({
  useRouteParams: () => ({ organizationSlug: "acme" }),
}));

vi.mock("@/lib/routing/use-last-project", () => ({
  useRedirectToLastProject: vi.fn(),
}));

vi.mock("@/components/blocks/project/project-dialog", () => ({
  ProjectDialog: ({ dialog }: { dialog: { isOpen: boolean } }) =>
    dialog.isOpen ? <div role="dialog">New project dialog</div> : null,
}));

function renderEmptyOrg(role: string | undefined) {
  useQueryMock.mockImplementation((ref: string) => {
    if (ref === "getBySlug") return { _id: "org_1" };
    if (ref === "listByOrganization") return [];
    return role;
  });
  render(<OrganizationPage />);
}

describe("OrganizationPage", () => {
  afterEach(() => {
    cleanup();
    useQueryMock.mockReset();
  });

  test("offers to create the first project from the empty state", () => {
    renderEmptyOrg("member");

    expect(screen.getByText(/no projects yet/i)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    expect(screen.getByRole("dialog").textContent).toBe("New project dialog");
  });

  test("never redirects into an archived project", () => {
    const active = { _id: "p_1", alias: "WEB", isArchived: false };
    useQueryMock.mockImplementation((ref: string) => {
      if (ref === "getBySlug") return { _id: "org_1" };
      if (ref === "listByOrganization") return [active, { _id: "p_2", alias: "OLD", isArchived: true }];
      return "member";
    });
    render(<OrganizationPage />);

    expect(vi.mocked(useRedirectToLastProject)).toHaveBeenLastCalledWith("acme", [active]);
  });

  test("hides the create action while the role loads", () => {
    renderEmptyOrg(undefined);

    expect(screen.queryByRole("button", { name: "Create project" })).toBeNull();
  });
});

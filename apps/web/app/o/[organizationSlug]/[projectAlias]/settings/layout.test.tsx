/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { getFunctionName, type FunctionReference } from "convex/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "@/convex/_generated/api";
import type { OrgRole, ProjectRole } from "@/lib/authz/roles";
import { withProjectRole } from "@/test-utils/project-role";
import ProjectSettingsLayout from "./layout";

const useQueryMock = vi.fn();
const replaceMock = vi.fn();
let pathname = "/o/acme/WEB/settings/general";

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

vi.mock("@/lib/auth/hooks", () => ({
  useAppConvexAuth: () => ({ isLoading: false, isAuthenticated: true }),
}));

vi.mock("@/lib/navigation", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("@/lib/navigation");
  return {
    ...actual,
    useNavigation: () => ({ push: vi.fn(), replace: replaceMock }),
    useNavigationLocation: () => ({ pathname, search: "", hash: "" }),
  };
});

const orgQuery = getFunctionName(api.organizations.core.getBySlug);
const projectQuery = getFunctionName(api.projects.core.getByAlias);
const orgRoleQuery = getFunctionName(api.organizations.members.getMyRole);

async function renderAt(
  path: string,
  role: ProjectRole | undefined,
  orgRole: OrgRole | undefined = "member"
) {
  pathname = path;
  useQueryMock.mockImplementation(
    withProjectRole(role, (query) => {
      const name = getFunctionName(query as FunctionReference<"query">);
      if (name === orgQuery) return { _id: "org-1" };
      if (name === projectQuery) return { _id: "project-1", alias: "WEB" };
      if (name === orgRoleQuery) return orgRole;
      return undefined;
    })
  );
  await act(async () => {
    render(
      <ProjectSettingsLayout
        params={Promise.resolve({ organizationSlug: "acme", projectAlias: "WEB" })}
      >
        <div>Section content</div>
      </ProjectSettingsLayout>
    );
  });
}

const generalTarget = expect.objectContaining({
  pathname: "/o/acme/WEB/settings/general",
});

describe("ProjectSettingsLayout", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  test.each([
    "/o/acme/WEB/settings/agents",
    "/o/acme/WEB/settings/agents/new",
    "/o/acme/WEB/settings/agents/agent-1",
    "/o/acme/WEB/settings/prompts/new",
    "/o/acme/WEB/settings/skills/new",
    "/o/acme/WEB/settings/workflows/new",
    "/o/acme/WEB/settings/workflows/workflow-1",
    "/o/acme/WEB/settings/lists",
  ])("a viewer is sent from %s to General before anything mounts", async (path) => {
    await renderAt(path, "viewer");

    expect(screen.queryByText("Section content")).toBeNull();
    expect(replaceMock).toHaveBeenCalledWith(generalTarget);
  });

  test("a viewer reads the sections that only show values", async () => {
    await renderAt("/o/acme/WEB/settings/members", "viewer");

    expect(screen.getByText("Section content")).toBeTruthy();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  test("waits for the role instead of redirecting a member", async () => {
    await renderAt("/o/acme/WEB/settings/agents/new", undefined);

    expect(screen.queryByText("Section content")).toBeNull();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  test("a member opens editor routes", async () => {
    await renderAt("/o/acme/WEB/settings/workflows/new", "member");

    expect(screen.getByText("Section content")).toBeTruthy();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  test("Danger Zone needs org project:delete or project:archive", async () => {
    await renderAt("/o/acme/WEB/settings/danger", "member", "member");
    expect(replaceMock).toHaveBeenCalledWith(generalTarget);
    cleanup();
    replaceMock.mockClear();

    await renderAt("/o/acme/WEB/settings/danger", "project-admin", "member");
    expect(screen.getByText("Section content")).toBeTruthy();
    expect(replaceMock).not.toHaveBeenCalled();
    cleanup();

    await renderAt("/o/acme/WEB/settings/danger", "viewer", "admin");
    expect(screen.getByText("Section content")).toBeTruthy();
    expect(replaceMock).not.toHaveBeenCalled();
  });
});

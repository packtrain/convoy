/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import type { SkillSource } from "@/convex/lib/contracts/skills";
import { SkillsSection } from "./skills-section";
import { expectEmptyState, expectVerticallyCentered } from "@/test-utils/empty-state";

const useQueryMock = vi.hoisted(() => vi.fn());
const usePaginatedQueryMock = vi.hoisted(() => vi.fn());
const loadMoreMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const deleteMutationMock = vi.hoisted(() => vi.fn());
const installMutationMock = vi.hoisted(() => vi.fn());
const refreshMutationMock = vi.hoisted(() => vi.fn());
const navigationPushMock = vi.hoisted(() => vi.fn());

vi.mock("convex/react", () => ({
  useQuery: useQueryMock,
  usePaginatedQuery: usePaginatedQueryMock,
  useMutation: useMutationMock,
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    skills: {
      core: {
        list: "skills.core.list",
        listCategories: "skills.core.listCategories",
        listByOrganization: "skills.core.listByOrganization",
        deleteSkill: "skills.core.deleteSkill",
        get: "skills.core.get",
        copyFromSkill: "skills.core.copyFromSkill",
        replaceFromSkill: "skills.core.replaceFromSkill",
      },
    },
    organizations: {
      members: {
        getMyRole: "organizations.members.getMyRole",
      },
    },
    projects: {
      members: {
        getMyRole: "projects.members.getMyRole",
      },
    },
  },
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
  appRoute: {
    organizationSkillNew: (organizationSlug: string) => ({
      pathname: `/o/${organizationSlug}/settings/skills/new`,
    }),
    organizationSkillDetail: (organizationSlug: string, skillId: string) => ({
      pathname: `/o/${organizationSlug}/settings/skills/${skillId}`,
    }),
    projectSkillNew: (organizationSlug: string, projectAlias: string) => ({
      pathname: `/o/${organizationSlug}/${projectAlias}/settings/skills/new`,
    }),
    projectSkillDetail: (organizationSlug: string, projectAlias: string, skillId: string) => ({
      pathname: `/o/${organizationSlug}/${projectAlias}/settings/skills/${skillId}`,
    }),
  },
  useNavigation: () => ({
    push: navigationPushMock,
  }),
}));

vi.mock("@/lib/errors", () => ({
  showConvexErrorToast: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

vi.mock("next/dynamic", () => ({
  default: () =>
    function MockMdxEditor({ value }: { value: string }) {
      return <div data-testid="skill-md">{value}</div>;
    },
}));

interface SkillRowFixture {
  _id: Id<"skills">;
  scope: "organization" | "project";
  name: string;
  normalizedName: string;
  description?: string;
  category?: string;
  version: number;
  sourceSkillId?: Id<"skills">;
  installedVersion?: number;
  locallyEdited?: boolean;
  source?: SkillSource;
}

function skill(overrides: Partial<SkillRowFixture> = {}): SkillRowFixture {
  return {
    _id: "skill_1" as Id<"skills">,
    scope: "organization",
    name: "pdf-tools",
    normalizedName: "pdf-tools",
    description: "Fill and read PDFs",
    category: "Docs",
    version: 3,
    ...overrides,
  };
}

/** What `listCategories` would return for these fixtures. */
function categoryCounts(skills: SkillRowFixture[]) {
  const counts = new Map<string | undefined, number>();
  for (const item of skills) {
    counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  }

  return [...counts].map(([category, count]) => ({ category, count }));
}

/** The paginated list query, filtering by category the way the server does. */
function mockPaginatedSkills(skills: SkillRowFixture[], status = "Exhausted") {
  usePaginatedQueryMock.mockImplementation((_query, args: { category?: string | null }) => ({
    results: args.category === undefined ? skills : skills.filter((item) => (item.category ?? null) === args.category),
    status,
    isLoading: false,
    loadMore: loadMoreMock,
  }));
}

/** The project section, with the organization catalog behind the install list. */
function renderProjectSection(args: { projectSkills: SkillRowFixture[]; organizationSkills?: SkillRowFixture[]; role?: string }) {
  useQueryMock.mockImplementation((query) => {
    if (query === "skills.core.listCategories") {
      return categoryCounts(args.projectSkills);
    }
    if (query === "skills.core.listByOrganization") {
      return args.organizationSkills ?? [];
    }
    if (query === "projects.members.getMyRole") {
      return args.role ?? "project-admin";
    }
    if (query === "skills.core.get") {
      return { skillMd: "# PDF tools", files: [{ path: "references/fields.md", content: "detail" }] };
    }
    return undefined;
  });
  mockPaginatedSkills(args.projectSkills);
  useMutationMock.mockImplementation((ref) => {
    if (ref === "skills.core.copyFromSkill") {
      return installMutationMock;
    }

    return ref === "skills.core.replaceFromSkill" ? refreshMutationMock : deleteMutationMock;
  });

  return render(
    <SkillsSection
      organizationId={"org_1" as Id<"organizations">}
      organizationSlug="acme"
      projectId={"project_1" as Id<"projects">}
      projectAlias="OS"
    />
  );
}

function mockQueries(args: {
  skills: SkillRowFixture[] | undefined;
  role: "owner" | "admin" | "member" | null | undefined;
  status?: string;
}) {
  useQueryMock.mockImplementation((query) => {
    if (query === "skills.core.listCategories") {
      return args.skills && categoryCounts(args.skills);
    }
    if (query === "organizations.members.getMyRole") {
      return args.role;
    }
    return undefined;
  });
  mockPaginatedSkills(args.skills ?? [], args.status);
  useMutationMock.mockReturnValue(deleteMutationMock);
}

function renderSection() {
  return render(<SkillsSection organizationId={"org_1" as Id<"organizations">} organizationSlug="acme" />);
}

describe("SkillsSection", () => {
  afterEach(() => {
    cleanup();
    useQueryMock.mockReset();
    usePaginatedQueryMock.mockReset();
    loadMoreMock.mockReset();
    useMutationMock.mockReset();
    deleteMutationMock.mockReset();
    installMutationMock.mockReset();
    refreshMutationMock.mockReset();
    navigationPushMock.mockReset();
  });

  test("renders loading state while queries are unresolved", () => {
    mockQueries({ skills: undefined, role: undefined });

    renderSection();

    expect(screen.getByLabelText("Loading skills")).toBeDefined();
  });

  test("renders empty state and create affordance for managers", () => {
    mockQueries({ skills: [], role: "owner" });

    renderSection();

    expect(screen.getByRole("heading", { name: "No skills yet" })).toBeDefined();
    expect(screen.getByRole("link", { name: "Create skill" }).getAttribute("href")).toBe("/o/acme/settings/skills/new");
    expect(screen.queryByLabelText("Search skills")).toBeNull();
  });

  test("the empty state is the shared unframed pattern, centered in the section", () => {
    mockQueries({ skills: [], role: "owner" });

    renderSection();

    const section = screen.getByTestId("skills-section");
    const empty = expectEmptyState("No skills yet", { boundary: section, action: { role: "link", name: "Create skill" } });
    expectVerticallyCentered(empty, section);
  });

  test("owner sees create affordance and clickable skill rows", () => {
    mockQueries({ skills: [skill()], role: "owner" });

    renderSection();

    expect(screen.getByRole("link", { name: "New skill" }).getAttribute("href")).toBe("/o/acme/settings/skills/new");
    expect(screen.getByText("Fill and read PDFs")).toBeDefined();
    expect(screen.getByRole("link", { name: /pdf-tools/ }).getAttribute("href")).toBe("/o/acme/settings/skills/skill_1");
    expect(screen.getByRole("button", { name: "Skill actions" })).toBeDefined();
  });

  test("rows carry the template version badge, as the AI Agents list does", () => {
    mockQueries({ skills: [skill()], role: "owner" });

    renderSection();

    // Two copies: the row renders one badge per breakpoint, like the category badge.
    expect(screen.getAllByLabelText("Organization template v3").map((badge) => badge.textContent)).toEqual(["v3", "v3"]);
  });

  test("a row copied from a repository links straight to the copied commit", () => {
    mockQueries({
      skills: [
        skill({
          source: {
            repoUrl: "https://github.com/anthropics/skills",
            commitSha: "0f1e2d3c4b5a69788796a5b4c3d2e1f0abcdef12",
            subpath: "pdf",
          },
        }),
        skill({ _id: "skill_2" as Id<"skills">, name: "invoice-parser", normalizedName: "invoice-parser" }),
      ],
      role: "owner",
    });

    renderSection();

    const link = screen.getByRole("link", { name: "Open source repository" });
    expect(link.getAttribute("href")).toBe("https://github.com/anthropics/skills/tree/0f1e2d3c4b5a69788796a5b4c3d2e1f0abcdef12/pdf");
    // Opening the source must not also open the editor.
    expect(screen.getByRole("link", { name: /pdf-tools/ }).contains(link)).toBe(false);
  });

  test("member can open rows but cannot manage skills", () => {
    mockQueries({ skills: [skill()], role: "member" });

    renderSection();

    expect(screen.queryByRole("link", { name: /new skill|create skill/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Skill actions" })).toBeNull();
    expect(screen.getByRole("link", { name: /pdf-tools/ }).getAttribute("href")).toBe("/o/acme/settings/skills/skill_1");
  });

  test("category filtering changes visible rows", () => {
    mockQueries({
      skills: [skill(), skill({ _id: "skill_2" as Id<"skills">, name: "invoice-parser", category: "Finance" })],
      role: "member",
    });

    renderSection();

    fireEvent.click(within(screen.getByLabelText("Skill categories")).getByRole("button", { name: /Finance/ }));

    expect(screen.getByText("/invoice-parser")).toBeDefined();
    expect(screen.queryByText("/pdf-tools")).toBeNull();
    // The filter is the query's, not a client pass over the loaded page.
    expect(usePaginatedQueryMock).toHaveBeenLastCalledWith(
      "skills.core.list",
      { organizationId: "org_1", category: "Finance" },
      { initialNumItems: 50 }
    );
  });

  test("a partially loaded list ends in a Load more button that fetches the next 50", () => {
    mockQueries({ skills: [skill()], role: "member", status: "CanLoadMore" });

    renderSection();

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    expect(loadMoreMock).toHaveBeenCalledWith(50);
  });

  test("a category beyond the loaded page still shows in the navigation", () => {
    // The nav comes from the categories query, so it lists a category whose
    // skills the paginated list has not loaded yet.
    useQueryMock.mockImplementation((query) => {
      if (query === "skills.core.listCategories") {
        return [
          { category: "Docs", count: 1 },
          { category: "Unloaded", count: 49 },
        ];
      }
      return query === "organizations.members.getMyRole" ? "member" : undefined;
    });
    mockPaginatedSkills([skill()], "CanLoadMore");
    useMutationMock.mockReturnValue(deleteMutationMock);

    renderSection();

    expect(within(screen.getByLabelText("Skill categories")).getByRole("button", { name: /Unloaded/ })).toBeDefined();
  });

  test("search matches name, description, and category, and shows an empty result", () => {
    mockQueries({
      skills: [skill(), skill({ _id: "skill_2" as Id<"skills">, name: "invoice-parser", description: undefined, category: undefined })],
      role: "member",
    });

    renderSection();

    fireEvent.change(screen.getByLabelText("Search skills"), { target: { value: "read pdfs" } });
    expect(screen.getByText("/pdf-tools")).toBeDefined();
    expect(screen.queryByText("/invoice-parser")).toBeNull();

    // Rows read as `/name`, and searching that way finds them.
    fireEvent.change(screen.getByLabelText("Search skills"), { target: { value: "/pdf" } });
    expect(screen.getByText("/pdf-tools")).toBeDefined();

    fireEvent.change(screen.getByLabelText("Search skills"), { target: { value: "nothing" } });
    expect(screen.getByText("No skills match this search.")).toBeDefined();
  });

  test("project scope uses project queries, permissions, and routes", () => {
    renderProjectSection({ projectSkills: [skill({ scope: "project" })], role: "member" });

    expect(screen.getByRole("link", { name: "New skill" }).getAttribute("href")).toBe("/o/acme/OS/settings/skills/new");
    // A project Skill is not a template, so its badge does not claim to be one.
    expect(screen.getAllByLabelText("Skill v3")).toHaveLength(2);
    expect(screen.getByRole("link", { name: /pdf-tools/ }).getAttribute("href")).toBe("/o/acme/OS/settings/skills/skill_1");
  });

  test("a project viewer reads project skills but cannot manage them", () => {
    renderProjectSection({ projectSkills: [skill({ scope: "project" })], role: "viewer" });

    expect(screen.queryByRole("link", { name: /new skill|create skill/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Skill actions" })).toBeNull();
    expect(screen.getByText("/pdf-tools")).toBeDefined();
  });

  test("a manager installs an organization template that the project does not have yet", () => {
    renderProjectSection({
      projectSkills: [skill({ _id: "skill_copy" as Id<"skills">, scope: "project", name: "changelog", normalizedName: "changelog" })],
      organizationSkills: [
        skill({ _id: "skill_template" as Id<"skills"> }),
        // Already installed under its own name, so a second copy would collide.
        skill({ _id: "skill_installed" as Id<"skills">, name: "changelog", normalizedName: "changelog" }),
      ],
    });

    // Templates live behind the `New skill` group, not in a second list on the page.
    fireEvent.pointerDown(screen.getByRole("button", { name: "More skill creation options" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Install org skill" }));

    expect(screen.getByRole("heading", { name: "Install org skill" })).toBeDefined();
    // The installed one keeps its row, marked, but cannot be installed twice.
    expect(screen.getByText("Installed")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Install changelog" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Install pdf-tools" }));

    expect(installMutationMock).toHaveBeenCalledWith({ projectId: "project_1", skillId: "skill_template" });
    // Installing several in a row means the dialog stays open.
    expect(screen.getByRole("heading", { name: "Install org skill" })).toBeDefined();
  });

  test("clicking a template row previews it before installing", () => {
    renderProjectSection({
      projectSkills: [],
      organizationSkills: [skill({ _id: "skill_template" as Id<"skills"> })],
    });

    fireEvent.click(screen.getByRole("button", { name: "Install org skill" }));
    fireEvent.click(screen.getByRole("button", { name: /^\/pdf-tools/ }));

    expect(screen.getByTestId("skill-md").textContent).toBe("# PDF tools");
    expect(screen.getByText("references/fields.md")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Install" }));

    expect(installMutationMock).toHaveBeenCalledWith({ projectId: "project_1", skillId: "skill_template" });
  });

  test("the template dialog has its own search, leaving the section list alone", () => {
    renderProjectSection({
      projectSkills: [skill({ _id: "skill_copy" as Id<"skills">, scope: "project", name: "changelog", normalizedName: "changelog" })],
      organizationSkills: [
        skill({ _id: "skill_template" as Id<"skills"> }),
        skill({ _id: "skill_other" as Id<"skills">, name: "invoice-parser", normalizedName: "invoice-parser", description: undefined }),
      ],
    });

    fireEvent.pointerDown(screen.getByRole("button", { name: "More skill creation options" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Install org skill" }));
    fireEvent.change(screen.getByLabelText("Search organization skills"), { target: { value: "invoice" } });

    expect(screen.getByRole("button", { name: "Install invoice-parser" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Install pdf-tools" })).toBeNull();
    // The project row keeps its own search state.
    expect(screen.getByText("/changelog")).toBeDefined();
  });

  test("a project viewer is offered no templates to install", () => {
    renderProjectSection({
      projectSkills: [skill({ scope: "project" })],
      organizationSkills: [skill({ _id: "skill_template" as Id<"skills">, name: "changelog", normalizedName: "changelog" })],
      role: "viewer",
    });

    expect(screen.queryByRole("button", { name: "More skill creation options" })).toBeNull();
  });

  test("an organization with no skills offers no template dialog", () => {
    renderProjectSection({
      projectSkills: [skill({ _id: "skill_copy" as Id<"skills">, scope: "project" })],
      organizationSkills: [],
    });

    expect(screen.queryByRole("button", { name: "More skill creation options" })).toBeNull();
  });

  test("the template dialog updates an installed copy whose template moved on", () => {
    renderProjectSection({
      projectSkills: [
        skill({
          _id: "skill_copy" as Id<"skills">,
          scope: "project",
          sourceSkillId: "skill_template" as Id<"skills">,
          installedVersion: 2,
        }),
      ],
      organizationSkills: [skill({ _id: "skill_template" as Id<"skills">, version: 5 })],
    });

    fireEvent.pointerDown(screen.getByRole("button", { name: "More skill creation options" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Install org skill" }));
    fireEvent.click(screen.getByRole("button", { name: "Update pdf-tools to v5" }));

    // Overwriting the copy is destructive, so it is confirmed even from the dialog.
    expect(refreshMutationMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Update" }));

    expect(refreshMutationMock).toHaveBeenCalledWith({ skillId: "skill_copy", overwriteLocalEdits: true });
  });

  test("an empty project can install a template straight from the empty state", () => {
    renderProjectSection({
      projectSkills: [],
      organizationSkills: [skill({ _id: "skill_template" as Id<"skills"> })],
    });

    fireEvent.click(screen.getByRole("button", { name: "Install org skill" }));
    fireEvent.click(screen.getByRole("button", { name: "Install pdf-tools" }));

    expect(installMutationMock).toHaveBeenCalledWith({ projectId: "project_1", skillId: "skill_template" });
  });

  test("an installed copy badges the version it came from and updates from the template", () => {
    renderProjectSection({
      projectSkills: [
        skill({
          _id: "skill_copy" as Id<"skills">,
          scope: "project",
          version: 4,
          sourceSkillId: "skill_template" as Id<"skills">,
          installedVersion: 2,
        }),
      ],
      organizationSkills: [skill({ _id: "skill_template" as Id<"skills">, version: 5 })],
    });

    // The badge tracks the installed version, not the copy's own save count.
    expect(screen.getAllByLabelText("Installed from organization template v2").map((badge) => badge.textContent)).toEqual(["v2", "v2"]);
    expect(screen.getAllByLabelText("New version 5 is available")).toHaveLength(2);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Skill actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Update" }));

    // An update overwrites the copy's files, so even a clean copy is warned first.
    expect(refreshMutationMock).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Update to v5?" })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Update" }));

    expect(refreshMutationMock).toHaveBeenCalledWith({ skillId: "skill_copy", overwriteLocalEdits: true });
  });

  test("a locally edited copy can be reset to the organization version", () => {
    renderProjectSection({
      projectSkills: [
        skill({
          _id: "skill_copy" as Id<"skills">,
          scope: "project",
          sourceSkillId: "skill_template" as Id<"skills">,
          installedVersion: 5,
          locallyEdited: true,
        }),
      ],
      organizationSkills: [skill({ _id: "skill_template" as Id<"skills">, version: 5 })],
    });

    // Nothing newer to fetch, so the way back is a reset rather than an update.
    expect(screen.queryByLabelText(/New version/)).toBeNull();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Skill actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Reset" }));

    expect(refreshMutationMock).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Reset to the organization version?" })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    expect(refreshMutationMock).toHaveBeenCalledWith({ skillId: "skill_copy", overwriteLocalEdits: true });
  });

  test("updating a locally edited copy warns before the local changes are lost", () => {
    renderProjectSection({
      projectSkills: [
        skill({
          _id: "skill_copy" as Id<"skills">,
          scope: "project",
          sourceSkillId: "skill_template" as Id<"skills">,
          installedVersion: 2,
          locallyEdited: true,
        }),
      ],
      organizationSkills: [skill({ _id: "skill_template" as Id<"skills">, version: 5 })],
    });

    expect(screen.getAllByLabelText("Edited in this project since installing v2")).toHaveLength(2);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Skill actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Update" }));

    expect(refreshMutationMock).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Overwrite local changes?" })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Update" }));

    expect(refreshMutationMock).toHaveBeenCalledWith({ skillId: "skill_copy", overwriteLocalEdits: true });
  });

  test("a clean copy whose template has not moved on has nothing to update or reset", () => {
    renderProjectSection({
      projectSkills: [
        skill({
          _id: "skill_copy" as Id<"skills">,
          scope: "project",
          sourceSkillId: "skill_template" as Id<"skills">,
          installedVersion: 5,
        }),
      ],
      organizationSkills: [skill({ _id: "skill_template" as Id<"skills">, version: 5 })],
    });

    expect(screen.queryByLabelText(/New version/)).toBeNull();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Skill actions" }));
    expect(screen.queryByRole("menuitem", { name: "Update" })).toBeNull();
  });
});

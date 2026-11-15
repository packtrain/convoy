/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import type { SkillSource } from "@/convex/lib/contracts/skills";
import { SkillEditorPage } from "./skill-editor-page";
import type { SkillFormValues } from "./skill-form";

const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const pushMock = vi.hoisted(() => vi.fn());
const createMutationMock = vi.hoisted(() => vi.fn());
const createProjectMutationMock = vi.hoisted(() => vi.fn());
const updateMutationMock = vi.hoisted(() => vi.fn());
const deleteMutationMock = vi.hoisted(() => vi.fn());
const showConvexErrorToastMock = vi.hoisted(() => vi.fn());
const currentRouteMock = vi.hoisted(() => vi.fn());

vi.mock("convex/react", () => ({
  useQuery: useQueryMock,
  useMutation: useMutationMock,
}));

vi.mock("next/dynamic", () => ({
  default: () =>
    function MockMdxEditor({ value }: { value: string }) {
      return <textarea aria-label="Markdown" readOnly value={value} />;
    },
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    organizations: {
      members: {
        getMyRole: "organizations.members.getMyRole",
      },
    },
    skills: {
      core: {
        get: "skills.core.get",
        createInOrganization: "skills.core.createInOrganization",
        createInProject: "skills.core.createInProject",
        update: "skills.core.update",
        deleteSkill: "skills.core.deleteSkill",
      },
    },
    projects: {
      core: {
        getByAlias: "projects.core.getByAlias",
      },
      members: {
        getMyRole: "projects.members.getMyRole",
      },
    },
  },
}));

vi.mock("@/lib/routing/current-org-project-context", () => ({
  useCurrentOrgProject: currentRouteMock,
}));

vi.mock("@/lib/navigation", () => ({
  AppLink: ({ href, children, className }: { href: string | { pathname: string }; children: ReactNode; className?: string }) => (
    <a href={typeof href === "string" ? href : href.pathname} className={className}>
      {children}
    </a>
  ),
  appRoute: {
    organizationSkills: (organizationSlug: string) => ({
      pathname: `/o/${organizationSlug}/settings/skills`,
    }),
    organizationSkillDetail: (organizationSlug: string, skillId: string) => ({
      pathname: `/o/${organizationSlug}/settings/skills/${skillId}`,
    }),
    projectSettings: (organizationSlug: string, projectAlias: string, section: string) => ({
      pathname: `/o/${organizationSlug}/${projectAlias}/settings/${section}`,
    }),
  },
  useNavigation: () => ({
    push: pushMock,
  }),
}));

vi.mock("@/lib/errors", () => ({
  showConvexErrorToast: showConvexErrorToastMock,
  getErrorMessage: (_error: unknown, fallback: string) => fallback,
}));

vi.mock("./skill-form", () => ({
  SkillForm: ({
    mode,
    initialValues,
    onSubmit,
    onCancel,
    onDelete,
  }: {
    mode: "create" | "edit";
    initialValues: SkillFormValues;
    onSubmit: (values: SkillFormValues) => Promise<void>;
    onCancel: () => void;
    onDelete?: () => void;
  }) => (
    <div data-testid="skill-form" data-mode={mode}>
      <span>{initialValues.name || "empty-name"}</span>
      <span>{initialValues.content || "empty-content"}</span>
      <span data-testid="seeded-file-paths">{initialValues.files.map((file) => file.path).join(",") || "no-files"}</span>
      <span data-testid="seeded-source">
        {initialValues.source ? `${initialValues.source.repoUrl}@${initialValues.source.commitSha}` : "no-source"}
      </span>
      <button
        type="button"
        onClick={() =>
          void onSubmit({
            name: "pdf-tools",
            description: "",
            category: "",
            content: "# PDF tools",
            files: [{ path: "references/fields.md", content: "# Fields" }],
          })
        }
      >
        Submit form
      </button>
      <button
        type="button"
        onClick={() =>
          void onSubmit({
            name: "pdf-tools",
            description: "",
            category: "",
            content: "# PDF tools",
            files: [],
            source: { repoUrl: "https://github.com/anthropics/skills", commitSha: "0f1e2d3", ref: "", subpath: "" },
          })
        }
      >
        Submit with source
      </button>
      <button type="button" onClick={onCancel}>
        Cancel form
      </button>
      {onDelete ? (
        <button type="button" onClick={onDelete}>
          Delete from form
        </button>
      ) : null}
    </div>
  ),
}));

const skill = {
  _id: "skill_1" as Id<"skills">,
  _creationTime: 1,
  scope: "organization",
  organizationId: "org_1" as Id<"organizations">,
  name: "pdf-tools",
  normalizedName: "pdf-tools",
  description: "Fill and read PDFs",
  category: "Docs",
  version: 1,
  createdBy: "user_1" as Id<"users">,
  updatedBy: "user_1" as Id<"users">,
  createdAt: 1,
  updatedAt: 1,
  isDeleted: false,
  skillMd: "---\nname: pdf-tools\n---\n\n# PDF tools",
  files: [{ path: "references/fields.md", content: "# Fields" }],
} as const;

function mockQueries(args: {
  role: "owner" | "admin" | "member" | null | undefined;
  skill?: ((typeof skill | { scope: "project"; projectId: Id<"projects"> }) & { source?: SkillSource }) | null | undefined;
  project?: { _id: Id<"projects"> } | null | undefined;
  projectRole?: "project-admin" | "member" | "viewer" | null | undefined;
}) {
  currentRouteMock.mockReturnValue({ organizationId: "org_1", organizationSlug: "acme", projectAlias: null });
  useQueryMock.mockImplementation((query) => {
    if (query === "organizations.members.getMyRole") {
      return args.role;
    }
    if (query === "skills.core.get") {
      return args.skill;
    }
    if (query === "projects.core.getByAlias") {
      return args.project;
    }
    if (query === "projects.members.getMyRole") {
      return args.projectRole;
    }
    return undefined;
  });
  useMutationMock.mockImplementation((mutation) => {
    if (mutation === "skills.core.createInOrganization") {
      return createMutationMock;
    }
    if (mutation === "skills.core.createInProject") {
      return createProjectMutationMock;
    }
    if (mutation === "skills.core.update") {
      return updateMutationMock;
    }
    if (mutation === "skills.core.deleteSkill") {
      return deleteMutationMock;
    }
    return vi.fn();
  });
}

describe("SkillEditorPage", () => {
  afterEach(() => {
    cleanup();
    useQueryMock.mockReset();
    useMutationMock.mockReset();
    pushMock.mockReset();
    createMutationMock.mockReset();
    createProjectMutationMock.mockReset();
    updateMutationMock.mockReset();
    deleteMutationMock.mockReset();
    showConvexErrorToastMock.mockReset();
    currentRouteMock.mockReset();
  });

  test("create mode blocks members", () => {
    mockQueries({ role: "member" });

    render(<SkillEditorPage mode="create" />);

    expect(screen.getByText("You do not have permission to create skills.")).toBeDefined();
  });

  test("create submit sends the whole file set in one call and returns to the list", async () => {
    createMutationMock.mockResolvedValue("skill_1");
    mockQueries({ role: "owner" });

    render(<SkillEditorPage mode="create" />);

    expect(screen.getByRole("heading", { name: "New skill" })).toBeDefined();
    expect(screen.getByRole("link", { name: "Back to skills" }).getAttribute("href")).toBe("/o/acme/settings/skills");
    expect(screen.getByTestId("seeded-file-paths").textContent).toBe("no-files");
    fireEvent.click(screen.getByRole("button", { name: "Submit form" }));

    await waitFor(() => {
      expect(createMutationMock).toHaveBeenCalledWith({
        organizationId: "org_1",
        name: "pdf-tools",
        description: undefined,
        category: undefined,
        content: "# PDF tools",
        files: [{ path: "references/fields.md", content: "# Fields" }],
      });
      // Nothing left to come back for: the files went with the create.
      expect(pushMock).toHaveBeenCalledWith({ pathname: "/o/acme/settings/skills" });
    });
  });

  test("project create uses the project mutation and returns to project skills", async () => {
    createProjectMutationMock.mockResolvedValue("skill_1");
    mockQueries({ role: undefined, project: { _id: "project_1" as Id<"projects"> }, projectRole: "member" });
    currentRouteMock.mockReturnValue({ organizationId: "org_1", organizationSlug: "acme", projectAlias: "OS" });

    render(<SkillEditorPage mode="create" scope="project" />);

    expect(screen.getByRole("link", { name: "Back to skills" }).getAttribute("href")).toBe("/o/acme/OS/settings/skills");
    fireEvent.click(screen.getByRole("button", { name: "Submit form" }));

    await waitFor(() => {
      expect(createProjectMutationMock).toHaveBeenCalledWith({
        projectId: "project_1",
        name: "pdf-tools",
        description: undefined,
        category: undefined,
        content: "# PDF tools",
        files: [{ path: "references/fields.md", content: "# Fields" }],
      });
      expect(pushMock).toHaveBeenCalledWith({ pathname: "/o/acme/OS/settings/skills" });
    });
  });

  test("a project skill opened on the organization route is not found", () => {
    mockQueries({ role: "owner", skill: { ...skill, scope: "project", projectId: "project_1" as Id<"projects"> } });

    render(<SkillEditorPage mode="detail" skillId="skill_1" />);

    const heading = screen.getByRole("heading", { level: 1, name: "Skill not found" });
    expect(heading.closest('[data-slot="empty"]')).not.toBeNull();
  });

  test("another project's skill is not found on this project's route", () => {
    mockQueries({
      role: undefined,
      skill: { ...skill, scope: "project", projectId: "project_2" as Id<"projects"> },
      project: { _id: "project_1" as Id<"projects"> },
      projectRole: "project-admin",
    });
    currentRouteMock.mockReturnValue({ organizationId: "org_1", organizationSlug: "acme", projectAlias: "OS" });

    render(<SkillEditorPage mode="detail" scope="project" skillId="skill_1" />);

    expect(screen.getByRole("heading", { name: "Skill not found" })).toBeDefined();
  });

  test("detail mode seeds the editable form with the stored file set", () => {
    mockQueries({ role: "admin", skill });

    render(<SkillEditorPage mode="detail" skillId="skill_1" />);

    expect(screen.getByRole("heading", { name: "Edit skill" })).toBeDefined();
    expect(screen.getByTestId("skill-form").dataset.mode).toBe("edit");
    expect(screen.getByTestId("seeded-file-paths").textContent).toBe("references/fields.md");
  });

  test("detail mode seeds the metadata fields from the stored source", () => {
    mockQueries({
      role: "admin",
      skill: {
        ...skill,
        source: { repoUrl: "https://github.com/anthropics/skills", commitSha: "0f1e2d3c4b5a69788796a5b4c3d2e1f0abcdef12", subpath: "pdf" },
      },
    });

    render(<SkillEditorPage mode="detail" skillId="skill_1" />);

    expect(screen.getByTestId("seeded-source").textContent).toBe(
      "https://github.com/anthropics/skills@0f1e2d3c4b5a69788796a5b4c3d2e1f0abcdef12"
    );
    // A skill nobody copied seeds empty fields.
    cleanup();
    mockQueries({ role: "admin", skill });
    render(<SkillEditorPage mode="detail" skillId="skill_1" />);
    expect(screen.getByTestId("seeded-source").textContent).toBe("no-source");
  });

  test("metadata typed in the form is saved, and emptying it clears the stored source", async () => {
    updateMutationMock.mockResolvedValue({ ok: true, version: 2 });
    mockQueries({ role: "admin", skill });

    render(<SkillEditorPage mode="detail" skillId="skill_1" />);
    fireEvent.click(screen.getByRole("button", { name: "Submit with source" }));

    await waitFor(() => {
      expect(updateMutationMock).toHaveBeenCalledWith(
        expect.objectContaining({ source: { repoUrl: "https://github.com/anthropics/skills", commitSha: "0f1e2d3" } })
      );
    });

    // The blank fields of an ordinary save are a clear, not "leave it alone".
    fireEvent.click(screen.getByRole("button", { name: "Submit form" }));

    await waitFor(() => {
      expect(updateMutationMock).toHaveBeenLastCalledWith(expect.objectContaining({ source: null }));
    });
  });

  test("detail mode renders read-only content for a member", () => {
    mockQueries({ role: "member", skill });

    render(<SkillEditorPage mode="detail" skillId="skill_1" />);

    expect(screen.getByRole("heading", { name: "/pdf-tools", level: 1 })).toBeDefined();
    expect(screen.queryByTestId("skill-form")).toBeNull();
  });

  test("a member can open an additional file and read its content", async () => {
    mockQueries({ role: "member", skill });

    render(<SkillEditorPage mode="detail" skillId="skill_1" />);
    fireEvent.click(screen.getByRole("button", { name: "references/fields.md" }));

    await waitFor(() => {
      const rendered = screen.getAllByLabelText("Markdown").map((element) => (element as HTMLTextAreaElement).value);
      expect(rendered).toContain("# Fields");
    });
    // Read-only: no path input, no save.
    expect(screen.queryByLabelText("Path")).toBeNull();
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
  });

  test("missing skill renders a not-found panel", () => {
    mockQueries({ role: "owner", skill: null });

    render(<SkillEditorPage mode="detail" skillId="skill_1" />);

    expect(screen.getByRole("heading", { name: "Skill not found" })).toBeDefined();
  });

  test("update submit clears optional fields it was given empty", async () => {
    updateMutationMock.mockResolvedValue(null);
    mockQueries({ role: "owner", skill });

    render(<SkillEditorPage mode="detail" skillId="skill_1" />);
    fireEvent.click(screen.getByRole("button", { name: "Submit form" }));

    await waitFor(() => {
      expect(updateMutationMock).toHaveBeenCalledWith({
        skillId: "skill_1",
        name: "pdf-tools",
        description: null,
        category: null,
        content: "# PDF tools",
        files: [{ path: "references/fields.md", content: "# Fields" }],
        source: null,
      });
      expect(pushMock).toHaveBeenCalledWith({ pathname: "/o/acme/settings/skills" });
    });
  });

  test("save surfaces a duplicate-name error through the toast helper", async () => {
    const error = new Error("A skill with this name already exists");
    createMutationMock.mockRejectedValue(error);
    mockQueries({ role: "owner" });

    render(<SkillEditorPage mode="create" />);
    fireEvent.click(screen.getByRole("button", { name: "Submit form" }));

    await waitFor(() => {
      expect(showConvexErrorToastMock).toHaveBeenCalledWith(error, "Could not save skill");
    });
  });

  test("delete dialog names the skill and confirms", async () => {
    deleteMutationMock.mockResolvedValue(null);
    mockQueries({ role: "owner", skill });

    render(<SkillEditorPage mode="detail" skillId="skill_1" />);
    fireEvent.click(screen.getByRole("button", { name: "Delete from form" }));

    expect(screen.getByText("Delete /pdf-tools?")).toBeDefined();
    const deleteButtons = screen.getAllByRole("button", { name: "Delete" });
    fireEvent.click(deleteButtons[deleteButtons.length - 1]);

    await waitFor(() => {
      expect(deleteMutationMock).toHaveBeenCalledWith({ skillId: "skill_1" });
    });
  });
});

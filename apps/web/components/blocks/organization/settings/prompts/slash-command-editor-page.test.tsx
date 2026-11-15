/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { SlashCommandEditorPage } from "./slash-command-editor-page";
import type { SlashCommandFormValues } from "./slash-command-form";

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

vi.mock("@/convex/_generated/api", () => ({
  api: {
    organizations: {
      members: {
        getMyRole: "organizations.members.getMyRole",
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
    slashCommands: {
      core: {
        get: "slashCommands.core.get",
        createInOrganization: "slashCommands.core.createInOrganization",
        createInProject: "slashCommands.core.createInProject",
        update: "slashCommands.core.update",
        deleteSlashCommand: "slashCommands.core.deleteSlashCommand",
      },
    },
  },
}));

vi.mock("@/lib/routing/current-org-project-context", () => ({
  useCurrentOrgProject: currentRouteMock,
}));

vi.mock("@/lib/navigation", () => ({
  AppLink: ({
    href,
    children,
    className,
  }: {
    href: string | { pathname: string };
    children: ReactNode;
    className?: string;
  }) => (
    <a
      href={typeof href === "string" ? href : href.pathname}
      className={className}
    >
      {children}
    </a>
  ),
  appRoute: {
    organizationPrompts: (organizationSlug: string) => ({
      pathname: `/o/${organizationSlug}/settings/prompts`,
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
}));

vi.mock("./slash-command-form", () => ({
  SlashCommandForm: ({
    mode,
    initialValues,
    onSubmit,
    onCancel,
    onDelete,
  }: {
    mode: "create" | "edit";
    initialValues: SlashCommandFormValues;
    onSubmit: (values: SlashCommandFormValues) => Promise<void>;
    onCancel: () => void;
    onDelete?: () => void;
  }) => (
    <div data-testid="slash-command-form" data-mode={mode}>
      <span>{initialValues.key || "empty-key"}</span>
      <button
        type="button"
        onClick={() =>
          void onSubmit({
            key: "review",
            description: "",
            category: "",
            content: "Review contracts",
            autoExpand: true,
            autoSubmit: true,
          })
        }
      >
        Submit form
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
  slashCommandFormSchema: {},
}));

const command = {
  _id: "cmd_1" as Id<"slashCommands">,
  key: "review",
  description: "Review contracts",
  category: "Legal",
  content: "# Contract Review\n\nReview contracts",
  autoExpand: false,
  autoSubmit: false,
  scope: "organization",
  organizationId: "org_1" as Id<"organizations">,
  createdBy: "user_1" as Id<"users">,
  updatedBy: "user_1" as Id<"users">,
  createdAt: 1,
  updatedAt: 1,
  isDeleted: false,
  _creationTime: 1,
} as const;

function mockQueries(args: {
  role: "owner" | "admin" | "member" | null | undefined;
  command?: typeof command | null | undefined;
  project?: { _id: Id<"projects"> } | null | undefined;
  projectRole?: "project-admin" | "member" | "viewer" | null | undefined;
}) {
  currentRouteMock.mockReturnValue({ organizationId: "org_1", organizationSlug: "acme", projectAlias: null });
  useQueryMock.mockImplementation((query) => {
    if (query === "organizations.members.getMyRole") {
      return args.role;
    }
    if (query === "slashCommands.core.get") {
      return args.command;
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
    if (mutation === "slashCommands.core.createInOrganization") {
      return createMutationMock;
    }
    if (mutation === "slashCommands.core.createInProject") {
      return createProjectMutationMock;
    }
    if (mutation === "slashCommands.core.update") {
      return updateMutationMock;
    }
    if (mutation === "slashCommands.core.deleteSlashCommand") {
      return deleteMutationMock;
    }
    return vi.fn();
  });
}

describe("SlashCommandEditorPage", () => {
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

    render(<SlashCommandEditorPage mode="create" />);

    expect(screen.getByText("You do not have permission to create prompts.")).toBeDefined();
  });

  test("create submit calls create mutation and navigates back", async () => {
    createMutationMock.mockResolvedValue("cmd_1");
    mockQueries({ role: "owner" });

    render(<SlashCommandEditorPage mode="create" />);

    expect(screen.getByRole("heading", { name: "New prompt" })).toBeDefined();
    expect(
      screen.getByRole("link", { name: "Back to prompts" }).getAttribute("href")
    ).toBe("/o/acme/settings/prompts");
    fireEvent.click(screen.getByRole("button", { name: "Submit form" }));

    await waitFor(() => {
      expect(createMutationMock).toHaveBeenCalledWith({
        organizationId: "org_1",
        key: "review",
        description: undefined,
        category: undefined,
        content: "Review contracts",
        autoExpand: true,
        autoSubmit: true,
      });
      expect(pushMock).toHaveBeenCalledWith({
        pathname: "/o/acme/settings/prompts",
      });
    });
  });

  test("project create uses the project mutation and returns to project prompts", async () => {
    createProjectMutationMock.mockResolvedValue("cmd_1");
    mockQueries({
      role: undefined,
      project: { _id: "project_1" as Id<"projects"> },
      projectRole: "member",
    });
    currentRouteMock.mockReturnValue({ organizationId: "org_1", organizationSlug: "acme", projectAlias: "OS" });

    render(<SlashCommandEditorPage mode="create" scope="project" />);
    expect(
      screen.getByRole("link", { name: "Back to prompts" }).getAttribute("href")
    ).toBe("/o/acme/OS/settings/prompts");
    fireEvent.click(screen.getByRole("button", { name: "Submit form" }));

    await waitFor(() => {
      expect(createProjectMutationMock).toHaveBeenCalledWith({
        projectId: "project_1",
        key: "review",
        description: undefined,
        category: undefined,
        content: "Review contracts",
        autoExpand: true,
        autoSubmit: true,
      });
      expect(pushMock).toHaveBeenCalledWith({ pathname: "/o/acme/OS/settings/prompts" });
    });
  });

  test("detail mode renders editable form for admin", () => {
    mockQueries({ role: "admin", command });

    render(<SlashCommandEditorPage mode="detail" slashCommandId="cmd_1" />);

    expect(screen.getByRole("heading", { name: "Edit prompt" })).toBeDefined();
    expect(screen.getByTestId("slash-command-form").dataset.mode).toBe("edit");
    expect(screen.getByText("review")).toBeDefined();
  });

  test("detail mode renders read-only markdown for member", () => {
    mockQueries({ role: "member", command });

    render(<SlashCommandEditorPage mode="detail" slashCommandId="cmd_1" />);

    expect(screen.getByRole("heading", { name: "/review", level: 1 })).toBeDefined();
  });

  test("update submit calls update mutation with nullable clears", async () => {
    updateMutationMock.mockResolvedValue(null);
    mockQueries({ role: "owner", command });

    render(<SlashCommandEditorPage mode="detail" slashCommandId="cmd_1" />);
    fireEvent.click(screen.getByRole("button", { name: "Submit form" }));

    await waitFor(() => {
      expect(updateMutationMock).toHaveBeenCalledWith({
        slashCommandId: "cmd_1",
        key: "review",
        description: null,
        category: null,
        content: "Review contracts",
        autoExpand: true,
        autoSubmit: true,
      });
    });
  });

  test("save handles duplicate-key Convex errors with toast helper", async () => {
    const error = new Error("A slash command with this key already exists");
    createMutationMock.mockRejectedValue(error);
    mockQueries({ role: "owner" });

    render(<SlashCommandEditorPage mode="create" />);
    fireEvent.click(screen.getByRole("button", { name: "Submit form" }));

    await waitFor(() => {
      expect(showConvexErrorToastMock).toHaveBeenCalledWith(error, "Could not save slash command");
    });
  });

  test("cancel navigates to prompts list", () => {
    mockQueries({ role: "owner" });

    render(<SlashCommandEditorPage mode="create" />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel form" }));

    expect(pushMock).toHaveBeenCalledWith({
      pathname: "/o/acme/settings/prompts",
    });
  });

  test("delete dialog shows command and confirms delete", async () => {
    deleteMutationMock.mockResolvedValue(null);
    mockQueries({ role: "owner", command });

    render(<SlashCommandEditorPage mode="detail" slashCommandId="cmd_1" />);
    fireEvent.click(screen.getByRole("button", { name: "Delete from form" }));

    expect(screen.getByText("Delete /review?")).toBeDefined();
    const deleteButtons = screen.getAllByRole("button", { name: "Delete" });
    fireEvent.click(deleteButtons[deleteButtons.length - 1]);

    await waitFor(() => {
      expect(deleteMutationMock).toHaveBeenCalledWith({
        slashCommandId: "cmd_1",
      });
    });
  });
});

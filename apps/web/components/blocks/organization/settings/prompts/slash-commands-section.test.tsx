/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { SlashCommandsSection } from "./slash-commands-section";
import { expectEmptyState, expectVerticallyCentered } from "@/test-utils/empty-state";
import type { SlashCommandListItem } from "./slash-command-list-utils";

const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const deleteMutationMock = vi.hoisted(() => vi.fn());
const navigationPushMock = vi.hoisted(() => vi.fn());

vi.mock("convex/react", () => ({
  useQuery: useQueryMock,
  useMutation: useMutationMock,
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    slashCommands: {
      core: {
        listByOrganization: "slashCommands.core.listByOrganization",
        listByProject: "slashCommands.core.listByProject",
        deleteSlashCommand: "slashCommands.core.deleteSlashCommand",
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
    organizationPromptNew: (organizationSlug: string) => ({
      pathname: `/o/${organizationSlug}/settings/prompts/new`,
    }),
    organizationPromptDetail: (organizationSlug: string, slashCommandId: string) => ({
      pathname: `/o/${organizationSlug}/settings/prompts/${slashCommandId}`,
    }),
    projectPromptNew: (organizationSlug: string, projectAlias: string) => ({
      pathname: `/o/${organizationSlug}/${projectAlias}/settings/prompts/new`,
    }),
    projectPromptDetail: (organizationSlug: string, projectAlias: string, slashCommandId: string) => ({
      pathname: `/o/${organizationSlug}/${projectAlias}/settings/prompts/${slashCommandId}`,
    }),
  },
  useNavigation: () => ({
    push: navigationPushMock,
  }),
}));

vi.mock("@/lib/errors", () => ({
  showConvexErrorToast: vi.fn(),
}));

function command(overrides: Partial<SlashCommandListItem>): SlashCommandListItem {
  return {
    _id: "cmd_1" as Id<"slashCommands">,
    key: "review",
    description: "Review contracts",
    category: "Legal",
    content: "# Contract Review\n\nReview contracts",
    autoExpand: false,
    ...overrides,
  };
}

function mockQueries(args: { commands: SlashCommandListItem[] | undefined; role: "owner" | "admin" | "member" | null | undefined }) {
  useQueryMock.mockImplementation((query) => {
    if (query === "slashCommands.core.listByOrganization") {
      return args.commands;
    }
    if (query === "organizations.members.getMyRole") {
      return args.role;
    }
    return undefined;
  });
  useMutationMock.mockReturnValue(deleteMutationMock);
}

function renderSection() {
  return render(<SlashCommandsSection organizationId={"org_1" as Id<"organizations">} organizationSlug="acme" />);
}

describe("SlashCommandsSection", () => {
  afterEach(() => {
    cleanup();
    useQueryMock.mockReset();
    useMutationMock.mockReset();
    deleteMutationMock.mockReset();
    navigationPushMock.mockReset();
  });

  test("renders loading state while queries are unresolved", () => {
    mockQueries({ commands: undefined, role: undefined });

    renderSection();

    expect(screen.getByLabelText("Loading prompts")).toBeDefined();
  });

  test("renders empty state and create affordance for managers", () => {
    mockQueries({ commands: [], role: "owner" });

    renderSection();

    expect(screen.getByRole("heading", { name: "No prompts yet" })).toBeDefined();
    expect(screen.getByText("Create reusable prompts for common slash-command workflows.")).toBeDefined();
    expect(screen.getByRole("link", { name: "Create prompt" }).getAttribute("href")).toBe("/o/acme/settings/prompts/new");
    expect(screen.queryByLabelText("Search prompts")).toBeNull();
    expect(screen.queryByRole("button", { name: /All/ })).toBeNull();
  });

  test("the empty state is the shared unframed pattern, centered in the section", () => {
    mockQueries({ commands: [], role: "owner" });

    renderSection();

    const section = screen.getByTestId("slash-commands-section");
    const empty = expectEmptyState("No prompts yet", { boundary: section, action: { role: "link", name: "Create prompt" } });
    expectVerticallyCentered(empty, section);
  });

  test("owner sees create affordance and clickable prompt rows", () => {
    mockQueries({
      commands: [command({ autoExpand: true })],
      role: "owner",
    });

    renderSection();

    const newPromptLink = screen.getByRole("link", { name: "New prompt" });
    expect(newPromptLink.getAttribute("href")).toBe("/o/acme/settings/prompts/new");
    expect(newPromptLink.getAttribute("data-variant")).toBe("outline");
    expect(screen.queryByRole("link", { name: "Create prompt" })).toBeNull();
    expect(screen.getByRole("link", { name: /\/review/ }).getAttribute("href")).toBe(
      "/o/acme/settings/prompts/cmd_1"
    );
    expect(screen.getByRole("button", { name: "Prompt actions" })).toBeDefined();
    expect(screen.queryByText("Auto-expand")).toBeNull();
  });

  test("member can open rows but cannot manage prompts", () => {
    mockQueries({
      commands: [command({})],
      role: "member",
    });

    renderSection();

    expect(screen.queryByRole("link", { name: /new prompt|create prompt/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Prompt actions" })).toBeNull();
    expect(screen.getByRole("link", { name: /\/review/ }).getAttribute("href")).toBe(
      "/o/acme/settings/prompts/cmd_1"
    );
  });

  test("category filtering changes visible cards", () => {
    mockQueries({
      commands: [
        command({ _id: "cmd_1" as Id<"slashCommands">, key: "review", category: "Legal" }),
        command({ _id: "cmd_2" as Id<"slashCommands">, key: "memo", category: "Banking" }),
      ],
      role: "member",
    });

    renderSection();

    fireEvent.click(
      within(screen.getByLabelText("Prompt categories")).getByRole("button", {
        name: /Banking/,
      })
    );

    expect(screen.getByText("/memo")).toBeDefined();
    expect(screen.queryByText("/review")).toBeNull();
  });

  test("uncategorized prompts render without category sidebar and remain searchable by preview", () => {
    mockQueries({
      commands: [
        command({
          description: undefined,
          category: undefined,
          content: "# Contract Review\n\nAnalyze obligations and risks.",
        }),
      ],
      role: "member",
    });

    renderSection();

    expect(screen.queryByLabelText("Prompt categories")).toBeNull();
    expect(screen.getByText("Contract Review Analyze obligations and risks.")).toBeDefined();
    expect(screen.queryByText("# Contract Review")).toBeNull();

    fireEvent.change(screen.getByLabelText("Search prompts"), {
      target: { value: "obligations" },
    });
    expect(screen.getByText("/review")).toBeDefined();
  });

  test("search no-results keeps category controls visible and shows empty state", () => {
    mockQueries({
      commands: [command({})],
      role: "member",
    });

    renderSection();

    fireEvent.change(screen.getByLabelText("Search prompts"), {
      target: { value: "missing" },
    });

    expect(screen.getByRole("button", { name: /All/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /Legal/ })).toBeDefined();
    expect(screen.getByText("No prompts match this search.")).toBeDefined();
  });

  test("project scope uses project queries, permissions, and routes", () => {
    useQueryMock.mockImplementation((query) => {
      if (query === "slashCommands.core.listByProject") {
        return [command({})];
      }
      if (query === "projects.members.getMyRole") {
        return "member";
      }
      return undefined;
    });
    useMutationMock.mockReturnValue(deleteMutationMock);

    render(
      <SlashCommandsSection
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="acme"
        projectId={"project_1" as Id<"projects">}
        projectAlias="OS"
      />
    );

    const newPromptLink = screen.getByRole("link", { name: "New prompt" });
    expect(newPromptLink.getAttribute("href")).toBe("/o/acme/OS/settings/prompts/new");
    expect(newPromptLink.getAttribute("data-variant")).toBe("outline");
    expect(screen.getByRole("link", { name: /\/review/ }).getAttribute("href")).toBe(
      "/o/acme/OS/settings/prompts/cmd_1"
    );
  });
});

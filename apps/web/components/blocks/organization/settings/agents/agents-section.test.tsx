/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { AgentsSection } from "./agents-section";
import { expectEmptyState, expectVerticallyCentered } from "@/test-utils/empty-state";
import type { OrganizationAgentListItem } from "@/components/blocks/agents/agent-list-utils";

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
    agents: {
      core: {
        listByOrganization: "agents.core.listByOrganization",
        deleteAgent: "agents.core.deleteAgent",
      },
    },
    organizations: {
      members: {
        getMyRole: "organizations.members.getMyRole",
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
    organizationAgentNew: (organizationSlug: string) => ({
      pathname: `/o/${organizationSlug}/settings/agents/new`,
    }),
    organizationAgentDetail: (organizationSlug: string, agentId: string) => ({
      pathname: `/o/${organizationSlug}/settings/agents/${agentId}`,
    }),
  },
  useNavigation: () => ({
    push: navigationPushMock,
  }),
}));

vi.mock("@/lib/errors", () => ({
  showConvexErrorToast: vi.fn(),
}));

function agent(overrides: Partial<OrganizationAgentListItem>): OrganizationAgentListItem {
  return {
    _id: "agent_1" as Id<"agents">,
    _creationTime: 1,
    organizationId: "org_1" as Id<"organizations">,
    name: "Code Reviewer",
    version: 1,
    description: "Reviews code changes",
    category: "Engineering",
    prompt: "# Code Reviewer\n\nReview code changes",
    appearance: { color: "#3b82f6" },
    createdBy: "user_1" as Id<"users">,
    updatedBy: "user_1" as Id<"users">,
    createdAt: 1,
    updatedAt: 1,
    isDeleted: false,
    ...overrides,
  };
}

function mockQueries(args: { agents: OrganizationAgentListItem[] | undefined; role: "owner" | "admin" | "member" | null | undefined }) {
  useQueryMock.mockImplementation((query) => {
    if (query === "agents.core.listByOrganization") {
      return args.agents;
    }
    if (query === "organizations.members.getMyRole") {
      return args.role;
    }
    return undefined;
  });
  useMutationMock.mockReturnValue(deleteMutationMock);
}

function renderSection() {
  return render(<AgentsSection organizationId={"org_1" as Id<"organizations">} organizationSlug="acme" />);
}

describe("AgentsSection", () => {
  afterEach(() => {
    cleanup();
    useQueryMock.mockReset();
    useMutationMock.mockReset();
    deleteMutationMock.mockReset();
    navigationPushMock.mockReset();
  });

  test("renders loading state while queries are unresolved", () => {
    mockQueries({ agents: undefined, role: undefined });

    renderSection();

    expect(screen.getByLabelText("Loading agents")).toBeDefined();
  });

  test("renders empty state and create action for managers", () => {
    mockQueries({ agents: [], role: "owner" });

    renderSection();

    expect(screen.getByRole("heading", { name: "No agents yet" })).toBeDefined();
    expect(screen.getByRole("link", { name: "Create agent" }).getAttribute("href")).toBe("/o/acme/settings/agents/new");
  });

  test("the empty state is the shared unframed pattern, centered in the section", () => {
    mockQueries({ agents: [], role: "owner" });

    renderSection();

    const section = screen.getByTestId("agents-section");
    const empty = expectEmptyState("No agents yet", { boundary: section, action: { role: "link", name: "Create agent" } });
    expectVerticallyCentered(empty, section);
  });

  test("members can browse agents without create actions", () => {
    mockQueries({ agents: [agent({})], role: "member" });

    renderSection();

    expect(screen.queryByRole("link", { name: /new agent|create agent/i })).toBeNull();
    expect(screen.getByRole("link", { name: /Code Reviewer/ }).getAttribute("href")).toBe(
      "/o/acme/settings/agents/agent_1"
    );
    expect(screen.queryByRole("button", { name: "Agent actions" })).toBeNull();
    expect(screen.getByText("C")).toBeDefined();
  });

  test("managers see row actions for agents", () => {
    mockQueries({ agents: [agent({})], role: "owner" });

    renderSection();

    expect(screen.getByRole("link", { name: "New agent" }).getAttribute("data-variant")).toBe("outline");
    expect(screen.getByRole("button", { name: "Agent actions" })).toBeDefined();
  });

  test("search filters by prompt preview and category", () => {
    mockQueries({
      agents: [
        agent({
          _id: "agent_1" as Id<"agents">,
          name: "Code Reviewer",
          category: "Engineering",
        }),
        agent({
          _id: "agent_2" as Id<"agents">,
          name: "Support Triage",
          category: "Support",
          prompt: "Classify customer issues",
        }),
      ],
      role: "member",
    });

    renderSection();

    fireEvent.click(
      within(screen.getByLabelText("Agent categories")).getByRole("button", {
        name: /Support/,
      })
    );
    expect(screen.getByText("Support Triage")).toBeDefined();
    expect(screen.queryByText("Code Reviewer")).toBeNull();

    fireEvent.change(screen.getByLabelText("Search agents"), {
      target: { value: "customer" },
    });
    expect(screen.getByText("Support Triage")).toBeDefined();
  });
});

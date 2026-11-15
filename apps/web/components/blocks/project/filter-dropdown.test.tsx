/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { FilterDropdown } from "./filter-dropdown";
import type { Id } from "@/convex/_generated/dataModel";

const noop = vi.fn();
const useQueryMock = vi.hoisted(() => vi.fn());

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

function mockAssignableAssignees({
  users = [],
  projectAgents = [],
  currentUser,
}: {
  users?: unknown[];
  projectAgents?: unknown[];
  currentUser?: unknown;
}) {
  useQueryMock.mockImplementation((query, args) => {
    if (args === "skip") {
      return undefined;
    }

    const queryName = getFunctionName(query);
    if (queryName === "projects/members:listAssignable") {
      return users;
    }
    if (queryName === "agents/projectAgents:listByProject") {
      return projectAgents;
    }
    if (queryName === "users/core:current") {
      return currentUser;
    }
    return undefined;
  });
}

describe("FilterDropdown", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    useQueryMock.mockReset();
  });

  test("shows the status filter label", () => {
    render(
      <FilterDropdown
        statusFilter="all"
        assigneeFilter={null}
        onStatusFilterChange={noop}
        onAssigneeFilterChange={noop}
      />
    );

    expect(screen.getByRole("button").textContent).toBe("All");
  });

  test("shows the assignee filter label when my tasks is active", () => {
    render(
      <FilterDropdown
        statusFilter="all"
        assigneeFilter={{ type: "me" }}
        onStatusFilterChange={noop}
        onAssigneeFilterChange={noop}
      />
    );

    expect(screen.getByRole("button").textContent).toBe("My tasks");
  });

  test("toggles My tasks off when selected again", () => {
    const onAssigneeFilterChange = vi.fn();

    render(
      <FilterDropdown
        statusFilter="all"
        assigneeFilter={{ type: "me" }}
        onStatusFilterChange={noop}
        onAssigneeFilterChange={onAssigneeFilterChange}
      />
    );

    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("menuitem", { name: "My tasks" }));

    expect(onAssigneeFilterChange).toHaveBeenCalledWith(null);
  });

  test("shows selected Project-agent name in the trigger", () => {
    const projectId = "project-1" as Id<"projects">;
    const projectAgentId = "agent-1" as Id<"projectAgents">;
    mockAssignableAssignees({
      projectAgents: [
        {
          _id: projectAgentId,
          name: "Code Review",
          description: "Reviews diffs",
          prompt: "Review code",
          category: "Engineering",
          appearance: { color: "#3b82f6" },
          isDeleted: false,
        },
      ],
      currentUser: { _id: "user-1" },
    });

    render(
      <FilterDropdown
        statusFilter="all"
        assigneeFilter={{ type: "projectAgent", projectAgentId }}
        projectId={projectId}
        onStatusFilterChange={noop}
        onAssigneeFilterChange={noop}
      />
    );

    expect(screen.getByRole("button").textContent).toBe("CCode Review");
  });

  test("does not highlight the trigger for the All status filter", () => {
    render(
      <FilterDropdown
        statusFilter="all"
        assigneeFilter={null}
        onStatusFilterChange={noop}
        onAssigneeFilterChange={noop}
      />
    );

    const trigger = screen.getByRole("button");
    expect(trigger.className.split(" ")).not.toContain("bg-muted");
    expect(trigger.className).not.toContain("bg-amber-50");
    expect(trigger.className).not.toContain("bg-emerald-50");
    expect(trigger.querySelector("svg")?.className.baseVal).toContain(
      "text-muted-foreground"
    );
  });

  test("highlights non-All status filters with the selected status color", () => {
    render(
      <FilterDropdown
        statusFilter="active"
        assigneeFilter={null}
        onStatusFilterChange={noop}
        onAssigneeFilterChange={noop}
      />
    );

    const trigger = screen.getByRole("button");
    expect(trigger.className).toContain("bg-amber-50");
    expect(trigger.className).toContain("text-amber-900");
    expect(trigger.querySelector("svg")?.className.baseVal).toContain(
      "text-warning"
    );
  });

  test("does not expose Backlog or Archived options", () => {
    render(
      <FilterDropdown
        statusFilter="all"
        assigneeFilter={null}
        onStatusFilterChange={noop}
        onAssigneeFilterChange={noop}
      />
    );

    fireEvent.click(screen.getByRole("button"));

    expect(screen.queryByText("Backlog")).toBeNull();
    expect(screen.queryByText("Archived")).toBeNull();
  });

  test("moves generic and directory assignee options into Assigned to submenu", () => {
    const projectId = "project-1" as Id<"projects">;
    const userId = "user-1" as Id<"users">;
    const projectAgentId = "agent-1" as Id<"projectAgents">;
    mockAssignableAssignees({
      users: [
        {
          _id: userId,
          name: "Ada Lovelace",
          email: "ada@example.com",
          avatarUrl: null,
          role: "member",
        },
      ],
      projectAgents: [
        {
          _id: projectAgentId,
          name: "Code Review",
          description: "Reviews diffs",
          prompt: "Review code",
          category: "Engineering",
          appearance: { color: "#3b82f6" },
          isDeleted: false,
        },
      ],
      currentUser: { _id: userId },
    });

    render(
      <FilterDropdown
        statusFilter="all"
        assigneeFilter={null}
        projectId={projectId}
        onStatusFilterChange={noop}
        onAssigneeFilterChange={noop}
      />
    );

    fireEvent.click(screen.getByRole("button"));

    expect(screen.queryByRole("menuitem", { name: "Any assignee" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "No assignee" })).toBeNull();
    expect(screen.queryByText("Agents")).toBeNull();
    expect(screen.queryByText("People")).toBeNull();

    fireEvent.click(screen.getByRole("menuitem", { name: "Assigned to" }));

    expect(screen.getByRole("menuitem", { name: "Any assignee" })).toBeDefined();
    expect(screen.getByRole("menuitem", { name: "No assignee" })).toBeDefined();
    expect(screen.getByText("Agents")).toBeDefined();
    expect(screen.getByText("People")).toBeDefined();
    expect(screen.getByRole("menuitem", { name: /Code Review/ })).toBeDefined();
    expect(screen.getByRole("menuitem", { name: /Ada Lovelace \(you\)/ })).toBeDefined();
  });
});

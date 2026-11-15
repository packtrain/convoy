/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getFunctionName, type FunctionReference } from "convex/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";
import { AssigneeSelector } from "./assignee-selector";

const useQueryMock = vi.hoisted(() => vi.fn());

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

const projectId = "project-1" as Id<"projects">;

function mockAssignableAssignees({
  users = [
    {
      _id: "user-2" as Id<"users">,
      name: "Ada Lovelace",
      avatarUrl: "https://example.com/ada.png",
      role: "member",
    },
  ],
  agents = [],
}: {
  users?: Array<{
    _id: Id<"users">;
    name: string;
    avatarUrl: string | null;
    role: string;
  }>;
  agents?: Array<{
    _id: Id<"projectAgents">;
    name: string;
    description: string | null;
    category: string | null;
    appearance: { color: string };
    isDeleted: boolean;
  }>;
} = {}) {
  useQueryMock.mockImplementation((query: unknown, args: unknown) => {
    if (args && typeof args === "object" && "projectId" in args) {
      const queryName = getFunctionName(query as FunctionReference<"query">);
      if (queryName === "projects/members:listAssignable") return users;
      if (queryName === "agents/projectAgents:listByProject") return agents;
      return [];
    }

    return { _id: "user-1" };
  });
}

describe("AssigneeSelector", () => {
  afterEach(() => {
    cleanup();
    useQueryMock.mockReset();
  });

  test("renders the resolved assignee name for an optimistic assignee id update", () => {
    mockAssignableAssignees();

    render(
      <AssigneeSelector
        assignee={{
          type: "user",
          userId: "user-2" as Id<"users">,
          name: "Grace Hopper",
          avatarUrl: null,
        }}
        projectId={projectId}
        onAssigneeChange={vi.fn()}
      />
    );

    expect(screen.getByText("Ada Lovelace")).toBeDefined();
    expect(screen.queryByText("Grace Hopper")).toBeNull();
  });

  test("renders unassigned immediately when the optimistic assignee id is cleared", () => {
    mockAssignableAssignees();

    render(
      <AssigneeSelector
        assignee={null}
        projectId={projectId}
        onAssigneeChange={vi.fn()}
      />
    );

    expect(screen.getByText("No assignee")).toBeDefined();
    expect(screen.queryByText("Grace Hopper")).toBeNull();
  });

  test("renders compact read-only assignee without subscribing to queries", () => {
    render(
      <AssigneeSelector
        assignee={{
          type: "user",
          userId: "user-2" as Id<"users">,
          name: "Ada Lovelace",
          avatarUrl: null,
        }}
        onAssigneeChange={vi.fn()}
        variant="compact"
        isEditable={false}
      />
    );

    expect(useQueryMock.mock.calls).toHaveLength(0);
    expect(screen.getByText("Assignee: Ada Lovelace")).toBeDefined();
    expect(screen.getByText("AL")).toBeDefined();
  });

  test("the icon trigger is named", () => {
    mockAssignableAssignees();
    render(<AssigneeSelector projectId={projectId} onAssigneeChange={vi.fn()} variant="icon" />);

    expect(screen.getByRole("button", { name: "Assignee" })).toBeTruthy();
  });

  test("shows empty AI Agents section action when no agents exist", () => {
    mockAssignableAssignees();
    const handleAddAgentClick = vi.fn();

    render(
      <AssigneeSelector
        projectId={projectId}
        onAssigneeChange={vi.fn()}
        onAddAgentClick={handleAddAgentClick}
      />
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: "No assignee" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Add an agent" }));

    expect(handleAddAgentClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Invite teammates")).toBeNull();
  });

  test("picking a person emits an owner change and picking an agent emits a delegation change", () => {
    mockAssignableAssignees({
      agents: [
        {
          _id: "agent-1" as Id<"projectAgents">,
          name: "Triage Agent",
          description: null,
          category: null,
          appearance: { color: "blue" },
          isDeleted: false,
        },
      ],
    });
    const handleChange = vi.fn();

    render(
      <AssigneeSelector
        projectId={projectId}
        onAssigneeChange={handleChange}
      />
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: "No assignee" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Ada Lovelace/ }));
    expect(handleChange).toHaveBeenLastCalledWith({
      assigneeId: "user-2",
      assigneeDetails: {
        type: "user",
        userId: "user-2",
        name: "Ada Lovelace",
        avatarUrl: "https://example.com/ada.png",
      },
    });

    fireEvent.pointerDown(screen.getByRole("button", { name: "No assignee" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Triage Agent/ }));
    expect(handleChange).toHaveBeenLastCalledWith({
      delegatedToAgentId: "agent-1",
      delegatedToAgentDetails: {
        type: "projectAgent",
        projectAgentId: "agent-1",
        name: "Triage Agent",
        appearance: { color: "blue" },
        isDeleted: false,
      },
    });
  });

  test("an open menu closes and stops submitting when write access is removed", () => {
    mockAssignableAssignees();
    const handleChange = vi.fn();
    const view = render(
      <AssigneeSelector projectId={projectId} onAssigneeChange={handleChange} />
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: "No assignee" }));
    const option = screen.getByRole("menuitem", { name: /Ada Lovelace/ });
    view.rerender(
      <AssigneeSelector projectId={projectId} onAssigneeChange={handleChange} isEditable={false} />
    );
    fireEvent.click(option);

    expect(handleChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("menuitem", { name: /Ada Lovelace/ })).toBeNull();
  });

  test("No assignee clears only the owner and Clear delegation clears only the agent", () => {
    mockAssignableAssignees({
      agents: [
        {
          _id: "agent-1" as Id<"projectAgents">,
          name: "Triage Agent",
          description: null,
          category: null,
          appearance: { color: "blue" },
          isDeleted: false,
        },
      ],
    });
    const handleChange = vi.fn();

    render(
      <AssigneeSelector
        assignee={{
          type: "user",
          userId: "user-2" as Id<"users">,
          name: "Ada Lovelace",
          avatarUrl: null,
        }}
        delegatedToAgent={{
          type: "projectAgent",
          projectAgentId: "agent-1" as Id<"projectAgents">,
          name: "Triage Agent",
          appearance: { color: "blue" },
          isDeleted: false,
        }}
        projectId={projectId}
        onAssigneeChange={handleChange}
      />
    );

    const trigger = screen.getByRole("button", { name: /Triage Agent/ });
    fireEvent.pointerDown(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "No assignee" }));
    expect(handleChange).toHaveBeenLastCalledWith({
      assigneeId: null,
      assigneeDetails: null,
    });

    fireEvent.pointerDown(trigger);
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Clear delegation (Triage Agent)" })
    );
    expect(handleChange).toHaveBeenLastCalledWith({
      delegatedToAgentId: null,
      delegatedToAgentDetails: null,
    });
  });

  test("marks both the owner and the delegated agent as checked", () => {
    mockAssignableAssignees({
      users: [
        { _id: "user-2" as Id<"users">, name: "Ada Lovelace", avatarUrl: null, role: "member" },
        { _id: "user-3" as Id<"users">, name: "Alan Turing", avatarUrl: null, role: "member" },
      ],
      agents: [
        {
          _id: "agent-1" as Id<"projectAgents">,
          name: "Triage Agent",
          description: null,
          category: null,
          appearance: { color: "blue" },
          isDeleted: false,
        },
        {
          _id: "agent-2" as Id<"projectAgents">,
          name: "Review Agent",
          description: null,
          category: null,
          appearance: { color: "green" },
          isDeleted: false,
        },
      ],
    });

    render(
      <AssigneeSelector
        assignee={{
          type: "user",
          userId: "user-2" as Id<"users">,
          name: "Ada Lovelace",
          avatarUrl: null,
        }}
        delegatedToAgent={{
          type: "projectAgent",
          projectAgentId: "agent-1" as Id<"projectAgents">,
          name: "Triage Agent",
          appearance: { color: "blue" },
          isDeleted: false,
        }}
        projectId={projectId}
        onAssigneeChange={vi.fn()}
      />
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: /Triage Agent/ }));
    const checked = (name: RegExp) =>
      screen.getByRole("menuitem", { name }).getAttribute("data-checked");
    expect(checked(/^ALAda Lovelace/)).toBe("true");
    expect(checked(/^TTriage Agent/)).toBe("true");
    expect(checked(/^ATAlan Turing/)).toBeNull();
    expect(checked(/^RReview Agent/)).toBeNull();
  });

  test("calls section header add actions", () => {
    mockAssignableAssignees({
      agents: [
        {
          _id: "agent-1" as Id<"projectAgents">,
          name: "Triage Agent",
          description: null,
          category: null,
          appearance: { color: "blue" },
          isDeleted: false,
        },
      ],
    });
    const handleInviteClick = vi.fn();
    const handleAddAgentClick = vi.fn();

    render(
      <AssigneeSelector
        projectId={projectId}
        onAssigneeChange={vi.fn()}
        onInviteClick={handleInviteClick}
        onAddAgentClick={handleAddAgentClick}
      />
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: "No assignee" }));
    fireEvent.click(screen.getByRole("button", { name: "Add an agent" }));
    fireEvent.click(screen.getByRole("button", { name: "Invite teammates" }));

    expect(handleAddAgentClick).toHaveBeenCalledTimes(1);
    expect(handleInviteClick).toHaveBeenCalledTimes(1);
  });

  test("focuses and filters the assignee search when the menu opens", () => {
    mockAssignableAssignees({
      users: [
        {
          _id: "user-2" as Id<"users">,
          name: "Ada Lovelace",
          avatarUrl: null,
              role: "member",
        },
        {
          _id: "user-3" as Id<"users">,
          name: "Grace Hopper",
          avatarUrl: null,
              role: "member",
        },
      ],
    });

    render(
      <AssigneeSelector
        projectId={projectId}
        onAssigneeChange={vi.fn()}
      />
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: "No assignee" }));

    const search = screen.getByPlaceholderText("Search assignees...");
    expect(document.activeElement).toBe(search);

    fireEvent.change(search, { target: { value: "Grace" } });

    expect(screen.getByRole("menuitem", { name: /Grace Hopper/ })).toBeDefined();
    expect(screen.queryByRole("menuitem", { name: /Ada Lovelace/ })).toBeNull();
  });

  test("uses only the product clear button for assignee search", () => {
    mockAssignableAssignees();

    render(
      <AssigneeSelector
        projectId={projectId}
        onAssigneeChange={vi.fn()}
      />
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: "No assignee" }));

    const search = screen.getByPlaceholderText("Search assignees...");
    fireEvent.change(search, { target: { value: "Ada" } });

    expect(search.getAttribute("type")).toBe("text");
    expect(search.getAttribute("role")).toBe("searchbox");
    expect(
      screen.getAllByRole("button", { name: "Clear assignee search" })
    ).toHaveLength(1);
  });

  test("keeps focus in assignee search while typing matching characters", () => {
    mockAssignableAssignees();

    render(
      <AssigneeSelector
        projectId={projectId}
        onAssigneeChange={vi.fn()}
      />
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: "No assignee" }));

    const search = screen.getByPlaceholderText("Search assignees...");
    fireEvent.keyDown(search, { key: "A" });
    fireEvent.change(search, { target: { value: "A" } });
    fireEvent.keyDown(search, { key: "d" });
    fireEvent.change(search, { target: { value: "Ad" } });

    expect(document.activeElement).toBe(search);
    expect((search as HTMLInputElement).value).toBe("Ad");
  });

  test("uses arrows to focus assignees and Space to select the focused result", () => {
    mockAssignableAssignees();
    const handleChange = vi.fn();

    render(
      <AssigneeSelector
        projectId={projectId}
        onAssigneeChange={handleChange}
      />
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: "No assignee" }));

    const search = screen.getByPlaceholderText("Search assignees...");
    fireEvent.change(search, { target: { value: "Ada" } });
    fireEvent.keyDown(search, { key: "ArrowDown" });

    const ada = screen.getByRole("menuitem", { name: /Ada Lovelace/ });
    expect(document.activeElement).toBe(ada);

    fireEvent.keyDown(ada, { key: " " });

    expect(handleChange).toHaveBeenCalledWith({
      assigneeId: "user-2",
      assigneeDetails: {
        type: "user",
        userId: "user-2",
        name: "Ada Lovelace",
        avatarUrl: "https://example.com/ada.png",
      },
    });
  });
  test("a controlled open prop opens the picker without a click", () => {
    mockAssignableAssignees();
    render(
      <AssigneeSelector
        open
        onOpenChange={vi.fn()}
        assignee={null}
        projectId={projectId}
        onAssigneeChange={vi.fn()}
      />
    );
    expect(screen.getByPlaceholderText("Search assignees...")).toBeDefined();
  });
});

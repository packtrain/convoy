/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { ComponentProps, ReactNode } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { WorkflowSelector } from "./workflow-selector";

const useQueryMock = vi.fn();
vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args) as unknown,
}));

const pushMock = vi.fn();
vi.mock("@/lib/navigation", () => ({
  useNavigation: () => ({ push: pushMock }),
  appRoute: {
    projectWorkflowNew: (organizationSlug: string, projectAlias: string) =>
      `/o/${organizationSlug}/${projectAlias}/settings/workflows/new`,
  },
}));

// Inline the dropdown primitives so the (normally portal'd, closed) content
// renders and rows are clickable — same approach as thread-agent-selector.test.
vi.mock("@/components/ai-elements/model-selector-dropdown", () => ({
  ModelSelectorDropdown: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ModelSelectorDropdownTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ModelSelectorDropdownContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ModelSelectorDropdownInput: (props: ComponentProps<"input">) => <input {...props} />,
  ModelSelectorDropdownList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ModelSelectorDropdownEmpty: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ModelSelectorDropdownGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ModelSelectorDropdownItem: ({ children, onSelect }: { children: ReactNode; onSelect?: () => void }) => (
    <button type="button" onClick={onSelect}>
      {children}
    </button>
  ),
  ModelSelectorDropdownName: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

const WORKFLOWS = [
  { _id: "wf_1", name: "Plan and build" },
  { _id: "wf_2", name: "Review sweep" },
];

const BASE_PROPS = {
  projectId: "project_1" as Id<"projects">,
  organizationSlug: "acme",
  projectAlias: "app",
  onChange: vi.fn(),
};

describe("WorkflowSelector", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  test("lists the project's workflows; selecting one hands back its id and name", () => {
    useQueryMock.mockReturnValue(WORKFLOWS);
    const onChange = vi.fn();
    render(<WorkflowSelector {...BASE_PROPS} onChange={onChange} value={null} />);

    expect(screen.getByTitle("Workflow: none")).toBeDefined();
    // Icon-only below a 2xl composer bar; the title carries the value.
    expect(screen.getByTitle("Workflow: none").querySelector("span")?.className).toContain("hidden min-w-0 max-w-32 truncate @2xl/composer-bar:inline");
    fireEvent.click(screen.getByRole("button", { name: "Plan and build" }));
    expect(onChange).toHaveBeenCalledWith({ _id: "wf_1", name: "Plan and build" });
  });

  test("a selected workflow names the trigger, and both its row and No workflow deselect", () => {
    useQueryMock.mockReturnValue(WORKFLOWS);
    const onChange = vi.fn();
    render(
      <WorkflowSelector
        {...BASE_PROPS}
        onChange={onChange}
        value={{ _id: "wf_2" as Id<"workflows">, name: "Review sweep" }}
      />
    );

    expect(screen.getByTitle("Workflow: Review sweep")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "No workflow" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
    fireEvent.click(screen.getByRole("button", { name: "Review sweep" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  test("a workflow's color tints its row glyph, rides the selection, and tints the trigger", () => {
    useQueryMock.mockReturnValue([{ _id: "wf_1", name: "Plan and build", color: "#ef4444" }]);
    const onChange = vi.fn();
    const { unmount } = render(<WorkflowSelector {...BASE_PROPS} onChange={onChange} value={null} />);

    const row = screen.getByRole("button", { name: "Plan and build" });
    expect((row.querySelector("svg") as SVGElement).style.color).toBe("rgb(239, 68, 68)");
    fireEvent.click(row);
    expect(onChange).toHaveBeenCalledWith({ _id: "wf_1", name: "Plan and build", color: "#ef4444" });
    unmount();

    render(
      <WorkflowSelector
        {...BASE_PROPS}
        value={{ _id: "wf_1" as Id<"workflows">, name: "Plan and build", color: "#ef4444" }}
      />
    );
    const trigger = screen.getByTitle("Workflow: Plan and build");
    expect((trigger.querySelector("svg") as SVGElement).style.color).toBe("rgb(239, 68, 68)");
  });

  test("with no workflows, the empty state says so and New workflow… opens the editor", () => {
    useQueryMock.mockReturnValue([]);
    render(<WorkflowSelector {...BASE_PROPS} value={null} />);

    expect(screen.getByText("No workflows yet.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /New workflow/ }));
    expect(pushMock).toHaveBeenCalledWith("/o/acme/app/settings/workflows/new");
  });
});

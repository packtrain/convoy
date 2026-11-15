/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import type { ProjectLabel } from "@/lib/tasks/hooks/use-project-labels";
import { expectEmptyState, expectVerticallyCentered } from "@/test-utils/empty-state";
import { LabelsSection } from "./labels-section";

const labelsMock = vi.hoisted(() => ({ current: [] as ProjectLabel[] }));

vi.mock("convex/react", () => ({ useMutation: () => vi.fn() }));
vi.mock("@/convex/_generated/api", () => ({ api: { tasks: { labels: { reorder: "reorder", remove: "remove" } } } }));
vi.mock("@/lib/tasks/hooks/use-project-labels", () => ({
  useProjectLabels: () => ({ labels: labelsMock.current, labelsById: new Map(), isLoading: false }),
}));
vi.mock("@/components/blocks/tasks/create-task-label-dialog", () => ({
  CreateTaskLabelDialog: ({ open }: { open: boolean }) => (open ? <div role="dialog">Create label dialog</div> : null),
}));

const projectId = "project_1" as Id<"projects">;

function label(name: string): ProjectLabel {
  return { _id: `label_${name}`, name, color: "#3b82f6", rank: "a" } as unknown as ProjectLabel;
}

describe("LabelsSection", () => {
  afterEach(() => {
    cleanup();
    labelsMock.current = [];
  });

  test("an empty list is the shared empty state with the create action inside it", () => {
    const { container } = render(<LabelsSection projectId={projectId} canEdit />);

    const section = container.firstElementChild as HTMLElement;
    const empty = expectEmptyState("No labels yet", {
      boundary: section,
      action: { role: "button", name: "Create label" },
    });
    expect(screen.getByText("Create labels to group the Board by them.")).toBeDefined();
    expect(screen.getAllByRole("button", { name: "Create label" })).toHaveLength(1);
    expectVerticallyCentered(empty, section);

    fireEvent.click(screen.getByRole("button", { name: "Create label" }));
    expect(screen.getByRole("dialog")).toBeDefined();
  });

  test("viewers see the empty state without a create action", () => {
    render(<LabelsSection projectId={projectId} canEdit={false} />);

    expectEmptyState("No labels yet");
    expect(screen.queryByRole("button", { name: "Create label" })).toBeNull();
  });

  test("with labels, the create action stays above the list", () => {
    labelsMock.current = [label("Bug")];
    render(<LabelsSection projectId={projectId} canEdit />);

    const button = screen.getByRole("button", { name: "Create label" });
    expect(button.closest("[data-slot=empty]")).toBeNull();
    expect(screen.getByText("Bug")).toBeDefined();
  });
});

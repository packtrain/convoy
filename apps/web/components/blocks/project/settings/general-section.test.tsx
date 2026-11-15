/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Doc } from "@/convex/_generated/dataModel";
import { GeneralSection } from "./general-section";

const updateProjectMock = vi.fn();

vi.mock("convex/react", () => ({
  useMutation: () => updateProjectMock,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Radix Select is not pointer-drivable in jsdom: each Select becomes a box
// named by its trigger, holding its value and one button per item.
vi.mock("@/components/ui/select", async () => {
  const { createContext, useContext } = await import("react");
  const SelectContext = createContext<(value: string) => void>(() => {});
  return {
    Select: ({ value, onValueChange, children }: { value: string; onValueChange: (value: string) => void; children: ReactNode }) => (
      <SelectContext.Provider value={onValueChange}>
        <div data-value={value}>{children}</div>
      </SelectContext.Provider>
    ),
    SelectTrigger: ({ "aria-label": label }: { "aria-label": string }) => <span>{label}</span>,
    SelectValue: () => null,
    SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
    SelectItem: ({ value, children }: { value: string; children: ReactNode }) => {
      const onValueChange = useContext(SelectContext);
      return <button type="button" onClick={() => onValueChange(value)}>{children}</button>;
    },
  };
});

const project = {
  _id: "project_1",
  name: "Project",
  alias: "PR",
  defaultViewMode: "list",
  defaultListGroupBy: "status",
  defaultBoardGroupBy: "assignee",
  defaultBoardRowGroupBy: "priority",
} as unknown as Doc<"projects">;

// The row label repeats the trigger's name; the trigger is the one inside a Select.
const field = (label: string) =>
  screen.getAllByText(label).map((element) => element.closest<HTMLElement>("[data-value]")).find(Boolean)!;

describe("GeneralSection default view", () => {
  // Radix Switch measures itself.
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  test("shows the view, list grouping and both board axes separately", () => {
    render(<GeneralSection project={project} />);
    expect(field("Default view").dataset.value).toBe("list");
    expect(field("Default list grouping").dataset.value).toBe("status");
    expect(field("Default board columns").dataset.value).toBe("assignee");
    expect(field("Default board rows").dataset.value).toBe("priority");
    // Rows never repeat the columns.
    expect(within(field("Default board rows")).queryByRole("button", { name: "Assignee" })).toBeNull();
  });

  test("picking the rows dimension as columns swaps the axes, and Save sends every field", async () => {
    updateProjectMock.mockResolvedValue(null);
    render(<GeneralSection project={project} />);
    fireEvent.click(within(field("Default board columns")).getByRole("button", { name: "Priority" }));
    expect(field("Default board columns").dataset.value).toBe("priority");
    expect(field("Default board rows").dataset.value).toBe("assignee");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateProjectMock).toHaveBeenCalled());
    expect(updateProjectMock).toHaveBeenCalledWith(expect.objectContaining({
      defaultViewMode: "list",
      defaultListGroupBy: "status",
      defaultBoardGroupBy: "priority",
      defaultBoardRowGroupBy: "assignee",
    }));
  });

  test("renders no page heading of its own, since the page shell owns it", () => {
    render(<GeneralSection project={project} />);
    expect(screen.queryByRole("heading", { name: "General" })).toBeNull();
  });

  test("one Save row saves a changed project key", async () => {
    updateProjectMock.mockResolvedValue(null);
    const onAliasChanged = vi.fn();
    render(<GeneralSection project={project} onAliasChanged={onAliasChanged} />);

    expect(screen.queryByRole("button", { name: /Update project key/i })).toBeNull();
    fireEvent.change(screen.getByLabelText("Project key"), { target: { value: "new" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onAliasChanged).toHaveBeenCalledWith("NEW"));
    expect(updateProjectMock).toHaveBeenCalledWith({ id: "project_1", alias: "NEW" });
    // Only the key changed, so the other fields are not re-sent.
    expect(updateProjectMock).toHaveBeenCalledTimes(1);
  });
});

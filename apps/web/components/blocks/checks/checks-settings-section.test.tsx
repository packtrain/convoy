/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import { BUILT_IN_TASK_TYPES } from "@/lib/tasks/task-types";
import type { CheckDefinition, Checklist } from "./types";
import { ChecklistDialog } from "./checklist-dialog";
import { ChecksSettingsSection } from "./checks-settings-section";

const data = vi.hoisted(() => ({ catalog: [] as unknown[], checklists: [] as unknown[] }));

vi.mock("convex/react", () => ({
  useQuery: (ref: string) => (ref === "definitions.list" ? data.catalog : data.checklists),
  useMutation: () => vi.fn(),
}));
vi.mock("@/convex/_generated/api", () => ({
  api: {
    checks: {
      definitions: { list: "definitions.list", create: "c", update: "u", remove: "r" },
      checklists: { list: "checklists.list", create: "c", update: "u", remove: "r" },
    },
  },
}));

const projectId = "project_1" as Id<"projects">;
const check = (key: string): CheckDefinition => ({ _id: `check_${key}` as Id<"checkDefinitions">, key, label: `Label ${key}`, instruction: "" });
const checklist = (name: string, checkKeys: string[] = []): Checklist => ({
  _id: `checklist_${name}` as Id<"checklists">,
  name,
  checkKeys,
  taskTypeKeys: ["feature"],
});

describe("ChecksSettingsSection", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
  });

  afterEach(() => {
    cleanup();
    data.catalog = [];
    data.checklists = [];
  });

  test("the Checklists group stays hidden until there is a check", () => {
    render(<ChecksSettingsSection projectId={projectId} canEdit />);

    expect(screen.getByText("No checks yet")).toBeDefined();
    expect(screen.queryByText("Checklists")).toBeNull();
    expect(screen.queryByText("No checklists yet")).toBeNull();
  });

  test("the Checks heading is hidden while the empty state is the only content", () => {
    render(<ChecksSettingsSection projectId={projectId} canEdit />);

    expect(screen.queryByRole("heading", { name: "Checks" })).toBeNull();
  });

  test("checklists stay manageable after the last check is deleted", () => {
    data.checklists = [checklist("Feature")];
    render(<ChecksSettingsSection projectId={projectId} canEdit />);

    expect(screen.getByText("No checks yet")).toBeDefined();
    expect(screen.getByRole("button", { name: "Edit Feature" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Feature actions" })).toBeDefined();
  });

  test("task type pills wrap below a long checklist name instead of overflowing", () => {
    data.catalog = [check("tests")];
    data.checklists = [{ ...checklist("Everything"), taskTypeKeys: BUILT_IN_TASK_TYPES.map((type) => type.key) }];
    render(<ChecksSettingsSection projectId={projectId} canEdit />);

    const pill = screen.getByText("Feature");
    const row = pill.parentElement;
    expect(row?.className).toContain("flex-wrap");
    expect(within(row!).getByText("Bug")).toBeDefined();
    expect(screen.getByText("Everything").className).toContain("max-w-full");
  });

  test("clicking a row opens its edit dialog", () => {
    data.catalog = [check("tests")];
    data.checklists = [checklist("Feature", ["tests"])];
    render(<ChecksSettingsSection projectId={projectId} canEdit />);

    fireEvent.click(screen.getByRole("button", { name: "Edit Label tests" }));
    expect(screen.getByRole("dialog", { name: "Edit check" })).toBeDefined();
  });

  test("viewers get plain rows with no edit action", () => {
    data.catalog = [check("tests")];
    render(<ChecksSettingsSection projectId={projectId} canEdit={false} />);

    expect(screen.getByText("Label tests")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Edit Label tests" })).toBeNull();
  });

  test("checks are picked from a checkbox dropdown and listed in pick order", () => {
    const catalog = ["tests", "ui", "lint"].map(check);
    render(<ChecklistDialog projectId={projectId} checklist={undefined} catalog={catalog} checklists={[]} onClose={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Add checks" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /^Label ui/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /^Label tests/ }));

    const handles = screen.getAllByRole("button", { name: /^Drag to reorder/ });
    expect(handles.map((handle) => handle.getAttribute("aria-label"))).toEqual(["Drag to reorder Label ui", "Drag to reorder Label tests"]);
  });

  test("the Add checks button sits below the picked checks", () => {
    const feature = checklist("Feature", ["tests"]);
    render(<ChecklistDialog projectId={projectId} checklist={feature} catalog={[check("tests")]} checklists={[feature]} onClose={() => {}} />);

    const row = screen.getByRole("button", { name: "Drag to reorder Label tests" });
    const add = screen.getByRole("button", { name: "Add checks" });
    expect(row.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("default task types render as inline removable pills above Add task types", () => {
    const feature = { ...checklist("Feature"), taskTypeKeys: ["bug", "feature"] };
    render(<ChecklistDialog projectId={projectId} checklist={feature} catalog={[]} checklists={[feature]} onClose={() => {}} />);

    const removeBug = screen.getByRole("button", { name: "Remove Bug" });
    const add = screen.getByRole("button", { name: "Add task types" });
    expect(removeBug.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(removeBug.closest(".flex-wrap")?.contains(screen.getByRole("button", { name: "Remove Feature" }))).toBe(true);

    fireEvent.click(removeBug);
    expect(screen.queryByRole("button", { name: "Remove Bug" })).toBeNull();

    fireEvent.click(add);
    fireEvent.click(screen.getByRole("checkbox", { name: /^Epic/ }));
    expect(screen.getByRole("button", { name: "Remove Epic" })).toBeDefined();
  });

  test("the checklist editor scrolls inside the viewport", () => {
    const keys = Array.from({ length: 50 }, (_, index) => `check-${index}`);
    const feature = checklist("Feature", keys);
    render(<ChecklistDialog projectId={projectId} checklist={feature} catalog={keys.map(check)} checklists={[feature]} onClose={() => {}} />);

    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toMatch(/max-h-/);
    const body = screen.getByTestId("checklist-dialog-body");
    expect(body.className).toContain("overflow-y-auto");
    expect(body.contains(screen.getByLabelText("Name"))).toBe(true);
    expect(body.contains(screen.getByRole("button", { name: "Save" }))).toBe(false);
  });
});

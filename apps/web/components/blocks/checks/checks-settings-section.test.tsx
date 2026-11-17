/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import { BUILT_IN_TASK_TYPES } from "@/lib/tasks/task-types";
import type { CheckDefinition, Checklist } from "./types";
import { ChecklistDialog } from "./checklist-dialog";
import { ChecksSettingsSection } from "./checks-settings-section";

const data = vi.hoisted(() => ({ catalog: [] as unknown[], checklists: [] as unknown[], mutate: vi.fn() }));

vi.mock("convex/react", () => ({
  useQuery: (ref: string) => (ref === "definitions.list" ? data.catalog : data.checklists),
  useMutation: () => data.mutate,
}));
vi.mock("@/convex/_generated/api", () => ({
  api: {
    checks: {
      definitions: { list: "definitions.list", create: "c", update: "u", remove: "r" },
      checklists: { list: "checklists.list", create: "c", update: "u", remove: "r", setDefaults: "setDefaults" },
    },
    projects: { core: { update: "projects.update" } },
  },
}));

const projectId = "project_1" as Id<"projects">;
const check = (key: string): CheckDefinition => ({ _id: `check_${key}` as Id<"checkDefinitions">, key, label: `Label ${key}`, instruction: "", showInPullRequestList: false });
const checklist = (name: string, checkKeys: string[] = []): Checklist => ({
  _id: `checklist_${name}` as Id<"checklists">,
  name,
  checkKeys,
  taskTypeKeys: ["feature"],
  pullRequests: false,
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
    data.mutate.mockReset();
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
    const row = pill.closest<HTMLElement>(".flex-wrap");
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
    render(<ChecklistDialog projectId={projectId} checklist={undefined} catalog={catalog} onClose={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Add checks" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /^Label ui/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /^Label tests/ }));

    const handles = screen.getAllByRole("button", { name: /^Drag to reorder/ });
    expect(handles.map((handle) => handle.getAttribute("aria-label"))).toEqual(["Drag to reorder Label ui", "Drag to reorder Label tests"]);
  });

  test("the Add checks button sits below the picked checks", () => {
    const feature = checklist("Feature", ["tests"]);
    render(<ChecklistDialog projectId={projectId} checklist={feature} catalog={[check("tests")]} onClose={() => {}} />);

    const row = screen.getByRole("button", { name: "Drag to reorder Label tests" });
    const add = screen.getByRole("button", { name: "Add checks" });
    expect(row.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("the checklist dialog no longer sets defaults", () => {
    render(<ChecklistDialog projectId={projectId} checklist={checklist("Feature")} catalog={[]} onClose={() => {}} />);

    expect(screen.queryByText("Default for")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add task types" })).toBeNull();
  });

  test("Defaults opens one picker per task type and pull requests, showing the current checklist", () => {
    data.catalog = [check("tests")];
    data.checklists = [{ ...checklist("Feature"), taskTypeKeys: ["task", "feature"] }, { ...checklist("Review"), taskTypeKeys: [], pullRequests: true }];
    render(<ChecksSettingsSection projectId={projectId} canEdit />);

    fireEvent.click(screen.getByRole("button", { name: "Defaults" }));
    const dialog = screen.getByRole("dialog", { name: "Default checklists" });
    expect(within(dialog).getAllByRole("combobox")).toHaveLength(BUILT_IN_TASK_TYPES.length + 1);
    expect(within(dialog).getByRole("combobox", { name: "Checklist for Task" }).textContent).toBe("Feature");
    expect(within(dialog).getByRole("combobox", { name: "Checklist for Bug" }).textContent).toBe("No checks");
    expect(within(dialog).getByRole("combobox", { name: "Checklist for Pull requests" }).textContent).toBe("Review");
  });

  test("viewers get no Defaults button", () => {
    data.catalog = [check("tests")];
    data.checklists = [checklist("Feature")];
    render(<ChecksSettingsSection projectId={projectId} canEdit={false} />);

    expect(screen.queryByRole("button", { name: "Defaults" })).toBeNull();
  });

  test("saving defaults sends every row in one setDefaults call", async () => {
    data.catalog = [check("tests")];
    const feature = { ...checklist("Feature"), taskTypeKeys: ["task", "feature"] };
    data.checklists = [feature];
    render(<ChecksSettingsSection projectId={projectId} canEdit />);

    fireEvent.click(screen.getByRole("button", { name: "Defaults" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(data.mutate).toHaveBeenCalledTimes(1));
    expect(data.mutate).toHaveBeenCalledWith({
      projectId,
      taskTypes: BUILT_IN_TASK_TYPES.map((type) => ({ key: type.key, checklistId: ["task", "feature"].includes(type.key) ? feature._id : null })),
      pullRequests: null,
    });
  });

  test("clicking a default's pill on a checklist row opens Defaults, not the checklist editor", () => {
    data.catalog = [check("tests")];
    data.checklists = [{ ...checklist("Feature"), pullRequests: true }];
    render(<ChecksSettingsSection projectId={projectId} canEdit />);

    expect(screen.getByRole("button", { name: "Change the default checklist for Pull requests" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Change the default checklist for Feature" }));
    expect(screen.getByRole("dialog", { name: "Default checklists" })).toBeDefined();
    expect(screen.queryByRole("dialog", { name: "Edit checklist" })).toBeNull();
  });

  test("with a Pull requests checklist, an admin can keep results off the Git host (OS-2406)", async () => {
    data.catalog = [check("tests")];
    data.checklists = [{ ...checklist("Review"), pullRequests: true }];
    render(<ChecksSettingsSection projectId={projectId} canEdit publishPullRequestChecks />);

    const toggle = screen.getByRole("switch", { name: "Publish results to the Git host" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);
    await waitFor(() => expect(data.mutate).toHaveBeenCalledWith({ id: projectId, publishPullRequestChecks: false }));
  });

  test("the publish switch waits for a Pull requests checklist and is read-only for viewers (OS-2406)", () => {
    data.catalog = [check("tests")];
    data.checklists = [checklist("Feature")];
    const { rerender } = render(<ChecksSettingsSection projectId={projectId} canEdit publishPullRequestChecks />);
    expect(screen.queryByRole("switch")).toBeNull();

    data.checklists = [{ ...checklist("Review"), pullRequests: true }];
    rerender(<ChecksSettingsSection projectId={projectId} canEdit={false} publishPullRequestChecks={false} />);
    const toggle = screen.getByRole("switch", { name: "Publish results to the Git host" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(toggle.hasAttribute("disabled")).toBe(true);
  });

  test("viewers' pills are plain, not buttons", () => {
    data.catalog = [check("tests")];
    data.checklists = [checklist("Feature")];
    render(<ChecksSettingsSection projectId={projectId} canEdit={false} />);

    expect(screen.queryByRole("button", { name: /default checklist/ })).toBeNull();
  });

  test("the checklist editor scrolls inside the viewport", () => {
    const keys = Array.from({ length: 50 }, (_, index) => `check-${index}`);
    const feature = checklist("Feature", keys);
    render(<ChecklistDialog projectId={projectId} checklist={feature} catalog={keys.map(check)} onClose={() => {}} />);

    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toMatch(/max-h-/);
    const body = screen.getByTestId("checklist-dialog-body");
    expect(body.className).toContain("overflow-y-auto");
    expect(body.contains(screen.getByLabelText("Name"))).toBe(true);
    expect(body.contains(screen.getByRole("button", { name: "Save" }))).toBe(false);
  });
});

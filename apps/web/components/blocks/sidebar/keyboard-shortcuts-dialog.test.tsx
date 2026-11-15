/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { getFunctionName, type FunctionReference } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { ProjectRole } from "@/lib/authz/roles";
import { setTestHotkeyPlatform } from "@/test-utils/hotkeys";
import { withProjectRole } from "@/test-utils/project-role";
import { KeyboardShortcutsButton } from "./keyboard-shortcuts-dialog";

const useQueryMock = vi.hoisted(() => vi.fn());
const routeParams = vi.hoisted(() => ({ current: {} as { projectAlias?: string } }));

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

vi.mock("next/navigation", () => ({
  useParams: () => routeParams.current,
}));

function mockProjectRole(role: ProjectRole) {
  const projectsQuery = getFunctionName(api.projects.core.listByOrganization);
  useQueryMock.mockImplementation(
    withProjectRole(role, (query) =>
      getFunctionName(query as FunctionReference<"query">) === projectsQuery
        ? [{ _id: "project_1", alias: "WEB" }]
        : undefined
    )
  );
}

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/sidebar", () => ({
  SidebarMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarMenuButton: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  SidebarMenuItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

describe("KeyboardShortcutsButton", () => {
  afterEach(() => {
    routeParams.current = {};
    useQueryMock.mockReset();
    setTestHotkeyPlatform({
      platform: "Linux x86_64",
      userAgent: "Mozilla/5.0",
    });
    cleanup();
    vi.clearAllMocks();
  });

  test.each([
    ["member", true],
    ["viewer", false],
  ] as const)("lists write shortcuts inside a project for a %s: %s", (role: ProjectRole, listed) => {
    routeParams.current = { projectAlias: "WEB" };
    mockProjectRole(role);

    render(<KeyboardShortcutsButton organizationId={"org_1" as Id<"organizations">} />);
    fireEvent.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));

    for (const label of [
      "Open new task dialog",
      "Archive completed tasks",
      "Toggle status",
      "Set status",
      "Delete selected",
      "Duplicate task",
      "Indent (make subtask)",
      "Reorder up / down",
    ]) {
      expect(screen.queryByText(label) !== null).toBe(listed);
    }
    expect(screen.queryByText("Editing") !== null).toBe(listed);
    for (const label of ["Find task", "Move up / down", "Clear selection", "Open task details", "Copy task link (on ref)"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  test.each([
    ["member", true],
    ["viewer", false],
  ] as const)("lists the Threads group inside a project for a %s: %s", (role: ProjectRole, listed) => {
    routeParams.current = { projectAlias: "WEB" };
    mockProjectRole(role);

    render(<KeyboardShortcutsButton organizationId={"org_1" as Id<"organizations">} />);
    fireEvent.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));

    expect(screen.queryByText("Threads") !== null).toBe(listed);
    expect(screen.queryByText("New thread") !== null).toBe(listed);
  });

  test("shows the thread attach shortcut in the dialog", () => {
    setTestHotkeyPlatform({
      platform: "Linux x86_64",
      userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
    });

    render(<KeyboardShortcutsButton />);

    fireEvent.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));

    const attachLabel = screen.getByText("Attach files or photos");
    const attachRow = attachLabel.parentElement;

    expect(attachRow).toBeTruthy();
    expect(within(attachRow as HTMLElement).getByText("Ctrl")).toBeTruthy();
    expect(within(attachRow as HTMLElement).getByText("U")).toBeTruthy();
  });

  test("shows the archive completed shortcut in the dialog", () => {
    setTestHotkeyPlatform({
      platform: "Linux x86_64",
      userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
    });

    render(<KeyboardShortcutsButton />);

    fireEvent.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));

    const archiveLabel = screen.getByText("Archive completed tasks");
    const archiveRow = archiveLabel.parentElement;

    expect(archiveRow).toBeTruthy();
    expect(within(archiveRow as HTMLElement).getByText("Ctrl")).toBeTruthy();
    expect(within(archiveRow as HTMLElement).getByText("Shift")).toBeTruthy();
    expect(within(archiveRow as HTMLElement).getByText("A")).toBeTruthy();
  });

  test("shows the global task quick open shortcut in the dialog", () => {
    setTestHotkeyPlatform({
      platform: "Linux x86_64",
      userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
    });

    render(<KeyboardShortcutsButton />);

    fireEvent.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));

    const findTaskLabel = screen.getByText("Find task");
    const findTaskRow = findTaskLabel.parentElement;

    expect(findTaskRow).toBeTruthy();
    expect(within(findTaskRow as HTMLElement).getByText("Ctrl")).toBeTruthy();
    expect(within(findTaskRow as HTMLElement).getByText("K")).toBeTruthy();
  });

  test("shows the move closed to bottom shortcut in the dialog", () => {
    setTestHotkeyPlatform({
      platform: "Linux x86_64",
      userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
    });

    render(<KeyboardShortcutsButton />);

    fireEvent.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));

    const moveLabel = screen.getByText("Move closed to bottom");
    const moveRow = moveLabel.parentElement;

    expect(moveRow).toBeTruthy();
    expect(within(moveRow as HTMLElement).getByText("Ctrl")).toBeTruthy();
    expect(within(moveRow as HTMLElement).getByText("Shift")).toBeTruthy();
    expect(within(moveRow as HTMLElement).getByText("B")).toBeTruthy();
  });

  test("shows the clear selection shortcut in the dialog", () => {
    render(<KeyboardShortcutsButton />);

    fireEvent.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));

    const clearSelectionLabel = screen.getByText("Clear selection");
    const clearSelectionRow = clearSelectionLabel.parentElement;

    expect(clearSelectionRow).toBeTruthy();
    expect(within(clearSelectionRow as HTMLElement).getByText("Escape")).toBeTruthy();
  });

  test("shows task metadata sequence shortcuts in the dialog", () => {
    render(<KeyboardShortcutsButton />);

    fireEvent.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));

    const statusLabel = screen.getByText("Set status");
    const statusRow = statusLabel.parentElement;
    const typeLabel = screen.getByText("Set task type");
    const typeRow = typeLabel.parentElement;

    expect(statusRow).toBeTruthy();
    expect(within(statusRow as HTMLElement).getByText("S")).toBeTruthy();
    expect(within(statusRow as HTMLElement).getByText("O")).toBeTruthy();
    expect(within(statusRow as HTMLElement).getByText("V")).toBeTruthy();

    expect(typeRow).toBeTruthy();
    expect(within(typeRow as HTMLElement).getAllByText("T").length).toBeGreaterThan(0);
    expect(within(typeRow as HTMLElement).getByText("F")).toBeTruthy();
    expect(within(typeRow as HTMLElement).getByText("I")).toBeTruthy();
  });

  test("shows the toggle plan mode shortcut in the dialog", () => {
    setTestHotkeyPlatform({
      platform: "MacIntel",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    });

    render(<KeyboardShortcutsButton />);

    fireEvent.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));

    const toggleLabel = screen.getByText("Toggle plan mode");
    const toggleRow = toggleLabel.parentElement;

    expect(toggleRow).toBeTruthy();
    expect(within(toggleRow as HTMLElement).getByText("Shift")).toBeTruthy();
    expect(within(toggleRow as HTMLElement).getByText("Tab")).toBeTruthy();
  });
  test("? opens the sheet, but not while typing", () => {
    render(<KeyboardShortcutsButton />);
    const input = document.body.appendChild(document.createElement("input"));

    fireEvent.keyDown(input, { key: "?", shiftKey: true });
    expect(screen.queryByText("Find task")).toBeNull();

    fireEvent.keyDown(document.body, { key: "?", shiftKey: true });
    expect(screen.getByText("Find task")).toBeTruthy();
    input.remove();
  });

  test.each(["dialog", "menu", "listbox"])("? does nothing while a %s has focus", (role) => {
    render(<KeyboardShortcutsButton />);
    const layer = document.body.appendChild(document.createElement("div"));
    layer.setAttribute("role", role);
    const button = layer.appendChild(document.createElement("button"));

    fireEvent.keyDown(button, { key: "?", shiftKey: true });

    expect(screen.queryByText("Find task")).toBeNull();
    layer.remove();
  });

  function rowOf(label: string) {
    return screen.getByText(label).parentElement as HTMLElement;
  }

  test("lists the single-key, panel, board and go-to shortcuts", () => {
    routeParams.current = { projectAlias: "WEB" };
    mockProjectRole("member");
    render(<KeyboardShortcutsButton organizationId={"org_1" as Id<"organizations">} />);
    fireEvent.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));

    expect(within(rowOf("Move up / down")).getByText("J")).toBeTruthy();
    expect(within(rowOf("Move up / down")).getByText("K")).toBeTruthy();
    for (const [label, key] of [
      ["Set priority", "P"],
      ["Set assignee", "A"],
      ["Assign to me", "I"],
      ["Set label", "L"],
      ["Set due date", "D"],
      ["Move to list", "M"],
      ["Close task panel", "Escape"],
      ["Pick up card", "Space"],
      ["Show keyboard shortcuts", "?"],
    ]) {
      expect(within(rowOf(label)).getByText(key)).toBeTruthy();
    }
    expect(within(rowOf("Next / previous task")).getByText("J")).toBeTruthy();
    for (const [label, key] of [
      ["Go to inbox", "I"],
      ["Go to Watch Tower", "W"],
      ["Go to threads", "T"],
      ["Go to settings", "S"],
    ]) {
      expect(within(rowOf(label)).getByText("G")).toBeTruthy();
      expect(within(rowOf(label)).getByText(key)).toBeTruthy();
    }
  });

  test("hides the property shortcuts from read-only viewers", () => {
    routeParams.current = { projectAlias: "WEB" };
    mockProjectRole("viewer");
    render(<KeyboardShortcutsButton organizationId={"org_1" as Id<"organizations">} />);
    fireEvent.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));

    expect(screen.queryByText("Set priority")).toBeNull();
    expect(screen.queryByText("Pick up card")).toBeNull();
    expect(screen.getByText("Next / previous task")).toBeTruthy();
  });

  test("group headers are sentence case, not all caps", () => {
    render(<KeyboardShortcutsButton />);
    fireEvent.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));

    const headers = screen.getAllByRole("heading", { level: 3 });
    expect(headers.map((header) => header.textContent)).toContain("Task properties");
    for (const header of headers) {
      expect(header.className).not.toContain("uppercase");
      const text = header.textContent ?? "";
      expect(text.slice(1)).toBe(text.slice(1).toLowerCase());
    }
  });
});

/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import { WorktreeSetupsSettingsSection } from "./worktree-setups-settings-section";

const data = vi.hoisted(() => ({ rows: [] as unknown[] | undefined, save: vi.fn(), remove: vi.fn() }));

vi.mock("convex/react", () => ({
  useQuery: () => data.rows,
  useMutation: (ref: string) => (ref === "save" ? data.save : data.remove),
}));
vi.mock("@/convex/_generated/api", () => ({
  api: { cli: { worktreeSetups: { list: "list", save: "save", remove: "remove" } } },
}));

const projectId = "project_1" as Id<"projects">;
const rows = [
  { repoKey: "acme/api", setup: null },
  {
    repoKey: "packtrain/convoy",
    setup: { _id: "setup_1", script: "pnpm i", revision: 1, updatedByName: "Ada", updatedAt: Date.now(), approvedByMe: true },
  },
];

describe("WorktreeSetupsSettingsSection", () => {
  afterEach(() => {
    cleanup();
    data.rows = [];
    data.save.mockReset();
    data.remove.mockReset();
  });

  test("renders one row per repo key", () => {
    data.rows = rows;
    render(<WorktreeSetupsSettingsSection projectId={projectId} canEdit />);

    expect(screen.getByText("acme/api")).toBeDefined();
    expect(screen.getByText("No setup script")).toBeDefined();
    expect(screen.getByText("Last edited by Ada, Just now")).toBeDefined();
  });

  test("explains where repos come from when there are none", () => {
    render(<WorktreeSetupsSettingsSection projectId={projectId} canEdit />);

    expect(screen.getByText(/connects a path with a Git origin/)).toBeDefined();
  });

  test("saves the typed script for the row's repo", async () => {
    data.rows = rows;
    data.save.mockResolvedValue("setup_2");
    render(<WorktreeSetupsSettingsSection projectId={projectId} canEdit />);

    fireEvent.click(screen.getByRole("button", { name: "Edit setup for acme/api" }));
    fireEvent.change(screen.getByLabelText("Setup script"), { target: { value: "make setup" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(data.save).toHaveBeenCalledWith({ projectId, repoKey: "acme/api", script: "make setup" }));
  });

  test("is read-only without project:update", () => {
    data.rows = rows;
    render(<WorktreeSetupsSettingsSection projectId={projectId} canEdit={false} />);

    expect(screen.getByText("Only project admins can edit setup scripts.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "View setup for packtrain/convoy" }));

    expect(screen.getByLabelText("Setup script").hasAttribute("readonly")).toBe(true);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  });

  test("lets an admin approve a script someone else changed, without editing it", async () => {
    const changed = { ...rows[1], setup: { ...rows[1].setup!, approvedByMe: false } };
    data.rows = [changed];
    data.save.mockResolvedValue("setup_1");
    render(<WorktreeSetupsSettingsSection projectId={projectId} canEdit />);

    expect(screen.getByText(/Not approved by you/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Edit setup for packtrain/convoy" }));
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => expect(data.save).toHaveBeenCalledWith({ projectId, repoKey: "packtrain/convoy", script: "pnpm i" }));
  });

  test("removes a script after confirming", async () => {
    data.rows = rows;
    data.remove.mockResolvedValue(null);
    render(<WorktreeSetupsSettingsSection projectId={projectId} canEdit />);

    fireEvent.click(screen.getByRole("button", { name: "Edit setup for packtrain/convoy" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(data.remove).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(data.remove).toHaveBeenCalledWith({ setupId: "setup_1" }));
  });

  test("announces loading once", () => {
    data.rows = undefined;
    render(<WorktreeSetupsSettingsSection projectId={projectId} canEdit />);

    expect(screen.getAllByRole("status", { name: "Loading repositories" })).toHaveLength(1);
  });
});

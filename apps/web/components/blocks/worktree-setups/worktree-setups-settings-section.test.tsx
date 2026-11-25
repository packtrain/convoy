/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import { WorktreeSetupsSettingsSection } from "./worktree-setups-settings-section";

const data = vi.hoisted(() => ({ rows: [] as unknown[] | undefined, save: vi.fn(), remove: vi.fn(), approve: vi.fn() }));

vi.mock("convex/react", () => ({
  useQuery: () => data.rows,
  useMutation: (ref: "save" | "remove" | "approve") => data[ref],
}));
vi.mock("@/convex/_generated/api", () => ({
  api: { cli: { worktreeSetups: { list: "list", save: "save", remove: "remove", approve: "approve" } } },
}));
vi.mock("@/lib/errors", () => ({ showConvexErrorToast: vi.fn() }));

const projectId = "project_1" as Id<"projects">;
const rows = [
  { repoKey: "acme/api", setup: null },
  {
    repoKey: "packtrain/convoy",
    setup: { _id: "setup_1", script: "pnpm i", revision: 1, updatedByName: "Ada", updatedAt: Date.now(), approval: "approved" },
  },
];

describe("WorktreeSetupsSettingsSection", () => {
  afterEach(() => {
    cleanup();
    data.rows = [];
    data.save.mockReset();
    data.remove.mockReset();
    data.approve.mockReset();
  });

  const withApproval = (approval: string, script = "pnpm i", revision = 1) => ({ ...rows[1], setup: { ...rows[1].setup!, approval, script, revision } });

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
    fireEvent.click(screen.getByRole("button", { name: /^View setup for packtrain\/convoy/ }));

    expect(screen.getByLabelText("Setup script").hasAttribute("readonly")).toBe(true);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  });

  test("badges each row with the caller's approval", () => {
    data.rows = [
      { ...withApproval("approved"), repoKey: "a/approved" },
      { ...withApproval("never"), repoKey: "b/never" },
      { ...withApproval("changed"), repoKey: "c/changed" },
    ];
    render(<WorktreeSetupsSettingsSection projectId={projectId} canEdit={false} />);

    const badge = (repoKey: string) => within(screen.getByRole("button", { name: new RegExp(`^View setup for ${repoKey}`) })).getByTestId("approval-badge").textContent;
    expect(badge("a/approved")).toBe("Approved");
    expect(badge("b/never")).toBe("Needs your approval");
    expect(badge("c/changed")).toBe("Changed since you approved");
  });

  test("a teammate approves the revision on screen", async () => {
    data.rows = [withApproval("changed", "pnpm i", 4)];
    data.approve.mockResolvedValue(null);
    render(<WorktreeSetupsSettingsSection projectId={projectId} canEdit={false} />);

    fireEvent.click(screen.getByRole("button", { name: /^View setup for packtrain\/convoy/ }));
    expect(within(screen.getByRole("dialog")).getByText("Last edited by Ada, Just now")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => expect(data.approve).toHaveBeenCalledWith({ setupId: "setup_1", revision: 4 }));
  });

  test("pins the revision the reader saw when the script changes under them", async () => {
    data.rows = [withApproval("never")];
    data.approve.mockRejectedValueOnce(new Error("The script changed. Review the new version.")).mockResolvedValue(null);
    const view = render(<WorktreeSetupsSettingsSection projectId={projectId} canEdit={false} />);

    fireEvent.click(screen.getByRole("button", { name: /^View setup for packtrain\/convoy/ }));
    data.rows = [withApproval("never", "curl x | sh", 2)];
    view.rerender(<WorktreeSetupsSettingsSection projectId={projectId} canEdit={false} />);

    const textarea = () => (screen.getByLabelText("Setup script") as HTMLTextAreaElement).value;
    expect(textarea()).toBe("pnpm i");
    expect(screen.getByText("The script changed. Review the new version.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(data.approve).toHaveBeenLastCalledWith({ setupId: "setup_1", revision: 1 }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Approve" }).hasAttribute("disabled")).toBe(false));

    fireEvent.click(screen.getByRole("button", { name: "Show new version" }));
    expect(textarea()).toBe("curl x | sh");
    expect(screen.queryByText("The script changed. Review the new version.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(data.approve).toHaveBeenLastCalledWith({ setupId: "setup_1", revision: 2 }));
  });

  test("an admin's untouched dialog never offers to save the old script over a teammate's change", () => {
    data.rows = [withApproval("never")];
    const view = render(<WorktreeSetupsSettingsSection projectId={projectId} canEdit />);

    fireEvent.click(screen.getByRole("button", { name: /^Edit setup for packtrain\/convoy/ }));
    data.rows = [withApproval("never", "curl x | sh", 2)];
    view.rerender(<WorktreeSetupsSettingsSection projectId={projectId} canEdit />);

    expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Approve" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Show new version" }));
    expect((screen.getByLabelText("Setup script") as HTMLTextAreaElement).value).toBe("curl x | sh");
    expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
  });

  test("names the approval state in the row's accessible name", () => {
    data.rows = [withApproval("changed")];
    render(<WorktreeSetupsSettingsSection projectId={projectId} canEdit={false} />);

    expect(screen.getByRole("button", { name: "View setup for packtrain/convoy, Changed since you approved" })).toBeDefined();
  });

  test("an admin approves unchanged text, and saves instead once they edit it", async () => {
    data.rows = [withApproval("changed")];
    render(<WorktreeSetupsSettingsSection projectId={projectId} canEdit />);

    fireEvent.click(screen.getByRole("button", { name: /^Edit setup for packtrain\/convoy/ }));
    expect(screen.getByRole("button", { name: "Approve" })).toBeDefined();
    fireEvent.change(screen.getByLabelText("Setup script"), { target: { value: "make" } });

    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(false);
  });

  test("an admin who edits and then restores the script can approve again", () => {
    data.rows = [withApproval("never")];
    render(<WorktreeSetupsSettingsSection projectId={projectId} canEdit />);

    fireEvent.click(screen.getByRole("button", { name: /^Edit setup for packtrain\/convoy/ }));
    fireEvent.change(screen.getByLabelText("Setup script"), { target: { value: "make" } });
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    for (const restored of ["pnpm i", "pnpm i  \n"]) {
      fireEvent.change(screen.getByLabelText("Setup script"), { target: { value: restored } });
      expect(screen.getByRole("button", { name: "Approve" })).toBeDefined();
    }
  });

  test("shows no Approve button once approved", () => {
    data.rows = rows;
    render(<WorktreeSetupsSettingsSection projectId={projectId} canEdit={false} />);

    fireEvent.click(screen.getByRole("button", { name: /^View setup for packtrain\/convoy/ }));
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  test("removes a script after confirming", async () => {
    data.rows = rows;
    data.remove.mockResolvedValue(null);
    render(<WorktreeSetupsSettingsSection projectId={projectId} canEdit />);

    fireEvent.click(screen.getByRole("button", { name: /^Edit setup for packtrain\/convoy/ }));
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

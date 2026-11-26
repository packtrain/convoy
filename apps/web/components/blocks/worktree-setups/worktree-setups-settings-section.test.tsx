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

    fireEvent.click(screen.getByRole("button", { name: /^acme\/api(,|$)/ }));
    fireEvent.change(screen.getByLabelText("Setup script"), { target: { value: "make setup" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(data.save).toHaveBeenCalledWith({ projectId, repoKey: "acme/api", script: "make setup", expected: null }));
  });

  test("is read-only without project:update", () => {
    data.rows = rows;
    render(<WorktreeSetupsSettingsSection projectId={projectId} canEdit={false} />);

    expect(screen.getByText("Only project admins can edit setup scripts.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /^packtrain\/convoy(,|$)/ }));

    expect(screen.getByLabelText("Setup script").hasAttribute("readonly")).toBe(true);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "packtrain/convoy actions" })).toBeNull();
  });

  test("badges each row with the caller's approval", () => {
    data.rows = [
      { ...withApproval("approved"), repoKey: "a/approved" },
      { ...withApproval("never"), repoKey: "b/never" },
      { ...withApproval("changed"), repoKey: "c/changed" },
    ];
    render(<WorktreeSetupsSettingsSection projectId={projectId} canEdit={false} />);

    const badge = (repoKey: string) => within(screen.getByRole("button", { name: new RegExp(`^${repoKey},`) })).getByTestId("approval-badge").textContent;
    expect(badge("a/approved")).toBe("Approved");
    expect(badge("b/never")).toBe("Needs your approval");
    expect(badge("c/changed")).toBe("Changed since you approved");
  });

  test("a teammate approves the revision on screen", async () => {
    data.rows = [withApproval("changed", "pnpm i", 4)];
    data.approve.mockResolvedValue(null);
    render(<WorktreeSetupsSettingsSection projectId={projectId} canEdit={false} />);

    fireEvent.click(screen.getByRole("button", { name: /^packtrain\/convoy(,|$)/ }));
    expect(within(screen.getByRole("dialog")).getByText("Last edited by Ada, Just now")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => expect(data.approve).toHaveBeenCalledWith({ setupId: "setup_1", revision: 4 }));
  });

  test("pins the version the reader saw, and approves only once they load the new one", async () => {
    data.rows = [withApproval("never")];
    data.approve.mockResolvedValue(null);
    const view = render(<WorktreeSetupsSettingsSection projectId={projectId} canEdit={false} />);

    fireEvent.click(screen.getByRole("button", { name: /^packtrain\/convoy(,|$)/ }));
    data.rows = [withApproval("never", "curl x | sh", 2)];
    view.rerender(<WorktreeSetupsSettingsSection projectId={projectId} canEdit={false} />);

    const textarea = () => (screen.getByLabelText("Setup script") as HTMLTextAreaElement).value;
    expect(textarea()).toBe("pnpm i");
    expect(screen.getByRole("status").textContent).toContain("Ada changed the script. Review the new version.");
    expect(screen.getByRole("button", { name: "Approve" }).hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Show new version" }));
    expect(textarea()).toBe("curl x | sh");
    expect(screen.queryByText(/changed the script/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(data.approve).toHaveBeenLastCalledWith({ setupId: "setup_1", revision: 2 }));
  });

  test("an admin's untouched dialog never offers to save the old script over a teammate's change", () => {
    data.rows = [withApproval("never")];
    const view = render(<WorktreeSetupsSettingsSection projectId={projectId} canEdit />);

    fireEvent.click(screen.getByRole("button", { name: /^packtrain\/convoy(,|$)/ }));
    data.rows = [withApproval("never", "curl x | sh", 2)];
    view.rerender(<WorktreeSetupsSettingsSection projectId={projectId} canEdit />);

    expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Approve" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Show new version" }));
    expect((screen.getByLabelText("Setup script") as HTMLTextAreaElement).value).toBe("curl x | sh");
    expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
  });

  test("names the row by repo and approval state, and describes it by the last edit", () => {
    data.rows = [withApproval("changed")];
    render(<WorktreeSetupsSettingsSection projectId={projectId} canEdit={false} />);

    const row = screen.getByRole("button", { name: "packtrain/convoy, Changed since you approved" });
    expect(row.getAttribute("aria-describedby") && document.getElementById(row.getAttribute("aria-describedby")!)?.textContent).toBe("Last edited by Ada, Just now");
  });

  test("an admin approves unchanged text, and saves instead once they edit it", async () => {
    data.rows = [withApproval("changed")];
    render(<WorktreeSetupsSettingsSection projectId={projectId} canEdit />);

    fireEvent.click(screen.getByRole("button", { name: /^packtrain\/convoy(,|$)/ }));
    expect(screen.getByRole("button", { name: "Approve" })).toBeDefined();
    fireEvent.change(screen.getByLabelText("Setup script"), { target: { value: "make" } });

    expect(screen.getByRole("button", { name: "Approve" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Save approves your edited version.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(false);
  });

  test("an admin who edits and then restores the script can approve again", () => {
    data.rows = [withApproval("never")];
    render(<WorktreeSetupsSettingsSection projectId={projectId} canEdit />);

    fireEvent.click(screen.getByRole("button", { name: /^packtrain\/convoy(,|$)/ }));
    fireEvent.change(screen.getByLabelText("Setup script"), { target: { value: "make" } });
    expect(screen.getByRole("button", { name: "Approve" }).hasAttribute("disabled")).toBe(true);
    for (const restored of ["pnpm i", "pnpm i  \n"]) {
      fireEvent.change(screen.getByLabelText("Setup script"), { target: { value: restored } });
      expect(screen.getByRole("button", { name: "Approve" }).hasAttribute("disabled")).toBe(false);
    }
  });

  test("shows no Approve button once approved", () => {
    data.rows = rows;
    render(<WorktreeSetupsSettingsSection projectId={projectId} canEdit={false} />);

    fireEvent.click(screen.getByRole("button", { name: /^packtrain\/convoy(,|$)/ }));
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  test("removes a script after confirming", async () => {
    data.rows = rows;
    data.remove.mockResolvedValue(null);
    render(<WorktreeSetupsSettingsSection projectId={projectId} canEdit />);

    expect(screen.queryByRole("button", { name: "acme/api actions" })).toBeNull();
    fireEvent.pointerDown(screen.getByRole("button", { name: "packtrain/convoy actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove setup script" }));
    expect(data.remove).not.toHaveBeenCalled();
    const confirm = screen.getByRole("alertdialog");
    expect(within(confirm).getByText("packtrain/convoy").className).toContain("font-mono");
    fireEvent.click(within(confirm).getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(data.remove).toHaveBeenCalledWith({ projectId, repoKey: "packtrain/convoy" }));
  });

  test("the editor scrolls inside the viewport and keeps its footer reachable", () => {
    data.rows = [withApproval("approved", Array.from({ length: 80 }, (_, line) => `echo ${line}`).join("\n"))];
    render(<WorktreeSetupsSettingsSection projectId={projectId} canEdit />);
    fireEvent.click(screen.getByRole("button", { name: /^packtrain\/convoy(,|$)/ }));

    expect(screen.getByRole("dialog").className).toMatch(/max-h-/);
    const body = screen.getByTestId("worktree-setup-dialog-body");
    expect(body.className).toContain("overflow-y-auto");
    expect(body.contains(screen.getByLabelText("Setup script"))).toBe(true);
    expect(body.contains(screen.getByRole("button", { name: "Save" }))).toBe(false);
    expect(screen.getByLabelText("Setup script").className).toContain("field-sizing-fixed");
  });

  test("a stale editor cannot save over a newer version, and the save names the revision it edited", async () => {
    data.rows = [withApproval("approved", "pnpm i", 3)];
    data.save.mockResolvedValue(null);
    const view = render(<WorktreeSetupsSettingsSection projectId={projectId} canEdit />);
    fireEvent.click(screen.getByRole("button", { name: /^packtrain\/convoy(,|$)/ }));
    fireEvent.change(screen.getByLabelText("Setup script"), { target: { value: "make" } });

    data.rows = [withApproval("never", "curl x | sh", 4)];
    view.rerender(<WorktreeSetupsSettingsSection projectId={projectId} canEdit />);
    expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);

    data.rows = [withApproval("approved", "pnpm i", 3)];
    view.rerender(<WorktreeSetupsSettingsSection projectId={projectId} canEdit />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(data.save).toHaveBeenCalledWith({ projectId, repoKey: "packtrain/convoy", script: "make", expected: { setupId: "setup_1", revision: 3 } }));
  });

  test("asks before discarding edits, and closes an untouched editor at once", () => {
    data.rows = rows;
    render(<WorktreeSetupsSettingsSection projectId={projectId} canEdit />);

    fireEvent.click(screen.getByRole("button", { name: /^acme\/api(,|$)/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^acme\/api(,|$)/ }));
    fireEvent.change(screen.getByLabelText("Setup script"), { target: { value: "make" } });
    fireEvent.keyDown(screen.getByLabelText("Setup script"), { key: "Escape" });
    const confirm = screen.getByRole("alertdialog", { name: "Discard changes?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Keep editing" }));
    expect((screen.getByLabelText("Setup script") as HTMLTextAreaElement).value).toBe("make");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Discard" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("asks before Show new version replaces edits", () => {
    data.rows = [withApproval("approved")];
    const view = render(<WorktreeSetupsSettingsSection projectId={projectId} canEdit />);
    fireEvent.click(screen.getByRole("button", { name: /^packtrain\/convoy(,|$)/ }));
    fireEvent.change(screen.getByLabelText("Setup script"), { target: { value: "make" } });
    data.rows = [withApproval("never", "curl x | sh", 2)];
    view.rerender(<WorktreeSetupsSettingsSection projectId={projectId} canEdit />);

    fireEvent.click(screen.getByRole("button", { name: "Show new version" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Discard" }));
    expect((screen.getByLabelText("Setup script") as HTMLTextAreaElement).value).toBe("curl x | sh");
  });

  test("flags a script over the length limit instead of cutting it off", () => {
    data.rows = rows;
    render(<WorktreeSetupsSettingsSection projectId={projectId} canEdit />);
    fireEvent.click(screen.getByRole("button", { name: /^acme\/api(,|$)/ }));

    const textarea = screen.getByLabelText("Setup script");
    expect(textarea.hasAttribute("maxlength")).toBe(false);
    fireEvent.change(textarea, { target: { value: "x".repeat(10_001) } });
    expect(textarea.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("1 character over the 10,000 limit")).toBeDefined();
    expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
  });

  test("returns focus to the row when the editor closes", async () => {
    data.rows = rows;
    render(<WorktreeSetupsSettingsSection projectId={projectId} canEdit />);
    const row = screen.getByRole("button", { name: /^packtrain\/convoy(,|$)/ });

    fireEvent.click(row);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(document.activeElement).toBe(row));
  });

  test("returns focus to the row on every close, the same row twice included", async () => {
    data.rows = rows;
    render(<WorktreeSetupsSettingsSection projectId={projectId} canEdit />);
    const row = screen.getByRole("button", { name: /^packtrain\/convoy(,|$)/ });

    for (let attempt = 0; attempt < 2; attempt++) {
      fireEvent.click(row);
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(document.activeElement).toBe(row));
      row.blur();
    }
  });

  test("Keep editing and a discarded draft return focus to the script", async () => {
    data.rows = [withApproval("approved")];
    const view = render(<WorktreeSetupsSettingsSection projectId={projectId} canEdit />);
    fireEvent.click(screen.getByRole("button", { name: /^packtrain\/convoy(,|$)/ }));
    const textarea = screen.getByLabelText("Setup script");
    fireEvent.change(textarea, { target: { value: "make" } });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Setup script")));

    data.rows = [withApproval("never", "curl x | sh", 2)];
    view.rerender(<WorktreeSetupsSettingsSection projectId={projectId} canEdit />);
    screen.getByLabelText("Setup script").blur();
    fireEvent.click(screen.getByRole("button", { name: "Show new version" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Setup script")));
  });

  test("a click outside an edited editor keeps the page from taking focus", async () => {
    data.rows = rows;
    render(<WorktreeSetupsSettingsSection projectId={projectId} canEdit />);
    fireEvent.click(screen.getByRole("button", { name: /^acme\/api(,|$)/ }));
    fireEvent.change(screen.getByLabelText("Setup script"), { target: { value: "make" } });

    await waitFor(() => expect(fireEvent.pointerDown(document.body)).toBe(false));
    expect(screen.getByRole("alertdialog", { name: "Discard changes?" })).toBeDefined();
  });

  test("says so when a teammate removes the script under the editor, and lets the editor save it again", async () => {
    data.rows = [withApproval("approved")];
    data.save.mockResolvedValue(null);
    const view = render(<WorktreeSetupsSettingsSection projectId={projectId} canEdit />);
    fireEvent.click(screen.getByRole("button", { name: /^packtrain\/convoy(,|$)/ }));
    fireEvent.change(screen.getByLabelText("Setup script"), { target: { value: "make" } });

    data.rows = [{ repoKey: "packtrain/convoy", setup: null }];
    view.rerender(<WorktreeSetupsSettingsSection projectId={projectId} canEdit />);
    expect(screen.getByRole("status").textContent).toContain("This script was removed.");
    expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Keep my edits" }));
    expect((screen.getByLabelText("Setup script") as HTMLTextAreaElement).value).toBe("make");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(data.save).toHaveBeenCalledWith({ projectId, repoKey: "packtrain/convoy", script: "make", expected: null }));
  });

  test("keeps the editor and its draft when the repo leaves the list, the last row included", () => {
    for (const others of [[rows[0]], []]) {
      data.rows = [...others, withApproval("approved")];
      const view = render(<WorktreeSetupsSettingsSection projectId={projectId} canEdit />);
      fireEvent.click(screen.getByRole("button", { name: /^packtrain\/convoy(,|$)/ }));
      fireEvent.change(screen.getByLabelText("Setup script"), { target: { value: "make" } });

      data.rows = others;
      view.rerender(<WorktreeSetupsSettingsSection projectId={projectId} canEdit />);
      expect((screen.getByLabelText("Setup script") as HTMLTextAreaElement).value).toBe("make");
      expect(screen.getByRole("status").textContent).toContain("This script was removed.");
      cleanup();
    }
  });

  test("treats a recreated setup with the same revision as a new version", () => {
    data.rows = [withApproval("approved")];
    const view = render(<WorktreeSetupsSettingsSection projectId={projectId} canEdit />);
    fireEvent.click(screen.getByRole("button", { name: /^packtrain\/convoy(,|$)/ }));
    fireEvent.change(screen.getByLabelText("Setup script"), { target: { value: "make" } });

    data.rows = [{ ...rows[1], setup: { ...rows[1].setup!, _id: "setup_2", script: "teammate" } }];
    view.rerender(<WorktreeSetupsSettingsSection projectId={projectId} canEdit />);
    expect(screen.getByRole("button", { name: "Show new version" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
  });

  test("whitespace-only edits neither block Approve nor hide the approval line", () => {
    data.rows = [{ ...withApproval("never"), repoKey: "b/never" }, withApproval("approved")];
    render(<WorktreeSetupsSettingsSection projectId={projectId} canEdit />);

    fireEvent.click(screen.getByRole("button", { name: /^b\/never(,|$)/ }));
    fireEvent.change(screen.getByLabelText("Setup script"), { target: { value: "pnpm i\n" } });
    expect(screen.queryByText("Save approves your edited version.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Discard" }));

    fireEvent.click(screen.getByRole("button", { name: /^packtrain\/convoy(,|$)/ }));
    fireEvent.change(screen.getByLabelText("Setup script"), { target: { value: "make" } });
    expect(within(screen.getByRole("dialog")).queryByText("Approved by you")).toBeNull();
  });

  test("returns focus to the row after the Remove confirm closes", async () => {
    data.rows = rows;
    render(<WorktreeSetupsSettingsSection projectId={projectId} canEdit />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "packtrain/convoy actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove setup script" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: /^packtrain\/convoy(,|$)/ })));
  });

  test("the dialog states the approval rule and the caller's approval", () => {
    data.rows = [{ ...withApproval("never"), repoKey: "b/never" }, withApproval("approved")];
    render(<WorktreeSetupsSettingsSection projectId={projectId} canEdit={false} />);

    fireEvent.click(screen.getByRole("button", { name: /^b\/never(,|$)/ }));
    expect(screen.getByText(/Each teammate's CLIs run it only after they approve the current version/)).toBeDefined();
    expect(screen.getByText("Ada saved this script. Your CLIs won't run it until you approve it.")).toBeDefined();
    fireEvent.click(within(screen.getByRole("dialog")).getByText("Close", { selector: "button" }));

    fireEvent.click(screen.getByRole("button", { name: /^packtrain\/convoy(,|$)/ }));
    expect(within(screen.getByRole("dialog")).getByText("Approved by you")).toBeDefined();
  });

  test("labels the placeholder as an example", () => {
    data.rows = rows;
    render(<WorktreeSetupsSettingsSection projectId={projectId} canEdit />);
    fireEvent.click(screen.getByRole("button", { name: /^acme\/api(,|$)/ }));

    expect(screen.getByLabelText("Setup script").getAttribute("placeholder")).toMatch(/^# Example/);
  });

  test("announces loading once", () => {
    data.rows = undefined;
    render(<WorktreeSetupsSettingsSection projectId={projectId} canEdit />);

    expect(screen.getAllByRole("status", { name: "Loading repositories" })).toHaveLength(1);
  });
});

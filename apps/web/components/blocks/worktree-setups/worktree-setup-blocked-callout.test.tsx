/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi, type Mock } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { WorktreeSetupBlockedCallout } from "./worktree-setup-blocked-callout";

const data = vi.hoisted(() => ({ rows: undefined as unknown[] | undefined, listArgs: [] as unknown[], approve: vi.fn() }));

vi.mock("convex/react", () => ({
  useQuery: (_ref: unknown, args: unknown) => {
    data.listArgs.push(args);
    return data.rows;
  },
  useMutation: (ref: string) => (ref === "approve" ? data.approve : vi.fn()),
}));
vi.mock("@/convex/_generated/api", () => ({
  api: { cli: { worktreeSetups: { list: "list", save: "save", remove: "remove", approve: "approve" } } },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const projectId = "project_1" as Id<"projects">;
const setupRow = (approval: string) => ({
  repoKey: "packtrain/convoy",
  setup: { _id: "setup_1", script: "cp .mcp.json .\npnpm i", revision: 3, updatedByName: "Ada", updatedAt: Date.now(), approval },
});

function renderCallout(overrides: { onRetryWithoutConfirm?: Mock<() => Promise<void>>; isRetrying?: boolean } = {}) {
  const props = {
    projectId,
    repoKey: "packtrain/convoy",
    onRetry: vi.fn(),
    onRetryWithoutConfirm: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    isRetrying: false,
    ...overrides,
  };
  render(<WorktreeSetupBlockedCallout {...props} />);
  return props;
}

describe("WorktreeSetupBlockedCallout", () => {
  afterEach(() => {
    cleanup();
    data.rows = undefined;
    data.listArgs = [];
    data.approve.mockReset();
    vi.mocked(toast.error).mockReset();
  });

  test("names the repo and offers Review script, with no way to approve unread", () => {
    renderCallout();

    // Past tense: still true once the script is approved elsewhere.
    expect(screen.getByRole("alert").textContent).toContain("Run stopped for setup script approval");
    expect(screen.getByRole("alert").textContent).toContain("The setup script for packtrain/convoy wasn't approved when this run started");
    expect(screen.getByRole("button", { name: "Review script" })).toBeDefined();
    expect(screen.queryByRole("button", { name: /Approve/ })).toBeNull();
    // The setups list is read only once the reader asks for the script.
    expect(data.listArgs.every((args) => args === "skip")).toBe(true);
  });

  test("Review script opens the exact script read-only, and Approve and retry approves that revision, then retries", async () => {
    data.rows = [setupRow("never")];
    data.approve.mockResolvedValue(null);
    const props = renderCallout();

    fireEvent.click(screen.getByRole("button", { name: "Review script" }));
    const script = screen.getByLabelText("Setup script") as HTMLTextAreaElement;
    expect(script.value).toBe("cp .mcp.json .\npnpm i");
    expect(script.hasAttribute("readonly")).toBe(true);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Approve and retry" }));

    await waitFor(() => expect(props.onRetryWithoutConfirm).toHaveBeenCalledTimes(1));
    expect(data.approve).toHaveBeenCalledWith({ setupId: "setup_1", revision: 3 });
    expect(data.approve.mock.invocationCallOrder[0]).toBeLessThan(props.onRetryWithoutConfirm.mock.invocationCallOrder[0]);
    await waitFor(() => expect(screen.queryByLabelText("Setup script")).toBeNull());
  });

  test("a failed approval does not retry", async () => {
    data.rows = [setupRow("changed")];
    data.approve.mockRejectedValue(new Error("The script changed. Review the new version."));
    const props = renderCallout();

    fireEvent.click(screen.getByRole("button", { name: "Review script" }));
    fireEvent.click(screen.getByRole("button", { name: "Approve and retry" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Failed to approve the setup script"));
    expect(props.onRetryWithoutConfirm).not.toHaveBeenCalled();
  });

  test("Review script shows it is loading until the script arrives", () => {
    renderCallout();

    fireEvent.click(screen.getByRole("button", { name: "Review script" }));

    const button = screen.getByRole("button", { name: "Review script" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
  });

  test("a failed retry after approving says the approval went through", async () => {
    data.rows = [setupRow("never")];
    data.approve.mockResolvedValue(null);
    renderCallout({ onRetryWithoutConfirm: vi.fn<() => Promise<void>>().mockRejectedValue(new Error("busy")) });

    fireEvent.click(screen.getByRole("button", { name: "Review script" }));
    fireEvent.click(screen.getByRole("button", { name: "Approve and retry" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Approved, but the retry failed", { description: "Press Retry to try again." })
    );
  });

  test("Retry stays available for a script approved elsewhere", () => {
    const props = renderCallout();

    fireEvent.click(screen.getByRole("button", { name: /^Retry/ }));

    expect(props.onRetry).toHaveBeenCalledTimes(1);
  });

  test("opens on the script, so Enter cannot approve it unread", () => {
    data.rows = [setupRow("never")];
    renderCallout();

    fireEvent.click(screen.getByRole("button", { name: "Review script" }));

    expect(document.activeElement).toBe(screen.getByLabelText("Setup script"));
  });

  test("an already approved script offers Retry in the dialog, with no second confirm", async () => {
    data.rows = [setupRow("approved")];
    const props = renderCallout();

    fireEvent.click(screen.getByRole("button", { name: "Review script" }));
    expect(screen.queryByRole("button", { name: "Approve and retry" })).toBeNull();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(props.onRetryWithoutConfirm).toHaveBeenCalledTimes(1));
    expect(data.approve).not.toHaveBeenCalled();
    expect(props.onRetry).not.toHaveBeenCalled();
  });

  test("a script removed since the run failed says so and offers Retry", () => {
    data.rows = [];
    renderCallout();

    fireEvent.click(screen.getByRole("button", { name: "Review script" }));

    expect(screen.getByText("No setup script is saved for this repo.")).toBeDefined();
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Retry" })).toBeDefined();
  });

  test("a failed plain retry does not claim an approval", async () => {
    data.rows = [setupRow("approved")];
    renderCallout({ onRetryWithoutConfirm: vi.fn<() => Promise<void>>().mockRejectedValue(new Error("busy")) });

    fireEvent.click(screen.getByRole("button", { name: "Review script" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Couldn't retry the run", { description: "Press Retry to try again." }));
  });

  test("Retry is disabled while a retry is in flight", () => {
    renderCallout({ isRetrying: true });

    expect((screen.getByRole("button", { name: /^Retry/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("the dialog's actions are disabled while a retry is in flight, so reopening it cannot send a second", () => {
    data.rows = [setupRow("approved"), { ...setupRow("never"), repoKey: "acme/web" }];
    renderCallout({ isRetrying: true });

    fireEvent.click(screen.getByRole("button", { name: "Review script" }));

    expect((within(screen.getByRole("dialog")).getByRole("button", { name: "Retry" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("Approve and retry is disabled while a retry is in flight", () => {
    data.rows = [setupRow("never")];
    renderCallout({ isRetrying: true });

    fireEvent.click(screen.getByRole("button", { name: "Review script" }));

    expect((screen.getByRole("button", { name: "Approve and retry" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

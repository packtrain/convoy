/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { RenameProfileDialog } from "./rename-profile-dialog";

const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    open,
    children,
  }: {
    open: boolean;
    children: ReactNode;
  }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

describe("RenameProfileDialog", () => {
  afterEach(() => {
    cleanup();
    toastSuccess.mockClear();
    toastError.mockClear();
  });

  test("prefills and resets input when reopened", () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    const profileId = "profile_1" as Id<"cliProfiles">;
    const { rerender } = render(
      <RenameProfileDialog
        open
        onOpenChange={onOpenChange}
        profileId={profileId}
        currentName="Original profile"
        hostname="machine-a"
        profileKey="os-local"
        onRename={onRename}
      />
    );

    const input = screen.getByLabelText("Name");
    expect((input as HTMLInputElement).value).toBe("Original profile");
    fireEvent.change(input, { target: { value: "Temporary value" } });
    expect((input as HTMLInputElement).value).toBe("Temporary value");

    rerender(
      <RenameProfileDialog
        open={false}
        onOpenChange={onOpenChange}
        profileId={profileId}
        currentName="Original profile"
        hostname="machine-a"
        profileKey="os-local"
        onRename={onRename}
      />
    );

    rerender(
      <RenameProfileDialog
        open
        onOpenChange={onOpenChange}
        profileId={profileId}
        currentName="Updated source name"
        hostname="machine-a"
        profileKey="os-local"
        onRename={onRename}
      />
    );

    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
      "Updated source name"
    );
  });

  test("allows submitting empty input", async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    const profileId = "profile_1" as Id<"cliProfiles">;

    render(
      <RenameProfileDialog
        open
        onOpenChange={onOpenChange}
        profileId={profileId}
        currentName="Original profile"
        hostname="machine-a"
        profileKey="os-local"
        onRename={onRename}
      />
    );

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await vi.waitFor(() =>
      expect(onRename).toHaveBeenCalledWith(profileId, "   ")
    );
    expect(toastSuccess).toHaveBeenCalledWith("Profile renamed");
  });

  test("uses profile key fallback text when hostname is unavailable", () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    const profileId = "profile_1" as Id<"cliProfiles">;

    render(
      <RenameProfileDialog
        open
        onOpenChange={onOpenChange}
        profileId={profileId}
        currentName="Original profile"
        profileKey="os-local"
        onRename={onRename}
      />
    );

    expect(screen.getByText("Leave empty to reset to profile key (os-local).")).toBeDefined();
  });

  test("uses direct prompt when fallback fields are unavailable", () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    const profileId = "profile_1" as Id<"cliProfiles">;

    render(
      <RenameProfileDialog
        open
        onOpenChange={onOpenChange}
        profileId={profileId}
        currentName="Original profile"
        onRename={onRename}
      />
    );

    expect(screen.getByText("Enter a name for this profile.")).toBeDefined();
  });

  test("shows error toast and keeps dialog open when save fails", async () => {
    const onRename = vi.fn().mockRejectedValue(new Error("Rename failed"));
    const onOpenChange = vi.fn();
    const profileId = "profile_1" as Id<"cliProfiles">;

    render(
      <RenameProfileDialog
        open
        onOpenChange={onOpenChange}
        profileId={profileId}
        currentName="Original profile"
        hostname="machine-a"
        profileKey="os-local"
        onRename={onRename}
      />
    );

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Renamed profile" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await vi.waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Rename failed")
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});

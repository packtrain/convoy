/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DEV_SETTINGS } from "@/lib/dev-mode/constants";
import { UserSettingsDialog } from "./user-settings-dialog";

const useQueryMock = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: () => ({ withOptimisticUpdate: () => vi.fn() }),
}));

vi.mock("./general-section", () => ({
  GeneralSection: () => <div>General content</div>,
}));

vi.mock("./api-keys", () => ({
  ApiKeysSection: () => <div>API keys content</div>,
}));

vi.mock("./profiles-section", () => ({
  ProfilesSection: () => <div>Profiles content</div>,
}));

// The real field renders a PatchDiff (shadow DOM + Shiki), out of scope here.
vi.mock("./code-diff-theme-field", () => ({
  CodeDiffThemeField: () => <div>Code diff theme field</div>,
}));

describe("UserSettingsDialog", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useQueryMock.mockReset();
    useQueryMock.mockReturnValue({
      buildId: "backend-build-123456",
      buildTime: "2026-05-31T12:00:00.000Z",
      gitRef: "main",
      vercelEnvironment: "production",
    });
  });

  test("shows the Developer section in the sidebar", () => {
    render(
      <UserSettingsDialog
        open
        onOpenChange={vi.fn()}
        section="general"
        onSectionChange={vi.fn()}
      />
    );

    expect(
      (screen.getByRole("button", { name: "Developer" }) as HTMLButtonElement)
        .disabled
    ).toBe(false);
  });

  test("hides the unfinished Account and Danger Zone sections", () => {
    render(
      <UserSettingsDialog
        open
        onOpenChange={vi.fn()}
        section="general"
        onSectionChange={vi.fn()}
      />
    );

    expect(screen.queryByRole("button", { name: "Account" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Danger zone" })).toBeNull();
  });

  test("shows the Profiles section and renders it when active", () => {
    const { rerender } = render(
      <UserSettingsDialog open onOpenChange={vi.fn()} section="general" onSectionChange={vi.fn()} />
    );

    expect((screen.getByRole("button", { name: "CLI profiles" }) as HTMLButtonElement).disabled).toBe(false);

    rerender(<UserSettingsDialog open onOpenChange={vi.fn()} section="profiles" onSectionChange={vi.fn()} />);
    expect(screen.getByText("Profiles content")).toBeDefined();
  });

  test("renders the Appearance section with both theme controls (OS-1684)", () => {
    const { rerender } = render(
      <UserSettingsDialog open onOpenChange={vi.fn()} section="general" onSectionChange={vi.fn()} />
    );

    expect(
      (screen.getByRole("button", { name: "Appearance" }) as HTMLButtonElement).disabled
    ).toBe(false);

    rerender(
      <UserSettingsDialog open onOpenChange={vi.fn()} section="appearance" onSectionChange={vi.fn()} />
    );

    expect(screen.getByRole("heading", { name: "Appearance" })).toBeDefined();
    expect(screen.getByText("Code diff theme field")).toBeDefined();
    // The app theme picker moved here out of General.
    expect(screen.getByRole("button", { name: /System/ })).toBeDefined();
  });

  test("renders developer settings content when the section is active", () => {
    render(
      <UserSettingsDialog
        open
        onOpenChange={vi.fn()}
        section="developer"
        onSectionChange={vi.fn()}
      />
    );

    expect(screen.getByRole("heading", { name: "Developer" })).toBeDefined();
    expect(screen.getByText("App versions")).toBeDefined();
    expect(screen.getByText("Frontend")).toBeDefined();
    expect(screen.getByText("Backend")).toBeDefined();
    expect(screen.getAllByText("backend-buil").length).toBeGreaterThan(0);
    expect(screen.getByTitle("backend-build-123456")).toBeDefined();
    expect(screen.getByText("Build time")).toBeDefined();

    fireEvent.click(
      screen.getByRole("button", { name: "Backend version details" })
    );

    expect(
      screen.getByRole("table", { name: "Backend version metadata" })
    ).toBeDefined();
    expect(screen.getByText("backend-build-123456")).toBeDefined();
    expect(screen.getByText("main")).toBeDefined();
    expect(screen.getByText("production")).toBeDefined();
    expect(
      screen.getByRole("switch", {
        name: "Toggle Task list: Show rank",
      }).getAttribute("aria-checked")
    ).toBe("false");
    expect(
      screen.queryByRole("switch", {
        name: "Toggle Add task microphone",
      })
    ).toBeNull();
  });

  test("updates the task-list rank setting when toggled", async () => {
    render(
      <UserSettingsDialog
        open
        onOpenChange={vi.fn()}
        section="developer"
        onSectionChange={vi.fn()}
      />
    );

    const rankSwitch = screen.getByRole("switch", {
      name: "Toggle Task list: Show rank",
    });

    fireEvent.click(rankSwitch);

    await waitFor(() => {
      expect(
        window.localStorage.getItem(DEV_SETTINGS.taskListShowRank.storageKey)
      ).toBe("1");
      expect(rankSwitch.getAttribute("aria-checked")).toBe("true");
    });
  });

});

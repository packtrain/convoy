/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import { INTERACTIVE_CONNECT_COMMAND } from "@/lib/threads/setup-commands";
import { ProfilesSection } from "./profiles-section";
import { expectEmptyState } from "@/test-utils/empty-state";

const queryState = vi.hoisted(() => ({ value: undefined as unknown }));

vi.mock("convex/react", () => ({
  useQuery: () => queryState.value,
  useMutation: () => vi.fn(),
}));

vi.mock("@/components/blocks/thread/rename-profile-dialog", () => ({
  RenameProfileDialog: () => null,
}));

vi.mock("@/components/blocks/cli/profiles/delete-profile-dialog", () => ({
  DeleteProfileDialog: () => null,
}));

const profile = {
  _id: "profile-1" as Id<"cliProfiles">,
  name: "Local Dev",
  profileKey: "os-local",
  hostname: "workstation.local",
  paths: [
    { id: "path-1", label: "workspace", path: "/workspace" },
    { id: "path-2", label: "feature", path: "/workspace-feature", kind: "worktree" as const },
  ],
  createdAt: new Date("2026-07-10T10:00:00Z").getTime(),
  lastConnectedAt: new Date("2026-07-14T10:00:00Z").getTime(),
  isOnline: false,
  runtimes: [{ type: "codex", version: "0.9.0" }],
  project: {
    _id: "project-1" as Id<"projects">,
    name: "Contoso",
    alias: "OS",
    isArchived: false,
  },
  organization: {
    _id: "org-1" as Id<"organizations">,
    name: "Acme",
    slug: "acme",
  },
};

describe("ProfilesSection", () => {
  afterEach(cleanup);

  beforeEach(() => {
    queryState.value = undefined;
  });

  test("renders loading and empty states", () => {
    const { rerender } = render(<ProfilesSection />);
    expect(screen.getByLabelText("Loading profiles")).toBeDefined();

    queryState.value = [];
    rerender(<ProfilesSection />);
    expect(screen.getByText("No CLI profiles")).toBeDefined();
  });

  test("the empty state is the shared unframed pattern", () => {
    queryState.value = [];
    const { container } = render(<ProfilesSection />);
    expectEmptyState("No CLI profiles", { boundary: container.firstElementChild as HTMLElement });
  });

  test("shows the same primary connect command as the thread setup screen", () => {
    queryState.value = [];
    render(<ProfilesSection />);

    expect(screen.getByText(INTERACTIVE_CONNECT_COMMAND)).toBeDefined();
    expect(screen.getByRole("button", { name: "Copy command" })).toBeDefined();
  });

  test("shows the backend URL next to the connect command", () => {
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://example-123.convex.cloud");
    queryState.value = [];
    render(<ProfilesSection />);

    expect(screen.getByText("https://example-123.convex.cloud")).toBeDefined();
    expect(screen.getByRole("button", { name: "Copy backend URL" })).toBeDefined();
    vi.unstubAllEnvs();
  });

  test("groups profiles by organization and project and expands read-only details", () => {
    queryState.value = [profile];
    render(<ProfilesSection />);

    expect(screen.getByText("Acme")).toBeDefined();
    expect(screen.getByText("Contoso")).toBeDefined();
    expect(screen.getByText("OS")).toBeDefined();
    expect(screen.getByLabelText("Disconnected")).toBeDefined();
    expect(screen.getByText(/workstation\.local · Last seen/)).toBeDefined();
    expect(screen.queryByText(/directory/)).toBeNull();
    expect(screen.queryByText("Codex")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show details for Local Dev" }));
    expect(screen.getByText("workstation.local")).toBeDefined();
    expect(screen.getByText("/workspace")).toBeDefined();
    expect(screen.getByText("Codex")).toBeDefined();
  });

  test("puts profiles without accessible location metadata in the unavailable group", () => {
    queryState.value = [{ ...profile, project: undefined, organization: undefined }];
    render(<ProfilesSection />);

    expect(screen.getByText("Unavailable profiles")).toBeDefined();
    expect(screen.getByText("Unavailable project")).toBeDefined();
    expect(screen.getByText("Local Dev")).toBeDefined();
  });
});

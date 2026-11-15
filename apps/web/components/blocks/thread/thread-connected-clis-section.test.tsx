/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import { CONNECTED_CLIS_SECTION_STORAGE_KEY } from "@/lib/threads/section-collapsed";
import { ThreadConnectedClisSection } from "./thread-connected-clis-section";

const useQueryMock = vi.fn();
const useCliProfilesMock = vi.fn();
const toastSuccessMock = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: (...args: unknown[]) => toastSuccessMock(...args) },
}));

vi.mock("@/lib/threads/hooks/use-cli-profiles", () => ({
  useCliProfiles: (...args: unknown[]) => useCliProfilesMock(...args),
}));

vi.mock("@/components/blocks/project/agent-list-item", () => ({
  AgentAvatar: ({ agent }: { agent: { userName: string } }) => <span data-testid="agent-avatar">{agent.userName}</span>,
  AgentListItem: ({
    agent,
    onClick,
    profileDetails,
  }: {
    agent: { name: string };
    onClick: () => void;
    profileDetails?: { name: string };
  }) => (
    <button type="button" onClick={onClick} data-profile-details={profileDetails?.name}>
      {agent.name}
    </button>
  ),
}));

function session(overrides: Record<string, unknown>) {
  return {
    sessionId: "session_1",
    profileId: "profile_online",
    name: "Online Agent",
    paths: [{ id: "path_online", path: "/tmp/online" }],
    isOnline: true,
    availableClis: [],
    userName: "User",
    instanceId: "instance_1",
    lastHeartbeatAt: Date.now(),
    ...overrides,
  };
}

function renderSection() {
  return render(
    <ThreadConnectedClisSection
      projectId={"project_1" as Id<"projects">}
      projectName="Project Alpha"
      organizationSlug="org"
      projectAlias="ABC"
      compactLayout={false}
    />
  );
}

describe("ThreadConnectedClisSection", () => {
  beforeEach(() => {
    window.localStorage.clear();
    // Start expanded; the default-collapsed test clears this.
    window.localStorage.setItem(CONNECTED_CLIS_SECTION_STORAGE_KEY, "0");
    useQueryMock.mockReset();
    toastSuccessMock.mockReset();
    useCliProfilesMock.mockReturnValue({
      profiles: [{ _id: "profile_online", name: "Online profile", isOnline: true, paths: [], availableClis: [] }],
    });
  });

  afterEach(() => {
    cleanup();
  });

  test("lists only online CLIs, sorted, with hover-card profile details", () => {
    useQueryMock.mockReturnValue([
      session({ sessionId: "s_b", name: "Beta" }),
      session({ sessionId: "s_off", name: "Offline", isOnline: false }),
      session({ sessionId: "s_a", name: "Alpha" }),
    ]);

    renderSection();

    const rows = [screen.getByText("Alpha"), screen.getByText("Beta")];
    expect(screen.queryByText("Offline")).toBeNull();
    expect(rows[0].compareDocumentPosition(rows[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(rows[0].getAttribute("data-profile-details")).toBe("Online profile");
  });

  test("clicking the CLI row toggles its checkouts, same as the chevron", () => {
    useQueryMock.mockReturnValue([session({})]);

    renderSection();
    expect(screen.getByRole("button", { name: "Show checkouts" })).toBeDefined();

    fireEvent.click(screen.getByText("Online Agent"));

    expect(screen.getByRole("button", { name: "Hide checkouts" })).toBeDefined();
  });

  test("wraps rows in a zero-min-content grid track so long names can't widen the sidebar", () => {
    useQueryMock.mockReturnValue([session({})]);

    renderSection();

    // The ScrollArea viewport is display:table and grows to its content's min-content width.
    // The row shares its track with the checkouts toggle (OS-2036).
    expect(screen.getByText("Online Agent").parentElement?.className).toContain("grid-cols-[auto_minmax(0,1fr)]");
  });

  test("renders nothing while sessions load", () => {
    useQueryMock.mockReturnValue(undefined);

    const { container } = renderSection();

    expect(container.textContent).toBe("");
  });

  test("is collapsed by default and persists expanding", () => {
    window.localStorage.clear();
    useQueryMock.mockReturnValue([session({})]);

    renderSection();
    expect(screen.queryByText("Online Agent")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Connected CLIs/ }));

    expect(screen.getByText("Online Agent")).toBeDefined();
    expect(window.localStorage.getItem(CONNECTED_CLIS_SECTION_STORAGE_KEY)).toBe("0");
  });

  test("offers the connect command when profiles exist but none are online", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    useQueryMock.mockReturnValue([session({ isOnline: false })]);

    renderSection();
    expect(screen.getByText(/No connected CLIs/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Copy connect command" }));

    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("npx @useconvoy/cli connect"));
    expect(toastSuccessMock).toHaveBeenCalledWith("Connect command copied to clipboard");
  });

  test("offers the setup command when the project has no profiles", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    useQueryMock.mockReturnValue([]);
    useCliProfilesMock.mockReturnValue({ profiles: [] });

    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Copy setup command" }));

    await vi.waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        "npx @useconvoy/cli setup --project project_1 --profile 'Project Alpha' --profile-key abc --url <convex_url>"
      )
    );
  });
});

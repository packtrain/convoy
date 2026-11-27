/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import { CONNECTED_CLIS_SECTION_STORAGE_KEY } from "@/lib/threads/section-collapsed";
import { formatAbsoluteTime } from "@/lib/format-relative-time";
import { ThreadConnectedClisSection } from "./thread-connected-clis-section";

const useQueryMock = vi.fn();
const useCliProfilesMock = vi.fn();
const toastSuccessMock = vi.fn();
const removeProfileMock = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: () => removeProfileMock,
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

function profile(overrides: Record<string, unknown>) {
  return { _id: "profile_1", name: "Profile", profileKey: "key", isOnline: false, paths: [], availableClis: [], lastConnectedAt: Date.now() - 3 * 3600000, ...overrides };
}

/** Sessions for `listByProject`, the signed-in user for `users.core.current` (no args). */
function sessionsOr(sessions: unknown[]) {
  return (_ref: unknown, args?: unknown) =>
    typeof args === "object" && args !== null && "projectId" in args ? sessions : { name: "Gecko Zero", avatarUrl: undefined };
}

function openActions(profileName: string) {
  fireEvent.pointerDown(screen.getByRole("button", { name: `Actions for ${profileName}` }), { button: 0, ctrlKey: false });
}

function renderSection({ compactLayout = false }: { compactLayout?: boolean } = {}) {
  return render(
    <ThreadConnectedClisSection
      projectId={"project_1" as Id<"projects">}
      projectName="Project Alpha"
      organizationSlug="org"
      projectAlias="ABC"
      compactLayout={compactLayout}
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

  test("lists offline profiles that copy their own connect command when none are online", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    useQueryMock.mockImplementation(sessionsOr([session({ isOnline: false })]));
    useCliProfilesMock.mockReturnValue({
      profiles: [
        profile({ _id: "p_mac", name: "MacBook Pro", profileKey: "mac" }),
        profile({ _id: "p_dev", name: "devbox", profileKey: "dev" }),
      ],
    });

    renderSection();
    const rows = [screen.getByText("devbox"), screen.getByText("MacBook Pro")];
    expect(rows[0].compareDocumentPosition(rows[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByText("Offline")).toHaveLength(2);
    expect(screen.queryByText(/No connected CLIs/)).toBeNull();

    openActions("MacBook Pro");
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy connect command" }));

    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("npx @useconvoy/cli connect --profile mac"));
    expect(toastSuccessMock).toHaveBeenCalledWith("Connect command copied to clipboard");
  });

  test("lists offline profiles below the online CLIs", () => {
    useQueryMock.mockImplementation(sessionsOr([session({ profileId: "profile_online", name: "Online Agent" })]));
    useCliProfilesMock.mockReturnValue({
      profiles: [profile({ _id: "profile_online", name: "Online profile", isOnline: true }), profile({ _id: "p_sandbox", name: "Sandbox" })],
    });

    renderSection();

    const online = screen.getByText("Online Agent");
    const offline = screen.getByRole("group", { name: "Sandbox" });
    expect(online.compareDocumentPosition(offline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Online profile" })).toBeNull();
  });

  test("offline row keeps the online row's layout: actions on the title line, time under them", () => {
    useQueryMock.mockImplementation(sessionsOr([]));
    useCliProfilesMock.mockReturnValue({ profiles: [profile({ name: "MacBook Pro" })] });

    renderSection();

    const titleLine = screen.getByText("MacBook Pro").parentElement!;
    expect(titleLine.contains(screen.getByRole("button", { name: "Actions for MacBook Pro" }))).toBe(true);
    expect(screen.getByText("3h").parentElement?.textContent).toBe("Offline3h");
  });

  test("offline row shows an old last connection as days, with the date in its title", () => {
    const lastConnectedAt = Date.now() - 29 * 86400000;
    useQueryMock.mockImplementation(sessionsOr([]));
    useCliProfilesMock.mockReturnValue({ profiles: [profile({ name: "MacBook Pro", lastConnectedAt })] });

    renderSection();

    expect(screen.getByText("29d").getAttribute("title")).toBe(`Last connected ${formatAbsoluteTime(lastConnectedAt)}`);
  });

  test("Delete profile in the actions menu confirms, then removes the profile", async () => {
    removeProfileMock.mockResolvedValue(null);
    useQueryMock.mockImplementation(sessionsOr([]));
    useCliProfilesMock.mockReturnValue({ profiles: [profile({ _id: "p_mac", name: "MacBook Pro" })] });

    renderSection();
    openActions("MacBook Pro");
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete profile" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete profile" }));

    await vi.waitFor(() => expect(removeProfileMock).toHaveBeenCalledWith({ profileId: "p_mac" }));
  });

  test.each([
    { compactLayout: false, rounded: true },
    { compactLayout: true, rounded: false },
  ])("offline rows are rounded only outside compact layout (compact=$compactLayout)", ({ compactLayout, rounded }) => {
    useQueryMock.mockImplementation(sessionsOr([]));
    useCliProfilesMock.mockReturnValue({ profiles: [profile({ name: "MacBook Pro" })] });

    renderSection({ compactLayout });

    // The row owns hover and rounding, like the online CLI row in WorktreeList.
    const row = screen.getByRole("group", { name: "MacBook Pro" });
    expect(row.className.includes("rounded-lg")).toBe(rounded);
    expect(row.parentElement?.className.includes("px-2")).toBe(rounded);
  });

  test("offers the setup command when the project has no profiles", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    useQueryMock.mockImplementation(sessionsOr([]));
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

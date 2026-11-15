/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { getFunctionName, type FunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "@/convex/_generated/api";
import { NEW_THREAD_HOTKEY } from "@/lib/browser/hotkeys";
import type { ProjectRole } from "@/lib/authz/roles";
import { withProjectRole } from "@/test-utils/project-role";
import ThreadLayout from "./layout";

const useQueryMock = vi.fn();
const replaceMock = vi.fn();
const hotkeyOptions = new Map<string, { enabled?: boolean } | undefined>();

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

vi.mock("@tanstack/react-hotkeys", () => ({
  useHotkey: (hotkey: string, _callback: unknown, options?: { enabled?: boolean }) => {
    hotkeyOptions.set(hotkey, options);
  },
}));

vi.mock("@/lib/auth/hooks", () => ({
  useAppAuth: () => ({ isLoaded: true, isSignedIn: true, userId: "user-1" }),
  useAppConvexAuth: () => ({ isLoading: false, isAuthenticated: true }),
}));

vi.mock("@/lib/navigation", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("@/lib/navigation");
  return {
    ...actual,
    useNavigation: () => ({
      location: { pathname: "/o/acme/WEB/threads", search: "", hash: "" },
      push: vi.fn(),
      replace: replaceMock,
    }),
    useRouteParams: () => ({}),
  };
});

vi.mock("@/lib/threads/hooks/use-cli-profiles", () => ({
  useCliProfiles: () => ({ isLoading: false, hasProfiles: false }),
}));

vi.mock("@/components/blocks/thread/no-profiles-state", () => ({
  NoProfilesState: () => <div>CLI setup</div>,
}));

const orgQuery = getFunctionName(api.organizations.core.getBySlug);
const projectQuery = getFunctionName(api.projects.core.getByAlias);

function renderLayout(role: ProjectRole | undefined) {
  useQueryMock.mockImplementation(
    withProjectRole(role, (query) => {
      const name = getFunctionName(query as FunctionReference<"query">);
      if (name === orgQuery) return { _id: "org-1" };
      if (name === projectQuery) return { _id: "project-1", name: "Web", alias: "WEB" };
      return undefined;
    })
  );
  return render(
    <ThreadLayout params={Promise.resolve({ organizationSlug: "acme", projectAlias: "WEB" })}>
      <div />
    </ThreadLayout>
  );
}

describe("ThreadLayout for project viewers", () => {
  beforeEach(() => {
    hotkeyOptions.clear();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  test("a viewer is sent to the task view and never sees the threads screen", async () => {
    await act(async () => {
      renderLayout("viewer");
    });

    expect(replaceMock).toHaveBeenCalledWith(expect.objectContaining({ pathname: "/o/acme/WEB" }));
    expect(screen.queryByText("CLI setup")).toBeNull();
    expect(hotkeyOptions.get(NEW_THREAD_HOTKEY)?.enabled).toBe(false);
  });

  test("waits for the role before rendering anything thread-shaped", async () => {
    await act(async () => {
      renderLayout(undefined);
    });

    expect(replaceMock).not.toHaveBeenCalled();
    expect(screen.queryByText("CLI setup")).toBeNull();
  });

  test("a member gets the threads area and the new-thread hotkey", async () => {
    await act(async () => {
      renderLayout("member");
    });

    expect(replaceMock).not.toHaveBeenCalled();
    expect(screen.getByText("CLI setup")).toBeTruthy();
    expect(hotkeyOptions.get(NEW_THREAD_HOTKEY)?.enabled).toBe(true);
  });
});

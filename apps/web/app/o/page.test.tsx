/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { APP_AUTH_READINESS_TIMEOUT_MS } from "@/lib/auth/use-app-auth-readiness";
import { getFunctionName } from "convex/server";
import OrgBasePage from "./page";

const replaceMock = vi.fn();
const signOutMock = vi.fn();
const useQueryMock = vi.hoisted(() => vi.fn());
let organizations: Array<{ slug: string }> | undefined;
let authState = {
  isLoaded: true,
  isSignedIn: true,
  userId: "user_1" as string | null,
};
let convexAuthState = {
  isLoading: false,
  isAuthenticated: true,
};

function findOrganizationsQueryCall() {
  return useQueryMock.mock.calls.find(([query]) => getFunctionName(query) === "organizations/core:listForUser");
}

vi.mock("convex/react", () => ({
  useQuery: useQueryMock,
}));

vi.mock("@/lib/auth/hooks", () => ({
  useAppAuth: () => authState,
  useAppConvexAuth: () => convexAuthState,
  useAppSignOut: () => signOutMock,
}));

vi.mock("@/lib/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/navigation")>()),
  useNavigation: () => ({ replace: replaceMock, location: { search: "" } }),
}));

describe("OrgBasePage", () => {
  beforeEach(() => {
    replaceMock.mockReset();
    localStorage.clear();
    organizations = undefined;
    authState = {
      isLoaded: true,
      isSignedIn: true,
      userId: "user_1",
    };
    convexAuthState = {
      isLoading: false,
      isAuthenticated: true,
    };
    useQueryMock.mockReset();
    useQueryMock.mockImplementation(() => organizations);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test("redirects once to the first organization under Strict Mode", async () => {
    organizations = [{ slug: "acme" }];

    render(
      <StrictMode>
        <OrgBasePage />
      </StrictMode>
    );

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith(expect.objectContaining({ pathname: "/o/acme/" }));
    });
    expect(replaceMock).toHaveBeenCalledTimes(1);
  });

  test("redirects to the last-used organization when it is still accessible", async () => {
    localStorage.setItem("lastOrganizationSlug", "globex");
    organizations = [{ slug: "acme" }, { slug: "globex" }];

    render(<OrgBasePage />);

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith(expect.objectContaining({ pathname: "/o/globex/" }));
    });
  });

  test("falls back to the first accessible organization when the last-used one is no longer accessible", async () => {
    localStorage.setItem("lastOrganizationSlug", "removed-org");
    organizations = [{ slug: "acme" }, { slug: "globex" }];

    render(<OrgBasePage />);

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith(expect.objectContaining({ pathname: "/o/acme/" }));
    });
  });

  test("routes to /auth/callback for onboarding when the user has no organizations", async () => {
    organizations = [];

    render(<OrgBasePage />);

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith(expect.objectContaining({ pathname: "/auth/callback" }));
    });
  });

  test("keeps loading without redirecting while organizations are undefined", () => {
    organizations = undefined;

    render(<OrgBasePage />);

    expect(replaceMock).not.toHaveBeenCalled();
  });

  test("skips the organizations query until Convex authentication is ready", () => {
    convexAuthState = {
      isLoading: true,
      isAuthenticated: false,
    };
    organizations = [];

    render(<OrgBasePage />);

    expect(findOrganizationsQueryCall()?.[1]).toBe("skip");
    expect(replaceMock).not.toHaveBeenCalled();
  });

  test("queries and routes to onboarding after authenticated empty results", async () => {
    organizations = [];

    render(<OrgBasePage />);

    expect(findOrganizationsQueryCall()?.[1]).toEqual({});
    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith(expect.objectContaining({ pathname: "/auth/callback" }));
    });
  });

  test("shows a recoverable error when Convex authentication times out", async () => {
    vi.useFakeTimers();
    convexAuthState = {
      isLoading: true,
      isAuthenticated: false,
    };

    render(<OrgBasePage />);

    expect(screen.getByText("Loading…")).toBeDefined();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(APP_AUTH_READINESS_TIMEOUT_MS);
    });

    expect(
      screen.getByRole("heading", {
        name: "Your session needs to be refreshed",
      })
    ).toBeDefined();
    expect(replaceMock).not.toHaveBeenCalled();
  });
});

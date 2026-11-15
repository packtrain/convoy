/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { ConvexError } from "convex/values";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { APP_AUTH_READINESS_TIMEOUT_MS } from "@/lib/auth/use-app-auth-readiness";
import AuthCallbackPage from "./page";

const replaceMock = vi.fn();
const onboardMock = vi.fn();
const signOutMock = vi.fn();
let authState = {
  isLoaded: true,
  isSignedIn: false,
  userId: null as string | null,
};
let convexAuthState = {
  isLoading: false,
  isAuthenticated: false,
};
let searchParams = new URLSearchParams();

vi.mock("@/lib/auth/hooks", () => ({
  supportsSignOut: true,
  useAppAuth: () => authState,
  useAppConvexAuth: () => convexAuthState,
  useAppSignOut: () => signOutMock,
}));

vi.mock("convex/react", () => ({
  useMutation: () => onboardMock,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/auth/callback",
  useRouter: () => ({
    replace: replaceMock,
  }),
  useSearchParams: () => searchParams,
}));

describe("AuthCallbackPage", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/auth/callback");
    replaceMock.mockReset();
    onboardMock.mockReset();
    authState = {
      isLoaded: true,
      isSignedIn: false,
      userId: null,
    };
    convexAuthState = {
      isLoading: false,
      isAuthenticated: false,
    };
    onboardMock.mockResolvedValue({
      organizationId: "org_1",
      organizationSlug: "acme",
      isNewUser: true,
    });
    searchParams = new URLSearchParams();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test("preserves redirect_url when forwarding a signed-out user to sign-in", async () => {
    window.history.replaceState(null, "", "/auth/callback?redirect_url=%2Fo%2Facme%2FWEB%2Fthreads%2Ft1%3Ftask%3DWEB-7");
    searchParams = new URLSearchParams({
      redirect_url: "/o/acme/WEB/threads/t1?task=WEB-7",
    });

    render(<AuthCallbackPage />);

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith("/auth/sign-in?redirect_url=%2Fo%2Facme%2FWEB%2Fthreads%2Ft1%3Ftask%3DWEB-7", {
        scroll: false,
      });
    });
    expect(onboardMock).not.toHaveBeenCalled();
  });

  test("waits for Convex authentication before onboarding, then runs once", async () => {
    authState = {
      isLoaded: true,
      isSignedIn: true,
      userId: "user_1",
    };
    convexAuthState = {
      isLoading: true,
      isAuthenticated: false,
    };
    onboardMock.mockResolvedValue({
      organizationId: "org_1",
      organizationSlug: "acme",
      isNewUser: true,
    });

    const view = render(
      <StrictMode>
        <AuthCallbackPage />
      </StrictMode>
    );

    expect(onboardMock).not.toHaveBeenCalled();

    convexAuthState = {
      isLoading: false,
      isAuthenticated: true,
    };
    view.rerender(
      <StrictMode>
        <AuthCallbackPage />
      </StrictMode>
    );

    await waitFor(() => {
      expect(onboardMock).toHaveBeenCalledTimes(1);
      expect(replaceMock).toHaveBeenCalledWith("/o/acme/", {
        scroll: false,
      });
    });

    view.rerender(
      <StrictMode>
        <AuthCallbackPage />
      </StrictMode>
    );
    expect(onboardMock).toHaveBeenCalledTimes(1);
  });

  test("preserves redirect_url after authenticated onboarding", async () => {
    window.history.replaceState(null, "", "/auth/callback?redirect_url=%2Fo%2Facme%2FWEB%2Fthreads%2Ft1%3Ftask%3DWEB-7");
    searchParams = new URLSearchParams({
      redirect_url: "/o/acme/WEB/threads/t1?task=WEB-7",
    });
    authState = {
      isLoaded: true,
      isSignedIn: true,
      userId: "user_1",
    };
    convexAuthState = {
      isLoading: false,
      isAuthenticated: true,
    };
    onboardMock.mockResolvedValue({
      organizationId: "org_1",
      organizationSlug: "acme",
      isNewUser: true,
    });

    render(<AuthCallbackPage />);

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith("/o/acme/WEB/threads/t1?task=WEB-7", { scroll: false });
    });
  });

  test("shows a recoverable error instead of redirecting home when onboarding fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    authState = {
      isLoaded: true,
      isSignedIn: true,
      userId: "user_1",
    };
    convexAuthState = {
      isLoading: false,
      isAuthenticated: true,
    };
    onboardMock.mockRejectedValue(
      new ConvexError({
        code: "AUTH_NOT_AUTHENTICATED",
        message: "Not authenticated",
      })
    );

    render(<AuthCallbackPage />);

    expect(
      await screen.findByRole("heading", {
        name: "Your session needs to be refreshed",
      })
    ).toBeDefined();
    expect(replaceMock).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith("Failed to onboard user:", expect.any(ConvexError));
  });

  test("shows generic recovery copy for a non-auth onboarding failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    authState = {
      isLoaded: true,
      isSignedIn: true,
      userId: "user_1",
    };
    convexAuthState = {
      isLoading: false,
      isAuthenticated: true,
    };
    onboardMock.mockRejectedValue(new Error("Database unavailable"));

    render(<AuthCallbackPage />);

    expect(
      await screen.findByRole("heading", {
        name: "Could not load this page",
      })
    ).toBeDefined();
  });

  test("shows a recoverable error when Convex authentication times out", async () => {
    vi.useFakeTimers();
    authState = {
      isLoaded: true,
      isSignedIn: true,
      userId: "user_1",
    };
    convexAuthState = {
      isLoading: true,
      isAuthenticated: false,
    };

    render(<AuthCallbackPage />);

    expect(screen.getByText("Setting up your account")).toBeDefined();
    expect(onboardMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(APP_AUTH_READINESS_TIMEOUT_MS);
    });

    expect(
      screen.getByRole("heading", {
        name: "Your session needs to be refreshed",
      })
    ).toBeDefined();
    expect(onboardMock).not.toHaveBeenCalled();
    expect(replaceMock).not.toHaveBeenCalled();
  });
});

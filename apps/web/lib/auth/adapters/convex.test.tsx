/**
 * @vitest-environment jsdom
 */
import { act, render } from "@testing-library/react";
import type { ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { AppSignOut } from "../hooks";

const state = vi.hoisted(() => ({
  convexAuth: { isLoading: false, isAuthenticated: false },
  pathname: "/o/acme/WEB",
  signOut: vi.fn(async () => {}),
}));

vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signOut: state.signOut }),
  useAuthToken: () => null,
}));
vi.mock("convex/react", () => ({ useConvexAuth: () => state.convexAuth }));
vi.mock("@/lib/navigation", () => ({ useNavigationLocation: () => ({ pathname: state.pathname }) }));
vi.mock("@/components/blocks/auth/email-password-sign-in-form", () => ({ EmailPasswordSignInForm: () => null }));
vi.mock("@/components/blocks/auth/email-password-sign-up-form", () => ({ EmailPasswordSignUpForm: () => null }));
vi.mock("@/components/blocks/auth/verify-email-screen", () => ({ VerifyEmailScreen: () => null }));
vi.mock("@/components/blocks/auth/forgot-password-form", () => ({ ForgotPasswordForm: () => null }));
vi.mock("@/components/blocks/auth/reset-password-form", () => ({ ResetPasswordForm: () => null }));

import { convexAdapter } from "./convex";

const location = { replace: vi.fn(), assign: vi.fn() };

function renderProvider(child: ReactNode = null) {
  return render(<convexAdapter.Provider client={{} as ConvexReactClient}>{child}</convexAdapter.Provider>);
}

describe("Convex adapter route gate", () => {
  beforeEach(() => {
    location.replace.mockReset();
    location.assign.mockReset();
    state.convexAuth = { isLoading: false, isAuthenticated: false };
    state.pathname = "/o/acme/WEB";
    vi.stubGlobal("location", {
      pathname: state.pathname,
      search: "?task=WEB-7",
      hash: "",
      origin: "http://localhost:3000",
      ...location,
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("sends a signed-out visitor of a private page to sign-in with the page as redirect_url", () => {
    renderProvider();
    expect(location.replace).toHaveBeenCalledWith("/auth/sign-in?redirect_url=%2Fo%2Facme%2FWEB%3Ftask%3DWEB-7");
  });

  test("leaves the sign-in, sign-up, verify-email and password reset pages alone", () => {
    for (const pathname of ["/auth/sign-in", "/auth/sign-up", "/auth/verify-email", "/auth/forgot-password", "/auth/reset-password"]) {
      state.pathname = pathname;
      renderProvider().unmount();
    }
    expect(location.replace).not.toHaveBeenCalled();
  });

  test("waits while auth is loading", () => {
    state.convexAuth = { isLoading: true, isAuthenticated: false };
    renderProvider();
    expect(location.replace).not.toHaveBeenCalled();
  });

  test("sign-out goes to the caller's redirectUrl, not to sign-in with the page just left", async () => {
    state.convexAuth = { isLoading: false, isAuthenticated: true };
    let signOut: AppSignOut = async () => {};
    function Capture() {
      signOut = convexAdapter.useSignOut();
      return null;
    }
    const view = renderProvider(<Capture />);
    state.signOut.mockImplementation(async () => {
      state.convexAuth = { isLoading: false, isAuthenticated: false };
      view.rerender(
        <convexAdapter.Provider client={{} as ConvexReactClient}>
          <Capture />
        </convexAdapter.Provider>
      );
    });

    await act(() => signOut({ redirectUrl: "/" }));

    expect(location.assign).toHaveBeenCalledWith("/");
    expect(location.replace).not.toHaveBeenCalled();
  });
});

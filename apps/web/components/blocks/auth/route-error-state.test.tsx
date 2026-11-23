/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { AppAuthReadiness } from "@/lib/auth/use-app-auth-readiness";
import { isAuthenticationRouteError, RouteErrorState } from "./route-error-state";

const signOutMock = vi.fn();
const reloadMock = vi.fn();

vi.mock("@/lib/auth/hooks", () => ({
  useAppSignOut: () => signOutMock,
}));

let readiness: AppAuthReadiness = { status: "authenticated", reason: null, userId: "user_1" };

vi.mock("@/lib/auth/use-app-auth-readiness", () => ({
  useAppAuthReadiness: () => readiness,
}));

describe("RouteErrorState", () => {
  beforeEach(() => {
    cleanup();
    signOutMock.mockReset();
    reloadMock.mockReset();
    readiness = { status: "authenticated", reason: null, userId: "user_1" };
    window.history.replaceState({}, "", "/o/acme/WEB?task=WEB-7");
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...window.location,
        reload: reloadMock,
      },
    });
  });

  test("recognizes Convex unauthenticated errors", () => {
    expect(isAuthenticationRouteError(new Error("Not authenticated"))).toBe(true);
    expect(isAuthenticationRouteError(new Error("Other failure"))).toBe(false);
  });

  test("renders explicitly selected auth-specific recovery copy", () => {
    render(<RouteErrorState error={new Error("Production redacted server error")} variant="auth" />);

    expect(screen.getByRole("heading", { name: "Your session needs to be refreshed" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /sign in again/i })).toBeTruthy();
  });

  test("does not infer auth copy when the caller selects the generic variant", () => {
    render(<RouteErrorState error={new Error("Not authenticated")} variant="generic" />);

    expect(screen.getByRole("heading", { name: "Could not load this page" })).toBeTruthy();
  });

  test("retries by reloading the browser page", () => {
    render(<RouteErrorState error={new Error("Not authenticated")} />);

    fireEvent.click(screen.getByRole("button", { name: /try again/i }));

    expect(reloadMock).toHaveBeenCalledOnce();
  });

  test("signs out with the current route as the sign-in redirect", () => {
    render(<RouteErrorState error={new Error("Not authenticated")} />);

    fireEvent.click(screen.getByRole("button", { name: /sign in again/i }));

    expect(signOutMock).toHaveBeenCalledWith({
      redirectUrl: "/auth/sign-in?redirect_url=%2Fo%2Facme%2FWEB%3Ftask%3DWEB-7",
    });
  });

  test("shows an authorizing state while a boundary-caught auth error is still settling", () => {
    readiness = { status: "loading", reason: "convex", userId: "user_1" };
    render(<RouteErrorState error={new Error("Not authenticated")} />);

    expect(screen.getByText("Authorizing")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Your session needs to be refreshed" })).toBeNull();
  });

  test("recovers the route once auth settles after a pending window", () => {
    const onRecover = vi.fn();
    readiness = { status: "loading", reason: "convex", userId: "user_1" };
    const view = render(<RouteErrorState error={new Error("Not authenticated")} onRecover={onRecover} />);
    expect(onRecover).not.toHaveBeenCalled();

    readiness = { status: "authenticated", reason: null, userId: "user_1" };
    view.rerender(<RouteErrorState error={new Error("Not authenticated")} onRecover={onRecover} />);

    expect(onRecover).toHaveBeenCalledOnce();
  });

  test("shows the auth error once readiness times out", () => {
    readiness = { status: "loading", reason: "convex", userId: "user_1" };
    const view = render(<RouteErrorState error={new Error("Not authenticated")} />);

    readiness = { status: "timed-out", reason: "convex", userId: "user_1" };
    view.rerender(<RouteErrorState error={new Error("Not authenticated")} />);

    expect(screen.getByRole("heading", { name: "Your session needs to be refreshed" })).toBeTruthy();
  });

  test("does not recover when auth was never seen pending", () => {
    const onRecover = vi.fn();
    render(<RouteErrorState error={new Error("Not authenticated")} onRecover={onRecover} />);

    expect(onRecover).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Your session needs to be refreshed" })).toBeTruthy();
  });

  test("explicit auth variant shows the error even while readiness is loading", () => {
    readiness = { status: "loading", reason: "convex", userId: "user_1" };
    render(<RouteErrorState variant="auth" />);

    expect(screen.getByRole("heading", { name: "Your session needs to be refreshed" })).toBeTruthy();
  });
});

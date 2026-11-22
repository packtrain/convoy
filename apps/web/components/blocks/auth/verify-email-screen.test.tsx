/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { CompleteSignUpState } from "@convex-dev/auth/methods/email-password/react";
import { VerifyEmailScreen } from "./verify-email-screen";

const state = vi.hoisted(() => ({
  link: { status: "loading" } as CompleteSignUpState,
  emailCode: null as string | null,
  replace: vi.fn(),
}));

vi.mock("@convex-dev/auth/methods/email-password/react", () => ({
  useCompleteSignUpWithEmailPassword: (_api: unknown, { emailCode }: { emailCode: string }) => {
    state.emailCode = emailCode;
    return state.link;
  },
}));
vi.mock("@/convex/_generated/api", () => ({ api: { auth: {} } }));
vi.mock("@/lib/navigation", () => ({
  AppLink: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
  appRoute: { authSignUp: (redirectUrl?: string | null) => (redirectUrl ? `/auth/sign-up?redirect_url=${redirectUrl}` : "/auth/sign-up") },
  targetFromHref: (href: string) => href,
  useNavigation: () => ({ location: { search: "?code=the-code" }, replace: state.replace }),
}));

describe("VerifyEmailScreen", () => {
  beforeEach(() => {
    state.link = { status: "loading" };
    state.replace.mockReset();
    window.localStorage.clear();
  });

  test("presents the link's code and waits", () => {
    render(<VerifyEmailScreen />);
    expect(state.emailCode).toBe("the-code");
    expect(screen.getByText("Verifying your email…")).toBeTruthy();
    expect(state.replace).not.toHaveBeenCalled();
  });

  test("once complete, goes to the callback with the redirect kept at sign-up, and forgets it", () => {
    window.localStorage.setItem("convoy.signUpRedirect", "/auth/invite/tok");
    state.link = { status: "complete" };

    render(<VerifyEmailScreen />);

    expect(state.replace).toHaveBeenCalledWith("/auth/callback?redirect_url=%2Fauth%2Finvite%2Ftok");
    expect(window.localStorage.getItem("convoy.signUpRedirect")).toBeNull();
  });

  test("a link opened in another browser says so", () => {
    state.link = { status: "error", userError: { error: "MISSING_SECRET" } };

    render(<VerifyEmailScreen />);

    expect(screen.getByRole("alert").textContent).toContain("Open the link in the browser where you signed up");
  });

  test("going back to sign up after a failed link keeps the redirect kept at sign-up", () => {
    window.localStorage.setItem("convoy.signUpRedirect", "/auth/invite/tok");
    state.link = { status: "error", userError: { error: "INVALID_CHALLENGE" } };

    render(<VerifyEmailScreen />);

    expect(screen.getByRole("link", { name: "Back to sign up" }).getAttribute("href")).toBe(
      "/auth/sign-up?redirect_url=/auth/invite/tok"
    );
    expect(window.localStorage.getItem("convoy.signUpRedirect")).toBe("/auth/invite/tok");
  });
});

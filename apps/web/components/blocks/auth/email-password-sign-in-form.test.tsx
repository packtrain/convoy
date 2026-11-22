/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { EmailPasswordSignInForm } from "./email-password-sign-in-form";

const state = vi.hoisted(() => ({ settings: undefined as { emailEnabled: boolean } | undefined }));

vi.mock("convex/react", () => ({ useQuery: () => state.settings }));
vi.mock("@convex-dev/auth/methods/email-password/react", () => ({
  useSignInWithEmailPassword: () => ({ signIn: vi.fn(), pending: false }),
}));
vi.mock("./google-sign-in-button", () => ({ GoogleSignInButton: () => null }));
vi.mock("@/convex/_generated/api", () => ({ api: { auth: {} } }));
vi.mock("@/lib/navigation", () => ({
  AppLink: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
  appRoute: {
    authSignUp: () => "/auth/sign-up",
    authForgotPassword: (redirectUrl?: string | null) => `/auth/forgot-password?redirect_url=${redirectUrl}`,
  },
  useNavigation: () => ({ location: { search: "?redirect_url=/auth/invite/tok" } }),
}));

describe("EmailPasswordSignInForm", () => {
  beforeEach(() => {
    state.settings = undefined;
  });

  test("links to forgot password, keeping the redirect, when email is on", () => {
    state.settings = { emailEnabled: true };
    render(<EmailPasswordSignInForm />);
    expect(screen.getByRole("link", { name: "Forgot password?" }).getAttribute("href")).toBe(
      "/auth/forgot-password?redirect_url=/auth/invite/tok"
    );
  });

  test("has no forgot-password link when email is off or not loaded yet", () => {
    const view = render(<EmailPasswordSignInForm />);
    expect(screen.queryByRole("link", { name: "Forgot password?" })).toBeNull();
    state.settings = { emailEnabled: false };
    view.rerender(<EmailPasswordSignInForm />);
    expect(screen.queryByRole("link", { name: "Forgot password?" })).toBeNull();
  });
});

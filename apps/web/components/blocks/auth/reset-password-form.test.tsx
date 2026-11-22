/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { CompletePasswordRecoveryState } from "@convex-dev/auth/methods/email-password/react";
import { ResetPasswordForm } from "./reset-password-form";

const state = vi.hoisted(() => ({
  link: { status: "loading" } as CompletePasswordRecoveryState,
  emailCode: null as string | null,
  complete: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("@convex-dev/auth/methods/email-password/react", () => ({
  useCompletePasswordRecovery: (_api: unknown, { emailCode }: { emailCode: string }) => {
    state.emailCode = emailCode;
    return state.link;
  },
}));
vi.mock("@/convex/_generated/api", () => ({ api: { auth: {} } }));
vi.mock("@/lib/navigation", () => ({
  AppLink: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
  appRoute: { authForgotPassword: () => "/auth/forgot-password" },
  targetFromHref: (href: string) => href,
  useNavigation: () => ({ location: { search: "?code=the-code" }, replace: state.replace }),
}));

function submit(password: string, confirmation = password) {
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: confirmation } });
  fireEvent.submit(screen.getByRole("button", { name: "Set password and sign in" }));
}

describe("ResetPasswordForm", () => {
  beforeEach(() => {
    state.complete.mockReset();
    state.replace.mockReset();
    state.link = { status: "ready", completePasswordRecovery: state.complete, pending: false };
  });

  test("checks the link's code before asking for a password", () => {
    state.link = { status: "loading" };
    render(<ResetPasswordForm />);
    expect(state.emailCode).toBe("the-code");
    expect(screen.getByText("Checking the link…")).toBeTruthy();
  });

  test("sets the new password, with no email field", async () => {
    state.complete.mockResolvedValue({ status: "complete" });
    render(<ResetPasswordForm />);
    expect(screen.queryByLabelText("Email")).toBeNull();

    submit("another horse battery");
    await waitFor(() => expect(state.complete).toHaveBeenCalledWith({ newPassword: "another horse battery" }));
  });

  test("different passwords are not sent", () => {
    render(<ResetPasswordForm />);
    submit("another horse battery", "something else entirely");
    expect(screen.getByRole("alert").textContent).toBe("Passwords don't match.");
    expect(state.complete).not.toHaveBeenCalled();
  });

  test("a rejected password is shown and keeps the form", async () => {
    state.complete.mockResolvedValue({ status: "error", userError: { error: "PASSWORD_TOO_COMMON" } });
    render(<ResetPasswordForm />);
    submit("password1234");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("This password is too common. Choose another."));
  });

  test("once complete, goes to the callback", () => {
    state.link = { status: "complete" };
    render(<ResetPasswordForm />);
    expect(state.replace).toHaveBeenCalledWith("/auth/callback");
  });

  test("a link opened in another browser says so and offers a new link", () => {
    state.link = { status: "error", userError: { error: "MISSING_SECRET" } };
    render(<ResetPasswordForm />);
    expect(screen.getByRole("alert").textContent).toContain("Open the link in the browser where you asked for it");
    expect(screen.getByRole("link", { name: "Get a new link" }).getAttribute("href")).toBe("/auth/forgot-password");
  });
});

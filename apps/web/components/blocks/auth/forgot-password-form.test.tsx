/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ForgotPasswordForm } from "./forgot-password-form";

const state = vi.hoisted(() => ({
  settings: { emailEnabled: true } as { emailEnabled: boolean } | undefined,
  start: vi.fn(),
}));

vi.mock("convex/react", () => ({ useQuery: () => state.settings }));
vi.mock("@convex-dev/auth/methods/email-password/react", () => ({
  useStartPasswordRecovery: () => ({ startPasswordRecovery: state.start, pending: false }),
}));
vi.mock("@/convex/_generated/api", () => ({ api: { auth: {} } }));
vi.mock("@/lib/navigation", () => ({
  AppLink: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  appRoute: { authSignIn: () => "/auth/sign-in" },
  useNavigation: () => ({ location: { search: "" } }),
}));

function submit(email = "Robin@Example.com") {
  const view = render(<ForgotPasswordForm />);
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.submit(screen.getByRole("button", { name: "Send link" }));
  return view;
}

describe("ForgotPasswordForm", () => {
  beforeEach(() => {
    state.settings = { emailEnabled: true };
    state.start.mockReset();
  });

  test("asks for the email only, and on success names the address the link went to", async () => {
    state.start.mockResolvedValue({ success: true, sentTo: "robin@example.com" });
    submit();
    expect(screen.queryByLabelText("Password")).toBeNull();

    await screen.findByText("Check your email");
    expect(state.start).toHaveBeenCalledWith({ email: "Robin@Example.com" });
    expect(screen.getByText(/We sent a link to robin@example\.com/)).toBeTruthy();
  });

  test("an unknown address is reported", async () => {
    state.start.mockResolvedValue({ success: false, userError: { error: "EMAIL_NOT_FOUND" } });
    submit();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("No account uses this email."));
  });

  test("shows no form until the settings say email is on", () => {
    state.settings = undefined;
    render(<ForgotPasswordForm />);
    expect(screen.queryByLabelText("Email")).toBeNull();
  });

  test("email turning off wins over an earlier success", async () => {
    state.start.mockResolvedValue({ success: true, sentTo: "robin@example.com" });
    const view = submit();
    await screen.findByText("Check your email");
    state.settings = { emailEnabled: false };
    view.rerender(<ForgotPasswordForm />);
    expect(screen.queryByText("Check your email")).toBeNull();
  });

  test("with email off, says reset is off instead of showing the form", () => {
    state.settings = { emailEnabled: false };
    render(<ForgotPasswordForm />);
    expect(screen.getByText("Password reset is off")).toBeTruthy();
    expect(screen.queryByLabelText("Email")).toBeNull();
  });
});

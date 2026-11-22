/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConvexError } from "convex/values";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { EmailPasswordSignUpForm } from "./email-password-sign-up-form";

const signUp = vi.fn();
const startEmailedSignUp = vi.fn();
const setSession = vi.fn(async () => {});
let search = "";

const proxyUrls: string[] = [];

vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    constructor(url: string) {
      proxyUrls.push(url);
    }
    mutation = signUp;
  },
}));
vi.mock("@convex-dev/auth/react", () => ({ useAuthActions: () => ({ setSession }) }));
vi.mock("@convex-dev/auth/methods/email-password/react", () => ({
  useSignUpWithEmailPassword: () => ({ signUp: startEmailedSignUp, pending: false }),
}));
vi.mock("./google-sign-in-button", () => ({ GoogleSignInButton: () => null }));
vi.mock("@/convex/_generated/api", () => ({ api: { auth: { signUpWithoutEmailVerification: "signUp" } } }));
vi.mock("@/lib/navigation", () => ({
  AppLink: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  appRoute: { authSignIn: () => ({ pathname: "/auth/sign-in" }) },
  useNavigation: () => ({ location: { search } }),
}));

function submit(email = "robin@example.com", password = "correct horse battery", confirmation = password) {
  render(<EmailPasswordSignUpForm />);
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: confirmation } });
  fireEvent.submit(screen.getByRole("button", { name: "Create account" }));
}

describe("EmailPasswordSignUpForm", () => {
  beforeEach(() => {
    signUp.mockReset();
    proxyUrls.length = 0;
    startEmailedSignUp.mockReset();
    setSession.mockClear();
    search = "";
    window.localStorage.clear();
  });

  test("adopts the session the one-transaction sign-up returns", async () => {
    const tokens = { accessToken: "a", refreshToken: "r", refreshTokenExpiresAt: 1, userId: "u" };
    signUp.mockResolvedValue({ status: "complete", tokens });

    submit();

    await waitFor(() => expect(setSession).toHaveBeenCalledWith(tokens));
    expect(signUp).toHaveBeenCalledWith("signUp", { email: "robin@example.com", password: "correct horse battery" });
    // Through the auth proxy route, which keeps the refresh token in an httpOnly cookie.
    expect(proxyUrls).toEqual(["/auth/signin?path="]);
  });

  test("refuses to sign up when the confirmation differs", async () => {
    submit("robin@example.com", "correct horse battery", "correct horse batery");

    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Passwords don't match.");
    expect(signUp).not.toHaveBeenCalled();
  });

  test("shows a plain message for each error code", async () => {
    signUp.mockResolvedValue({ status: "error", userError: { error: "EMAIL_TAKEN" } });

    submit();

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "An account with this email already exists. Sign in instead."
    );
    expect(setSession).not.toHaveBeenCalled();
  });

  test("shows the deployment's reason when the backend refuses sign-up", async () => {
    signUp.mockRejectedValue(new ConvexError("Email sending is not configured on this deployment"));

    submit();

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Email sending is not configured on this deployment"
    );
  });

  describe("with verification required", () => {
    beforeEach(() => {
      signUp.mockResolvedValue({ status: "error", userError: { error: "EMAIL_VERIFICATION_REQUIRED" } });
    });

    test("starts the emailed sign-up and asks to open the link in this browser", async () => {
      startEmailedSignUp.mockResolvedValue({ success: true });

      submit();

      expect(await screen.findByRole("heading", { name: "Check your email" })).toBeTruthy();
      expect(screen.getByText(/robin@example.com/).textContent).toContain("in this browser");
      expect(startEmailedSignUp).toHaveBeenCalledWith({ email: "robin@example.com", password: "correct horse battery" });
      expect(setSession).not.toHaveBeenCalled();
    });

    test("keeps redirect_url for the landing page of the link", async () => {
      search = "?redirect_url=%2Fauth%2Finvite%2Ftok";
      startEmailedSignUp.mockResolvedValue({ success: true });

      submit();

      await screen.findByRole("heading", { name: "Check your email" });
      expect(window.localStorage.getItem("convoy.signUpRedirect")).toBe("/auth/invite/tok");
    });

    test("shows a plain message for an error code", async () => {
      startEmailedSignUp.mockResolvedValue({ success: false, userError: { error: "EMAIL_TAKEN" } });

      submit();

      expect(await screen.findByRole("alert")).toHaveProperty(
        "textContent",
        "An account with this email already exists. Sign in instead."
      );
    });

    test("shows the deployment's reason when sending is not configured", async () => {
      startEmailedSignUp.mockResolvedValue({
        success: false,
        userError: { error: "OTHER_ERROR", cause: new ConvexError("Email sending is not configured on this deployment") },
      });

      submit();

      expect(await screen.findByRole("alert")).toHaveProperty(
        "textContent",
        "Email sending is not configured on this deployment"
      );
    });
  });
});

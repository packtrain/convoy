/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConvexError } from "convex/values";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { EmailPasswordSignUpForm } from "./email-password-sign-up-form";

const signUp = vi.fn();
const setSession = vi.fn(async () => {});

vi.mock("convex/react", () => ({ useMutation: () => signUp }));
vi.mock("@convex-dev/auth/react", () => ({ useAuthActions: () => ({ setSession }) }));
vi.mock("@/convex/_generated/api", () => ({ api: { auth: { signUpWithoutEmailVerification: "signUp" } } }));
vi.mock("@/lib/navigation", () => ({
  AppLink: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  appRoute: { authSignIn: () => ({ pathname: "/auth/sign-in" }) },
  useNavigation: () => ({ location: { search: "" } }),
}));

function submit(email = "robin@example.com", password = "correct horse battery") {
  render(<EmailPasswordSignUpForm />);
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  fireEvent.submit(screen.getByRole("button", { name: "Create account" }));
}

describe("EmailPasswordSignUpForm", () => {
  beforeEach(() => {
    signUp.mockReset();
    setSession.mockClear();
  });

  test("adopts the session the one-transaction sign-up returns", async () => {
    const tokens = { accessToken: "a", refreshToken: "r", refreshTokenExpiresAt: 1, userId: "u" };
    signUp.mockResolvedValue({ status: "complete", tokens });

    submit();

    await waitFor(() => expect(setSession).toHaveBeenCalledWith(tokens));
    expect(signUp).toHaveBeenCalledWith({ email: "robin@example.com", password: "correct horse battery" });
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
});

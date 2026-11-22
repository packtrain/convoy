/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConvexError } from "convex/values";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { GoogleSignInButton } from "./google-sign-in-button";

const state = vi.hoisted(() => ({
  settings: undefined as { googleEnabled: boolean } | undefined,
  flowError: null as unknown,
  signIn: vi.fn(),
}));

vi.mock("convex/react", () => ({ useQuery: () => state.settings }));
vi.mock("@convex-dev/auth/methods/google/react", () => ({
  useSignInWithGoogle: () => ({ signIn: state.signIn }),
  useOauth: () => ({ flowError: state.flowError }),
}));
vi.mock("@/convex/_generated/api", () => ({ api: { auth: {} } }));

const BUTTON = { name: "Continue with Google" };

describe("GoogleSignInButton", () => {
  beforeEach(() => {
    state.settings = undefined;
    state.flowError = null;
    state.signIn.mockReset();
  });

  test("renders nothing until settings load, or when Google is off", () => {
    const view = render(<GoogleSignInButton />);
    expect(screen.queryByRole("button", BUTTON)).toBeNull();
    state.settings = { googleEnabled: false };
    view.rerender(<GoogleSignInButton />);
    expect(screen.queryByRole("button", BUTTON)).toBeNull();
  });

  test("starts the Google flow when Google is on", () => {
    state.settings = { googleEnabled: true };
    state.signIn.mockReturnValue(new Promise(() => {}));
    render(<GoogleSignInButton />);

    fireEvent.click(screen.getByRole("button", BUTTON));

    expect(state.signIn).toHaveBeenCalledWith();
  });

  test("says the sign-in was cancelled after the consent screen's cancel", () => {
    state.settings = { googleEnabled: true };
    state.flowError = { error: "ACCESS_DENIED" };
    render(<GoogleSignInButton />);

    expect(screen.getByRole("alert").textContent).toBe("Sign-in was cancelled.");
  });

  test("shows the backend's reason when it refuses the sign-in", () => {
    state.settings = { googleEnabled: true };
    state.flowError = { error: "OTHER_ERROR", cause: new ConvexError("Convex Auth sign-up is not enabled on this deployment") };
    render(<GoogleSignInButton />);

    expect(screen.getByRole("alert").textContent).toBe("Convex Auth sign-up is not enabled on this deployment");
  });

  test("shows an error when the flow fails to start", async () => {
    state.settings = { googleEnabled: true };
    state.signIn.mockResolvedValue({ status: "error", userError: { error: "OTHER_ERROR", cause: new Error("offline") } });
    render(<GoogleSignInButton />);

    fireEvent.click(screen.getByRole("button", BUTTON));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Could not sign in with Google. Try again."));
  });
});

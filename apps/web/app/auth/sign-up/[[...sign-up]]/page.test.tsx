/**
 * @vitest-environment jsdom
 */
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ReactNode } from "react";
import SignUpPage from "./page";

const signUpProps = vi.fn();
let search = "";

vi.mock("@/lib/auth/auth-mode", () => ({ authMode: "clerk" }));
vi.mock("@clerk/nextjs", () => ({
  SignUp: (props: Record<string, unknown>) => {
    signUpProps(props);
    return null;
  },
}));

vi.mock("@/components/blocks/auth/auth-page-wrapper", () => ({
  AuthPageWrapper: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/navigation", () => ({
  useNavigation: () => ({ location: { search } }),
}));

describe("SignUpPage", () => {
  beforeEach(() => {
    signUpProps.mockReset();
    search = "";
  });

  test("forces the post-sign-up redirect through /auth/callback with the original redirect_url", () => {
    search = "?redirect_url=%2Fo%2Facme%2FWEB";

    render(<SignUpPage />);

    expect(signUpProps).toHaveBeenCalledWith(
      expect.objectContaining({
        forceRedirectUrl: "/auth/callback?redirect_url=%2Fo%2Facme%2FWEB",
      })
    );
  });

  test("forces the redirect to the bare callback without a redirect_url", () => {
    render(<SignUpPage />);

    expect(signUpProps).toHaveBeenCalledWith(
      expect.objectContaining({ forceRedirectUrl: "/auth/callback" })
    );
  });
});

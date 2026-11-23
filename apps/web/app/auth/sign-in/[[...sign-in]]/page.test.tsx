/**
 * @vitest-environment jsdom
 */
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ReactNode } from "react";
import SignInPage from "./page";

const signInProps = vi.fn();
let search = "";

vi.mock("@/lib/auth/auth-mode", () => ({ authMode: "clerk" }));
vi.mock("@clerk/nextjs", () => ({
  SignIn: (props: Record<string, unknown>) => {
    signInProps(props);
    return null;
  },
}));

vi.mock("@/components/blocks/auth/auth-page-wrapper", () => ({
  AuthPageWrapper: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/navigation", () => ({
  useNavigation: () => ({ location: { search } }),
}));

describe("SignInPage", () => {
  beforeEach(() => {
    signInProps.mockReset();
    search = "";
  });

  test("forces the post-sign-in redirect through /auth/callback with the original redirect_url", () => {
    search = "?redirect_url=%2Fo%2Facme%2FWEB%3Ftask%3DWEB-7";

    render(<SignInPage />);

    expect(signInProps).toHaveBeenCalledWith(
      expect.objectContaining({
        forceRedirectUrl:
          "/auth/callback?redirect_url=%2Fo%2Facme%2FWEB%3Ftask%3DWEB-7",
      })
    );
  });

  test("forces the redirect to the bare callback without a redirect_url", () => {
    render(<SignInPage />);

    expect(signInProps).toHaveBeenCalledWith(
      expect.objectContaining({ forceRedirectUrl: "/auth/callback" })
    );
  });
});

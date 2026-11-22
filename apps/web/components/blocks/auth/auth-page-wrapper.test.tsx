/**
 * @vitest-environment jsdom
 */
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { href, type RouteTarget } from "@/lib/navigation/target";
import { AuthPageWrapper } from "./auth-page-wrapper";

const replace = vi.fn();
let search = "";
let auth = { isLoaded: true, isSignedIn: false, userId: null as string | null };

vi.mock("@/lib/auth/hooks", () => ({ useAppAuth: () => auth }));
vi.mock("@/lib/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/navigation")>()),
  useNavigation: () => ({ location: { search }, replace }),
}));

describe("AuthPageWrapper", () => {
  beforeEach(() => {
    replace.mockReset();
    search = "";
    auth = { isLoaded: true, isSignedIn: false, userId: null };
  });

  test("renders the screen for a signed-out visitor", () => {
    const view = render(<AuthPageWrapper>form</AuthPageWrapper>);
    expect(view.getByText("form")).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  test("sends a signed-in visitor through /auth/callback, keeping redirect_url", () => {
    search = "?redirect_url=%2Fo%2Facme";
    auth = { isLoaded: true, isSignedIn: true, userId: "user_1" };

    render(<AuthPageWrapper>form</AuthPageWrapper>);

    const target = replace.mock.calls[0][0] as RouteTarget;
    expect(href(target)).toBe("/auth/callback?redirect_url=%2Fo%2Facme");
  });
});

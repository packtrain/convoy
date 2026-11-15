/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { errors } from "@/convex/integrations/github/errors";
import { GithubCallbackPage } from "./github-callback-page";

const completeSetupMock = vi.fn();
const replaceMock = vi.fn();
let search = "";

vi.mock("convex/react", () => ({ useAction: () => completeSetupMock }));
vi.mock("@/lib/auth/hooks", () => ({ useAppConvexAuth: () => ({ isAuthenticated: true, isLoading: false }) }));
vi.mock("@/lib/navigation", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/navigation")>()),
  useNavigation: () => ({ location: { pathname: "/integrations/github/callback", search, hash: "" }, replace: replaceMock }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("GithubCallbackPage", () => {
  test("finishes the setup once and returns to the project's Integrations settings", async () => {
    search = "?code=abc&state=xyz";
    completeSetupMock.mockResolvedValue({ setupId: "setup_1", organizationSlug: "org", projectAlias: "WEB" });
    render(<GithubCallbackPage />);
    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith(
        expect.objectContaining({ pathname: "/o/org/WEB/settings/integrations/github" })
      )
    );
    expect(completeSetupMock).toHaveBeenCalledTimes(1);
    expect(completeSetupMock).toHaveBeenCalledWith({ state: "xyz", code: "abc" });
  });

  test("a GitHub error shows Convoy's message, not the URL's text, and links back", () => {
    search = "?error=access_denied&error_description=Call+this+number+now";
    render(<GithubCallbackPage />);
    expect(screen.getByText(errors.GITHUB_AUTHORIZATION_FAILED)).toBeTruthy();
    expect(screen.queryByText(/Call this number/)).toBeNull();
    expect(screen.getByRole("link", { name: "Back to Convoy" }).getAttribute("href")).toBe("/");
    expect(completeSetupMock).not.toHaveBeenCalled();
  });

  test("the end of an App install points back to Convoy and closes its tab", () => {
    search = "?installation_id=181348741&setup_action=install";
    const close = vi.spyOn(window, "close").mockImplementation(() => {});
    render(<GithubCallbackPage />);
    expect(screen.getByText("GitHub App installed")).toBeTruthy();
    expect(screen.queryByText(errors.GITHUB_AUTHORIZATION_FAILED)).toBeNull();
    expect(close).toHaveBeenCalled();
    expect(completeSetupMock).not.toHaveBeenCalled();
  });

  test("the page centers its message on the screen, since the route has no layout around it", () => {
    search = "?code=abc&state=xyz";
    completeSetupMock.mockReturnValue(new Promise(() => {}));
    const { container } = render(<GithubCallbackPage />);
    expect(screen.getByText("Connecting GitHub…")).toBeTruthy();
    expect((container.firstElementChild as HTMLElement).className).toContain("min-h-screen");
  });
});

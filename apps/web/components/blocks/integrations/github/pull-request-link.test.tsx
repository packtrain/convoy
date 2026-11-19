/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PullRequestLink } from "./pull-request-link";

let targets: unknown = [];
let route: unknown = { organizationId: "org_1", organizationSlug: "org", projectAlias: "WEB" };
const queryMock = vi.fn();
const pushMock = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: (_fn: unknown, args: unknown) => {
    queryMock(args);
    return targets;
  },
}));
vi.mock("@/lib/auth/hooks", () => ({ useAppConvexAuth: () => ({ isAuthenticated: true }) }));
vi.mock("@/lib/routing/current-org-project-context", () => ({ useOptionalCurrentOrgProject: () => route }));
vi.mock("@/lib/navigation", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/navigation")>()),
  useNavigation: () => ({ location: { pathname: "/", search: "", hash: "" }, push: pushMock }),
}));

const URL_482 = "https://github.com/Acme/Web/pull/482";

beforeEach(() => {
  targets = [{ projectAlias: "API", repositoryId: "repo_1", owner: "acme", name: "web" }];
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  route = { organizationId: "org_1", organizationSlug: "org", projectAlias: "WEB" };
});

function renderLink(url = URL_482, nestedInLink = false) {
  render(
    <PullRequestLink url={url} nestedInLink={nestedInLink} aria-label="PR #482">
      #482
    </PullRequestLink>
  );
}

describe("PullRequestLink", () => {
  test("a connected repository opens Convoy's reader, matching owner and name in any case", () => {
    renderLink();
    const link = screen.getByRole("link", { name: "PR #482" });
    expect(link.getAttribute("href")).toBe("/o/org/API/pull-requests?repo=repo_1&pr=482");
    expect(link.getAttribute("target")).toBeNull();
    expect(queryMock).toHaveBeenCalledWith({ organizationId: "org_1" });
  });

  test("prefers the current project when several connect the repository", () => {
    targets = [...(targets as unknown[]), { projectAlias: "WEB", repositoryId: "repo_2", owner: "acme", name: "web" }];
    renderLink();
    expect(screen.getByRole("link", { name: "PR #482" }).getAttribute("href")).toBe("/o/org/WEB/pull-requests?repo=repo_2&pr=482");
  });

  test("an unconnected repository or another host opens GitHub in a new tab", () => {
    renderLink("https://github.com/other/repo/pull/1");
    expect(screen.getByRole("link", { name: "PR #482" }).getAttribute("target")).toBe("_blank");
    cleanup();

    renderLink("https://gitlab.com/acme/web/-/merge_requests/1");
    expect(screen.getByRole("link", { name: "PR #482" }).getAttribute("href")).toBe("https://gitlab.com/acme/web/-/merge_requests/1");
  });

  test("nested in a row link, it is a span that navigates without bubbling", () => {
    const rowClick = vi.fn();
    render(
      <div onClick={rowClick}>
        <PullRequestLink url={URL_482} nestedInLink aria-label="PR #482">
          #482
        </PullRequestLink>
      </div>
    );
    const link = screen.getByRole("link", { name: "PR #482" });
    expect(link.tagName).toBe("SPAN");
    fireEvent.click(link);
    expect(pushMock).toHaveBeenCalledWith(expect.objectContaining({ pathname: "/o/org/API/pull-requests" }));
    expect(rowClick).not.toHaveBeenCalled();
  });
});

/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import { MobileNavBar } from "./mobile-nav-bar";
import { MobileNavBarProvider } from "./mobile-nav-context";

const routeMock = vi.hoisted(() => ({ pathname: "/o/acme/WEB" }));
const projectsMock = vi.hoisted(() => ({ value: undefined as unknown }));

vi.mock("convex/react", () => ({
  useQuery: () => projectsMock.value,
}));

vi.mock("@/lib/navigation", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("@/lib/navigation");
  return {
    ...actual,
    AppLink: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
      <a href={href} {...props}>{children}</a>
    ),
    useRouteParams: () => ({ projectAlias: "WEB" }),
    useNavigation: () => ({
      location: { pathname: routeMock.pathname, search: "", hash: "" },
      push: vi.fn(),
      replace: vi.fn(),
    }),
  };
});

vi.mock("./mobile-menu-panel", () => ({ MobileMenuPanel: () => null }));
vi.mock("./mobile-search-panel", () => ({ MobileSearchPanel: () => null }));
vi.mock("./mobile-create-task-panel", () => ({ MobileCreateTaskPanel: () => null }));

function renderNavBar() {
  return render(
    <MobileNavBarProvider>
      <MobileNavBar organizationId={"org_1" as Id<"organizations">} organizationSlug="acme" />
    </MobileNavBarProvider>
  );
}

const project = (myRole: string) => [{ _id: "project_web", alias: "WEB", myRole }];

describe("MobileNavBar + slot", () => {
  afterEach(() => {
    cleanup();
    routeMock.pathname = "/o/acme/WEB";
  });

  test.each([
    ["the projects load", "/o/acme/WEB", undefined, null],
    ["a member is on task views", "/o/acme/WEB", project("member"), "Create task"],
    ["a viewer is on task views", "/o/acme/WEB", project("viewer"), null],
    ["a member is in threads", "/o/acme/WEB/threads", project("member"), "New thread"],
    ["a viewer is in threads", "/o/acme/WEB/threads", project("viewer"), null],
    ["no project resolves and none is creatable", "/o/acme/WEB", [{ _id: "p2", alias: "OPS", myRole: "viewer" }], null],
    ["no project resolves but another is creatable", "/o/acme/WEB", [{ _id: "p2", alias: "OPS", myRole: "member" }], "Create task"],
  ])("when %s", (_case, pathname, projects, label) => {
    routeMock.pathname = pathname;
    projectsMock.value = projects;

    renderNavBar();

    const plus = screen.queryByRole("button", { name: /^(Create task|New thread)$/ });
    expect(plus?.getAttribute("aria-label") ?? null).toBe(label);
  });
});

describe("MobileNavBar Threads tab", () => {
  afterEach(() => {
    cleanup();
  });

  test.each([
    ["the projects load", undefined, false],
    ["a member's project resolves", project("member"), true],
    ["a viewer's project resolves", project("viewer"), false],
    ["no project resolves and none allows threads", [{ _id: "p2", alias: "OPS", myRole: "viewer" }], false],
    ["no project resolves but another allows threads", [{ _id: "p2", alias: "OPS", myRole: "member" }], true],
  ])("when %s", (_case, projects, shown) => {
    projectsMock.value = projects;

    renderNavBar();

    expect(Boolean(screen.queryByRole("link", { name: "Threads" }))).toBe(shown);
  });
});

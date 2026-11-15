/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { getFunctionName, type FunctionReference } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { SidebarProvider } from "@/components/ui/sidebar";
import { NavMain } from "./nav-main";

const projectsMock = vi.hoisted(() => ({ value: undefined as unknown }));

vi.mock("convex/react", () => ({
  useQuery: (query: FunctionReference<"query">) =>
    getFunctionName(query) === getFunctionName(api.projects.core.listByOrganization)
      ? projectsMock.value
      : undefined,
}));

function renderNavMain() {
  return render(
    <SidebarProvider>
      <NavMain
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="acme"
        onAddTask={vi.fn()}
        notificationsActive={false}
        onToggleNotifications={vi.fn()}
      />
    </SidebarProvider>
  );
}

describe("NavMain add task", () => {
  afterEach(() => {
    cleanup();
  });

  test.each([
    ["while projects load", undefined, false],
    ["when every project is view-only", [{ myRole: "viewer" }], false],
    ["when one project allows creating tasks", [{ myRole: "viewer" }, { myRole: "member" }], true],
  ])("%s", (_case, projects, shown) => {
    projectsMock.value = projects;

    renderNavMain();

    expect(Boolean(screen.queryByRole("button", { name: "Add task" }))).toBe(shown);
  });
});

describe("NavMain Watch Tower", () => {
  afterEach(() => {
    cleanup();
  });

  test.each([
    ["while projects load", undefined, false],
    ["when every project is view-only", [{ myRole: "viewer" }], false],
    ["when one project allows threads", [{ myRole: "viewer" }, { myRole: "member" }], true],
  ])("%s", (_case, projects, shown) => {
    projectsMock.value = projects;

    renderNavMain();

    expect(Boolean(screen.queryByRole("link", { name: "Watch Tower" }))).toBe(shown);
  });
});

/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { MobileMenuPanel } from "./mobile-menu-panel";

vi.mock("@/components/blocks/sidebar/nav-main", () => ({
  NavMain: () => <div>Main nav</div>,
}));

vi.mock("@/components/blocks/sidebar/nav-projects", () => ({
  NavProjects: () => <div>Projects nav</div>,
}));

vi.mock("@/components/blocks/sidebar/nav-user", () => ({
  NavUser: () => <div>User nav</div>,
}));

vi.mock("@/lib/navigation", () => ({
  AppLink: ({
    children,
    href,
    onClick,
    ...props
  }: {
    children: ReactNode;
    href: string;
    onClick?: ComponentProps<"a">["onClick"];
  } & Omit<ComponentProps<"a">, "href">) => (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault();
        onClick?.(event);
      }}
      {...props}
    >
      {children}
    </a>
  ),
  ORGANIZATION_SETTINGS_SECTION_LABELS: {
    general: "General",
    members: "Members",
    projects: "Projects",
    prompts: "Prompts",
    agents: "Agents",
    skills: "Skills",
  },
  appRoute: {
    organization: (organizationSlug: string) => `/o/${organizationSlug}/`,
    organizationSettings: (organizationSlug: string, section: string) =>
      `/o/${organizationSlug}/settings/${section}`,
  },
}));

describe("MobileMenuPanel", () => {
  afterEach(() => {
    cleanup();
  });

  test("opens organization settings drawer with section links", () => {
    render(
      <MobileMenuPanel
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="acme"
        onClose={vi.fn()}
      />
    );

    expect(screen.queryByRole("link", { name: "General" })).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Organization settings" })
    );

    expect(screen.getByRole("link", { name: "General" }).getAttribute("href"))
      .toBe("/o/acme/settings/general");
    expect(screen.getByRole("link", { name: "Members" }).getAttribute("href"))
      .toBe("/o/acme/settings/members");
    expect(screen.getByRole("link", { name: "Prompts" }).getAttribute("href"))
      .toBe("/o/acme/settings/prompts");
    expect(screen.getByRole("link", { name: "Agents" }).getAttribute("href"))
      .toBe("/o/acme/settings/agents");
    expect(screen.getByRole("link", { name: "Skills" }).getAttribute("href"))
      .toBe("/o/acme/settings/skills");
    for (const label of [
      "Workflows",
      "Task templates",
      "Project templates",
    ]) {
      expect(screen.queryByRole("button", { name: label })).toBeNull();
      expect(screen.queryByRole("link", { name: label })).toBeNull();
    }
  });

  test("closes the mobile menu when a settings section is selected", () => {
    const onClose = vi.fn();
    render(
      <MobileMenuPanel
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="acme"
        onClose={onClose}
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Organization settings" })
    );
    fireEvent.click(screen.getByRole("link", { name: "General" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

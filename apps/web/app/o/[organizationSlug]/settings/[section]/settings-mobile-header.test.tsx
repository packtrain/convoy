/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { SettingsMobileHeader } from "./settings-mobile-header";

vi.mock("@/lib/navigation", () => ({
  AppLink: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode;
    href: string;
  } & Omit<ComponentProps<"a">, "href">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  href: (target: string) => target,
  ORGANIZATION_SETTINGS_SECTION_LABELS: {
    general: "General",
    members: "Members",
    projects: "Projects",
    prompts: "Prompts",
    agents: "Agents",
    skills: "Skills",
  },
  appRoute: {
    organizationSettings: (organizationSlug: string, section: string) =>
      `/o/${organizationSlug}/settings/${section}`,
  },
}));

describe("SettingsMobileHeader", () => {
  afterEach(() => {
    cleanup();
  });

  test("renders the active section as a dropdown of section links", () => {
    render(
      <SettingsMobileHeader organizationSlug="acme" activeSection="members" />
    );

    const trigger = screen.getByRole("button", {
      name: "Switch settings section",
    });
    expect(trigger.textContent).toContain("Members");

    fireEvent.pointerDown(trigger);

    const membersItem = screen.getByRole("menuitem", { name: "Members" });
    expect(membersItem.getAttribute("href")).toBe("/o/acme/settings/members");
    expect(membersItem.getAttribute("aria-current")).toBe("page");
    expect(
      screen.getByRole("menuitem", { name: "General" }).getAttribute("href")
    ).toBe("/o/acme/settings/general");
    expect(
      screen.getByRole("menuitem", { name: "Prompts" }).getAttribute("href")
    ).toBe("/o/acme/settings/prompts");
    expect(
      screen.getByRole("menuitem", { name: "Agents" }).getAttribute("href")
    ).toBe("/o/acme/settings/agents");
    expect(
      screen.getByRole("menuitem", { name: "Skills" }).getAttribute("href")
    ).toBe("/o/acme/settings/skills");

    for (const label of [
      "Workflows",
      "Task templates",
      "Project templates",
    ]) {
      expect(screen.queryByRole("menuitem", { name: label })).toBeNull();
    }
  });
});

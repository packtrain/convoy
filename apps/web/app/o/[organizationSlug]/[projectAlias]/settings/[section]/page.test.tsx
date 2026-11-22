/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import ProjectSettingsPage from "./page";
import { PROJECT_USAGE_INFO_SLOT_ID } from "@/components/blocks/project/settings/project-settings-config";

vi.mock("./settings-mobile-header", () => ({
  ProjectSettingsMobileHeader: () => <div>Mobile navigation</div>,
}));

vi.mock("./settings-page-content", () => ({
  ProjectSettingsPageContent: ({ section }: { section: string }) => (
    <div>Project settings content: {section}</div>
  ),
}));

vi.mock("@/lib/navigation/server", () => ({
  notFound: vi.fn(),
}));

describe("ProjectSettingsPage", () => {
  test.each([
    ["general", "General", "Basic project information and settings."],
    ["labels", "Labels", "Each task can have one label. Label order defines the Board column order when grouping by label."],
    ["prompts", "Prompts", undefined],
    ["danger", "Danger zone", "Actions that cannot be undone."],
  ])("the shell owns the %s page title", async (section, title, description) => {
    const page = await ProjectSettingsPage({
      params: Promise.resolve({ organizationSlug: "acme", projectAlias: "WEB", section }),
    });

    render(page);

    const heading = screen.getByRole("heading", { name: title, level: 1 });
    expect(heading.className).toContain("text-2xl");
    if (description) {
      expect(screen.getByText(description)).toBeDefined();
    }
    expect(screen.getByText(`Project settings content: ${section}`)).toBeDefined();
    cleanup();
  });

  test("the usage description ends in the slot for the dashboard's cost details", async () => {
    const page = await ProjectSettingsPage({
      params: Promise.resolve({ organizationSlug: "acme", projectAlias: "WEB", section: "usage" }),
    });

    render(page);

    const slot = document.getElementById(PROJECT_USAGE_INFO_SLOT_ID);
    expect(slot?.parentElement?.textContent).toContain("Agent token spend recorded from CLI threads.");
    cleanup();
  });

  test("the section body fills the page so an empty state can center in it", async () => {
    const page = await ProjectSettingsPage({
      params: Promise.resolve({ organizationSlug: "acme", projectAlias: "WEB", section: "labels" }),
    });

    render(page);

    const container = screen.getByText("Project settings content: labels").parentElement!;
    expect(container.className.split(" ")).toEqual(expect.arrayContaining(["flex", "flex-1", "flex-col"]));
    expect(container.parentElement!.tagName).toBe("MAIN");
    cleanup();
  });
});

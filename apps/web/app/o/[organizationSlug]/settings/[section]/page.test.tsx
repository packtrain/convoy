/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import OrganizationSettingsPage from "./page";

vi.mock("./settings-mobile-header", () => ({
  SettingsMobileHeader: () => <div>Mobile navigation</div>,
}));

vi.mock("./settings-page-content", () => ({
  SettingsPageContent: ({ section }: { section: string }) => <div>Organization settings content: {section}</div>,
}));

vi.mock("@/lib/navigation/server", () => ({
  notFound: vi.fn(),
}));

describe("OrganizationSettingsPage", () => {
  test("the section body fills the page so an empty state can center in it", async () => {
    const page = await OrganizationSettingsPage({
      params: Promise.resolve({ organizationSlug: "acme", section: "agents" }),
    });

    render(page);

    const container = screen.getByText("Organization settings content: agents").parentElement!;
    expect(container.className.split(" ")).toEqual(expect.arrayContaining(["flex", "flex-1", "flex-col"]));
    expect(container.parentElement!.tagName).toBe("MAIN");
  });
});

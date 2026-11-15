import { describe, expect, test } from "vitest";
import {
  deriveOrganizationSettingsSidebarState,
  deriveProjectSettingsSidebarState,
  isOrganizationSettingsSection,
} from "./app-sidebar-route-state";

describe("app sidebar route state", () => {
  test("derives organization settings sections", () => {
    expect(
      deriveOrganizationSettingsSidebarState("/o/acme/settings/general", "acme")
    ).toEqual({ section: "general" });
    expect(
      deriveOrganizationSettingsSidebarState("/o/acme/settings/members/", "acme")
    ).toEqual({ section: "members" });
    expect(
      deriveOrganizationSettingsSidebarState("/o/acme/settings/prompts", "acme")
    ).toEqual({ section: "prompts" });
    expect(
      deriveOrganizationSettingsSidebarState(
        "/o/acme/settings/prompts/cmd_1",
        "acme"
      )
    ).toEqual({ section: "prompts" });
  });

  test("ignores unrelated or invalid paths", () => {
    expect(deriveOrganizationSettingsSidebarState("/o/acme", "acme")).toEqual({
      section: null,
    });
    expect(deriveOrganizationSettingsSidebarState("/o/acme/WEB", "acme")).toEqual({
      section: null,
    });
    expect(
      deriveOrganizationSettingsSidebarState("/o/other/settings/general", "acme")
    ).toEqual({ section: null });
    expect(
      deriveOrganizationSettingsSidebarState("/o/acme/settings/billing", "acme")
    ).toEqual({ section: null });
  });

  test("derives project settings sections", () => {
    expect(
      deriveProjectSettingsSidebarState("/o/acme/WEB/settings/general", "acme")
    ).toEqual({ projectAlias: "WEB", section: "general" });
    expect(
      deriveProjectSettingsSidebarState("/o/acme/WEB/settings/labels/", "acme")
    ).toEqual({ projectAlias: "WEB", section: "labels" });
    expect(
      deriveProjectSettingsSidebarState("/o/acme/WEB/settings/danger", "acme")
    ).toEqual({ projectAlias: "WEB", section: "danger" });
  });

  test("ignores non-project-settings and invalid project paths", () => {
    expect(
      deriveProjectSettingsSidebarState("/o/acme/settings/general", "acme")
    ).toEqual({ projectAlias: null, section: null });
    expect(
      deriveProjectSettingsSidebarState("/o/acme/WEB/kanban", "acme")
    ).toEqual({ projectAlias: null, section: null });
    expect(
      deriveProjectSettingsSidebarState("/o/other/WEB/settings/general", "acme")
    ).toEqual({ projectAlias: null, section: null });
    expect(
      deriveProjectSettingsSidebarState("/o/acme/WEB/settings/bogus", "acme")
    ).toEqual({ projectAlias: "WEB", section: null });
  });

  test("narrows supported settings section ids", () => {
    expect(isOrganizationSettingsSection("general")).toBe(true);
    expect(isOrganizationSettingsSection("members")).toBe(true);
    expect(isOrganizationSettingsSection("prompts")).toBe(true);
    expect(isOrganizationSettingsSection("billing")).toBe(false);
  });
});

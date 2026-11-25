import { describe, expect, test } from "vitest";

import { href, type RouteTarget } from "@/lib/navigation";
import type { DevSettingsSnapshot } from "@/lib/dev-mode/use-dev-mode";
import { getProjectSettingsNavItems } from "./project-settings-navigation";
import { isSectionPermitted, type SectionId } from "./project-settings-config";

const toHref = (target: RouteTarget | string) =>
  typeof target === "string" ? target : href(target);

const DEV_SETTINGS_ALL_DISABLED = {
  extraProjectSettings: false,
  taskListShowRank: false,
  showUnfinishedItems: false,
} as unknown as DevSettingsSnapshot;

function build(
  devSettings: DevSettingsSnapshot,
  canOpenSection: (section: SectionId) => boolean = () => true
) {
  return getProjectSettingsNavItems({
    organizationSlug: "acme",
    projectAlias: "OS",
    activeSection: "members",
    devSettings,
    canOpenSection,
  });
}

const ids = (items: { id: string }[]) => items.map((item) => item.id);

describe("getProjectSettingsNavItems", () => {
  test("marks the active section and links to its route", () => {
    const items = build(DEV_SETTINGS_ALL_DISABLED);
    const members = items.find((item) => item.id === "members");

    expect(members?.isActive).toBe(true);
    expect(members && !members.disabled && toHref(members.href)).toBe(
      "/o/acme/OS/settings/members"
    );
  });

  test("hides dev-gated sections when their toggle is off", () => {
    const items = build(DEV_SETTINGS_ALL_DISABLED);

    expect(items.find((item) => item.id === "templates")).toBeUndefined();
  });

  test("disables dev-gated sections when only unfinished items are shown", () => {
    const items = build({
      ...DEV_SETTINGS_ALL_DISABLED,
      showUnfinishedItems: true,
    } as DevSettingsSnapshot);
    const templates = items.find((item) => item.id === "templates");

    expect(templates?.disabled).toBe(true);
  });

  test("keeps Workflows available when extra project settings are off", () => {
    const items = build(DEV_SETTINGS_ALL_DISABLED);
    const workflows = items.find((item) => item.id === "workflows");

    expect(workflows?.disabled).toBeFalsy();
    expect(workflows && !workflows.disabled && toHref(workflows.href)).toBe(
      "/o/acme/OS/settings/workflows"
    );
  });

  test("enables dev-gated sections when the toggle is on", () => {
    const items = build({
      ...DEV_SETTINGS_ALL_DISABLED,
      extraProjectSettings: true,
    } as DevSettingsSnapshot);
    const templates = items.find((item) => item.id === "templates");

    expect(templates?.disabled).toBeFalsy();
    expect(templates && !templates.disabled && toHref(templates.href)).toBe(
      "/o/acme/OS/settings/templates"
    );
  });

  test("renders Usage as an in-settings section", () => {
    const items = build(DEV_SETTINGS_ALL_DISABLED);
    const usage = items.find((item) => item.id === "usage");

    expect(usage?.disabled).toBeFalsy();
    expect(usage && !usage.disabled && toHref(usage.href)).toBe(
      "/o/acme/OS/settings/usage"
    );
  });

  test("does not render the removed Notifications section", () => {
    const items = build({
      ...DEV_SETTINGS_ALL_DISABLED,
      extraProjectSettings: true,
    } as DevSettingsSnapshot);

    expect(items.some((item) => item.id === "notifications")).toBe(false);
  });

  test("a viewer sees only the sections with something to read", () => {
    const items = build(DEV_SETTINGS_ALL_DISABLED, (section) =>
      isSectionPermitted(section, "viewer", "member")
    );

    expect(ids(items)).toEqual(["general", "members", "labels", "checks", "customization", "pull-requests", "integrations", "usage"]);
  });

  test("a project member sees every section but Danger Zone", () => {
    const items = build(DEV_SETTINGS_ALL_DISABLED, (section) =>
      isSectionPermitted(section, "member", "member")
    );

    expect(ids(items)).toEqual([
      "general",
      "members",
      "agents",
      "prompts",
      "skills",
      "workflows",
      "lists",
      "labels",
      "checks",
      "worktrees",
      "customization",
      "pull-requests",
      "integrations",
      "usage",
    ]);
  });

  test("Danger Zone opens for org project:delete or project:archive", () => {
    expect(isSectionPermitted("danger", "viewer", "admin")).toBe(true);
    expect(isSectionPermitted("danger", "project-admin", "member")).toBe(true);
    expect(isSectionPermitted("danger", "member", "member")).toBe(false);
    expect(isSectionPermitted("danger", undefined, undefined)).toBe(false);
  });

  test("gated sections stay closed while the role loads", () => {
    expect(isSectionPermitted("agents", undefined, undefined)).toBe(false);
    expect(isSectionPermitted("general", undefined, undefined)).toBe(true);
  });
});

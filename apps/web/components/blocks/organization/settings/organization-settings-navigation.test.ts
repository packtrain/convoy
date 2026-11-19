import { describe, expect, test } from "vitest";

import type { DevSettingsSnapshot } from "@/lib/dev-mode/use-dev-mode";
import { getOrganizationSettingsNavItems } from "./organization-settings-navigation";

const DEV_SETTINGS_ALL_DISABLED: DevSettingsSnapshot = {
  extraProjectSettings: false,
  taskListShowRank: false,
  showUnfinishedItems: false,
  toolCallDebug: false,
};

const FUTURE_IDS = ["workflows", "task-templates", "project-templates"];

describe("getOrganizationSettingsNavItems", () => {
  test("hides future sections by default", () => {
    const ids = getOrganizationSettingsNavItems(
      "acme",
      "general",
      DEV_SETTINGS_ALL_DISABLED
    ).map((item) => item.id);

    for (const id of FUTURE_IDS) expect(ids).not.toContain(id);
  });

  test("shows future sections disabled when unfinished items are shown", () => {
    const items = getOrganizationSettingsNavItems("acme", "general", {
      ...DEV_SETTINGS_ALL_DISABLED,
      showUnfinishedItems: true,
    });

    for (const id of FUTURE_IDS) {
      expect(items.find((item) => item.id === id)?.disabled).toBe(true);
    }
  });
});

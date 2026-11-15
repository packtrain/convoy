/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import { SettingsPageHeader, SettingsTwoColumnSection } from "./settings-layout";

describe("SettingsPageHeader", () => {
  afterEach(cleanup);

  test("renders a named parent link when provided", () => {
    render(
      <SettingsPageHeader
        title="Edit prompt"
        backLink={{
          href: { pathname: "/o/acme/settings/prompts" },
          label: "Back to prompts",
        }}
      />
    );

    expect(screen.getByRole("heading", { name: "Edit prompt" })).toBeDefined();
    expect(
      screen.getByRole("link", { name: "Back to prompts" }).getAttribute("href")
    ).toBe("/o/acme/settings/prompts");
  });

  test("omits parent navigation when no link is provided", () => {
    render(<SettingsPageHeader title="General" />);

    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("SettingsTwoColumnSection", () => {
  afterEach(cleanup);

  test("a danger section titles itself in the destructive color", () => {
    render(
      <SettingsTwoColumnSection title="Danger zone" description="Actions that cannot be undone." tone="danger">
        <p>Rows</p>
      </SettingsTwoColumnSection>
    );

    expect(screen.getByRole("heading", { name: "Danger zone" }).className).toContain("text-destructive");
  });

  test("a default section keeps the foreground title", () => {
    render(
      <SettingsTwoColumnSection title="Organization">
        <p>Fields</p>
      </SettingsTwoColumnSection>
    );

    expect(screen.getByRole("heading", { name: "Organization" }).className).not.toContain("text-destructive");
  });
});

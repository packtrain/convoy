/** @vitest-environment jsdom */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PullRequestSettingsSection } from "./pull-request-settings-section";

vi.mock("@/components/blocks/checks", () => ({ PullRequestChecksSettings: () => <p>Checks settings</p> }));
vi.mock("./guide-prompt-section", () => ({ GuidePromptSection: () => <p>Guide prompt section</p> }));

afterEach(cleanup);

describe("PullRequestSettingsSection", () => {
  test("a divider separates Checks from the Guide prompt", () => {
    const { container } = render(<PullRequestSettingsSection projectId={"project_1" as never} canEdit publishPullRequestChecks />);
    // A decorative Separator has no role.
    const separator = container.querySelector('[data-slot="separator"]')!;
    // The page title already says what the rows are for, so they get no heading.
    expect(screen.queryByRole("heading", { name: "Checks" })).toBeNull();
    expect(screen.getByText("Checks settings").compareDocumentPosition(separator) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(separator.compareDocumentPosition(screen.getByText("Guide prompt section")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText("Only project admins can change pull request settings.")).toBeNull();
  });

  test("a member without edit rights sees one note at the top", () => {
    render(<PullRequestSettingsSection projectId={"project_1" as never} canEdit={false} publishPullRequestChecks />);
    expect(screen.getAllByText("Only project admins can change pull request settings.")).toHaveLength(1);
  });
});

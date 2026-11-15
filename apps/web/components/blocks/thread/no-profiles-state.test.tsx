/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NoProfilesState } from "./no-profiles-state";

function expandOtherWays() {
  fireEvent.click(screen.getByRole("button", { name: "Other ways to connect" }));
}

describe("NoProfilesState", () => {
  afterEach(cleanup);

  test("shows one primary command and collapses the other two", () => {
    const { container } = render(<NoProfilesState projectId="proj_abc123" />);

    expect(container.textContent).toContain("npx @useconvoy/cli connect");
    expect(container.textContent).not.toContain("npx @useconvoy/cli setup");
    expect(
      screen.getByRole("button", { name: "Other ways to connect" }).getAttribute("aria-expanded")
    ).toBe("false");
    expect(screen.getAllByRole("button", { name: "Copy command" })).toHaveLength(1);
  });

  // Interactive connect asks for the deployment URL, so it is shown before the fold.
  test("shows the backend URL above the fold with its own copy button", () => {
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://example-123.convex.cloud");
    render(<NoProfilesState projectId="proj_abc123" />);

    expect(screen.getByText("Backend URL")).toBeDefined();
    expect(screen.getByText("https://example-123.convex.cloud")).toBeDefined();
    expect(screen.getByRole("button", { name: "Copy backend URL" })).toBeDefined();
    vi.unstubAllEnvs();
  });

  test("keeps every copy button visible and wraps long commands in the box", () => {
    const { container } = render(<NoProfilesState projectId="proj_abc123" />);
    expandOtherWays();

    const copyButtons = screen.getAllByRole("button", { name: "Copy command" });
    expect(copyButtons).toHaveLength(3);
    for (const button of copyButtons) {
      expect(button.className).not.toContain("opacity-0");
    }
    for (const code of container.querySelectorAll("code")) {
      expect(code.className).toContain("whitespace-pre-wrap");
    }
  });

  test("renders quick-start commands with project-prefilled values", () => {
    const { container } = render(
      <NoProfilesState
        projectId="proj_abc123"
        projectName="Project Alpha"
        projectAlias="ABC"
      />
    );
    expandOtherWays();

    expect(screen.getByText("Create profile")).toBeTruthy();
    expect(screen.queryByText("Fully automatic profile setup")).toBeNull();
    expect(container.textContent).toContain("npx @useconvoy/cli setup --project");
    expect(container.textContent).toContain(
      "--project proj_abc123 --profile 'Project Alpha' --profile-key abc --url"
    );
    expect(container.textContent).not.toContain("--api-key <api_key>");
    expect(container.textContent).not.toContain("--path .");
    expect(
      container.textContent
    ).toContain("npx @useconvoy/cli connect --profile abc");
  });

  test("falls back to placeholders when project values are unavailable", () => {
    const { container } = render(<NoProfilesState />);
    expandOtherWays();

    expect(
      container.textContent
    ).toContain("--project <project_id> --profile default --profile-key default");
  });
});

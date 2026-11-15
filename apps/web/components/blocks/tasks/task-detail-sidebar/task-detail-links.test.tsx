/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { format } from "date-fns";
import { afterEach, describe, expect, test } from "vitest";
import type { TaskExternalLink } from "@/lib/tasks/external-links";
import { TaskDetailLinks } from "./task-detail-links";

afterEach(() => {
  cleanup();
});

describe("TaskDetailLinks", () => {
  test("renders url-bearing links as external anchors", () => {
    const links: TaskExternalLink[] = [
      {
        id: "github-pr-acme-app-12",
        kind: "pull_request",
        url: "https://github.com/acme/app/pull/12",
        title: "Add links",
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    render(<TaskDetailLinks links={links} />);

    const anchor = screen.getByRole("link", { name: /PR: Add links/ });
    expect(anchor.getAttribute("href")).toBe(
      "https://github.com/acme/app/pull/12"
    );
    expect(anchor.getAttribute("target")).toBe("_blank");
    expect(anchor.getAttribute("rel")).toBe("noopener noreferrer");
  });

  test("does not duplicate the pull request label prefix", () => {
    const links: TaskExternalLink[] = [
      {
        id: "github-pr-acme-app-13",
        kind: "pull_request",
        url: "https://github.com/acme/app/pull/13",
        title: "PR: Add retry button",
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    render(<TaskDetailLinks links={links} />);

    expect(
      screen.getByRole("link", { name: /PR: Add retry button/ })
    ).toBeTruthy();
    expect(screen.queryByText("PR: PR: Add retry button")).toBeNull();
  });

  test("uses the updated timestamp as the native title", () => {
    const updatedAt = Date.UTC(2026, 1, 16, 12, 30, 0);
    const links: TaskExternalLink[] = [
      {
        id: "github-pr-acme-app-14",
        kind: "pull_request",
        url: "https://github.com/acme/app/pull/14",
        title: "Add sidebar link title",
        createdAt: Date.UTC(2026, 1, 15, 12, 30, 0),
        updatedAt,
      },
    ];

    render(<TaskDetailLinks links={links} />);

    expect(screen.getByRole("link").getAttribute("title")).toBe(
      `Updated ${format(new Date(updatedAt), "PPpp")}`
    );
  });

  test("falls back to the created timestamp as the native title", () => {
    const createdAt = Date.UTC(2026, 1, 15, 12, 30, 0);
    const links: TaskExternalLink[] = [
      {
        id: "branch-feature",
        kind: "branch",
        name: "feature/links",
        createdAt,
        updatedAt: Number.NaN,
      },
    ];

    render(<TaskDetailLinks links={links} />);

    const item = screen.getByText("feature/links").parentElement;
    expect(item?.getAttribute("title")).toBe(
      `Created ${format(new Date(createdAt), "PPpp")}`
    );
  });

  test("renders links without a url as plain text", () => {
    const links: TaskExternalLink[] = [
      {
        id: "branch-feature",
        kind: "branch",
        name: "feature/links",
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    render(<TaskDetailLinks links={links} />);

    expect(screen.getByText("feature/links")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  test("renders commit labels as short sha plus title", () => {
    const links: TaskExternalLink[] = [
      {
        id: "commit-abcdef1",
        kind: "commit",
        sha: "abcdef1234567",
        title: "Fix billing",
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    render(<TaskDetailLinks links={links} />);

    expect(screen.getByText("abcdef1 Fix billing")).toBeTruthy();
  });
});

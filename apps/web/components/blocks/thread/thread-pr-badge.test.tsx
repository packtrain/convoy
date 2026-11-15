/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ThreadPrBadge } from "./thread-pr-badge";
import type { ThreadPullRequest } from "@/lib/threads/pull-request";

const pullRequest: ThreadPullRequest = {
  provider: "github",
  number: 123,
  title: "Add PR badge",
  url: "https://github.com/acme/repo/pull/123",
  state: "open",
  headBranch: "feat/pr-badge",
  baseBranch: "main",
  capturedAt: Date.now(),
};

describe("ThreadPrBadge", () => {
  afterEach(cleanup);

  test("renders an external link with the short ref by default", () => {
    render(<ThreadPrBadge pullRequest={pullRequest} />);

    const badge = screen.getByLabelText("PR #123 · Open — Add PR badge");
    expect(badge.tagName).toBe("A");
    expect(badge.getAttribute("href")).toBe(pullRequest.url);
    expect(badge.getAttribute("target")).toBe("_blank");
    expect(badge.textContent).toBe("#123");
  });

  test("nestedInLink renders a role=link span whose click opens the PR without bubbling", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const onRowClick = vi.fn();
    render(
      <a href="/thread" aria-label="Thread row" onClick={onRowClick}>
        <ThreadPrBadge pullRequest={pullRequest} nestedInLink />
      </a>
    );

    const badge = screen.getByRole("link", {
      name: "PR #123 · Open — Add PR badge",
    });
    expect(badge.tagName).toBe("SPAN");

    fireEvent.click(badge);
    expect(open).toHaveBeenCalledWith(
      pullRequest.url,
      "_blank",
      "noopener,noreferrer"
    );
    expect(onRowClick).not.toHaveBeenCalled();

    fireEvent.keyDown(badge, { key: "Enter" });
    expect(open).toHaveBeenCalledTimes(2);
    open.mockRestore();
  });
});

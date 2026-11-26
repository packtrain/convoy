/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { RuntimeNoticePart } from "./runtime-notice-part";

const params = vi.hoisted(() => ({ value: { organizationSlug: "acme", projectAlias: "WEB" } as Record<string, string> }));
vi.mock("@/lib/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/navigation")>()),
  useRouteParams: () => params.value,
}));

afterEach(cleanup);

const unapproved = {
  type: "runtime-notice" as const,
  code: "worktree-setup-unapproved",
  title: "Worktree setup",
  message: "The setup script for `packtrain/convoy` needs your approval.",
};

describe("RuntimeNoticePart", () => {
  test("links an unapproved worktree setup to Project settings → Worktrees", () => {
    render(<RuntimeNoticePart part={unapproved} />);

    expect(screen.getByText(/needs your approval/)).toBeDefined();
    const link = screen.getByRole("link", { name: "Review script" });
    expect(link.getAttribute("href")).toBe("/o/acme/WEB/settings/worktrees");
    expect(link.closest("button")).toBeNull();
    expect(link.closest(".truncate")).toBeNull();
  });

  test("renders the repo key as code and lets the text wrap", () => {
    render(<RuntimeNoticePart part={unapproved} />);

    const code = screen.getByText("packtrain/convoy");
    expect(code.tagName).toBe("CODE");
    expect(code.closest(".truncate")).toBeNull();
    expect(screen.queryByText(/`/)).toBeNull();
  });

  test("keeps the text without a link outside a project route", () => {
    params.value = {};
    render(<RuntimeNoticePart part={unapproved} />);

    expect(screen.getByText(/needs your approval/)).toBeDefined();
    expect(screen.queryByRole("link")).toBeNull();
  });
});

const published = (payload: Record<string, unknown>) => ({
  type: "runtime-notice" as const,
  code: "claude-code-change-published",
  title: "Code change published",
  message: "Published packtrain/convoy#9.",
  detailsJson: JSON.stringify({ subtype: "code_change_published", payload }),
});

const payload = {
  provider: "github",
  url: "https://github.com/packtrain/convoy/pull/9",
  repo: "packtrain/convoy",
  identifier: "9",
  action: "created",
  branch: "epic/os-2173-pull-request-watch-wake",
};

describe("RuntimeNoticePart: code change published", () => {
  test("renders one row linking the PR on GitHub, with its branch and no JSON", () => {
    render(<RuntimeNoticePart part={published(payload)} />);

    expect(screen.getByText("Opened pull request")).toBeDefined();
    const link = screen.getByRole("link", { name: /packtrain\/convoy\s*#9/ });
    expect(link.getAttribute("href")).toBe(payload.url);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(screen.getByText(payload.branch)).toBeDefined();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText(/Code change published/)).toBeNull();
  });

  test("says Published for an action other than created", () => {
    render(<RuntimeNoticePart part={published({ ...payload, action: "updated" })} />);

    expect(screen.getByText("Published pull request")).toBeDefined();
  });

  test("keeps the generic notice when the payload has no url", () => {
    render(<RuntimeNoticePart part={published({ ...payload, url: undefined })} />);

    expect(screen.getByText(/Code change published: Published packtrain\/convoy#9\./)).toBeDefined();
    expect(screen.queryByRole("link")).toBeNull();
  });
});

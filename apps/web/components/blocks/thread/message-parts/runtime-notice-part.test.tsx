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

  test("keeps the text without a link outside a project route", () => {
    params.value = {};
    render(<RuntimeNoticePart part={unapproved} />);

    expect(screen.getByText(/needs your approval/)).toBeDefined();
    expect(screen.queryByRole("link")).toBeNull();
  });
});

/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

const worktreeNotice = (code: string, fields: Record<string, string>) => ({
  type: "runtime-notice" as const,
  code,
  title: "Working directory recovered",
  message: "The thread previously ran in /repo-worktrees/feat-captions. Its working directory is now /repo.",
  detailsJson: JSON.stringify(fields),
});

describe("worktree change notices (OS-2609)", () => {
  const fallback = { change: "parent", previousPath: "/repo-worktrees/feat-captions", path: "/repo", branch: "main" };

  test("shows (old) → (new) and the cause, with the old directory struck through when it is gone", () => {
    render(<RuntimeNoticePart part={worktreeNotice("workspace-recovered", fallback)} />);

    const trigger = screen.getByRole("button");
    expect(trigger.textContent).toContain("feat-captions");
    expect(trigger.textContent).toContain("repo");
    expect(trigger.textContent).toContain("worktree removed");
    expect(trigger.textContent).not.toContain("previously ran in");
    expect(screen.getByText("feat-captions").className).toContain("line-through");
  });

  test("opens the full paths, branch and explanation on click", () => {
    render(<RuntimeNoticePart part={worktreeNotice("workspace-recovered", fallback)} />);
    expect(screen.queryByText("/repo-worktrees/feat-captions")).toBeNull();

    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByText("/repo-worktrees/feat-captions")).toBeDefined();
    expect(screen.getByText("/repo")).toBeDefined();
    expect(screen.getByText("main")).toBeDefined();
    expect(screen.getByText(/fell back to its parent checkout/)).toBeDefined();
  });

  test("labels a moved worktree by its last two folders, since the basenames match", () => {
    render(<RuntimeNoticePart part={worktreeNotice("workspace-recovered", {
      change: "moved", previousPath: "/wt/feat-captions", path: "/wt/archive/feat-captions", branch: "feat/captions",
    })} />);

    const trigger = screen.getByRole("button");
    expect(trigger.textContent).toContain("wt/feat-captions");
    expect(trigger.textContent).toContain("archive/feat-captions");
    expect(trigger.textContent).toContain("worktree moved");
  });

  test("shows a created worktree, and the pending create before it finishes", () => {
    const { unmount } = render(<RuntimeNoticePart part={worktreeNotice("worktree-created", {
      change: "created", previousPath: "/repo", path: "/repo-worktrees/feat-captions", branch: "feat/captions", baseRef: "main",
    })} />);
    expect(screen.getByRole("button").textContent).toContain("new worktree");
    expect(screen.getByText("feat-captions").className).not.toContain("line-through");
    unmount();

    render(<RuntimeNoticePart part={worktreeNotice("worktree-create", { previousPath: "/repo", branch: "feat/captions", baseRef: "main" })} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/Creating worktree/).textContent).toContain("feat/captions");
  });

  test("falls back to the message row when an older CLI sent no fields", () => {
    render(<RuntimeNoticePart part={{ ...worktreeNotice("workspace-recovered", {}), detailsJson: undefined }} />);
    expect(screen.getByText(/previously ran in/)).toBeDefined();
  });
});

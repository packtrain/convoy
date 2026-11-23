/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { ProjectActionsDropdown } from "./project-actions-dropdown";

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    disabled,
    onClick,
    className,
    asChild,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
    className?: string;
    asChild?: boolean;
  }) =>
    asChild ? (
      <>{children}</>
    ) : (
      <button type="button" disabled={disabled} onClick={onClick} className={className}>
        {children}
      </button>
    ),
  DropdownMenuSeparator: () => <hr />,
}));

vi.mock("@/lib/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/navigation")>()),
  AppLink: ({
    href,
    children,
  }: {
    href: string;
    children: ReactNode;
  }) => <a href={href}>{children}</a>,
}));

vi.mock("@/components/ui/sidebar", () => ({
  SidebarMenuAction: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
  useSidebar: () => ({ isMobile: false }),
}));

describe("ProjectActionsDropdown", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  const project = {
    organizationSlug: "acme",
    projectAlias: "convoy",
    myRole: "project-admin",
    orgRole: "admin",
  } as const;

  test("renders navigating actions as links so the browser can open them in a new tab", () => {
    render(<ProjectActionsDropdown {...project} onDelete={vi.fn()} onArchive={vi.fn()} />);

    expect(screen.queryByText("Share")).toBeNull();
    const hrefFor = (name: string) =>
      screen.getByRole("link", { name }).getAttribute("href");
    expect(hrefFor("Settings")).toBe("/o/acme/convoy/settings/general");
    expect(hrefFor("Add members")).toBe("/o/acme/convoy/settings/members");
    expect(hrefFor("Agents")).toBe("/o/acme/convoy/settings/agents");
    expect(hrefFor("Prompts")).toBe("/o/acme/convoy/settings/prompts");
    expect(hrefFor("Skills")).toBe("/o/acme/convoy/settings/skills");
    expect(hrefFor("Workflows")).toBe("/o/acme/convoy/settings/workflows");
    expect(hrefFor("Lists")).toBe("/o/acme/convoy/settings/lists");
    expect(hrefFor("Integrations")).toBe("/o/acme/convoy/settings/integrations");
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Settings",
      "Add members",
      "Agents",
      "Prompts",
      "Skills",
      "Workflows",
      "Integrations",
      "Lists",
    ]);
  });

  test("Archive asks the caller to confirm", () => {
    const onArchive = vi.fn();
    render(<ProjectActionsDropdown {...project} onDelete={vi.fn()} onArchive={onArchive} />);

    screen.getByRole("button", { name: "Archive" }).click();
    expect(onArchive).toHaveBeenCalledTimes(1);
  });

  test("Archive needs project:archive or org projects:manage_all", () => {
    render(
      <ProjectActionsDropdown {...project} myRole="member" orgRole="member" onDelete={vi.fn()} onArchive={vi.fn()} />
    );
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
    cleanup();

    render(
      <ProjectActionsDropdown {...project} myRole="viewer" orgRole="admin" onDelete={vi.fn()} onArchive={vi.fn()} />
    );
    expect(screen.getByRole("button", { name: "Archive" })).toBeTruthy();
  });

  test("a viewer gets Settings only, and Delete only with the org permission", () => {
    render(
      <ProjectActionsDropdown {...project} myRole="viewer" orgRole="member" onDelete={vi.fn()} onArchive={vi.fn()} />
    );

    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(["Settings"]);
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    cleanup();

    // No project-admin bypass: an org admin viewing a project can still delete it.
    render(
      <ProjectActionsDropdown {...project} myRole="viewer" orgRole="admin" onDelete={vi.fn()} onArchive={vi.fn()} />
    );
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(["Settings"]);
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
  });

  test("a member manages everything but members, integrations, and delete", () => {
    render(
      <ProjectActionsDropdown {...project} myRole="member" orgRole="member" onDelete={vi.fn()} onArchive={vi.fn()} />
    );

    expect(screen.queryByRole("link", { name: "Add members" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Integrations" })).toBeNull();
    expect(screen.getByRole("link", { name: "Lists" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });

  test("offers nothing gated while the roles load", () => {
    render(
      <ProjectActionsDropdown {...project} myRole={undefined} orgRole={undefined} onDelete={vi.fn()} onArchive={vi.fn()} />
    );

    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(["Settings"]);
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });
});

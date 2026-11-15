/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  cloneElement,
  isValidElement,
  type ComponentProps,
  type ReactNode,
} from "react";
import { WorkspaceFooterActions } from "./workspace-footer-actions";

let isMobileSidebar = false;

vi.mock("@/lib/navigation", () => ({
  AppLink: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode;
    href: { pathname: string } | string;
  } & Omit<ComponentProps<"a">, "href">) => (
    <a href={typeof href === "string" ? href : href.pathname} {...props}>
      {children}
    </a>
  ),
  appRoute: {
    organizationSettings: (slug: string, section: string) => ({
      pathname: `/o/${slug}/settings/${section}`,
    }),
  },
}));

vi.mock("@/components/ui/sidebar", () => ({
  SidebarMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarMenuItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarMenuButton: ({
    asChild,
    children,
    className,
    onClick,
  }: {
    asChild?: boolean;
    children: ReactNode;
    className?: string;
    onClick?: () => void;
  } & ComponentProps<"button">) => (
    asChild && isValidElement<{ className?: string }>(children)
      ? cloneElement(children, {
          className: [children.props.className, className].filter(Boolean).join(" "),
        })
      : (
        <button className={className} type="button" onClick={onClick}>
          {children}
        </button>
      )
  ),
  useSidebar: () => ({ isMobile: isMobileSidebar }),
}));

describe("WorkspaceFooterActions", () => {
  afterEach(() => {
    cleanup();
    isMobileSidebar = false;
  });

  test("links to settings sub-sidebar", () => {
    render(
      <WorkspaceFooterActions
        organizationSlug="acme"
      />
    );

    expect(screen.getByRole("link", { name: "Organization settings" }).getAttribute("href"))
      .toBe("/o/acme/settings/general");
    expect(screen.queryByRole("button", { name: "Settings (popup)" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add members" })).toBeNull();
  });

  test("does not render the settings sub-sidebar link on mobile", () => {
    isMobileSidebar = true;

    render(
      <WorkspaceFooterActions
        organizationSlug="acme"
      />
    );

    expect(screen.queryByRole("link", { name: "Organization settings" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Settings (popup)" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add members" })).toBeNull();
  });
});

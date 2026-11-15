/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { MouseEventHandler, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AppLink } from "./app-link";

const navigationMocks = vi.hoisted(() => ({
  pathname: "/o/acme/WEB",
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigationMocks.pathname,
  useRouter: () => ({
    push: navigationMocks.push,
    replace: navigationMocks.replace,
  }),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    onClick,
    ...props
  }: {
    children: ReactNode;
    href: string;
    onClick?: MouseEventHandler<HTMLAnchorElement>;
  }) => (
    <a href={href} onClick={onClick} {...props}>
      {children}
    </a>
  ),
}));

describe("AppLink", () => {
  beforeEach(() => {
    navigationMocks.pathname = "/o/acme/WEB";
    navigationMocks.push.mockReset();
    navigationMocks.replace.mockReset();
    window.history.replaceState({}, "", "/o/acme/WEB");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  test("routes same-path query links through the navigation kernel", () => {
    const pushStateSpy = vi.spyOn(window.history, "pushState");
    render(<AppLink href="/o/acme/WEB?list=SPRINT-1">Sprint 1</AppLink>);

    fireEvent.click(screen.getByRole("link", { name: "Sprint 1" }));

    expect(pushStateSpy).toHaveBeenCalledWith(
      window.history.state,
      "",
      "/o/acme/WEB?list=SPRINT-1"
    );
    expect(navigationMocks.push).not.toHaveBeenCalled();
  });

  test("leaves modified clicks to the browser", () => {
    const pushStateSpy = vi.spyOn(window.history, "pushState");
    render(<AppLink href="/o/acme/WEB?list=SPRINT-1">Sprint 1</AppLink>);

    fireEvent.click(screen.getByRole("link", { name: "Sprint 1" }), {
      metaKey: true,
    });

    expect(pushStateSpy).not.toHaveBeenCalled();
    expect(navigationMocks.push).not.toHaveBeenCalled();
  });
});

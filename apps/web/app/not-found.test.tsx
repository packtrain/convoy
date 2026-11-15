/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";
import NotFoundPage from "./not-found";

vi.mock("@/lib/navigation", () => ({
  appRoute: { home: () => ({ pathname: "/" }) },
  AppLink: ({ href, children }: { href: { pathname: string }; children: ReactNode }) => (
    <a href={href.pathname}>{children}</a>
  ),
}));

afterEach(cleanup);

test("renders the shared not-found state with a way home", () => {
  render(<NotFoundPage />);

  const heading = screen.getByRole("heading", { level: 1, name: "Page not found" });
  expect(heading.closest('[data-slot="empty"]')).not.toBeNull();
  expect(screen.getByRole("link", { name: "Go home" }).getAttribute("href")).toBe("/");
});

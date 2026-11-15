/**
 * @vitest-environment jsdom
 */
import { cleanup, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ThemeProvider } from "./theme-provider";

const themeMock = vi.hoisted(() => ({ resolvedTheme: "dark" }));

vi.mock("next-themes", () => ({
  ThemeProvider: ({ children }: { children: ReactNode }) => children,
  useTheme: () => themeMock,
}));

describe("ThemeProvider", () => {
  beforeEach(() => {
    themeMock.resolvedTheme = "dark";
    document.head.innerHTML = `
      <meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff">
      <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#131313">
    `;
  });

  afterEach(() => {
    cleanup();
    document.head.innerHTML = "";
  });

  test("synchronizes every theme color with the resolved app appearance", async () => {
    const { rerender } = render(
      <ThemeProvider>
        <div />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(readThemeColors()).toEqual(["#131313", "#131313"]);
    });

    themeMock.resolvedTheme = "light";
    rerender(
      <ThemeProvider>
        <div />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(readThemeColors()).toEqual(["#ffffff", "#ffffff"]);
    });
  });
});

function readThemeColors() {
  return Array.from(
    document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
  ).map((element) => element.content);
}

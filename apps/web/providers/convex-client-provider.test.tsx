/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolvedTheme: undefined as string | undefined,
  appearance: undefined as unknown,
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: mocks.resolvedTheme }),
}));
vi.mock("@clerk/nextjs", () => ({
  ClerkProvider: ({ appearance, children }: { appearance?: unknown; children: ReactNode }) => {
    mocks.appearance = appearance;
    return <>{children}</>;
  },
}));
vi.mock("convex/react", () => ({
  ConvexReactClient: class {},
  ConvexProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useMutation: vi.fn(),
}));
vi.mock("./convex-clerk-provider", () => ({
  ConvexClerkProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import { ConvexClientProvider } from "./convex-client-provider";

function renderWithTheme(resolvedTheme: string | undefined) {
  mocks.resolvedTheme = resolvedTheme;
  render(<ConvexClientProvider>child</ConvexClientProvider>);
  return mocks.appearance as { variables?: Record<string, string> } | undefined;
}

describe("ConvexClientProvider Clerk appearance", () => {
  afterEach(() => {
    cleanup();
    mocks.appearance = undefined;
  });

  test("dark theme renders Clerk on the app's dark card and text colors", () => {
    expect(renderWithTheme("dark")?.variables).toMatchObject({
      colorBackground: "#181818",
      colorForeground: "#e8e8e8",
    });
  });

  test("light theme renders Clerk on the app's light card and text colors", () => {
    expect(renderWithTheme("light")?.variables).toMatchObject({
      colorBackground: "#ffffff",
      colorForeground: "#0a0a0a",
    });
  });

  test("an unresolved theme falls back to the light palette", () => {
    expect(renderWithTheme(undefined)?.variables).toMatchObject({ colorBackground: "#ffffff" });
  });
});

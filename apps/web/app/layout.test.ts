import { describe, expect, test, vi } from "vitest";

vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "--font-geist-sans" }),
  Geist_Mono: () => ({ variable: "--font-geist-mono" }),
  Inter: () => ({ variable: "--font-sans" }),
}));
vi.mock("../providers/convex-client-provider", () => ({
  ConvexClientProvider: ({ children }: { children: React.ReactNode }) =>
    children,
}));
vi.mock("../providers/theme-provider", () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));
vi.mock("@vercel/analytics/next", () => ({ Analytics: () => null }));
vi.mock("@vercel/speed-insights/next", () => ({ SpeedInsights: () => null }));
vi.mock("@/lib/navigation", () => ({
  NavigationProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/blocks/app-version-watcher", () => ({
  AppVersionWatcher: () => null,
}));

describe("root viewport metadata", () => {
  test("advertises theme colors for both system preferences", async () => {
    const { viewport } = await import("./layout");

    expect(viewport.themeColor).toEqual([
      { media: "(prefers-color-scheme: light)", color: "#ffffff" },
      { media: "(prefers-color-scheme: dark)", color: "#131313" },
    ]);
  });
});

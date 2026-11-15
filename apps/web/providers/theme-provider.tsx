"use client"

import {
  ThemeProvider as NextThemesProvider,
  useTheme,
} from "next-themes";
import { type ReactNode, useEffect } from "react";
import { APP_THEME_COLORS } from "@/lib/theme/constants";

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <ThemeColorSync />
      {children}
    </NextThemesProvider>
  );
}

function ThemeColorSync() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (resolvedTheme !== "light" && resolvedTheme !== "dark") return;

    const color = APP_THEME_COLORS[resolvedTheme];
    document
      .querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
      .forEach((element) => element.setAttribute("content", color));
  }, [resolvedTheme]);

  return null;
}

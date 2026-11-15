"use client";

import { MonitorCog, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/mdx-editor-kit/ui/button";
import { cn } from "@/lib/utils";

type Theme = "dark" | "light" | "system";

const STORAGE_KEY = "ui-playground-theme";

function resolveSystemTheme() {
  if (typeof window === "undefined") {
    return "dark";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  const resolvedTheme = theme === "system" ? resolveSystemTheme() : theme;

  root.classList.remove("dark", "light");
  root.classList.add(resolvedTheme);
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === "undefined") {
      return "dark";
    }

    const storedTheme = window.localStorage.getItem(STORAGE_KEY);
    return storedTheme === "light" || storedTheme === "dark" || storedTheme === "system"
      ? storedTheme
      : "dark";
  });

  useEffect(() => {
    applyTheme(theme);

    if (theme !== "system") {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const syncTheme = () => applyTheme("system");

    mediaQuery.addEventListener("change", syncTheme);
    return () => mediaQuery.removeEventListener("change", syncTheme);
  }, [theme]);

  function handleThemeChange(nextTheme: Theme) {
    setTheme(nextTheme);
    window.localStorage.setItem(STORAGE_KEY, nextTheme);
    applyTheme(nextTheme);
  }

  return (
    <div className="fixed right-5 top-5 z-50 inline-flex items-center gap-1 rounded-2xl border border-border bg-card/90 p-1.5 shadow-[var(--shadow-soft)] backdrop-blur-xl">
      <ThemeButton
        active={theme === "light"}
        ariaLabel="Use light theme"
        onClick={() => handleThemeChange("light")}
      >
        <Sun className="size-4" />
      </ThemeButton>
      <ThemeButton
        active={theme === "dark"}
        ariaLabel="Use dark theme"
        onClick={() => handleThemeChange("dark")}
      >
        <Moon className="size-4" />
      </ThemeButton>
      <ThemeButton
        active={theme === "system"}
        ariaLabel="Use system theme"
        onClick={() => handleThemeChange("system")}
      >
        <MonitorCog className="size-4" />
      </ThemeButton>
    </div>
  );
}

function ThemeButton({
  active,
  ariaLabel,
  children,
  onClick,
}: {
  active: boolean;
  ariaLabel: string;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={ariaLabel}
      className={cn(
        "rounded-[10px] text-muted-foreground hover:bg-muted hover:text-foreground",
        active && "bg-background text-primary shadow-[var(--shadow-soft)] hover:bg-background"
      )}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

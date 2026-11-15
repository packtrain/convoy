"use client";

import { useState } from "react";
import { ConsoleFigure } from "./console-figure";
import "../software-factory/kit/iso.css";
import "./console.css";

/** Landing-page candidate: Watch Tower as an air-traffic controller's desk. */
export default function WatchTowerConsolePlaygroundPage() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  return (
    <main className="iso min-h-screen px-6 py-12" data-theme={theme} style={{ background: "var(--anatomy-page)", color: "var(--anatomy-text)" }}>
      <div className="mx-auto max-w-[920px]">
        <div className="flex items-center justify-between font-mono text-xs">
          <span>Watch Tower console · anatomy figure</span>
          <button type="button" className="underline-offset-4 hover:underline" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            {theme === "dark" ? "Light" : "Dark"} theme
          </button>
        </div>
        <ConsoleFigure />
      </div>
    </main>
  );
}

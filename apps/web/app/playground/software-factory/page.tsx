"use client";

import { useState } from "react";
import { FactoryFigure } from "./factory-figure";
import "./kit/iso.css";
import "./factory.css";

/** Landing-page candidate: the "software factory" tagline as an isometric anatomy figure. */
export default function SoftwareFactoryPlaygroundPage() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  return (
    <main className="iso min-h-screen px-6 py-12" data-theme={theme} style={{ background: "var(--anatomy-page)", color: "var(--anatomy-text)" }}>
      <div className="mx-auto max-w-[920px]">
        <div className="flex items-center justify-between font-mono text-xs">
          <span>Software factory · anatomy figure</span>
          <button type="button" className="underline-offset-4 hover:underline" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            {theme === "dark" ? "Light" : "Dark"} theme
          </button>
        </div>
        <FactoryFigure />
      </div>
    </main>
  );
}

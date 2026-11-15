"use client";

import { useState } from "react";
import { ExchangeFigure } from "./exchange-figure";
import "../software-factory/kit/iso.css";
import "./exchange.css";

/** Landing-page candidate: Convoy's architecture as an isometric pneumatic tube post. */
export default function AgentExchangePlaygroundPage() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  return (
    <main className="iso min-h-screen px-6 py-12" data-theme={theme} style={{ background: "var(--anatomy-page)", color: "var(--anatomy-text)" }}>
      <div className="mx-auto max-w-[920px]">
        <div className="flex items-center justify-between font-mono text-xs">
          <span>Agent post · anatomy figure</span>
          <button type="button" className="underline-offset-4 hover:underline" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            {theme === "dark" ? "Light" : "Dark"} theme
          </button>
        </div>
        <ExchangeFigure />
      </div>
    </main>
  );
}

import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import { HeroPreview } from "@/components/product-preview";

const inter = Inter({ subsets: ["latin"], variable: "--font-preview-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-preview-mono" });

export const metadata: Metadata = {
  title: "Hero playground · Convoy",
  robots: { index: false, follow: false },
};

export default function HeroPlaygroundPage() {
  return (
    <main className={`${inter.variable} ${mono.variable} mx-auto max-w-[2000px] px-3 py-8 sm:px-6 sm:py-12`}>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-xs text-[#8f94a1]">Convoy playground</p>
          <h1 className="text-2xl font-medium tracking-tight">Hero application preview</h1>
        </div>
        <p className="max-w-sm text-sm text-[#8f94a1]">Select a thread and expand its tool calls. This example uses fictional project data.</p>
      </header>
      <HeroPreview />
    </main>
  );
}

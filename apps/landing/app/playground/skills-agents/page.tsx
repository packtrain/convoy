import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import { SkillsAgentsPreview } from "@/components/product-preview";

const inter = Inter({ subsets: ["latin"], variable: "--font-preview-sans" });

export const metadata: Metadata = {
  title: "Skills and agents playground · Convoy",
  robots: { index: false, follow: false },
};

export default function SkillsAgentsPlaygroundPage() {
  return (
    <main className={`${inter.variable} mx-auto max-w-[1120px] px-3 py-8 sm:px-6 sm:py-12`}>
      <header className="mb-8">
        <Link href="/playground" className="text-xs text-[#8f94a1] hover:text-white">Convoy playground</Link>
        <h1 className="mt-2 text-2xl font-medium tracking-tight">Skills and agents preview</h1>
        <p className="mt-3 text-sm text-[#8f94a1]">Two separate product views, with fictional review instructions.</p>
      </header>
      <section className="overflow-hidden rounded-xl border border-white/10 bg-[#151418]">
        <div className="px-6 pt-7 pb-2 sm:px-8">
          <h2 className="text-xl font-medium tracking-tight">Give your agents the way your team works</h2>
          <p className="mt-3 max-w-[65ch] text-[15px] leading-relaxed text-[#a8a5ae]">Define an agent’s responsibilities. Keep reusable procedures in Skills that agents can load when the work calls for them.</p>
        </div>
        <SkillsAgentsPreview />
      </section>
    </main>
  );
}

import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import { WatchTowerPreview } from "@/components/product-preview/watch-tower";

const inter = Inter({ subsets: ["latin"], variable: "--font-preview-sans" });
export const metadata: Metadata = { title: "Watch Tower playground · Convoy", robots: { index: false, follow: false } };

export default function WatchTowerPlaygroundPage() {
  return <main className={`${inter.variable} mx-auto max-w-[1120px] px-3 py-8 sm:px-6 sm:py-12`}>
    <header className="mb-8"><Link href="/playground" className="text-xs text-[#8f94a1] hover:text-white">Convoy playground</Link><h1 className="mt-2 text-2xl font-medium">Watch Tower preview</h1><p className="mt-3 text-sm text-[#8f94a1]">A focused crop of the attention sections. Use View settings to compare List and Board.</p></header>
    <section className="overflow-hidden rounded-xl border border-white/10 bg-[#151418] p-4 sm:p-8">
      <h2 className="text-xl font-medium">See which runs need you</h2><p className="mt-3 mb-8 text-[15px] text-[#a8a5ae]">Questions, failed runs and finished work across your projects.</p>
      <WatchTowerPreview crop />
    </section>
  </main>;
}

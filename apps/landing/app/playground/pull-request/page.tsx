import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import Link from "next/link";
import { PullRequestPreview } from "@/components/product-preview/pull-request";

const inter = Inter({ subsets: ["latin"], variable: "--font-preview-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-preview-mono" });
export const metadata: Metadata = { title: "Pull request playground · Convoy", robots: { index: false, follow: false } };

export default function PullRequestPlaygroundPage() {
  return <main className={`${inter.variable} ${mono.variable} mx-auto max-w-[1240px] px-3 py-8 sm:px-6 sm:py-12`}>
    <header className="mb-8"><Link href="/playground" className="text-xs text-[#8f94a1] hover:text-white">Convoy playground</Link><h1 className="mt-2 text-2xl font-medium">Pull request review preview</h1><p className="mt-3 text-sm text-[#8f94a1]">Overview with checks and Activity, the agent-written Guide, and the Diff.</p></header>
    <PullRequestPreview />
  </main>;
}

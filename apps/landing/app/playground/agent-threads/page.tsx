import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import { AgentThreadsPreview } from "@/components/product-preview/agent-threads";

const inter = Inter({ subsets: ["latin"], variable: "--font-preview-sans" });
export const metadata: Metadata = { title: "Agent threads playground · Convoy", robots: { index: false, follow: false } };

export default function AgentThreadsPlaygroundPage() {
  return <main className={`${inter.variable} mx-auto max-w-[1280px] px-3 py-8 sm:px-6 sm:py-12`}>
    <header className="mb-8"><Link href="/playground" className="text-xs text-[#8f94a1] hover:text-white">Convoy playground</Link><h1 className="mt-2 text-2xl font-medium">Agent threads preview</h1><p className="mt-3 text-sm text-[#8f94a1]">A thread that started other agent threads and exchanges messages with them.</p></header>
    <section className="rounded-xl border border-white/10 bg-[#151418] p-4 sm:p-8"><AgentThreadsPreview /></section>
    <p className="mt-5 text-xs leading-5 text-[#8f94a1]">Thread crop based on the product UI with an explanatory diagram around it. Agents and threads are fictional; the motion stops under reduced motion.</p>
  </main>;
}

import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import { ThreadGroupsPreview } from "@/components/product-preview/thread-groups";

const inter = Inter({ subsets: ["latin"], variable: "--font-preview-sans" });
export const metadata: Metadata = { title: "Thread groups playground · Convoy", robots: { index: false, follow: false } };

export default function ThreadGroupsPlaygroundPage() {
  return <main className={`${inter.variable} mx-auto max-w-[1120px] px-3 py-8 sm:px-6 sm:py-12`}>
    <header className="mb-8"><Link href="/playground" className="text-xs text-[#8f94a1] hover:text-white">Convoy playground</Link><h1 className="mt-2 text-2xl font-medium">Thread groups preview</h1><p className="mt-3 text-sm text-[#8f94a1]">Switch between related threads using the tabs at the top.</p></header>
    <section className="rounded-xl border border-white/10 bg-[#151418] p-4 sm:p-8">
      <h2 className="text-xl font-medium">Keep related threads together</h2><p className="mt-3 mb-8 text-[15px] text-[#a8a5ae]">Move between related conversations in one thread container.</p>
      <ThreadGroupsPreview />
    </section>
    <p className="mt-5 text-xs leading-5 text-[#8f94a1]">Thread container crop based on the product UI. Tabs switch locally; the plus and composer are display-only.</p>
  </main>;
}

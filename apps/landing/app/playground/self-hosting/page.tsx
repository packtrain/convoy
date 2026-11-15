import type { Metadata } from "next";
import Link from "next/link";
import { SelfHostingPreview } from "@/components/product-preview/self-hosting";

export const metadata: Metadata = { title: "Self-hosting playground · Convoy", robots: { index: false, follow: false } };

export default function SelfHostingPlaygroundPage() {
  return <main className="mx-auto max-w-[1120px] px-3 py-8 sm:px-6 sm:py-12">
    <header className="mb-8"><Link href="/playground" className="text-xs text-[#8f94a1] hover:text-white">Convoy playground</Link><h1 className="mt-2 text-2xl font-medium">Self-hosting diagram</h1><p className="mt-3 text-sm text-[#8f94a1]">What runs on your infrastructure, how machines connect and what stays external.</p></header>
    <section className="grid border border-white/[0.07] lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="border-white/[0.07] p-8 max-lg:border-b lg:border-r sm:p-10"><h2 className="text-[28px] font-[450] leading-[1.08] tracking-[-0.035em] sm:text-[34px]">Run Convoy yourself.</h2><p className="mt-4 max-w-[46ch] text-[15px] leading-relaxed text-[#8f94a1]">Host Convoy&apos;s web app and backend on your own infrastructure. Connect the machines where your agents work and manage them from your own Convoy instance.</p></div>
      <div className="flex min-w-0 items-center p-8 sm:p-10"><SelfHostingPreview /></div>
    </section>
    <p className="mt-5 text-xs leading-5 text-[#8f94a1]">Explanatory diagram, not a product screen. Machine names and runtimes are fictional; the motion stops under reduced motion.</p>
  </main>;
}

import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import { RemoteThreadPreview } from "@/components/product-preview/remote-thread";

const inter = Inter({ subsets: ["latin"], variable: "--font-preview-sans" });
export const metadata: Metadata = { title: "Remote thread playground · Convoy", robots: { index: false, follow: false } };

export default function RemoteThreadPlaygroundPage() {
  return (
    <main className={`${inter.variable} mx-auto max-w-[1040px] px-3 py-8 sm:px-6 sm:py-12`}>
      <header className="mb-8">
        <Link href="/playground" className="text-xs text-[#8f94a1] hover:text-white">Convoy playground</Link>
        <h1 className="mt-2 text-2xl font-medium">Remote thread preview</h1>
      </header>
      <section className="grid grid-cols-1 items-center gap-8 rounded-xl border border-white/10 bg-[#151418] px-2 py-8 sm:p-8 md:grid-cols-2">
        <div className="px-3 sm:px-0">
          <h2 className="text-2xl font-medium">Check on your coding agent from your phone.</h2>
          <p className="mt-4 max-w-sm text-[15px] leading-6 text-[#a8a5ae]">Your agent works on your code on a computer or server you connect to Convoy. Open Convoy in your phone&apos;s browser to see what the agent has done, answer its questions or ask for changes.</p>
        </div>
        <RemoteThreadPreview />
      </section>
      <p className="mt-5 text-xs leading-5 text-[#8f94a1]">Mobile web thread with fictional messages. Expand the tool call to inspect its output. Header actions and composer are display-only.</p>
    </main>
  );
}

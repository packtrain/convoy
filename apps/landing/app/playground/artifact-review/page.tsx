import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import { ArtifactReviewPreview } from "@/components/product-preview/artifact-review";

const inter = Inter({ subsets: ["latin"], variable: "--font-preview-sans" });
export const metadata: Metadata = { title: "Artifact review playground · Convoy", robots: { index: false, follow: false } };

export default function ArtifactReviewPlaygroundPage() {
  return <main className={`${inter.variable} mx-auto max-w-[1120px] px-3 py-8 sm:px-6 sm:py-12`}>
    <header className="mb-8">
      <Link href="/playground" className="text-xs text-[#8f94a1] hover:text-white">Convoy playground</Link>
      <h1 className="mt-2 text-2xl font-medium">Artifact review preview</h1>
      <p className="mt-3 text-sm text-[#8f94a1]">Select the highlighted passage to open its feedback. The comments button hides or shows the rail.</p>
    </header>
    <section className="rounded-xl border border-white/10 bg-[#151418] p-4 sm:p-8">
      <h2 className="text-xl font-medium">Review the plan where it lives</h2>
      <p className="mt-3 mb-8 text-[15px] text-[#a8a5ae]">Leave feedback on a specific passage and keep the discussion beside the document.</p>
      <ArtifactReviewPreview />
    </section>
    <p className="mt-5 text-xs leading-5 text-[#8f94a1]">Document and comments crop. Editing toolbar, resize handles and mutation controls are omitted. Narrow layouts stack the comments below the document.</p>
  </main>;
}

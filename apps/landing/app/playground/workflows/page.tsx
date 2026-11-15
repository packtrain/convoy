import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import { WorkflowPreview } from "@/components/product-preview";

const inter = Inter({ subsets: ["latin"], variable: "--font-preview-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-preview-mono" });

export const metadata: Metadata = {
  title: "Workflow playground · Convoy",
  robots: { index: false, follow: false },
};

export default function WorkflowPlaygroundPage() {
  return (
    <main className={`${inter.variable} ${mono.variable} mx-auto max-w-[1040px] px-3 py-8 sm:px-6 sm:py-12`}>
      <header className="mb-8">
        <p className="mb-2 text-xs text-[#8f94a1]">Convoy playground</p>
        <h1 className="text-2xl font-medium tracking-tight">Workflow section preview</h1>
        <p className="mt-3 text-sm text-[#8f94a1]">A focused view of a fictional webhook workflow. Scroll horizontally to explore the lanes.</p>
      </header>
      <section className="overflow-hidden rounded-xl border border-white/10 bg-[#151418]">
        <div className="px-6 pt-7 pb-2 sm:px-8">
          <h2 className="text-xl font-medium tracking-tight">Build a workflow you can run again</h2>
          <p className="mt-3 max-w-[65ch] text-[15px] leading-relaxed text-[#a8a5ae]">Combine agent prompts, human approval and Bash checks. Run independent reviews in parallel, then move to the next stage together.</p>
        </div>
        <WorkflowPreview />
      </section>
      <details className="mt-8 text-sm text-[#8f94a1]">
        <summary className="mb-4 w-fit cursor-pointer">Inspect the grid without the marketing frame</summary>
        <WorkflowPreview reference />
      </details>
    </main>
  );
}

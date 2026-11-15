import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import { TaskArtifactsPreview } from "@/components/product-preview/task-artifacts";

const inter = Inter({ subsets: ["latin"], variable: "--font-preview-sans" });
export const metadata: Metadata = { title: "Task artifacts playground · Convoy", robots: { index: false, follow: false } };

export default function TaskArtifactsPlaygroundPage() {
  return <main className={`${inter.variable} mx-auto max-w-[1120px] px-3 py-8 sm:px-6 sm:py-12`}>
    <header className="mb-8"><Link href="/playground" className="text-xs text-[#8f94a1] hover:text-white">Convoy playground</Link><h1 className="mt-2 text-2xl font-medium">Task artifacts preview</h1><p className="mt-3 text-sm text-[#8f94a1]">Select an artifact in Resources to open it beside the task.</p></header>
    <section className="rounded-xl border border-white/10 bg-[#151418] p-4 sm:p-8">
      <h2 className="text-xl font-medium">Keep agent output with the task</h2><p className="mt-3 mb-8 text-[15px] text-[#a8a5ae]">Plans, reports and handoffs live in the task they belong to.</p>
      <TaskArtifactsPreview />
    </section>
    <p className="mt-5 text-xs leading-5 text-[#8f94a1]">Task Resources and artifact panel crop. Other task fields, the editor toolbar, comments and delete controls are omitted. Narrow layouts stack the document below the resources.</p>
  </main>;
}

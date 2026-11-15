import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import { TaskAssignmentPreview } from "@/components/product-preview/task-assignment";

const inter = Inter({ subsets: ["latin"], variable: "--font-preview-sans" });
export const metadata: Metadata = { title: "Task assignment playground · Convoy", robots: { index: false, follow: false } };

export default function TaskAssignmentPlaygroundPage() {
  return <main className={`${inter.variable} mx-auto max-w-[1040px] px-3 py-8 sm:px-6 sm:py-12`}>
    <header className="mb-8"><Link href="/playground" className="text-xs text-[#8f94a1] hover:text-white">Convoy playground</Link><h1 className="mt-2 text-2xl font-medium">Task assignment preview</h1></header>
    <section className="grid grid-cols-1 items-center gap-8 rounded-xl border border-white/10 bg-[#151418] px-2 py-8 sm:p-8 md:grid-cols-2">
      <div className="px-3 sm:px-0"><h2 className="text-2xl font-medium">Assign a task to an agent</h2><p className="mt-4 text-[15px] leading-6 text-[#a8a5ae]">Choose an agent with the instructions and preferences for the job. Keep a teammate responsible for the task.</p></div>
      <TaskAssignmentPreview />
    </section>
    <p className="mt-5 text-xs leading-5 text-[#8f94a1]">Search and select fictional assignees. Changes stay in this preview. Adding agents and inviting teammates are display-only.</p>
  </main>;
}

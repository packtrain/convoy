import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import { ProjectOrganizationPreview } from "@/components/product-preview/project-organization";

const inter = Inter({ subsets: ["latin"], variable: "--font-preview-sans" });
export const metadata: Metadata = { title: "Project organization playground · Convoy", robots: { index: false, follow: false } };

export default function ProjectOrganizationPlaygroundPage() {
  return <main className={`${inter.variable} mx-auto max-w-[1200px] px-3 py-8 sm:px-6 sm:py-12`}>
    <header className="mb-8"><Link href="/playground" className="text-xs text-[#8f94a1] hover:text-white">Convoy playground</Link><h1 className="mt-2 text-2xl font-medium">Project organization preview</h1></header>
    <section className="overflow-hidden rounded-xl border border-white/10 bg-[#151418]">
      <div className="p-6 sm:p-8"><h2 className="text-2xl font-medium">Keep tasks, files and pull requests together.</h2><p className="mt-3 max-w-2xl text-[15px] leading-6 text-[#a8a5ae]">Plan work in Lists, break it into subtasks, and switch between Table and Board views. Keep the context on the task.</p></div>
      <div className="h-[560px] border-t border-white/10"><ProjectOrganizationPreview /></div>
    </section>
    <p className="mt-5 text-xs leading-5 text-[#8f94a1]">Switch views, search tasks and open their details. This is the same project view used in the hero. All changes stay in the preview.</p>
  </main>;
}

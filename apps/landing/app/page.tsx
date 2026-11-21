import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Logo } from "@/components/logo";
import { HalftoneHero } from "@/components/effects/halftone-hero";
import { RevealOnScroll } from "@/components/effects/reveal-on-scroll";
import { HeroPreview } from "@/components/product-preview";
import { TaskAssignmentPreview } from "@/components/product-preview/task-assignment";
import { ProjectOrganizationPreview } from "@/components/product-preview/project-organization";
import { TaskArtifactsPreview } from "@/components/product-preview/task-artifacts";
import { EnvironmentsPreview } from "@/components/product-preview/environments";
import { ChecksPreview } from "@/components/product-preview/checks";
import { PullRequestPreview } from "@/components/product-preview/pull-request";
import { SelfHostingPreview } from "@/components/product-preview/self-hosting";
import styles from "./page.module.css";
import { Footer } from "@/components/footer";
import { featureGroups, site } from "@/lib/copy";
import { HeroCopy, HeroProcess } from "./hero-copy";
import { CliLogoGrid } from "./cli-logos";
import { WhyCards } from "./why-cards";

const inter = Inter({ subsets: ["latin"], variable: "--font-preview-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-preview-mono" });

// Homepage only, so playground routes never inherit its canonical. Contract: docs/specs/landing-seo.md.
export const metadata: Metadata = {
  alternates: { canonical: "/" },
  openGraph: { type: "website", url: "/", siteName: site.name, title: site.title, description: site.description, locale: "en_US" },
  twitter: { card: "summary_large_image", title: site.title, description: site.description, images: ["/opengraph-image.png"] },
};


// `<` is escaped so page copy can never close the script tag.
const jsonLd = JSON.stringify({ "@context": "https://schema.org", "@type": "WebSite", name: site.name, url: `${site.url}/` }).replace(/</g, "\\u003c");

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={className} aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

const LINE = "border-white/[0.07]";
const DIM = "text-[#8f94a1]";
const GLASS_PILL = "group inline-flex cursor-pointer items-center rounded-full border border-white/15 bg-white/[0.04] font-[510] text-[#f2f3f5] backdrop-blur-md transition-[background-color,border-color,transform] duration-150 ease-[var(--ease-out)] hover:border-white/25 hover:bg-white/[0.08] active:scale-[0.97] motion-reduce:active:scale-[1]";

function GitHubButton() {
  return (
    <a
      href={site.repoUrl}
      className={`${GLASS_PILL} h-11 gap-2.5 pr-4 pl-5 text-[14px]`}
    >
      <GitHubIcon className="size-[18px]" /> View on GitHub
      <ArrowRight aria-hidden className="size-4 transition-transform duration-200 ease-[var(--ease-out)] group-hover:translate-x-0.5" />
    </a>
  );
}

const platformRows = [
  {
    title: "Assign a task to an agent",
    body: "Choose an agent with the instructions and preferences for the job. Start a thread from the task, send follow-up instructions, and follow the run from your board.",
    preview: <TaskAssignmentPreview />,
    scene: "task-assignment",
    copy: "left",
  },
  {
    title: "Keep tasks, files and pull requests together.",
    body: "Plan work in Lists, break it into subtasks, and switch between Board and Table views. Keep priorities, comments, attachments and related pull requests on the task so the next step has its context.",
    preview: <div className={styles.project}><ProjectOrganizationPreview initialMode="board" /></div>,
    scene: "project-organization",
    // The table needs the full width, so its copy sits on top.
    copy: "top",
  },
  {
    title: "Keep plans and results with the task",
    body: "Save plans, reviews and handoff notes as task artifacts. Teammates can review the documents, leave feedback and return to the decisions as the work continues.",
    preview: <TaskArtifactsPreview />,
    scene: "task-artifacts",
    copy: "right",
  },
] as const;

const ROW_GRID = { left: "lg:grid-cols-[320px_minmax(0,1fr)]", top: "", right: "lg:grid-cols-[minmax(0,1fr)_320px]" };
const COPY_SIDE = { left: "lg:order-1 lg:border-r", top: "border-b", right: "lg:order-2 lg:border-l" };

export default function Home() {
  return (
    <div className={`${inter.variable} ${mono.variable} bg-[#08080d] text-[#f2f3f5]`}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      <RevealOnScroll />
      {/* Nav — full width, content aligned to the column */}
      <header className={`sticky top-0 z-40 border-b ${LINE} bg-[#08080d]/85 backdrop-blur-md`}>
        <nav className="mx-auto flex h-[61px] max-w-[1200px] items-center px-6">
          <Link href="/" aria-label="Convoy">
            <Logo className="h-[25px] w-auto text-[#f2f3f5]" />
          </Link>
          <div className={`ml-10 hidden gap-7 text-[14px] leading-5 ${DIM} md:flex`}>
            <a href="#product" className="transition-colors hover:text-[#f2f3f5]">Product</a>
            <a href="#agents" className="transition-colors hover:text-[#f2f3f5]">Agents</a>
            <a href="#features" className="transition-colors hover:text-[#f2f3f5]">Features</a>
            <a href={`${site.docsUrl}docs`} className="transition-colors hover:text-[#f2f3f5]">Docs</a>
          </div>
          <div className="ml-auto flex items-center gap-5">
            <a
              href={site.repoUrl}
              className={`${GLASS_PILL} h-8 gap-2 px-3.5 text-[12px]`}
            >
              <GitHubIcon className="size-4" /> View on GitHub
            </a>
          </div>
        </nav>
      </header>

      <main>
        {/* The preview overhangs the animation; a spacer below clears it. */}
        <section className={`relative z-10 flex min-h-[calc(100svh-62px)] flex-col border-b ${LINE}`}>
          <HalftoneHero />
          <div className="pointer-events-none relative mx-auto flex w-full max-w-[1200px] flex-1 flex-col justify-end px-6 pt-32 sm:pt-44">
            <HeroCopy />
            <div className="enter pointer-events-auto mt-8 flex gap-3 [animation-delay:160ms]">
              <GitHubButton />
            </div>
            <HeroProcess />
            <div aria-hidden className="h-7 shrink-0" />
          </div>
          <div data-preview="hero" className={`enter pointer-events-auto relative z-20 mx-auto w-full -mb-[120px] max-w-[1760px] px-3 sm:px-6 lg:-mb-[240px] ${styles.hero} [animation-delay:240ms]`}>
            <HeroPreview />
          </div>

        </section>

        <div className={`mx-auto max-w-[1200px] border-x ${LINE}`}>
          <div aria-hidden className="pt-[120px] lg:pt-[240px]" />
          <section id="product" className={`scroll-mt-[61px] border-b ${LINE}`}>
            <div className="reveal px-8 py-20 sm:px-10 sm:py-24">
              <h2 className="max-w-[18ch] text-4xl font-[450] leading-[1.08] tracking-[-0.035em] text-balance sm:text-[48px]">
                Your team&apos;s software factory
              </h2>
              <p className="mt-6 max-w-[52ch] text-[17px] leading-[1.65] text-[#c6cad3]">
                Turn your team&apos;s expertise into a shared process for building
                software with AI. Bring agents, skills, workflows, and checks together so
                teammates can put that process to work and improve it across projects.
              </p>
            </div>
            <WhyCards />
          </section>

          <section id="agents" className={`scroll-mt-[61px] border-b ${LINE}`}>
            <div className={`reveal border-b ${LINE} px-8 py-20 text-center sm:py-24`}>
              <h2 className="mx-auto text-4xl font-[450] leading-[1.08] tracking-[-0.035em] text-balance sm:text-[48px]">
                Your process.
                <br />
                Your coding agents.
              </h2>
              <p className="mx-auto mt-6 max-w-[52ch] text-[17px] leading-[1.65] text-[#c6cad3]">
                Use Claude Code, Codex, OpenCode, Cursor, or Antigravity with your team&apos;s workflows.
                Agents run on your connected machines. Follow their work and review
                results in Convoy&apos;s web UI.
              </p>
            </div>
            <CliLogoGrid />
          </section>

          <section className={`border-b ${LINE}`}>
            <div className={`reveal border-b ${LINE} px-8 py-20 sm:px-10 sm:py-24`}>
              <h2 className="max-w-[20ch] text-4xl font-[450] leading-[1.08] tracking-[-0.035em] text-balance sm:text-[48px]">
                Tasks and agents in one place.
              </h2>
              <p className="mt-6 max-w-[52ch] text-[17px] leading-[1.65] text-[#c6cad3]">
                Organize the work, assign an agent, and keep its progress and results
                connected to the task. Review check results and evidence before you hand work off.
              </p>
            </div>
            {platformRows.map((row, i) => (
              <div
                key={row.title}
                className={`reveal grid ${ROW_GRID[row.copy]} ${i < platformRows.length - 1 ? `border-b ${LINE}` : ""}`}
              >
                <div className={`flex min-w-0 flex-col border-white/[0.07] p-8 max-lg:border-b sm:p-12 ${COPY_SIDE[row.copy]}`}>
                  <h3 className="text-[24px] font-[480] leading-snug tracking-[-0.025em]">
                    {row.title}
                  </h3>
                  <p className={`mt-4 max-w-[46ch] text-[15px] leading-relaxed ${DIM}`}>
                    {row.body}
                  </p>
                </div>
                <div data-preview={row.scene} className={`min-w-0 self-center p-3 sm:p-6 ${row.copy === "right" ? "lg:order-1" : "lg:order-2"}`}>
                  {row.preview}
                </div>
              </div>
            ))}
          </section>

          <section id="checks" className={`reveal scroll-mt-[61px] grid border-b ${LINE} lg:grid-cols-[320px_minmax(0,1fr)]`}>
            <div className="min-w-0 border-white/[0.07] p-8 max-lg:border-b lg:border-r sm:p-10">
              <p className="mb-5 text-[12px] font-medium tracking-[0.08em] text-[#a3a3a3] uppercase">Checks &amp; evidence</p>
              <h2 className="max-w-[18ch] text-[28px] font-[450] leading-[1.08] tracking-[-0.035em] sm:text-[34px]">See what passed.<br />Inspect the proof.</h2>
              <p className={`mt-5 max-w-[46ch] text-[15px] leading-relaxed ${DIM}`}>Give each task a checklist. Agents report results with notes, screenshots, logs, or reports, so your team can see what was verified and what still needs attention.</p>
              <p className={`mt-4 max-w-[46ch] text-[15px] leading-relaxed ${DIM}`}>Open the evidence beside the conversation. Ask the agent to run pending and failed checks, or run the whole checklist again.</p>
              <a href={`${site.docsUrl}docs/using/checks`} className="mt-7 inline-flex items-center gap-2 text-[13px] text-[#c6cad3] hover:text-white">How checks work <ArrowRight aria-hidden className="size-4" /></a>
            </div>
            <div data-preview="checks" className="min-w-0 self-center p-3 sm:p-6"><ChecksPreview /></div>
          </section>

          <section id="pull-requests" className={`reveal scroll-mt-[61px] border-b ${LINE}`}>
            <div className={`grid gap-6 border-b ${LINE} p-8 sm:p-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-12`}>
              <div>
                <p className="mb-5 text-[12px] font-medium tracking-[0.08em] text-[#a3a3a3] uppercase">Guided reviews</p>
                <h2 className="max-w-[18ch] text-[28px] font-[450] leading-[1.08] tracking-[-0.035em] sm:text-[34px]">Review pull requests chapter by chapter.</h2>
              </div>
              <div className="lg:pt-9">
                <p className={`max-w-[52ch] text-[15px] leading-relaxed ${DIM}`}>Guided reviews group related changes into chapters, so you can see how a change fits together even when it spans a dozen files. Notes beside the code explain what changed and where to look closely. When you come back to a review, you can see what still needs your attention and catch up on checks, commits, and agent discussions in one timeline.</p>
              </div>
            </div>
            <div data-preview="pull-request" className="min-w-0 p-3 sm:p-6"><PullRequestPreview /></div>
          </section>

          <section id="environments" className={`reveal grid border-b ${LINE} lg:grid-cols-[minmax(0,1fr)_320px]`}>
            <div className="min-w-0 border-white/[0.07] p-8 max-lg:border-b lg:order-2 lg:border-l sm:p-10">
              <h2 className="max-w-[18ch] text-[28px] font-[450] leading-[1.08] tracking-[-0.035em] sm:text-[34px]">
                Manage where your agents run.
              </h2>
              <p className={`mt-4 max-w-[46ch] text-[15px] leading-relaxed ${DIM}`}>
                Use <code className="[font:inherit]">convoy tui</code> to manage local and Docker environments
                from your terminal. See connected projects, check service status,
                and add environments with keyboard shortcuts.
              </p>
              <code className="mt-7 inline-block border border-white/15 bg-white/[0.04] px-3 py-2 font-mono text-[13px] text-[#c6cad3]">convoy tui</code>
            </div>
            <div data-preview="environments" className="min-w-0 self-center p-3 sm:p-6 lg:order-1">
              <EnvironmentsPreview />
            </div>
          </section>

          {/* Self-hosting */}
          <section
            id="self-hosting"
            className={`reveal grid border-b ${LINE} lg:grid-cols-[320px_minmax(0,1fr)]`}
          >
            <div className={`min-w-0 border-white/[0.07] p-8 max-lg:border-b lg:border-r sm:p-10`}>
              <h2 className="max-w-[18ch] text-[28px] font-[450] leading-[1.08] tracking-[-0.035em] sm:text-[34px]">
                Run Convoy yourself.
              </h2>
              <p className={`mt-4 max-w-[46ch] text-[15px] leading-relaxed ${DIM}`}>
                Self-host Convoy&apos;s web app and backend on your own infrastructure.
                Connect the machines where your coding agents work and manage them from
                your own Convoy instance.
              </p>
              <div className="mt-7 flex flex-col items-start gap-4">
                <a href={`${site.docsUrl}docs/deployment`} className="inline-flex items-center gap-2 text-[13px] text-[#c6cad3] hover:text-white">How to self-host <ArrowRight aria-hidden className="size-4" /></a>
                <a
                  href={site.repoUrl}
                  className="inline-flex cursor-pointer items-center gap-2 text-[13px] text-[#c6cad3] transition-colors hover:text-[#f2f3f5]"
                >
                  <GitHubIcon className="size-5" /> {new URL(site.repoUrl).pathname.slice(1)}
                </a>
              </div>
            </div>
            <div data-preview="self-hosting" className="min-w-0 p-6 sm:p-10">
              <SelfHostingPreview />
            </div>
          </section>

          {/* Feature index */}
          <section id="features" className="scroll-mt-[61px]">
            <div className={`reveal border-b ${LINE} px-8 py-16 sm:px-10 sm:py-20`}>
              <h2 className="text-4xl font-[450] leading-[1.08] tracking-[-0.035em] text-[#f2f3f5] sm:text-[48px]">
                Feature index
              </h2>
            </div>
            {featureGroups.map((group) => (
              <div key={group.title} className={`reveal border-b ${LINE}`}>
                <div className="grid lg:grid-cols-[220px_1fr]">
                  <div className={`border-b ${LINE} p-6 lg:border-r lg:border-b-0 sm:px-10 lg:px-6`}>
                    <h3 className="text-[14px] font-[520] text-[#c6cad3]">{group.title}</h3>
                  </div>
                  <div className="grid min-w-0 sm:grid-cols-2">
                    {group.features.map((feature, index) => {
                      const lastDesktopRowStart =
                        group.features.length - (group.features.length % 2 === 0 ? 2 : 1);

                      return (
                        <div
                          key={feature.name}
                          className={`min-w-0 border-white/[0.07] p-6 sm:p-8 ${index % 2 === 0 ? "sm:border-r" : ""} ${index < group.features.length - 1 ? "max-sm:border-b" : ""} ${index < lastDesktopRowStart ? "sm:border-b" : ""}`}
                        >
                          <p className="text-[15px] font-[520] text-[#f2f3f5]">
                            {feature.name}
                            {feature.soon ? (
                              <span className="ml-2 text-[11px] font-[450] text-[#6f7480]">
                                /soon
                              </span>
                            ) : null}
                          </p>
                          <p className={`mt-2 text-[15px] leading-relaxed ${DIM}`}>
                            {feature.body}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
          </section>

          {/* CTA */}
          <section id="cta" className="reveal px-6 py-28 text-center">
            <h2 className="mx-auto max-w-[24ch] text-4xl font-[450] leading-[1.08] tracking-[-0.035em] text-balance sm:text-[44px]">
              Build your team&apos;s way of working with AI.
            </h2>
            <p className="mx-auto mt-6 max-w-[52ch] text-[17px] leading-[1.65] text-[#c6cad3]">
              Start with one workflow. Give your team a process they can reuse and improve.
            </p>
            <div className="mt-9 flex justify-center gap-3">
              <GitHubButton />
            </div>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}

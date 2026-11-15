import Link from "next/link";
import { FilePenLine } from "lucide-react";

const demos = [
  {
    href: "/mdx-editor",
    title: "MDX Editor",
    description:
      "Client-only MDXEditor with live preview, raw source output, and source/diff mode for quick iteration.",
  },
];

export default function HomePage() {
  return (
    <main className="min-h-screen px-6 pb-[72px] pt-12 sm:px-6">
      <div className="mx-auto grid max-w-[960px] gap-6">
        <section className="rounded-[28px] border border-border bg-card p-8 shadow-[var(--shadow-elevated)] backdrop-blur-[18px]">
          <p className="mb-3 text-[0.78rem] font-bold uppercase tracking-[0.16em] text-primary">
            Convoy UI Playground
          </p>
          <h1 className="m-0 text-[clamp(2.2rem,6vw,4rem)] leading-[0.96]">
            Standalone interface experiments, isolated from the main app.
          </h1>
          <p className="mt-[18px] max-w-[56ch] text-[1.02rem] leading-[1.65] text-muted-foreground">
            This project is generated as its own Next.js app so new editor ideas can be tested without
            pulling root-level repo tooling into the workflow. Start with the MDX authoring demo below.
          </p>
        </section>

        <section
          className="grid gap-[18px] [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))]"
          aria-label="Available demos"
        >
          {demos.map((demo) => (
            <Link
              key={demo.href}
              href={demo.href}
              className="rounded-[20px] border border-border bg-card p-6 shadow-[var(--shadow-soft)] transition-[transform,border-color,box-shadow] duration-150 ease-out hover:-translate-y-0.5 hover:border-border-strong hover:shadow-[var(--shadow-elevated)]"
            >
              <div className="mb-3 flex items-center gap-3">
                <span className="inline-flex size-10 items-center justify-center rounded-2xl bg-muted text-primary">
                  <FilePenLine className="size-5" />
                </span>
                <h2 className="m-0 text-[1.2rem]">{demo.title}</h2>
              </div>
              <p className="m-0 leading-[1.6] text-muted-foreground">{demo.description}</p>
            </Link>
          ))}
        </section>
      </div>
    </main>
  );
}

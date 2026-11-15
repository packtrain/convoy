import { Logo } from "@/components/logo";
import { site } from "@/lib/copy";

/* Nothing but the wordmark on flat bg, with © / email in a bottom strip;
   wordmark and strip align to the page's 1200px column. */
export function Footer({ bg = "#07070b", email = "team@convoy.build" }: { bg?: string; email?: string }) {
  return (
    <footer className="relative overflow-hidden border-t border-white/[0.06]" style={{ background: bg }}>
      {/* The wordmark spans the page's 1200px column so its edges meet the column
          hairlines above; max-h still keeps it inside the footer — the SVG's default
          preserveAspectRatio scales the artwork down instead of cropping it. */}
      <Logo
        aria-hidden
        className="pointer-events-none absolute bottom-[84px] left-1/2 max-h-[calc(100%-8rem)] w-full max-w-[1200px] -translate-x-1/2 text-white/[0.04] [--lm-wave:#fff]"
      />
      <div className="h-[340px]" />
      <div className="relative border-t border-white/[0.06]">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-10 gap-y-2 px-6 py-5 text-[13px] text-[#8a8f98]">
          <p>© 2026</p>
          <p>
            <a href={`mailto:${email}`} className="transition-colors hover:text-[#f7f8f8]">
              {email}
            </a>
          </p>
          <nav aria-label="Resources" className="ml-auto flex gap-6">
            <a href={site.docsUrl} className="transition-colors hover:text-[#f7f8f8]">Documentation</a>
            <a href={site.repoUrl} className="transition-colors hover:text-[#f7f8f8]">GitHub</a>
          </nav>
        </div>
      </div>
    </footer>
  );
}

import { getEmailPreviewEntries } from "@/lib/emails/catalog";
import { renderEmailHtml } from "@/lib/emails/render-html";

const VIEWPORTS = [
  { key: "desktop", label: "Desktop", width: 640, height: 760 },
  { key: "narrow", label: "Narrow", width: 360, height: 760 },
] as const;

export default function EmailsPlaygroundPage() {
  const entries = getEmailPreviewEntries();

  return (
    <main
      className="min-h-screen bg-background text-foreground"
      style={{
        backgroundImage:
          "radial-gradient(circle at top, color-mix(in oklab, var(--primary) 14%, transparent), transparent 52%)",
      }}
    >
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 py-10">
        <header className="max-w-3xl space-y-4">
          <div className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            Email playground
          </div>
          <div className="space-y-3">
            <h1 className="text-4xl font-semibold tracking-tight text-balance">
              Review the exact email HTML before it reaches Resend
            </h1>
            <p className="text-base leading-7 text-muted-foreground">
              Review the live email HTML for organization invites, onboarding, project
              invitations, and the sign-up link. Each card below renders the same HTML used for
              outbound email payloads.
            </p>
          </div>
        </header>

        <section className="grid gap-6">
          {entries.map((entry) => {
            const html = renderEmailHtml(entry.template, "team@convoy.build");

            return (
              <article
                key={entry.key}
                data-testid={`email-preview-${entry.key}`}
                className="overflow-hidden rounded-[28px] border border-border/70 bg-card/90 shadow-sm backdrop-blur"
              >
                <div className="border-b border-border/70 px-6 py-5">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <div className="inline-flex items-center rounded-full border border-primary/15 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
                        {entry.fixtureLabel}
                      </div>
                      <div className="space-y-1">
                        <h2 className="text-2xl font-semibold">{entry.template.subject}</h2>
                        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                          {entry.description}
                        </p>
                      </div>
                    </div>

                    <dl className="grid gap-3 text-sm sm:grid-cols-3">
                      <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-3">
                        <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                          Template
                        </dt>
                        <dd className="mt-1 font-medium">{entry.template.label}</dd>
                      </div>
                      <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-3">
                        <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                          Layout tag
                        </dt>
                        <dd className="mt-1 font-medium">{entry.template.headerTag}</dd>
                      </div>
                      <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-3">
                        <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                          Preheader
                        </dt>
                        <dd className="mt-1 line-clamp-2 font-medium">{entry.template.preheader}</dd>
                      </div>
                    </dl>
                  </div>
                </div>

                <div className="grid gap-6 px-6 py-6 xl:grid-cols-2">
                  {VIEWPORTS.map((viewport) => (
                    <section key={viewport.key} className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                          {viewport.label}
                        </h3>
                        <span className="text-xs text-muted-foreground">
                          {viewport.width}px preview
                        </span>
                      </div>
                      <div className="overflow-auto rounded-[24px] border border-border/70 bg-background/80 p-4">
                        <iframe
                          title={`${entry.fixtureLabel} ${viewport.label}`}
                          srcDoc={html}
                          className="mx-auto block rounded-[20px] border border-border bg-background shadow-sm"
                          style={{
                            width: viewport.width,
                            minWidth: viewport.width,
                            height: viewport.height,
                          }}
                        />
                      </div>
                    </section>
                  ))}
                </div>
              </article>
            );
          })}
        </section>
      </div>
    </main>
  );
}

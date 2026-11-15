import { getEmailPreviewEntries } from "@/lib/emails/catalog";
import { renderEmailHtmlBoxed } from "@/lib/emails/render-html-boxed";

const VIEWPORTS = [
  { key: "desktop", label: "Desktop", width: 640, height: 760 },
  { key: "narrow", label: "Narrow", width: 360, height: 760 },
] as const;

export default function EmailsBoxedPage() {
  const entries = getEmailPreviewEntries();

  return (
    <main className="min-h-screen bg-white text-black font-mono">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 py-10">
        <header className="max-w-3xl space-y-4 border-b border-black pb-8">
          <div className="text-[10px] uppercase tracking-[0.2em] text-neutral-400">
            &bull; design/boxed
          </div>
          <h1 className="text-3xl font-normal tracking-tight">
            Boxed
          </h1>
          <p className="max-w-xl text-sm leading-7 text-neutral-500 font-mono">
            Single-pixel bordered container on light gray. Header and footer float outside the box.
            Receipt-like, contained, monospace.
          </p>
        </header>

        <section className="grid gap-8">
          {entries.map((entry) => {
            const html = renderEmailHtmlBoxed(entry.template);

            return (
              <article
                key={entry.key}
                data-testid={`email-preview-${entry.key}`}
                className="border-b border-neutral-200 pb-8"
              >
                <div className="mb-6 space-y-1">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-neutral-400">
                    &bull; {entry.fixtureLabel}
                  </div>
                  <h2 className="text-lg font-normal">{entry.template.subject}</h2>
                  <p className="text-xs leading-5 text-neutral-400 font-mono">
                    {entry.description}
                  </p>
                </div>

                <div className="grid gap-6 xl:grid-cols-2">
                  {VIEWPORTS.map((viewport) => (
                    <section key={viewport.key} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <h3 className="text-[10px] uppercase tracking-[0.16em] text-neutral-400">
                          {viewport.label}
                        </h3>
                        <span className="text-[10px] text-neutral-300 font-mono">
                          {viewport.width}px
                        </span>
                      </div>
                      <div className="overflow-auto border border-neutral-200 bg-neutral-50 p-4">
                        <iframe
                          title={`${entry.fixtureLabel} ${viewport.label}`}
                          srcDoc={html}
                          className="mx-auto block border border-neutral-200 bg-neutral-100"
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

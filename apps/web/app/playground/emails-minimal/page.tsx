import { getEmailPreviewEntries } from "@/lib/emails/catalog";
import { renderEmailHtmlMinimal } from "@/lib/emails/render-html-minimal";

const VIEWPORTS = [
  { key: "desktop", label: "Desktop", width: 640, height: 800 },
  { key: "narrow", label: "Narrow", width: 360, height: 800 },
] as const;

export default function EmailsMinimalPage() {
  const entries = getEmailPreviewEntries();

  return (
    <main className="min-h-screen bg-white text-black">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-12 px-6 py-16">
        <header className="max-w-3xl space-y-6">
          <p
            className="text-[10px] uppercase tracking-[0.2em] text-neutral-400"
            style={{ fontFamily: "monospace" }}
          >
            &bull;&nbsp; design / minimal
          </p>
          <div className="space-y-3">
            <h1 className="text-3xl font-bold tracking-tight">Minimal</h1>
            <p
              className="max-w-xl text-sm leading-7 text-neutral-400"
              style={{ fontFamily: "monospace" }}
            >
              Swiss-inspired open layout. No outer border, no background card.
              Hairline dividers, uppercase markers, generous whitespace.
            </p>
          </div>
          <div className="h-px bg-black" />
        </header>

        <section className="grid gap-16">
          {entries.map((entry) => {
            const html = renderEmailHtmlMinimal(entry.template);

            return (
              <article
                key={entry.key}
                data-testid={`email-preview-${entry.key}`}
              >
                <div className="mb-8 space-y-2">
                  <p
                    className="text-[10px] uppercase tracking-[0.18em] text-neutral-400"
                    style={{ fontFamily: "monospace" }}
                  >
                    &bull;&nbsp; {entry.fixtureLabel}
                  </p>
                  <h2 className="text-xl font-bold tracking-tight">
                    {entry.template.subject}
                  </h2>
                  <p
                    className="text-xs leading-5 text-neutral-400"
                    style={{ fontFamily: "monospace" }}
                  >
                    {entry.description}
                  </p>
                </div>

                <div className="grid gap-8 xl:grid-cols-2">
                  {VIEWPORTS.map((viewport) => (
                    <section key={viewport.key} className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h3
                          className="text-[10px] uppercase tracking-[0.16em] text-neutral-400"
                          style={{ fontFamily: "monospace" }}
                        >
                          {viewport.label}
                        </h3>
                        <span
                          className="text-[10px] text-neutral-300"
                          style={{ fontFamily: "monospace" }}
                        >
                          {viewport.width}px
                        </span>
                      </div>
                      <div className="overflow-auto border border-neutral-100 bg-neutral-50/50 p-4">
                        <iframe
                          title={`${entry.fixtureLabel} ${viewport.label}`}
                          srcDoc={html}
                          className="mx-auto block border border-neutral-100 bg-white"
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

                <div className="mt-10 h-px bg-neutral-200" />
              </article>
            );
          })}
        </section>
      </div>
    </main>
  );
}

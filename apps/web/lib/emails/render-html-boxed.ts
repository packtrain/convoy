import type { EmailTemplateDocument } from "./catalog";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * "Boxed" — B&W brutalist with a single-pixel bordered container.
 * Monospace throughout, thin lines between sections inside the box,
 * header and footer outside the box. Receipt-like.
 */
export function renderEmailHtmlBoxed(
  template: EmailTemplateDocument
): string {
  const detailsRows = template.details
    .map(
      (detail) => `
        <tr>
          <td style="padding:8px 0;font-family:'Courier New',Courier,monospace;color:#888888;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;">
            ${escapeHtml(detail.label)}
          </td>
          <td style="padding:8px 0;font-family:'Courier New',Courier,monospace;color:#000000;font-size:13px;text-align:right;">
            ${escapeHtml(detail.value)}
          </td>
        </tr>`
    )
    .join("");

  const bulletsMarkup =
    template.bullets && template.bullets.length > 0
      ? template.bullets
          .map(
            (b) =>
              `<p style="margin:0 0 6px;font-family:'Courier New',Courier,monospace;color:#000000;font-size:13px;line-height:1.7;">&rarr; ${escapeHtml(b)}</p>`
          )
          .join("")
      : "";

  const bodyParagraphs = template.body
    .map(
      (p) =>
        `<p style="margin:0 0 14px;font-family:'Courier New',Courier,monospace;color:#000000;font-size:13px;line-height:1.75;">${escapeHtml(p)}</p>`
    )
    .join("");

  const footerLines = template.footer
    .map(
      (line) =>
        `<p style="margin:0 0 4px;font-family:'Courier New',Courier,monospace;color:#aaaaaa;font-size:11px;line-height:1.6;">${escapeHtml(line)}</p>`
    )
    .join("");

  const actionMarkup = template.action
    ? `
      <div style="margin:24px 0 0;">
        <a href="${escapeHtml(template.action.url)}" style="display:inline-block;padding:11px 24px;border:1px solid #000000;background:#ffffff;color:#000000;font-family:'Courier New',Courier,monospace;font-size:11px;font-weight:400;letter-spacing:0.14em;text-decoration:none;text-transform:uppercase;">
          ${escapeHtml(template.action.label)} &rarr;
        </a>
      </div>`
    : "";

  const innerHr = `<div style="height:1px;background:#e0e0e0;margin:0;"></div>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(template.subject)}</title>
  </head>
  <body style="margin:0;padding:40px 16px;background:#f7f7f7;font-family:'Courier New',Courier,monospace;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(template.preheader)}</div>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="width:100%;border-collapse:collapse;">
      <tr>
        <td align="center">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:540px;width:100%;border-collapse:separate;">
            <tr>
              <td style="padding:0;">

                <!-- HEADER (outside box) -->
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="width:100%;border-collapse:collapse;">
                  <tr>
                    <td style="padding:0 0 20px;font-family:'Courier New',Courier,monospace;color:#000000;font-size:12px;letter-spacing:0.1em;text-transform:uppercase;">
                      &bull; convoy
                    </td>
                    <td align="right" style="padding:0 0 20px;font-family:'Courier New',Courier,monospace;color:#aaaaaa;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;">
                      ${escapeHtml(template.headerTag)}
                    </td>
                  </tr>
                </table>

                <!-- BOX -->
                <div style="border:1px solid #000000;background:#ffffff;">

                  <!-- TITLE -->
                  <div style="padding:28px 28px 24px;">
                    <h1 style="margin:0 0 10px;font-family:'Courier New',Courier,monospace;color:#000000;font-size:24px;line-height:1.2;font-weight:400;">
                      ${escapeHtml(template.title)}
                    </h1>
                    <p style="margin:0;font-family:'Courier New',Courier,monospace;color:#666666;font-size:13px;line-height:1.6;">
                      ${escapeHtml(template.intro)}
                    </p>
                  </div>

                  ${innerHr}

                  ${
                    template.details.length > 0
                      ? `
                  <!-- DETAILS -->
                  <div style="padding:20px 28px;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="width:100%;border-collapse:collapse;">
                      ${detailsRows}
                    </table>
                  </div>
                  ${innerHr}`
                      : ""
                  }

                  <!-- BODY -->
                  <div style="padding:24px 28px 28px;">
                    ${bodyParagraphs}
                    ${bulletsMarkup}
                    ${actionMarkup}
                  </div>

                </div>

                <!-- FOOTER (outside box) -->
                <div style="padding:20px 0 0;">
                  ${footerLines}
                </div>

              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

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
 * "Minimal" — Swiss-inspired, open layout with thin hairline dividers.
 * No outer border, no background card. Clean white canvas with generous
 * whitespace, uppercase markers (convoy / tag), and tight typography.
 * Inspired by modern agency/portfolio design language.
 */
export function renderEmailHtmlMinimal(
  template: EmailTemplateDocument,
): string {
  const mono = `'SFMono-Regular','SF Mono','Fira Mono','Roboto Mono',Menlo,Consolas,'Courier New',monospace`;
  const sans = `-apple-system,BlinkMacSystemFont,'Segoe UI','Inter',Helvetica,Arial,sans-serif`;

  const hairline = `<tr><td colspan="2" style="padding:0;"><div style="height:1px;background:#e0e0e0;"></div></td></tr>`;

  const detailsMarkup =
    template.details.length > 0
      ? `<tr><td colspan="2" style="padding:0 40px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="width:100%;border-collapse:collapse;">
            ${template.details
              .map(
                (detail) => `
              <tr>
                <td style="padding:12px 0;border-bottom:1px solid #f0f0f0;font-family:${mono};color:#999999;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;">
                  ${escapeHtml(detail.label)}
                </td>
                <td style="padding:12px 0;border-bottom:1px solid #f0f0f0;font-family:${sans};color:#000000;font-size:14px;font-weight:600;text-align:right;">
                  ${escapeHtml(detail.value)}
                </td>
              </tr>`,
              )
              .join("")}
          </table>
        </td></tr>
        <tr><td colspan="2" style="padding:0;height:24px;"></td></tr>
        ${hairline}`
      : "";

  const bulletsMarkup =
    template.bullets && template.bullets.length > 0
      ? template.bullets
          .map(
            (b) =>
              `<tr>
                <td style="padding:0 0 8px;font-family:${mono};color:#999999;font-size:13px;vertical-align:top;width:20px;">&bull;</td>
                <td style="padding:0 0 8px;font-family:${sans};color:#000000;font-size:14px;line-height:1.7;">${escapeHtml(b)}</td>
              </tr>`,
          )
          .join("")
      : "";

  const bodyParagraphs = template.body
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-family:${sans};color:#000000;font-size:14px;line-height:1.75;letter-spacing:-0.01em;">${escapeHtml(p)}</p>`,
    )
    .join("");

  const actionMarkup = template.action
    ? `<div style="margin:28px 0 0;">
        <a href="${escapeHtml(template.action.url)}" style="display:inline-block;padding:14px 28px;background:#000000;color:#ffffff;font-family:${mono};font-size:11px;font-weight:400;letter-spacing:0.14em;text-decoration:none;text-transform:uppercase;">
          ${escapeHtml(template.action.label)}
        </a>
      </div>`
    : "";

  const footerLines = template.footer
    .map(
      (line) =>
        `<p style="margin:0 0 6px;font-family:${sans};color:#999999;font-size:12px;line-height:1.6;">${escapeHtml(line)}</p>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(template.subject)}</title>
  </head>
  <body style="margin:0;padding:0;background:#ffffff;font-family:${sans};">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(template.preheader)}</div>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="width:100%;border-collapse:collapse;">
      <tr>
        <td align="center" style="padding:0 16px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:560px;width:100%;border-collapse:collapse;">

            <!-- SPACER -->
            <tr><td colspan="2" style="padding:0;height:48px;"></td></tr>

            <!-- HEADER -->
            <tr>
              <td colspan="2" style="padding:0 40px 20px;font-family:${mono};font-size:11px;letter-spacing:0.14em;text-transform:uppercase;">
                <span style="color:#000000;">CONVOY</span><span style="color:#999999;"> / ${escapeHtml(template.headerTag).toUpperCase()}</span>
              </td>
            </tr>

            ${hairline}

            <!-- TITLE + BODY -->
            <tr>
              <td colspan="2" style="padding:32px 40px 0;">
                <h1 style="margin:0 0 12px;font-family:${sans};color:#000000;font-size:28px;line-height:1.15;font-weight:700;letter-spacing:-0.02em;">
                  ${escapeHtml(template.title)}
                </h1>
                <p style="margin:0;font-family:${sans};color:#666666;font-size:14px;line-height:1.65;">
                  ${escapeHtml(template.intro)}
                </p>
              </td>
            </tr>

            ${detailsMarkup}

            <!-- BODY -->
            <tr>
              <td colspan="2" style="padding:20px 40px 32px;">
                ${bodyParagraphs}
                ${
                  bulletsMarkup
                    ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;margin:0 0 8px;">${bulletsMarkup}</table>`
                    : ""
                }
                ${actionMarkup}
              </td>
            </tr>

            ${hairline}

            <!-- FOOTER -->
            <tr>
              <td colspan="2" style="padding:24px 40px 12px;">
                ${footerLines}
              </td>
            </tr>

            <!-- BRAND MARK -->
            <tr>
              <td colspan="2" style="padding:20px 40px 48px;font-family:${mono};color:#cccccc;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;">
                CONVOY &bull; ${new Date().getFullYear()}
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

import type { EmailTemplateDocument } from "./catalog";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderParagraphs(paragraphs: string[]): string {
  return paragraphs
    .map(
      (paragraph) =>
        `<p style="margin:0 0 14px;color:#111827;font-size:15px;line-height:1.6;">${escapeHtml(paragraph)}</p>`
    )
    .join("");
}

function renderBullets(bullets: string[] | undefined): string {
  if (!bullets || bullets.length === 0) {
    return "";
  }

  return `<ul style="margin:0;padding:0 0 0 18px;color:#111827;">${bullets
    .map(
      (bullet) =>
        `<li style="margin:0 0 8px;font-size:14px;line-height:1.6;">${escapeHtml(bullet)}</li>`
    )
    .join("")}</ul>`;
}

export function renderEmailHtml(template: EmailTemplateDocument): string {
  const detailsMarkup = template.details
    .map(
      (detail) => `
        <tr>
          <td style="padding:10px 0;border-top:1px solid #111827;color:#6b7280;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">
            ${escapeHtml(detail.label)}
          </td>
          <td style="padding:10px 0;border-top:1px solid #111827;color:#111827;font-size:14px;font-weight:600;text-align:right;">
            ${escapeHtml(detail.value)}
          </td>
        </tr>`
    )
    .join("");
  const bulletsMarkup = renderBullets(template.bullets);
  const hasDetails = template.details.length > 0;
  const hasBullets = bulletsMarkup !== "";

  const actionMarkup = template.action
    ? `
      <div style="margin:24px 0 0;">
        <a href="${escapeHtml(template.action.url)}" style="display:inline-block;padding:14px 18px;border:1px solid #111827;background:#111827;color:#ffffff;font-size:14px;font-weight:700;letter-spacing:0.02em;text-decoration:none;text-transform:uppercase;">
          ${escapeHtml(template.action.label)}
        </a>
      </div>`
    : "";
  const footerMarkup = template.footer
    .map(
      (line) =>
        `<p style="margin:0 0 8px;color:#4b5563;font-size:12px;line-height:1.6;">${escapeHtml(line)}</p>`
    )
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(template.subject)}</title>
  </head>
  <body style="margin:0;padding:24px;background:#f5f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(template.preheader)}</div>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="width:100%;border-collapse:collapse;">
      <tr>
        <td align="center">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:640px;width:100%;border-collapse:separate;">
            <tr>
              <td style="padding:0;">
                <div style="border:1px solid #111827;background:#ffffff;">
                  <div style="height:8px;background:#111827;"></div>
                  <div style="padding:18px 20px;border-bottom:1px solid #111827;">
                    <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
                      <div style="color:#111827;font-size:16px;font-weight:700;letter-spacing:0.01em;">Convoy</div>
                      <div style="color:#6b7280;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;">${escapeHtml(template.headerTag)}</div>
                    </div>
                  </div>
                  <div style="padding:24px 20px;border-bottom:1px solid #111827;">
                    <h1 style="margin:0 0 12px;color:#111827;font-size:32px;line-height:1.1;font-weight:700;">
                      ${escapeHtml(template.title)}
                    </h1>
                    <p style="margin:0;color:#111827;font-size:15px;line-height:1.6;">
                      ${escapeHtml(template.intro)}
                    </p>
                  </div>
                  ${
                    hasDetails
                      ? `<div style="padding:20px;border-bottom:1px solid #111827;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="width:100%;border-collapse:collapse;">
                      ${detailsMarkup}
                    </table>
                  </div>`
                      : ""
                  }
                  <div style="padding:20px;border-bottom:1px solid #111827;">
                    ${renderParagraphs(template.body)}
                    ${hasBullets ? bulletsMarkup : ""}
                    ${actionMarkup}
                  </div>
                  <div style="padding:16px 20px;background:#fafaf9;">
                    ${footerMarkup}
                  </div>
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

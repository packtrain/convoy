import type { EmailTemplateDocument } from "./catalog";

// Production asset, so the logo also loads in emails sent from dev and preview deployments.
export const EMAIL_LOGO_URL = "https://app.convoy.build/web-app-manifest-192x192.png";

const SANS = `-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif`;
const TEXT = `margin:0 0 16px;font-family:${SANS};color:#4a4a4a;font-size:14px;line-height:1.5;`;
const LINK = "color:#1a1a1a;text-decoration:underline;";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const paragraph = (text: string) => `<p style="${TEXT}">${escapeHtml(text)}</p>`;

function renderDetails(template: EmailTemplateDocument): string {
  if (template.details.length === 0) return "";
  const rows = template.details
    .map(
      (detail) => `<tr>
        <td style="padding:3px 16px 3px 0;font-family:${SANS};color:#6b6b6b;font-size:13px;white-space:nowrap;vertical-align:top;">${escapeHtml(detail.label)}:</td>
        <td style="padding:3px 0;font-family:${SANS};color:#1a1a1a;font-size:13px;font-weight:600;">${escapeHtml(detail.value)}</td>
      </tr>`,
    )
    .join("");
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="width:100%;margin:0 0 28px;border:1px solid #e6e6e6;border-radius:6px;background:#f9f9f9;border-collapse:separate;">
    <tr><td style="padding:12px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">${rows}</table>
    </td></tr>
  </table>`;
}

function renderAction(template: EmailTemplateDocument): string {
  if (!template.action) return "";
  const url = escapeHtml(template.action.url);
  return `<p style="margin:4px 0 24px;">
      <a href="${url}" style="display:inline-block;padding:7px 10px;border-radius:4px;background:#1a1a1a;color:#ffffff;font-family:${SANS};font-size:13px;font-weight:500;text-decoration:none;">${escapeHtml(template.action.label)}</a>
    </p>
    <p style="${TEXT}">If you're having trouble with the above button, <a href="${url}" style="${LINK}">click here</a>.</p>`;
}

function renderSupport(supportEmail: string | undefined): string {
  if (!supportEmail) return "";
  const address = escapeHtml(supportEmail);
  return `<p style="${TEXT}">If you have any questions or need any help, reach out to <a href="mailto:${address}" style="${LINK}">${address}</a>.</p>`;
}

/** The live email layout: logo, title, details box, button, footer. See docs/specs/email-templates.md. */
export function renderEmailHtml(template: EmailTemplateDocument, supportEmail?: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(template.subject)}</title>
  </head>
  <body style="margin:0;padding:0;background:#ffffff;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(template.preheader)}</div>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="width:100%;border-collapse:collapse;">
      <tr>
        <td align="center" style="padding:48px 20px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:500px;width:100%;border-collapse:collapse;">
            <tr>
              <td style="padding:0 0 32px;">
                <img src="${EMAIL_LOGO_URL}" width="112" height="112" alt="Convoy" style="display:block;width:112px;height:112px;border:0;border-radius:12px;" />
              </td>
            </tr>
            <tr>
              <td>
                <h1 style="margin:0 0 20px;font-family:${SANS};color:#1a1a1a;font-size:24px;line-height:1.25;font-weight:700;">${escapeHtml(template.title)}</h1>
                ${paragraph(template.intro)}
                ${renderDetails(template)}
                ${template.body.map(paragraph).join("")}
                ${renderAction(template)}
                ${template.footer.map(paragraph).join("")}
                ${renderSupport(supportEmail)}
              </td>
            </tr>
            <tr>
              <td style="padding:40px 0 0;">
                <div style="border-top:1px dashed #cccccc;padding:16px 0 0;font-family:${SANS};color:#4a4a4a;font-size:12px;">&copy; ${new Date().getFullYear()} Convoy</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

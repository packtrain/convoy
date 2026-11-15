import { components } from "../../_generated/api";
import type { MutationCtx } from "../../_generated/server";
import { Resend } from "@convex-dev/resend";
import type { EmailTemplateDocument } from "../../../lib/emails/catalog";
import { renderLiveEmailHtml } from "../../../lib/emails/render-live-html";

// Initialize Resend client
// Requires RESEND_API_KEY environment variable in Convex
export const resend = new Resend(components.resend, {
  testMode: false,
});

// Get email from address from environment variable
export const getEmailFrom = () =>
  process.env.EMAIL_FROM || "Convoy <noreply@convoy.build>";

export function buildResendEmail(template: EmailTemplateDocument) {
  return {
    from: getEmailFrom(),
    subject: template.subject,
    html: renderLiveEmailHtml(template),
  };
}

export async function sendTransactionalEmail(
  ctx: MutationCtx,
  args: {
    to: string;
    template: EmailTemplateDocument;
  },
) {
  const email = buildResendEmail(args.template);

  return resend.sendEmail(ctx, {
    from: email.from,
    to: args.to,
    subject: email.subject,
    html: email.html,
  });
}

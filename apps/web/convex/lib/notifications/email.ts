import { components } from "../../_generated/api";
import { env, type MutationCtx } from "../../_generated/server";
import { Resend } from "@convex-dev/resend";
import type { EmailTemplateDocument } from "../../../lib/emails/catalog";
import { renderEmailHtml } from "../../../lib/emails/render-html";

// Without RESEND_API_KEY the deployment sends no email (self-hosted/README.md#email-verification).
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
    html: renderEmailHtml(template, env.SUPPORT_EMAIL),
  };
}

export function isEmailSendingConfigured(): boolean {
  return Boolean(env.RESEND_API_KEY);
}

/** Queues the email through Resend; a no-op returning null when no key is set. */
export async function sendTransactionalEmail(
  ctx: MutationCtx,
  args: {
    to: string;
    template: EmailTemplateDocument;
  },
) {
  if (!isEmailSendingConfigured()) return null;
  const email = buildResendEmail(args.template);

  return resend.sendEmail(ctx, {
    from: email.from,
    to: args.to,
    subject: email.subject,
    html: email.html,
  });
}

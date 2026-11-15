import type { EmailTemplateDocument } from "./catalog";
import { renderEmailHtmlMinimal } from "./render-html-minimal";

export const LIVE_EMAIL_LAYOUTS = ["minimal"] as const;

export type LiveEmailLayout = (typeof LIVE_EMAIL_LAYOUTS)[number];

export function getLiveEmailLayout(
  template: EmailTemplateDocument,
): LiveEmailLayout {
  switch (template.id) {
    case "org-invitation":
    case "welcome-onboarding":
    case "project-invitation":
      return "minimal";
    default: {
      const exhaustiveCheck: never = template.id;
      return exhaustiveCheck;
    }
  }
}

export function renderLiveEmailHtml(template: EmailTemplateDocument): string {
  const layout = getLiveEmailLayout(template);

  switch (layout) {
    case "minimal":
      return renderEmailHtmlMinimal(template);
    default: {
      const exhaustiveCheck: never = layout;
      return exhaustiveCheck;
    }
  }
}

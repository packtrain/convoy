# Email Templates & Playground Specification

This document defines the email-template subsystem used for Convoy outbound emails and for the `/playground/emails` design-review route.

## Overview

- Email templates are design assets first and delivery assets second.
- A single shared template-definition layer owns subject lines, copy, CTA labels, badges, stats, and fine print.
- The same live rendered HTML is used both for Resend payloads and for the default playground previews.
- Every email has the same look, modeled on the Clerk emails so both auth modes send alike: the Convoy logo, a bold title, short gray body text, an optional gray details box of label and value rows, a small black button, a "click here" fallback link to the same URL, a help line naming `SUPPORT_EMAIL`, and a dashed divider over "© year Convoy". White background, left-aligned column, 500px wide at most.
- The logo is the production `https://app.convoy.build/web-app-manifest-192x192.png`, so it loads in mail from dev and preview deployments too.

## Supported Templates

### Supported templates

| Template ID | Purpose | Delivery status |
|---|---|---|
| `org-invitation` | Invite a user to join an organization | Live |
| `welcome-onboarding` | Welcome a user after joining an organization | Live |
| `project-invitation` | Notify a user after being added to a project | Live |
| `verify-email` | Convex Auth sign-up link | Live |

### Explicit exclusions

- Clerk-managed auth emails remain out of scope.
- Other Convex Auth emails (email change, password reset) are not sent yet; the package's plain text would go out unchanged. The sign-up link is `verify-email`, see [auth-adapters.md](auth-adapters.md#email-verification).
- Task assignment, comment/mention, status-change, and due-date reminder emails remain out of scope.

## Rendering Rules

- The shared HTML renderer is the canonical visual output.
- Live delivery and the playground both call `renderEmailHtml` in `lib/emails/render-html.ts`.
- Templates provide content only; they do not define bespoke per-template layouts.
- `/playground/emails-boxed` and `/playground/emails-minimal` keep two earlier design explorations. Nothing sends them.
- Resend payloads must be built from the shared template document and HTML renderer, not from inline HTML strings inside mutations.
- The default playground must preview the exact live rendered HTML, not a separate approximation.
- Organization invitation resend uses the same `org-invitation` template as the initial send.

## Live Delivery Triggers

- `org-invitation` is sent from both `createOrganizationInvitation` and `resendOrganizationInvitation`.
- `welcome-onboarding` is sent from `acceptOrganizationInvitation` only after a new organization membership is created successfully.
- `welcome-onboarding` is not sent when the invite is invalid, expired, revoked, already accepted, or the accepting user is already an org member.
- `project-invitation` is sent from `projectMembers.add` only after a new project membership is created successfully.
- `project-invitation` follows the existing project-member eligibility rules; no separate email-only eligibility branch exists.
- `verify-email` is sent from `auth.deliverAuthEmail` when Convex Auth starts a sign-up with verification required.
- All live templates use the shared renderer and therefore the same layout.

## Support Address

- The help line ("If you have any questions or need any help, reach out to …") names `SUPPORT_EMAIL` from the Convex deployment. Ours set it to `team@convoy.build`.
- Unset leaves the line out, so a self-hosted deployment never points its users at our address.

## Link Generation

- Live template CTA URLs use `NEXT_PUBLIC_APP_URL` as the app base URL when it is set.
- If `NEXT_PUBLIC_APP_URL` is unset or blank, email links default to `https://app.convoy.build`.
- Local and staging environments must set `NEXT_PUBLIC_APP_URL` explicitly when they need links that target a non-production app host.

## Playground

- Route: `/playground/emails`
- Purpose: internal design review and QA of email layout, copy, and responsive behavior.
- The route must:
  - list every supported template/fixture variant,
  - expose the subject and preheader for quick review,
  - show at least a desktop-width and narrow-width preview,
  - rely on deterministic fixture data instead of live Convex records.

## Follow-up Integration

OS-684 completes the follow-up live delivery work for `welcome-onboarding` and `project-invitation`, while keeping the preview routes for design review.

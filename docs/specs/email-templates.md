# Email Templates & Playground Specification

This document defines the email-template subsystem used for Convoy outbound emails and for the `/playground/emails` design-review route.

## Overview

- Email templates are design assets first and delivery assets second.
- A single shared template-definition layer owns subject lines, copy, CTA labels, badges, stats, and fine print.
- The same live rendered HTML is used both for Resend payloads and for the default playground previews.
- The visual direction is brutal and simple: sharp edges, strong borders, minimal ornament, and very little copy.

## Supported Templates

### Supported templates

| Template ID | Purpose | Delivery status |
|---|---|---|
| `org-invitation` | Invite a user to join an organization | Live |
| `welcome-onboarding` | Welcome a user after joining an organization | Live |
| `project-invitation` | Notify a user after being added to a project | Live |

### Explicit exclusions

- Clerk-managed auth emails remain out of scope.
- Task assignment, comment/mention, status-change, and due-date reminder emails remain out of scope.

## Rendering Rules

- The shared HTML renderer is the canonical visual output.
- Live delivery uses one renderer-selection entry point.
- The live default layout is `minimal`.
- Templates provide content only; they do not define bespoke per-template layouts.
- Resend payloads must be built from the shared template document and HTML renderer, not from inline HTML strings inside mutations.
- The default playground must preview the exact live rendered HTML, not a separate approximation.
- Organization invitation resend uses the same `org-invitation` template as the initial send.

## Live Delivery Triggers

- `org-invitation` is sent from both `createOrganizationInvitation` and `resendOrganizationInvitation`.
- `welcome-onboarding` is sent from `acceptOrganizationInvitation` only after a new organization membership is created successfully.
- `welcome-onboarding` is not sent when the invite is invalid, expired, revoked, already accepted, or the accepting user is already an org member.
- `project-invitation` is sent from `projectMembers.add` only after a new project membership is created successfully.
- `project-invitation` follows the existing project-member eligibility rules; no separate email-only eligibility branch exists.
- All three live transactional templates use the shared live renderer and therefore the same minimal layout policy.

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

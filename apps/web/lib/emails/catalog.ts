export const EMAIL_TEMPLATE_IDS = [
  "org-invitation",
  "welcome-onboarding",
  "project-invitation",
  "verify-email",
] as const;

export type EmailTemplateId = (typeof EMAIL_TEMPLATE_IDS)[number];

type EmailRole = "admin" | "member" | "viewer" | "project-admin";

export interface EmailTemplateDetail {
  label: string;
  value: string;
}

export interface EmailTemplateAction {
  label: string;
  url: string;
}

export interface EmailTemplateDocument {
  id: EmailTemplateId;
  label: string;
  headerTag: string;
  subject: string;
  preheader: string;
  title: string;
  intro: string;
  details: EmailTemplateDetail[];
  body: string[];
  bullets?: string[];
  action: EmailTemplateAction | null;
  footer: string[];
}

export interface OrganizationInvitationEmailData {
  organizationName: string;
  inviterName: string;
  inviteUrl: string;
  role: "admin" | "member";
  expiresInDays?: number;
}

export interface WelcomeOnboardingEmailData {
  organizationName: string;
  workspaceUrl: string;
  role: "admin" | "member";
  inviterName?: string | null;
}

export interface ProjectInvitationEmailData {
  organizationName: string;
  projectName: string;
  projectUrl: string;
  addedByName: string;
  role: "project-admin" | "member" | "viewer";
}

export interface VerifyEmailEmailData {
  verifyUrl: string;
  // How long the link works, e.g. "1 hour".
  expiresIn: string;
}

export interface EmailPreviewEntry {
  key: string;
  fixtureLabel: string;
  description: string;
  template: EmailTemplateDocument;
}

function humanizeRole(role: EmailRole): string {
  switch (role) {
    case "admin":
      return "Admin";
    case "member":
      return "Member";
    case "viewer":
      return "Viewer";
    case "project-admin":
      return "Project admin";
    default:
      return role;
  }
}

export function buildOrganizationInvitationEmail(
  data: OrganizationInvitationEmailData
): EmailTemplateDocument {
  const roleLabel = humanizeRole(data.role);

  return {
    id: "org-invitation",
    label: "Organization invitation",
    headerTag: "Org invite",
    subject: `You're invited to join ${data.organizationName}`,
    preheader: `${data.inviterName} invited you to join ${data.organizationName} in Convoy.`,
    title: `Join ${data.organizationName}`,
    intro: `${data.inviterName} invited you to join ${data.organizationName} in Convoy.`,
    details: [
      { label: "Organization", value: data.organizationName },
      { label: "Invited by", value: data.inviterName },
      { label: "Role", value: roleLabel },
    ],
    body: [
      "Accept the invitation with the same email address that received this message.",
    ],
    action: {
      label: "Accept invitation",
      url: data.inviteUrl,
    },
    footer: [
      `This invitation expires in ${data.expiresInDays ?? 7} days.`,
      "If this was not meant for you, ignore this email.",
    ],
  };
}

export function buildWelcomeOnboardingEmail(
  data: WelcomeOnboardingEmailData
): EmailTemplateDocument {
  return {
    id: "welcome-onboarding",
    label: "Welcome and onboarding",
    headerTag: "Welcome",
    subject: "Welcome to Convoy",
    preheader: "Your Convoy account is ready.",
    title: "Welcome to Convoy",
    intro: "Your account is ready.",
    details: [],
    body: [
      `You now have access to ${data.organizationName}.`,
      "Start with your projects, the task list, and recent threads.",
    ],
    action: {
      label: "Open Convoy",
      url: data.workspaceUrl,
    },
    footer: [
      "If you were not expecting access, contact your workspace admin.",
    ],
  };
}

export function buildProjectInvitationEmail(
  data: ProjectInvitationEmailData
): EmailTemplateDocument {
  return {
    id: "project-invitation",
    label: "Project invitation",
    headerTag: "Project invite",
    subject: `You've been added to ${data.projectName}`,
    preheader: `${data.addedByName} added you to ${data.projectName} in ${data.organizationName}.`,
    title: `Open ${data.projectName}`,
    intro: `${data.addedByName} added you to ${data.projectName} in ${data.organizationName}.`,
    details: [
      { label: "Project", value: data.projectName },
      { label: "Organization", value: data.organizationName },
      { label: "Added by", value: data.addedByName },
      { label: "Role", value: humanizeRole(data.role) },
    ],
    body: [
      "Open the project to review the board, task list, and recent team activity.",
    ],
    action: {
      label: "Open project",
      url: data.projectUrl,
    },
    footer: [
      "If this access looks unexpected, check with your project admin.",
    ],
  };
}

/** The Convex Auth sign-up link, sent from `deliverAuthEmail` in convex/auth.ts. */
export function buildVerifyEmailEmail(
  data: VerifyEmailEmailData
): EmailTemplateDocument {
  return {
    id: "verify-email",
    label: "Verify email",
    headerTag: "Verify email",
    subject: "Verify your email address",
    preheader: "Finish creating your Convoy account.",
    title: "Verify your email",
    intro: "Open the link below to finish creating your Convoy account.",
    details: [],
    body: [
      `The link works for ${data.expiresIn}, and only in the browser where you signed up.`,
    ],
    action: {
      label: "Verify email",
      url: data.verifyUrl,
    },
    footer: [
      "If you didn't sign up for Convoy, you can ignore this email.",
    ],
  };
}

export function getEmailPreviewEntries(): EmailPreviewEntry[] {
  return [
    {
      key: "org-invitation-member",
      fixtureLabel: "Org invitation / member",
      description:
        "Primary invitation design used for both first-send and resend flows.",
      template: buildOrganizationInvitationEmail({
        organizationName: "Starlight Studio",
        inviterName: "Avery Quinn",
        inviteUrl: "https://app.convoy.build/auth/invite/invite_member_123",
        role: "member",
      }),
    },
    {
      key: "welcome-onboarding",
      fixtureLabel: "Welcome / onboarding",
      description:
        "Sent after a user successfully accepts an organization invitation and a new membership is created.",
      template: buildWelcomeOnboardingEmail({
        organizationName: "Starlight Studio",
        workspaceUrl: "https://app.convoy.build/o/starlight",
        role: "member",
        inviterName: "Avery Quinn",
      }),
    },
    {
      key: "project-invitation",
      fixtureLabel: "Project invitation",
      description:
        "Sent after a user is added to a project through the standard eligible-member flow.",
      template: buildProjectInvitationEmail({
        organizationName: "Starlight Studio",
        projectName: "North Star Launch",
        projectUrl: "https://app.convoy.build/o/starlight/NSL",
        addedByName: "Mika Hale",
        role: "member",
      }),
    },
    {
      key: "verify-email",
      fixtureLabel: "Verify email",
      description: "The Convex Auth sign-up link. Clerk sends its own.",
      template: buildVerifyEmailEmail({
        verifyUrl: "https://app.convoy.build/auth/verify-email?code=fixture_code",
        expiresIn: "1 hour",
      }),
    },
  ];
}

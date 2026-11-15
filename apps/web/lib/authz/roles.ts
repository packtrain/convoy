// Organization role values as const object
export const OrgRole = {
  OWNER: "owner",
  ADMIN: "admin",
  MEMBER: "member",
} as const;

// Derive type from const object
export type OrgRole = (typeof OrgRole)[keyof typeof OrgRole];

// Project role values as const object
export const ProjectRole = {
  PROJECT_ADMIN: "project-admin",
  MEMBER: "member",
  VIEWER: "viewer",
} as const;

// Derive type from const object
export type ProjectRole = (typeof ProjectRole)[keyof typeof ProjectRole];

// Invitation status values
export const InvitationStatus = {
  PENDING: "pending",
  ACCEPTED: "accepted",
  EXPIRED: "expired",
  REVOKED: "revoked",
} as const;

export type InvitationStatus =
  (typeof InvitationStatus)[keyof typeof InvitationStatus];

// Invitation roles (subset of OrgRole - can't invite as owner)
export const InvitationRole = {
  ADMIN: "admin",
  MEMBER: "member",
} as const;

export type InvitationRole =
  (typeof InvitationRole)[keyof typeof InvitationRole];

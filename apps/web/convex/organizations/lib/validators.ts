import { v } from "convex/values";
import {
  invitationRoleValidator,
  invitationStatusValidator,
  orgRoleValidator,
} from "../../lib/contracts/validators";

export const organizationValidator = v.object({
  _id: v.id("organizations"),
  _creationTime: v.number(),
  name: v.string(),
  slug: v.string(),
  avatarUrl: v.optional(v.string()),
  color: v.optional(v.string()),
  createdBy: v.id("users"),
  createdAt: v.number(),
  updatedAt: v.number(),
  isDeleted: v.boolean(),
  deletedAt: v.optional(v.number()),
  deletedBy: v.optional(v.id("users")),
});

export const organizationWithRoleValidator = v.object({
  _id: v.id("organizations"),
  _creationTime: v.number(),
  name: v.string(),
  slug: v.string(),
  avatarUrl: v.optional(v.string()),
  color: v.optional(v.string()),
  createdBy: v.id("users"),
  createdAt: v.number(),
  updatedAt: v.number(),
  isDeleted: v.boolean(),
  deletedAt: v.optional(v.number()),
  deletedBy: v.optional(v.id("users")),
  role: orgRoleValidator,
});

export const organizationMemberListItemValidator = v.object({
  _id: v.id("users"),
  name: v.string(),
  email: v.string(),
  avatarUrl: v.optional(v.string()),
  role: orgRoleValidator,
});

export const invitationSummaryValidator = v.object({
  _id: v.id("organizationInvitations"),
  email: v.string(),
  role: invitationRoleValidator,
  status: invitationStatusValidator,
  expiresAt: v.number(),
  createdAt: v.number(),
  invitedBy: v.object({
    _id: v.id("users"),
    name: v.union(v.string(), v.null()),
    email: v.union(v.string(), v.null()),
  }),
});

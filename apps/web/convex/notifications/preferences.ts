import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { getAuthenticatedUser, getOptionalAuthenticatedAccess } from "../lib/access/auth";
import {
  channelDefault,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPES,
  notificationChannelValidator,
  notificationTypeValidator,
} from "../lib/contracts/notifications";
import { ensure } from "../lib/shared/ensure";
import { errors } from "./errors";
import { findGlobalOverride, isChannelEnabled } from "./lib/preferences";
import {
  deletePreference,
  insertPreference,
  listPreferencesByUser,
  setPreferenceEnabled,
} from "./lib/notificationPreferencesRepo";

const preferenceEntryValidator = v.object({
  type: notificationTypeValidator,
  channel: notificationChannelValidator,
  enabled: v.boolean(),
});

/**
 * Effective notification preferences for the caller: the full type × channel
 * matrix with defaults applied over the sparse override rows
 * (docs/specs/notifications.md). Global (all projects) in v1.
 */
export const list = query({
  args: {},
  returns: v.array(preferenceEntryValidator),
  handler: async (ctx) => {
    const auth = await getOptionalAuthenticatedAccess(ctx);
    if (!auth) {
      return [];
    }
    const rows = await listPreferencesByUser(ctx, auth.user._id);
    return NOTIFICATION_TYPES.flatMap((type) =>
      NOTIFICATION_CHANNELS.map((channel) => ({
        type,
        channel,
        enabled: isChannelEnabled(rows, type, channel),
      }))
    );
  },
});

/**
 * Set one or more preferences at once (a group toggle in the UI writes each
 * of its types in a single call). Storage stays sparse: an entry that matches
 * the channel default deletes its override row instead of storing it.
 */
export const set = mutation({
  args: { entries: v.array(preferenceEntryValidator) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    ensure(args.entries.length).between(
      1,
      NOTIFICATION_TYPES.length * NOTIFICATION_CHANNELS.length,
      errors.PREFERENCE_ENTRIES_INVALID
    );
    // Last write wins for duplicate (type, channel) pairs in one call.
    const entries = [
      ...new Map(args.entries.map((entry) => [`${entry.type}:${entry.channel}`, entry])).values(),
    ];
    const rows = await listPreferencesByUser(ctx, user._id);
    for (const entry of entries) {
      const existing = findGlobalOverride(rows, entry.type, entry.channel);
      if (entry.enabled === channelDefault(entry.type, entry.channel)) {
        if (existing) {
          await deletePreference(ctx, existing._id);
        }
        continue;
      }
      if (existing) {
        if (existing.enabled !== entry.enabled) {
          await setPreferenceEnabled(ctx, existing._id, entry.enabled);
        }
        continue;
      }
      await insertPreference(ctx, {
        userId: user._id,
        type: entry.type,
        channel: entry.channel,
        enabled: entry.enabled,
      });
    }
    return null;
  },
});

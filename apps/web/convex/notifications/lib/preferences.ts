import type { Doc } from "../../_generated/dataModel";
import { channelDefault, type NotificationChannel, type NotificationType } from "../../lib/contracts/notifications";

/**
 * The single definition of "the global override row" — shared by the read
 * path (isChannelEnabled) and the write path (preferences.set) so they can
 * never drift and write a row the reads ignore. Rows with `projectId` set
 * are reserved per-project overrides — ignored until override logic ships
 * (OS-1125+).
 */
export function findGlobalOverride(
  preferences: Doc<"notificationPreferences">[],
  type: NotificationType,
  channel: NotificationChannel
): Doc<"notificationPreferences"> | undefined {
  return preferences.find((row) => row.projectId === undefined && row.type === type && row.channel === channel);
}

/** Resolve one user's effective setting from their sparse override rows. */
export function isChannelEnabled(
  preferences: Doc<"notificationPreferences">[],
  type: NotificationType,
  channel: NotificationChannel
): boolean {
  return findGlobalOverride(preferences, type, channel)?.enabled ?? channelDefault(type, channel);
}

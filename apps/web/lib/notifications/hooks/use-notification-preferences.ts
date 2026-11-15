"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { channelDefault, type NotificationChannel, type NotificationType } from "@/convex/lib/contracts/notifications";

/**
 * Effective notification preferences plus an optimistic setter, shared by the
 * settings section and the inbox row dropdown.
 */
export function useNotificationPreferences() {
  const entries = useQuery(api.notifications.preferences.list);
  const set = useMutation(api.notifications.preferences.set).withOptimisticUpdate((store, args) => {
    const current = store.getQuery(api.notifications.preferences.list, {});
    if (current === undefined) {
      return;
    }
    const next = new Map(args.entries.map((entry) => [`${entry.type}:${entry.channel}`, entry.enabled]));
    store.setQuery(
      api.notifications.preferences.list,
      {},
      current.map((entry) => {
        const enabled = next.get(`${entry.type}:${entry.channel}`);
        return enabled === undefined ? entry : { ...entry, enabled };
      })
    );
  });

  const isEnabled = (type: NotificationType, channel: NotificationChannel): boolean =>
    entries?.find((entry) => entry.type === type && entry.channel === channel)?.enabled ??
    channelDefault(type, channel);

  const setChannel = (types: NotificationType[], channel: NotificationChannel, enabled: boolean): Promise<null> =>
    set({ entries: types.map((type) => ({ type, channel, enabled })) });

  return { loading: entries === undefined, isEnabled, setChannel };
}

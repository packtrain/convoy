/**
 * Cross-tab claim on delivering one notification row (OS-1754,
 * docs/specs/notifications.md). The toast cursor lives in a tab's memory, so a
 * frozen background tab wakes minutes later and replays rows another tab
 * already delivered. This ring of recently delivered ids is shared through
 * `localStorage`, which outlives both the freeze and the sound's Web Lock hold.
 */

import { readLocalJson, writeLocalJson } from "@/lib/browser/local-storage";

/** Toast and sound claim separately: the tab that toasts may be unable to play. */
type DeliveryPurpose = "toast" | "sound";

// `recent` returns at most 5 rows, so 20 outlives any burst still in the feed.
const RING_SIZE = 20;

function readRing(purpose: DeliveryPurpose): string[] {
  const stored = readLocalJson(`convoy.notifications-delivered.${purpose}`);
  return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string") : [];
}

/**
 * `true` when this tab may deliver `id`, claiming it so no other tab (or this
 * one, later) repeats it. Fail-soft: with storage unavailable every call
 * claims, back to today's per-tab delivery.
 */
export function claimNotificationDelivery(purpose: DeliveryPurpose, id: string): boolean {
  const ring = readRing(purpose);
  if (ring.includes(id)) {
    return false;
  }
  // ponytail: read-then-write, so two tabs in the same tick can both claim —
  // the sound's Web Lock still holds that to one beep, and a duplicate toast
  // needs two visible windows to even be seen. Swap in a real lock if it is.
  writeLocalJson(`convoy.notifications-delivered.${purpose}`, [id, ...ring].slice(0, RING_SIZE));
  return true;
}

/**
 * Sound for agent-run notifications (OS-1754, docs/specs/notifications.md).
 * Rides the toast decision — the caller only adds "is this a thread row" — and
 * claims the row so several open tabs beep once, not once each.
 */

import type { NotificationType } from "@/convex/lib/contracts/notifications";
import { readLocalString, writeLocalString } from "@/lib/browser/local-storage";
import { claimNotificationDelivery } from "@/lib/notifications/delivery-storage";

const STORAGE_KEY = "convoy.notification-sound";
const LOCK_PREFIX = "convoy.notification-sound";

/**
 * Two tiers: a failed run and one waiting for input want a look now, a finished
 * run is an FYI. Each claims its own lock, so the FYI can't swallow the urgent
 * one within the hold window.
 */
const TIER_SOUNDS = {
  attention: "/sounds/attention.wav",
  done: "/sounds/run-finished.wav",
} as const;

type SoundTier = keyof typeof TIER_SOUNDS;

// ponytail: one window per tier instead of a per-notification claim — a burst
// of runs finishing together beeps once. Key the lock by notification id if
// every single row ever needs its own sound.
const HOLD_MS = 2_000;

/** A browser-local preference, like the inbox filter; sound is per-device. */
export function readNotificationSoundEnabled(): boolean {
  return readLocalString(STORAGE_KEY) !== "0";
}

export function writeNotificationSoundEnabled(enabled: boolean): void {
  writeLocalString(STORAGE_KEY, enabled ? "1" : "0");
}

function tierFor(type: NotificationType): SoundTier {
  return type === "thread.completed" ? "done" : "attention";
}

function play(tier: SoundTier): void {
  // Autoplay policy, a decoding failure, a muted device: a sound is a nicety.
  void new Audio(TIER_SOUNDS[tier]).play().catch(() => {});
}

/**
 * Plays the blip for notification `id` in exactly one tab, once. Fire-and-forget:
 * never awaited, never throws.
 */
export function playNotificationSound(type: NotificationType, id: string): void {
  if (!readNotificationSoundEnabled()) {
    return;
  }
  // A tab the user never touched cannot play (autoplay policy), so it must not
  // win either claim. Chrome-only API; undefined elsewhere means "try".
  if (navigator.userActivation?.hasBeenActive === false) {
    return;
  }
  // Outlasts the hold below: a tab frozen mid-run wakes long after it released.
  if (!claimNotificationDelivery("sound", id)) {
    return;
  }
  const tier = tierFor(type);
  // lib.dom types Web Locks as always present; Firefox <96 and Safari <15.4
  // lack it, and those tabs just risk beeping in parallel.
  const locks: LockManager | undefined = navigator.locks;
  if (locks === undefined) {
    play(tier);
    return;
  }
  void locks
    .request(`${LOCK_PREFIX}:${tier}`, { ifAvailable: true }, async (lock) => {
      if (lock === null) {
        return;
      }
      play(tier);
      // Held past the skew between tabs receiving the same reactive update, so
      // a laggy tab doesn't beep again for the same row.
      await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
    })
    .catch(() => {});
}

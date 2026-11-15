/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  playNotificationSound,
  readNotificationSoundEnabled,
  writeNotificationSoundEnabled,
} from "./sound";

/**
 * Single-holder stand-in for the Web Locks API: the claim is taken
 * synchronously (as the real one is atomic), so a second `ifAvailable` request
 * misses while the first callback still holds it.
 */
function fakeLockManager() {
  const held = new Set<string>();
  return {
    request: async (name: string, _options: unknown, callback: (lock: unknown) => Promise<void>) => {
      if (held.has(name)) {
        return callback(null);
      }
      held.add(name);
      try {
        return await callback({ name });
      } finally {
        held.delete(name);
      }
    },
  };
}

function stubNavigator(key: "locks" | "userActivation", value: unknown) {
  Object.defineProperty(navigator, key, { value, configurable: true });
}

let play: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  localStorage.clear();
  play = vi.spyOn(window.HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  stubNavigator("locks", fakeLockManager());
  stubNavigator("userActivation", { hasBeenActive: true, isActive: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("notification sound preference", () => {
  test("defaults on and round-trips an explicit opt-out", () => {
    expect(readNotificationSoundEnabled()).toBe(true);
    writeNotificationSoundEnabled(false);
    expect(readNotificationSoundEnabled()).toBe(false);
    writeNotificationSoundEnabled(true);
    expect(readNotificationSoundEnabled()).toBe(true);
  });
});

/** Basenames of the files each `play()` call was made on, in order. */
function playedFiles(): string[] {
  return play.mock.contexts.map((element: unknown) =>
    String((element as HTMLAudioElement).src).replace(/^.*\//, "")
  );
}

describe("playNotificationSound", () => {
  test("plays once while the tier hold is held, again after it expires", async () => {
    vi.useFakeTimers();

    playNotificationSound("thread.completed", "n1");
    playNotificationSound("thread.completed", "n2");
    await vi.advanceTimersByTimeAsync(0);
    expect(play).toHaveBeenCalledTimes(1);

    // The hold releases, so a later notification sounds again.
    await vi.advanceTimersByTimeAsync(5_000);
    playNotificationSound("thread.completed", "n3");
    await vi.advanceTimersByTimeAsync(0);
    expect(play).toHaveBeenCalledTimes(2);
  });

  test("never sounds the same row twice, long past the tier hold", async () => {
    vi.useFakeTimers();

    playNotificationSound("thread.completed", "n1");
    await vi.advanceTimersByTimeAsync(60_000);
    // A frozen tab waking up on the same row (OS-1754).
    playNotificationSound("thread.completed", "n1");
    await vi.advanceTimersByTimeAsync(0);

    expect(play).toHaveBeenCalledTimes(1);
  });

  test("attention events share a sound distinct from a finished run", async () => {
    vi.useFakeTimers();

    playNotificationSound("thread.failed", "n1");
    await vi.advanceTimersByTimeAsync(5_000);
    playNotificationSound("thread.waiting_input", "n2");
    await vi.advanceTimersByTimeAsync(5_000);
    playNotificationSound("thread.completed", "n3");
    await vi.advanceTimersByTimeAsync(0);

    expect(playedFiles()).toEqual(["attention.wav", "attention.wav", "run-finished.wav"]);
  });

  test("a finished run's hold cannot swallow an attention sound", async () => {
    vi.useFakeTimers();

    playNotificationSound("thread.completed", "n1");
    playNotificationSound("thread.waiting_input", "n2");
    await vi.advanceTimersByTimeAsync(0);

    expect(playedFiles()).toEqual(["run-finished.wav", "attention.wav"]);
  });

  test("stays silent when the user turned the sound off", async () => {
    writeNotificationSoundEnabled(false);
    playNotificationSound("thread.failed", "n1");
    await Promise.resolve();
    expect(play).not.toHaveBeenCalled();
  });

  test("plays without Web Locks (browsers predating it)", async () => {
    stubNavigator("locks", undefined);
    playNotificationSound("thread.completed", "n1");
    await Promise.resolve();
    expect(play).toHaveBeenCalledTimes(1);
  });

  test("skips the claim in a tab the user never interacted with", async () => {
    stubNavigator("userActivation", { hasBeenActive: false, isActive: false });
    playNotificationSound("thread.failed", "n1");
    await Promise.resolve();
    expect(play).not.toHaveBeenCalled();

    // ...and leaves the row unclaimed, so the tab that can play still does.
    stubNavigator("userActivation", { hasBeenActive: true, isActive: true });
    playNotificationSound("thread.failed", "n1");
    await Promise.resolve();
    expect(play).toHaveBeenCalledTimes(1);
  });

  test("plays where userActivation is unavailable (Safari, Firefox)", async () => {
    stubNavigator("userActivation", undefined);
    playNotificationSound("thread.completed", "n1");
    await Promise.resolve();
    expect(play).toHaveBeenCalledTimes(1);
  });
});

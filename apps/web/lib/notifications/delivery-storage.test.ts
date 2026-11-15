/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, test } from "vitest";
import { claimNotificationDelivery } from "./delivery-storage";

beforeEach(() => {
  localStorage.clear();
});

describe("claimNotificationDelivery", () => {
  test("claims a row once, however much later the second tab asks", () => {
    expect(claimNotificationDelivery("toast", "n1")).toBe(true);
    expect(claimNotificationDelivery("toast", "n1")).toBe(false);
  });

  test("keeps the purposes independent", () => {
    expect(claimNotificationDelivery("toast", "n1")).toBe(true);
    expect(claimNotificationDelivery("sound", "n1")).toBe(true);
  });

  test("forgets rows pushed out of the ring", () => {
    claimNotificationDelivery("toast", "old");
    for (let i = 0; i < 20; i++) {
      claimNotificationDelivery("toast", `n${i}`);
    }
    expect(claimNotificationDelivery("toast", "old")).toBe(true);
    expect(claimNotificationDelivery("toast", "n19")).toBe(false);
  });

  test("claims through a corrupt or foreign stored value", () => {
    localStorage.setItem("convoy.notifications-delivered.toast", "not json");
    expect(claimNotificationDelivery("toast", "n1")).toBe(true);
    expect(claimNotificationDelivery("toast", "n1")).toBe(false);
  });
});

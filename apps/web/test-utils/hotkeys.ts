import { HotkeyManager } from "@tanstack/react-hotkeys";

export function setTestHotkeyPlatform({
  platform,
  userAgent,
}: {
  platform: string;
  userAgent: string;
}) {
  Object.defineProperty(window.navigator, "platform", {
    value: platform,
    configurable: true,
  });
  Object.defineProperty(window.navigator, "userAgent", {
    value: userAgent,
    configurable: true,
  });
  HotkeyManager.resetInstance();
}

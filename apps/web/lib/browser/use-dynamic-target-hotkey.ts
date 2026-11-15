import { useEffect, useRef } from "react";
import {
  createHotkeyHandler,
  type HotkeyCallback,
  type Hotkey,
  type HotkeyOptions,
} from "@tanstack/react-hotkeys";
import { isEditableHotkeyTarget } from "./hotkeys";

type DynamicTargetHotkeyOptions = Omit<HotkeyOptions, "target"> & {
  target?: HotkeyOptions["target"];
};

// TanStack's React hook does not re-register when the concrete target object changes.
// This wrapper makes target changes part of the registration lifecycle.
export function useDynamicTargetHotkey(
  hotkey: Hotkey,
  callback: HotkeyCallback,
  options: DynamicTargetHotkeyOptions = {}
) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const {
    target = typeof document !== "undefined" ? document : null,
    enabled = true,
    eventType = "keydown",
    platform,
    preventDefault,
    stopPropagation,
    ignoreInputs = false,
  } = options;

  useEffect(() => {
    if (!target || enabled === false) {
      return;
    }

    const listener = createHotkeyHandler(
      hotkey,
      (event, context) => {
        callbackRef.current(event, context);
      },
      {
        platform,
        preventDefault,
        stopPropagation,
      }
    );

    const guardedListener: EventListener = (event) => {
      if (
        ignoreInputs &&
        event instanceof KeyboardEvent &&
        isEditableHotkeyTarget(event.target)
      ) {
        return;
      }

      listener(event as KeyboardEvent);
    };
    target.addEventListener(eventType, guardedListener);

    return () => {
      target.removeEventListener(eventType, guardedListener);
    };
  }, [
    hotkey,
    target,
    enabled,
    eventType,
    platform,
    preventDefault,
    stopPropagation,
    ignoreInputs,
  ]);
}

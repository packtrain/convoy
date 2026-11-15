"use client";

import { useEffect, useRef } from "react";
import { GO_TO_HOTKEYS, GO_TO_PREFIX_HOTKEY, isEditableHotkeyTarget, isOverlayHotkeyTarget } from "@/lib/browser/hotkeys";

type GoToDestination = keyof typeof GO_TO_HOTKEYS;

const GO_TO_CHORD_TIMEOUT_MS = 1500;

const DESTINATION_BY_KEY = new Map(
  (Object.entries(GO_TO_HOTKEYS) as [GoToDestination, string][]).map(([destination, key]) => [key, destination])
);

/**
 * G then I/W/T/S (docs/specs/keyboard-navigation.md#g-chords-go-to). Window capture
 * phase claims the second key before task shortcuts on the same letter (I, T, S).
 */
export function useGoToHotkeys(handlers: Record<GoToDestination, () => void>) {
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    let armedUntil = 0;

    const handleKeyDown = (event: KeyboardEvent) => {
      const armed = armedUntil > Date.now();
      armedUntil = 0;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (isEditableHotkeyTarget(event.target) || isOverlayHotkeyTarget(event.target)) return;

      const key = event.key.toUpperCase();
      if (!armed) {
        if (key === GO_TO_PREFIX_HOTKEY) armedUntil = Date.now() + GO_TO_CHORD_TIMEOUT_MS;
        return;
      }
      const destination = DESTINATION_BY_KEY.get(key);
      if (!destination) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      handlersRef.current[destination]();
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, []);
}

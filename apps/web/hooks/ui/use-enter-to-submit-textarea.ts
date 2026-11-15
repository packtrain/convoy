import { useCallback } from "react";
import type { KeyboardEvent } from "react";

interface UseEnterToSubmitTextareaOptions {
  onSubmit: () => void | Promise<void>;
  enabled?: boolean;
}

/**
 * Handles common textarea submit behavior:
 * Enter submits, Shift+Enter inserts a newline.
 */
export function useEnterToSubmitTextarea({
  onSubmit,
  enabled = true,
}: UseEnterToSubmitTextareaOptions) {
  return useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (!enabled) return;

      if (
        event.key !== "Enter" ||
        event.shiftKey ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.nativeEvent.isComposing
      ) {
        return;
      }

      event.preventDefault();
      onSubmit();
    },
    [enabled, onSubmit]
  );
}

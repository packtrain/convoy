import { RefObject, useCallback, useEffect, useMemo, useState } from "react";
import { TASK_TABLE_HOTKEYS } from "@/lib/browser/hotkeys";
import { STATUS_OPTIONS } from "@/lib/tasks/constants";
import {
  getStatusShortcutLabel,
  getTaskTypeShortcutLabel,
  matchTaskPropertyShortcut,
  STATUS_SHORTCUT_TARGETS,
  TASK_TYPE_SHORTCUT_TARGETS,
  type TaskPropertyShortcut,
} from "@/lib/tasks/metadata-shortcuts";
import type { BuiltInTaskTypeKey } from "@/lib/tasks/task-types";
import type { Status } from "@/lib/tasks/types";

const SHORTCUT_PALETTE_TIMEOUT_MS = 4000;

type ShortcutPaletteMode = "status" | "type";

export interface ShortcutPaletteOption {
  key: string;
  label: string;
}

export interface ShortcutPaletteState {
  mode: ShortcutPaletteMode;
  title: string;
  prefix: string;
  options: ShortcutPaletteOption[];
}

interface MetadataShortcutDescriptor {
  mode: ShortcutPaletteMode;
  title: string;
  prefix: string;
  options: ShortcutPaletteOption[];
  applyTarget?: (ids: string[], key: string) => boolean;
}

interface UseMetadataShortcutPaletteOptions {
  hotkeyTarget: Document | null;
  containerRef: RefObject<HTMLElement | null>;
  hasSelection: boolean;
  enabled: boolean;
  onSetStatus?: (ids: string[], status: Status) => void;
  onSetTaskType?: (ids: string[], taskTypeKey: BuiltInTaskTypeKey) => void;
  allowedStatuses?: Status[];
  /** P/A/I/L/D/M on the target rows; claimed so no other key handler also runs. */
  onPropertyShortcut?: (property: TaskPropertyShortcut, ids: string[]) => void;
  getShortcutTargetIds: () => string[];
}

function isTextInputActive(): boolean {
  const activeElement = document.activeElement;
  if (activeElement instanceof HTMLElement && activeElement.isContentEditable) {
    return true;
  }

  return Boolean(
    activeElement?.hasAttribute("data-task-input") ||
      activeElement?.hasAttribute("data-add-task-input") ||
      activeElement?.tagName === "INPUT" ||
      activeElement?.tagName === "TEXTAREA" ||
      activeElement?.tagName === "SELECT"
  );
}

function claimShortcutEvent(event: KeyboardEvent) {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

export function useMetadataShortcutPalette({
  hotkeyTarget,
  containerRef,
  hasSelection,
  enabled,
  onSetStatus,
  onSetTaskType,
  allowedStatuses,
  onPropertyShortcut,
  getShortcutTargetIds,
}: UseMetadataShortcutPaletteOptions) {
  const [activeShortcutMode, setActiveShortcutMode] =
    useState<ShortcutPaletteMode | null>(null);

  const statusShortcutTargets = useMemo(() => {
    const allowedStatusSet = new Set(allowedStatuses ?? STATUS_OPTIONS);
    return STATUS_SHORTCUT_TARGETS.filter((target) =>
      allowedStatusSet.has(target.status)
    );
  }, [allowedStatuses]);

  const shortcutDescriptors = useMemo(() => {
    const descriptors = {
      status: {
        mode: "status",
        title: "Set status",
        prefix: TASK_TABLE_HOTKEYS.setStatusPrefix,
        options: statusShortcutTargets.map((target) => ({
          key: target.key,
          label: getStatusShortcutLabel(target),
        })),
        applyTarget: onSetStatus
          ? (ids: string[], key: string) => {
              const target = statusShortcutTargets.find(
                (option) => option.key === key
              );
              if (!target) return false;

              onSetStatus(ids, target.status);
              return true;
            }
          : undefined,
      },
      type: {
        mode: "type",
        title: "Set type",
        prefix: TASK_TABLE_HOTKEYS.setTypePrefix,
        options: TASK_TYPE_SHORTCUT_TARGETS.map((target) => ({
          key: target.key,
          label: getTaskTypeShortcutLabel(target),
        })),
        applyTarget: onSetTaskType
          ? (ids: string[], key: string) => {
              const target = TASK_TYPE_SHORTCUT_TARGETS.find(
                (option) => option.key === key
              );
              if (!target) return false;

              onSetTaskType(ids, target.taskTypeKey);
              return true;
            }
          : undefined,
      },
    } satisfies Record<ShortcutPaletteMode, MetadataShortcutDescriptor>;

    return descriptors;
  }, [onSetStatus, onSetTaskType, statusShortcutTargets]);

  const shortcutPalette = activeShortcutMode
    ? shortcutDescriptors[activeShortcutMode]
    : null;

  const shouldHandleMetadataShortcut = useCallback(() => {
    const container = containerRef.current;
    const activeElement = document.activeElement;
    const hasFocusWithin = container?.contains(activeElement);

    return hasFocusWithin || (activeElement === document.body && hasSelection);
  }, [containerRef, hasSelection]);

  const handleShortcutKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;

      if (activeShortcutMode) {
        if (isTextInputActive()) {
          setActiveShortcutMode(null);
          return;
        }

        if (key === "Escape") {
          claimShortcutEvent(event);
          setActiveShortcutMode(null);
          return;
        }

        if (!enabled || event.altKey || event.ctrlKey || event.metaKey) {
          setActiveShortcutMode(null);
          return;
        }

        const descriptor = shortcutDescriptors[activeShortcutMode];
        const targetIds = getShortcutTargetIds();
        if (
          !descriptor.applyTarget ||
          targetIds.length === 0 ||
          !descriptor.applyTarget(targetIds, key)
        ) {
          setActiveShortcutMode(null);
          return;
        }

        claimShortcutEvent(event);
        setActiveShortcutMode(null);
        return;
      }

      if (!enabled || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      if (
        !shouldHandleMetadataShortcut() ||
        isTextInputActive() ||
        getShortcutTargetIds().length === 0
      ) {
        return;
      }

      const property = onPropertyShortcut ? matchTaskPropertyShortcut(event) : null;
      if (property && onPropertyShortcut) {
        claimShortcutEvent(event);
        onPropertyShortcut(property, getShortcutTargetIds());
        return;
      }

      const descriptor = Object.values(shortcutDescriptors).find(
        (candidate) =>
          candidate.prefix === key &&
          candidate.applyTarget &&
          candidate.options.length > 0
      );
      if (!descriptor) {
        return;
      }

      claimShortcutEvent(event);
      setActiveShortcutMode(descriptor.mode);
    },
    [
      activeShortcutMode,
      enabled,
      getShortcutTargetIds,
      onPropertyShortcut,
      shortcutDescriptors,
      shouldHandleMetadataShortcut,
    ]
  );

  // Capture-phase ownership keeps second keys such as C, and the property keys,
  // from leaking to table/global single-key shortcuts (thread D, create C).
  useEffect(() => {
    if (!hotkeyTarget) {
      return;
    }

    hotkeyTarget.addEventListener("keydown", handleShortcutKeyDown, {
      capture: true,
    });

    return () => {
      hotkeyTarget.removeEventListener("keydown", handleShortcutKeyDown, {
        capture: true,
      });
    };
  }, [handleShortcutKeyDown, hotkeyTarget]);

  useEffect(() => {
    if (!activeShortcutMode) {
      return;
    }

    if (!enabled) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- The palette mirrors the table's enabled state and must close in the same render cycle.
      setActiveShortcutMode(null);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setActiveShortcutMode(null);
    }, SHORTCUT_PALETTE_TIMEOUT_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [activeShortcutMode, enabled]);

  return { shortcutPalette };
}

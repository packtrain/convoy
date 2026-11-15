import {
  RefObject,
  useCallback,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";

type PendingNameInputFocusRestore = {
  taskId: string;
  selectionStart: number | null;
  selectionEnd: number | null;
};

let pendingNameInputFocusRestore: PendingNameInputFocusRestore | null = null;

function getInputSelection(input: HTMLInputElement): {
  selectionStart: number | null;
  selectionEnd: number | null;
} {
  try {
    return {
      selectionStart: input.selectionStart,
      selectionEnd: input.selectionEnd,
    };
  } catch {
    return {
      selectionStart: null,
      selectionEnd: null,
    };
  }
}

function restoreInputSelection(
  input: HTMLInputElement,
  restore: PendingNameInputFocusRestore
): void {
  if (restore.selectionStart === null || restore.selectionEnd === null) {
    return;
  }

  try {
    input.setSelectionRange(restore.selectionStart, restore.selectionEnd);
  } catch {
    // Ignore unsupported selection states; focus restoration still matters.
  }
}

/** Sets the full title as a native tooltip only while the text is cut off. */
function showTitleWhenTruncated(element: HTMLElement, title: string) {
  if (element.scrollWidth > element.clientWidth) {
    element.title = title;
  } else {
    element.removeAttribute("title");
  }
}

export interface NameCellInputProps {
  value: string;
  taskId: string;
  isClosed: boolean;
  inputRefs: RefObject<Map<string, HTMLInputElement> | null>;
  onSave: (value: string) => void;
  onDelete: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  /** False renders the name as plain text: nothing to focus, nothing to save. */
  isEditable?: boolean;
}

export function NameCellInput({
  value: serverValue,
  taskId,
  isClosed,
  inputRefs,
  onSave,
  onDelete,
  onKeyDown,
  isEditable = true,
}: NameCellInputProps) {
  const inputElementRef = useRef<HTMLInputElement | null>(null);
  const inputRefMap = inputRefs.current;
  // Track both local and server values to detect external changes
  const [state, setState] = useState({
    localValue: serverValue,
    lastServerValue: serverValue,
    isFocused: false,
  });

  const registerInput = useCallback(
    (el: HTMLInputElement | null) => {
      const previousInput = inputElementRef.current;
      if (!el && previousInput && document.activeElement === previousInput) {
        pendingNameInputFocusRestore = {
          taskId,
          ...getInputSelection(previousInput),
        };
      }

      inputElementRef.current = el;
      if (el) {
        inputRefMap?.set(taskId, el);
      } else {
        inputRefMap?.delete(taskId);
      }

      if (!el || pendingNameInputFocusRestore?.taskId !== taskId) {
        return;
      }

      const restore = pendingNameInputFocusRestore;
      pendingNameInputFocusRestore = null;
      if (document.activeElement !== document.body) {
        return;
      }

      el.focus();
      restoreInputSelection(el, restore);
    },
    [inputRefMap, taskId]
  );

  // Sync from server when value changed externally and not focused
  let { localValue, lastServerValue } = state;
  const { isFocused } = state;
  if (serverValue !== lastServerValue && !isFocused) {
    localValue = serverValue;
    lastServerValue = serverValue;
    setState({ localValue, lastServerValue, isFocused });
  }

  const handleFocus = () => {
    setState((s) => ({ ...s, isFocused: true }));
  };

  const handleBlur = () => {
    const valueChanged = localValue !== serverValue;

    if (valueChanged) {
      if (localValue === "") {
        onDelete();
      } else {
        onSave(localValue);
      }
    } else if (localValue === "") {
      onDelete();
    }
    // Don't update lastServerValue here - keep it as current serverValue
    // so sync check won't reset to old value before server updates
    setState((s) => ({ ...s, isFocused: false }));
  };

  if (!isEditable) {
    return (
      <span
        onPointerEnter={(event) => showTitleWhenTruncated(event.currentTarget, serverValue)}
        className={cn(
          "min-w-0 truncate px-2 py-2",
          isClosed ? "text-muted-foreground line-through" : "text-foreground"
        )}
      >
        {serverValue}
      </span>
    );
  }

  return (
    <div className="relative inline-flex min-w-[100px] max-w-full">
      <span className="invisible whitespace-pre px-2 py-2">{localValue || " "}</span>
      <input
        type="text"
        data-task-input
        data-task-input-id={taskId}
        ref={registerInput}
        value={localValue}
        onChange={(e) => setState((s) => ({ ...s, localValue: e.target.value }))}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={onKeyDown}
        onPointerEnter={(event) => showTitleWhenTruncated(event.currentTarget, localValue)}
        className={cn(
          "absolute inset-0 w-full bg-transparent px-2 py-2 outline-none",
          isClosed ? "text-muted-foreground line-through" : "text-foreground"
        )}
      />
    </div>
  );
}

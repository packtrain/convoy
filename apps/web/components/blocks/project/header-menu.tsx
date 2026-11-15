"use client";

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface HeaderMenuRenderArgs {
  open: boolean;
  close: () => void;
  toggle: () => void;
}

interface HeaderMenuProps {
  className?: string;
  menuClassName?: string;
  onClose?: () => void;
  trigger: (args: HeaderMenuRenderArgs) => ReactNode;
  children: (args: Pick<HeaderMenuRenderArgs, "close">) => ReactNode;
}

export function HeaderMenu({
  className,
  menuClassName,
  onClose,
  trigger,
  children,
}: HeaderMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    onClose?.();
  }, [onClose]);

  const toggle = useCallback(() => {
    setOpen((current) => {
      if (current) {
        onClose?.();
      }
      return !current;
    });
  }, [onClose]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || rootRef.current?.contains(target)) {
        return;
      }

      if (!(target instanceof Element)) {
        close();
        return;
      }

      if (
        target.closest(
          '[data-slot="dialog-content"], [data-slot="dropdown-menu-content"], [data-slot="popover-content"], [data-slot="select-content"]'
        )
      ) {
        return;
      }

      close();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [close, open]);

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      {trigger({ open, close, toggle })}
      {open ? (
        <div
          role="menu"
          className={cn(
            "absolute right-0 top-full z-50 mt-1 w-48 rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10",
            menuClassName
          )}
        >
          {children({ close })}
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { ArrowRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ButtonExt } from "@/components/custom/button-ext";

export function ButtonBusyPreview() {
  const [busy, setBusy] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  const handleClick = useCallback(() => {
    setBusy(true);

    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = window.setTimeout(() => {
      setBusy(false);
      timeoutRef.current = null;
    }, 1800);
  }, []);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="flex flex-col items-center gap-3">
      <ButtonExt
        busy={busy}
        effect="expandIcon"
        icon={ArrowRight}
        iconPlacement="right"
        onClick={handleClick}
        type="button"
      >
        Run action
      </ButtonExt>
      <p className="text-center text-xs leading-5 text-muted-foreground">
        Click to show ButtonExt busy state with the 3x4 snake loader.
      </p>
    </div>
  );
}

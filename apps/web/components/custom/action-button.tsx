"use client";

import { ArrowRightIcon } from "lucide-react";
import { ButtonExt, ButtonExtProps } from "./button-ext";
import { cn } from "@/lib/utils";

export function ActionButton({
  children,
  busy,
  roundedFull,
  showIcon = true,
  ...props
}: ButtonExtProps & { roundedFull?: boolean; showIcon?: boolean }) {
  if (!showIcon) {
    return (
      <ButtonExt
        type="submit"
        disabled={busy}
        effect="expandIcon"
        busy={busy}
        className={cn(roundedFull && "rounded-full")}
        {...props}
      >
        {children}
      </ButtonExt>
    );
  }

  return (
    <ButtonExt
      type="submit"
      disabled={busy}
      effect="expandIcon"
      icon={ArrowRightIcon}
      iconPlacement="right"
      busy={busy}
      className={cn(roundedFull && "rounded-full")}
      {...props}
    >
      {children}
    </ButtonExt>
  );
}

"use client";

import { useState, type ReactNode } from "react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { ProfileDetails, type ProfileDetailsData } from "./profile-details";
import { useIsMobile } from "@/hooks/browser/use-mobile";
import { cn } from "@/lib/utils";

export function ProfileHoverCard({
  profile,
  disabled = false,
  triggerAsChild = false,
  children,
}: {
  profile: ProfileDetailsData;
  disabled?: boolean;
  triggerAsChild?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // A phone has no room beside the trigger, so the card opens below it.
  const isMobile = useIsMobile();
  // Disabling drops a pending open, so re-enabling never resurrects a stale card.
  if (disabled && open) setOpen(false);

  return (
    <HoverCard
      open={disabled ? false : open}
      onOpenChange={(nextOpen) => {
        if (!disabled) setOpen(nextOpen);
      }}
      openDelay={500}
      closeDelay={120}
    >
      <HoverCardTrigger asChild data-profile-hover-card-trigger>
        {triggerAsChild ? (
          children
        ) : (
          <span
            tabIndex={0}
            aria-label={`Details for ${profile.name}`}
            className={cn(
              "inline-flex min-w-0 items-center gap-1.5 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
              !disabled && "cursor-default"
            )}
          >
            {children}
          </span>
        )}
      </HoverCardTrigger>
      <HoverCardContent side={isMobile ? "bottom" : "right"} align="start" sideOffset={8} collisionPadding={8} className="z-[70] w-80 max-w-[calc(100vw-16px)] p-3">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-semibold text-foreground">{profile.name}</p>
            <p className="text-xs text-muted-foreground">CLI profile</p>
          </div>
          <span className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[11px]",
            profile.isOnline ? "text-foreground" : "text-muted-foreground"
          )}>
            <span className={cn("size-1.5 rounded-full", profile.isOnline ? "bg-green-500" : "bg-muted-foreground/40")} />
            {profile.isOnline ? "Online" : "Offline"}
          </span>
        </div>
        <ProfileDetails profile={profile} />
      </HoverCardContent>
    </HoverCard>
  );
}

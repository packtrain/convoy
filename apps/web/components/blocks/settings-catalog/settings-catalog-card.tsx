import type { ReactNode } from "react";

import { AppLink, type RouteTarget } from "@/lib/navigation";
import { cn } from "@/lib/utils";

interface SettingsCatalogCardProps {
  href: RouteTarget | string;
  ariaLabel: string;
  title: string;
  metadata?: ReactNode;
  preview?: ReactNode;
  leading?: ReactNode;
  className?: string;
}

export function SettingsCatalogCard({
  href,
  ariaLabel,
  title,
  metadata,
  preview,
  leading,
  className,
}: SettingsCatalogCardProps) {
  return (
    <AppLink
      href={href}
      aria-label={ariaLabel}
      className={cn(
        "flex min-h-36 cursor-pointer flex-col rounded-lg border border-border bg-background p-4 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        {leading ? <div className="flex-none">{leading}</div> : null}
        <div className="min-w-0 space-y-1">
          <h2 className="truncate text-sm font-medium text-foreground">
            {title}
          </h2>
          {metadata ? (
            <div className="text-sm text-muted-foreground">{metadata}</div>
          ) : null}
        </div>
      </div>

      {preview ? (
        <p className="mt-4 line-clamp-3 text-sm leading-5 text-muted-foreground">
          {preview}
        </p>
      ) : null}
    </AppLink>
  );
}

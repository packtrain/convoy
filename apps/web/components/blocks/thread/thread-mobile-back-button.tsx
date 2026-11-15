"use client";

import { ChevronLeft } from "lucide-react";
import { AppLink, appRoute, href } from "@/lib/navigation";
import { Button } from "@/components/ui/button";

/**
 * Mobile-only back affordance for full-screen thread conversations. The
 * global mobile nav bar hides inside conversations, so the header back link
 * to the thread list is the way out (spec: docs/specs/mobile-bottom-nav.md).
 */
export function ThreadMobileBackButton({
  organizationSlug,
  projectAlias,
}: {
  organizationSlug: string;
  projectAlias: string;
}) {
  return (
    <Button
      asChild
      variant="ghost"
      size="icon-sm"
      aria-label="Back to threads"
      className="md:hidden"
    >
      <AppLink
        href={href(appRoute.projectThreads(organizationSlug, projectAlias))}
      >
        <ChevronLeft />
      </AppLink>
    </Button>
  );
}

"use client";

import { NotFoundState } from "@/components/blocks/not-found-state";
import { Button } from "@/components/ui/button";
import { AppLink, appRoute } from "@/lib/navigation";

interface ThreadNotFoundProps {
  organizationSlug: string;
  projectAlias: string;
}

export function ThreadNotFound({
  organizationSlug,
  projectAlias,
}: ThreadNotFoundProps) {
  return (
    <NotFoundState
      title="Thread not found"
      action={
        <Button variant="secondary" asChild>
          <AppLink href={appRoute.projectThreads(organizationSlug, projectAlias)}>
            Back to threads
          </AppLink>
        </Button>
      }
    />
  );
}

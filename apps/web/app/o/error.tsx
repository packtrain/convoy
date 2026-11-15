"use client";

import { useEffect } from "react";
import { RouteErrorState } from "@/components/blocks/auth/route-error-state";

interface OrganizationRouteErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function OrganizationRouteError({ error, reset }: OrganizationRouteErrorProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return <RouteErrorState error={error} onRecover={reset} />;
}

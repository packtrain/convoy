"use client";

import { useEffect } from "react";
import { RouteErrorState } from "@/components/blocks/auth/route-error-state";

interface AppErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function AppError({ error, reset }: AppErrorProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return <RouteErrorState error={error} onRecover={reset} />;
}

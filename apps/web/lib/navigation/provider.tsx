"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { emitNavigationLocationChange } from "./core";

interface NavigationProviderProps {
  children: ReactNode;
}

export function NavigationProvider({ children }: NavigationProviderProps) {
  const pathname = usePathname();

  // Next router path transitions do not emit popstate. Bridge them into the
  // navigation location store; query-only native history updates emit directly.
  useEffect(() => {
    emitNavigationLocationChange();
  }, [pathname]);

  return <>{children}</>;
}

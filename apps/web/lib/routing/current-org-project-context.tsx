"use client";

import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import type { Id } from "@/convex/_generated/dataModel";

export type CurrentOrgProjectRoute = {
  organizationId: Id<"organizations">;
  organizationSlug: string;
  projectAlias: string | null;
};

const CurrentOrgProjectContext =
  createContext<CurrentOrgProjectRoute | null>(null);

export function CurrentOrgProjectProvider({
  organizationId,
  organizationSlug,
  projectAlias,
  children,
}: CurrentOrgProjectRoute & {
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({
      organizationId,
      organizationSlug,
      projectAlias,
    }),
    [organizationId, organizationSlug, projectAlias]
  );

  return (
    <CurrentOrgProjectContext.Provider value={value}>
      {children}
    </CurrentOrgProjectContext.Provider>
  );
}

export function useOptionalCurrentOrgProject() {
  return useContext(CurrentOrgProjectContext);
}

export function useCurrentOrgProject() {
  const context = useOptionalCurrentOrgProject();

  if (!context) {
    throw new Error(
      "useCurrentOrgProject must be used within CurrentOrgProjectProvider"
    );
  }

  return context;
}

"use client";

import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { useDialog } from "@/hooks/ui/use-dialog";
import { parseProjectParams, useNavigationLocation } from "@/lib/navigation";
import { CreateTaskDialog } from "./create-task-dialog";

interface CreateTaskDialogContextValue {
  openCreateTaskDialog: () => void;
}

const CreateTaskDialogContext =
  createContext<CreateTaskDialogContextValue | null>(null);

interface CreateTaskDialogProviderProps {
  children: ReactNode;
  organizationId: Id<"organizations">;
  organizationSlug: string;
  activeProjectAlias: string | null;
}

export function CreateTaskDialogProvider({
  children,
  organizationId,
  organizationSlug,
  activeProjectAlias,
}: CreateTaskDialogProviderProps) {
  const taskCreateDialog = useDialog();
  const { search } = useNavigationLocation();
  const activeListRef = useMemo(() => {
    if (!activeProjectAlias) {
      return null;
    }

    const params = parseProjectParams(new URLSearchParams(search));
    return params.archived ? null : (params.list ?? null);
  }, [activeProjectAlias, search]);
  const value = useMemo(
    () => ({ openCreateTaskDialog: taskCreateDialog.open }),
    [taskCreateDialog.open]
  );

  return (
    <CreateTaskDialogContext.Provider value={value}>
      {children}
      <CreateTaskDialog
        dialog={taskCreateDialog}
        organizationId={organizationId}
        organizationSlug={organizationSlug}
        activeProjectAlias={activeProjectAlias}
        activeListRef={activeListRef}
      />
    </CreateTaskDialogContext.Provider>
  );
}

export function useCreateTaskDialog() {
  const context = useContext(CreateTaskDialogContext);
  if (!context) {
    throw new Error(
      "useCreateTaskDialog must be used within CreateTaskDialogProvider"
    );
  }

  return context;
}

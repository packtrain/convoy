"use client";

import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { Id } from "@/convex/_generated/dataModel";

type ThreadReadStateContextValue = {
  suppressedAutoReadThreadId: Id<"cliThreads"> | undefined;
  setSuppressedAutoReadThreadId: (
    threadId: Id<"cliThreads"> | undefined
  ) => void;
  clearSuppressionIfMatches: (threadId: Id<"cliThreads">) => void;
};

const ThreadReadStateContext = createContext<ThreadReadStateContextValue | null>(
  null
);

export function ThreadReadStateProvider({
  value,
  children,
}: {
  value: ThreadReadStateContextValue;
  children: ReactNode;
}) {
  return (
    <ThreadReadStateContext.Provider value={value}>
      {children}
    </ThreadReadStateContext.Provider>
  );
}

export function useThreadReadState() {
  return useContext(ThreadReadStateContext);
}

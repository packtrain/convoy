"use client";

import { ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";
import { AuthProvider } from "@/lib/auth/hooks";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

/** The Convex client, authenticated by the build's auth adapter (docs/specs/auth-adapters.md). */
export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return <AuthProvider client={convex}>{children}</AuthProvider>;
}

import { z } from "zod";

/**
 * App auth mode, baked in at build time from NEXT_PUBLIC_AUTH_MODE. Unset means
 * `clerk`. See docs/specs/auth-adapters.md.
 */
export const authModeSchema = z.enum(["clerk", "convex"]);
export type AuthMode = z.infer<typeof authModeSchema>;

export const authMode: AuthMode = authModeSchema.parse(process.env.NEXT_PUBLIC_AUTH_MODE || "clerk");

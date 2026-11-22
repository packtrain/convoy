import { v, type Infer } from "convex/values";
import type { Id } from "../../_generated/dataModel";

/** The `method` arg Convex Auth passes to our user callbacks for email and password. */
export const emailPasswordMethodValidator = v.object({ name: v.literal("emailPassword"), profile: v.object({}) });
export type EmailPasswordMethod = Infer<typeof emailPasswordMethodValidator>;

export type CreateAuthUserArgs = { method: EmailPasswordMethod };
export type OnAuthSignInArgs = { method: EmailPasswordMethod; userId: Id<"users"> };

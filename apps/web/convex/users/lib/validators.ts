import { v, type Infer } from "convex/values";
import { vGoogleProfile } from "@convex-dev/auth/methods/google/server";
import type { Id } from "../../_generated/dataModel";

/** The `method` arg Convex Auth passes to our user callbacks for email and password. */
export const emailPasswordMethodValidator = v.object({ name: v.literal("emailPassword"), profile: v.object({}) });
/** The same for Google, with the claims of its id_token. */
export const googleMethodValidator = v.object({ name: v.literal("google"), profile: vGoogleProfile });
export const authMethodValidator = v.union(emailPasswordMethodValidator, googleMethodValidator);
export type AuthMethod = Infer<typeof authMethodValidator>;

export type CreateAuthUserArgs = { method: AuthMethod };
export type OnAuthSignInArgs = { method: Infer<typeof emailPasswordMethodValidator>; userId: Id<"users"> };

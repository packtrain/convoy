import { setupConvexAuth } from "@convex-dev/auth/server";
import {
  setupEmailPassword,
  type CompleteSignUpResult,
  type SignUpResult,
} from "@convex-dev/auth/methods/email-password/server";
import type { FunctionReference } from "convex/server";
import { ConvexError, v, type Infer } from "convex/values";
import { api, components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { env, internalMutation, mutation } from "./_generated/server";
import { getAppUrlBase } from "./lib/shared/appUrl";
import { normalizeEmail } from "./lib/shared/strings";
import { takePendingSignUpCode, upsertPendingSignUpCode } from "./users/lib/pendingSignUpCodesRepo";
import type { CreateAuthUserArgs, OnAuthSignInArgs } from "./users/lib/validators";

// Convex Auth (docs/specs/auth-adapters.md). Loads on every deployment, so nothing
// here may require an env var: Clerk and local-demo deployments leave these unused.

const auth = setupConvexAuth({ component: components.auth });
export const { signOut, refreshSession, isAuthenticated } = auth;

const appUrl = getAppUrlBase();
const LANDING_URLS = {
  signUp: `${appUrl}/auth/verify-email`,
  changeEmail: `${appUrl}/auth/change-email`,
  recovery: `${appUrl}/auth/reset-password`,
};

const EMAIL_NOT_CONFIGURED = "Email sending is not configured on this deployment";

function isEmailVerificationOff(): boolean {
  return env.AUTH_EMAIL_VERIFICATION === "off";
}

// Annotated so the exports below don't infer their types through `internal`, which includes this module.
const createAuthUser: FunctionReference<"mutation", "internal", CreateAuthUserArgs, Id<"users">> =
  internal.users.core.createAuthUser;
const onAuthSignIn: FunctionReference<"mutation", "internal", OnAuthSignInArgs, null> =
  internal.users.core.onAuthSignIn;
type SendEmailRef = typeof components.resend.lib.sendEmail;
// Stand-in for Resend's `lib.sendEmail`, same args. S1b sends real mail.
const deliverAuthEmailRef = internal.auth.deliverAuthEmail as unknown as SendEmailRef;

export const { signUpWithEmailPassword, completeSignUpWithEmailPassword, signInWithEmailPassword } =
  setupEmailPassword(auth, {
    component: components.authEmail,
    passwordComponent: components.authPassword,
    emailSender: {
      kind: "resend",
      sendEmail: deliverAuthEmailRef,
      apiKey: "",
      from: "Convoy <auth@convoy.invalid>",
    },
    urls: LANDING_URLS,
  }).attachUserCallbacks({
    createUser: createAuthUser,
    onSignIn: onAuthSignIn,
  });

/**
 * Stand-in email sender. With verification off it keeps the code of a sign-up link
 * and sends nothing; every other link (recovery, change-email) is dropped.
 */
export const deliverAuthEmail = internalMutation({
  args: {
    options: v.object({
      apiKey: v.string(),
      testMode: v.boolean(),
      initialBackoffMs: v.number(),
      retryAttempts: v.number(),
    }),
    from: v.string(),
    to: v.array(v.string()),
    subject: v.optional(v.string()),
    text: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    if (!isEmailVerificationOff()) {
      throw new ConvexError(EMAIL_NOT_CONFIGURED);
    }
    const code = signUpCodeFromText(args.text);
    const to = args.to[0];
    if (code === null || to === undefined) {
      return "dropped";
    }

    await upsertPendingSignUpCode(ctx, { email: normalizeEmail(to), code });
    return "stored";
  },
});

/** The `code` of the link in the email text, only if the link is our sign-up landing URL. */
function signUpCodeFromText(text: string | undefined): string | null {
  const link = text?.match(/https?:\/\/\S+/)?.[0];
  if (!link) return null;
  const url = new URL(link);
  const code = url.searchParams.get("code");
  url.searchParams.delete("code");
  return code && url.toString() === new URL(LANDING_URLS.signUp).toString() ? code : null;
}

type SignUpErrorCode = Extract<SignUpResult, { success: false }>["userError"]["error"];

// Exhaustive, so a new package error code fails the typecheck here.
const SIGN_UP_ERROR_CODES: Record<SignUpErrorCode, null> = {
  INVALID_EMAIL: null,
  RATE_LIMITED: null,
  EMAIL_TAKEN: null,
  PASSWORD_TOO_SHORT: null,
  PASSWORD_TOO_LONG: null,
  PASSWORD_HAS_SURROUNDING_WHITESPACE: null,
  PASSWORD_TOO_COMMON: null,
};

const vSignUpWithoutVerificationResult = v.union(
  v.object({
    status: v.literal("complete"),
    tokens: v.object({
      accessToken: v.string(),
      refreshToken: v.string(),
      refreshTokenExpiresAt: v.number(),
      userId: v.string(),
    }),
  }),
  v.object({
    status: v.literal("error"),
    userError: v.object({
      error: v.union(...(Object.keys(SIGN_UP_ERROR_CODES) as SignUpErrorCode[]).map((code) => v.literal(code))),
    }),
  })
);
type SignUpWithoutVerificationResult = Infer<typeof vSignUpWithoutVerificationResult>;

const signUpRef: FunctionReference<"mutation", "public", { email: string; password: string }, SignUpResult> =
  api.auth.signUpWithEmailPassword;
const completeSignUpRef: FunctionReference<
  "mutation",
  "public",
  { emailCode: string; browserSecret: string },
  CompleteSignUpResult
> = api.auth.completeSignUpWithEmailPassword;

/**
 * Sign-up with verification off, in one transaction: start the sign-up, take the code
 * the stand-in sender kept, and complete it. Anything unexpected rolls it all back.
 */
export const signUpWithoutEmailVerification = mutation({
  args: { email: v.string(), password: v.string() },
  returns: vSignUpWithoutVerificationResult,
  handler: async (ctx, args): Promise<SignUpWithoutVerificationResult> => {
    if (!isEmailVerificationOff()) {
      throw new ConvexError(EMAIL_NOT_CONFIGURED);
    }
    const started = await ctx.runMutation(signUpRef, args);
    if (!started.success) {
      return { status: "error", userError: { error: started.userError.error } };
    }
    const emailCode = await takePendingSignUpCode(ctx, normalizeEmail(args.email));
    if (emailCode === null) {
      throw new Error("The stand-in email sender kept no sign-up code");
    }
    const completed = await ctx.runMutation(completeSignUpRef, { emailCode, browserSecret: started.browserSecret });
    if (completed.status !== "complete") {
      throw new Error(`Unexpected error when completing the sign-up: ${completed.userError.error}`);
    }
    return { status: "complete", tokens: completed.tokens };
  },
});

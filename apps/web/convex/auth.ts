import { setupConvexAuth } from "@convex-dev/auth/server";
import {
  setupEmailPassword,
  type CompleteSignUpResult,
  type SignUpResult,
} from "@convex-dev/auth/methods/email-password/server";
import { setupGoogle } from "@convex-dev/auth/methods/google/server";
import type { FunctionReference } from "convex/server";
import { ConvexError, v, type Infer } from "convex/values";
import { api, components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { env, internalMutation, mutation, query } from "./_generated/server";
import { buildResendEmail, getEmailFrom } from "./lib/notifications/email";
import {
  buildPasswordChangedEmail,
  buildResetPasswordEmail,
  buildVerifyEmailEmail,
  type EmailTemplateDocument,
} from "../lib/emails/catalog";
import { appRoute } from "../lib/navigation/routes";
import { href } from "../lib/navigation/target";
import { isEmailVerificationOff } from "./lib/access/auth";
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
const FORGOT_PASSWORD_URL = `${appUrl}${href(appRoute.authForgotPassword())}`;

const EMAIL_NOT_CONFIGURED = "Email sending is not configured on this deployment";

// Convex refuses to deploy without the Google credentials, so an install without Google sets this.
const GOOGLE_CREDENTIAL_PLACEHOLDER = "none";

function isGoogleConfigured(): boolean {
  return [env.AUTH_GOOGLE_CLIENT_ID, env.AUTH_GOOGLE_CLIENT_SECRET].every(
    (value) => value && value !== GOOGLE_CREDENTIAL_PLACEHOLDER
  );
}

// Annotated so the exports below don't infer their types through `internal`, which includes this module.
const createAuthUser: FunctionReference<"mutation", "internal", CreateAuthUserArgs, Id<"users">> =
  internal.users.core.createAuthUser;
const onAuthSignIn: FunctionReference<"mutation", "internal", OnAuthSignInArgs, null> =
  internal.users.core.onAuthSignIn;
type SendEmailRef = typeof components.resend.lib.sendEmail;
// Stand-in for Resend's `lib.sendEmail`, same args: it forwards or keeps the code by setting.
const deliverAuthEmailRef = internal.auth.deliverAuthEmail as unknown as SendEmailRef;

export const {
  signUpWithEmailPassword,
  completeSignUpWithEmailPassword,
  signInWithEmailPassword,
  startPasswordRecovery,
  checkPasswordRecovery,
  completePasswordRecovery,
} = setupEmailPassword(auth, {
    component: components.authEmail,
    passwordComponent: components.authPassword,
    emailSender: {
      kind: "resend",
      sendEmail: deliverAuthEmailRef,
      // Both are read when sending, in `deliverAuthEmail`.
      apiKey: "",
      from: "",
    },
    urls: LANDING_URLS,
  }).attachUserCallbacks({
    createUser: createAuthUser,
    onSignIn: onAuthSignIn,
  });

export const { startSignInWithGoogle, completeSignInWithGoogle } = setupGoogle(auth, {
  component: components.authGoogle,
  allowedRedirectOrigins: [new URL(appUrl).origin],
}).attachUserCallbacks({ createUser: createAuthUser });

/** The deployment's auth configuration, for the sign-in screens. Email is on unless verification is off. */
export const getSettings = query({
  args: {},
  returns: v.object({ emailEnabled: v.boolean(), googleEnabled: v.boolean() }),
  handler: async () => ({ emailEnabled: !isEmailVerificationOff(), googleEnabled: isGoogleConfigured() }),
});

/**
 * Stand-in email sender. With verification required it forwards to Resend in our templates. With it off
 * it keeps the code of a sign-up link and sends nothing; other links are dropped.
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
      const apiKey = env.RESEND_API_KEY;
      if (!apiKey) throw new ConvexError(EMAIL_NOT_CONFIGURED);
      return await ctx.runMutation(components.resend.lib.sendEmail, {
        ...args,
        options: { ...args.options, apiKey },
        from: getEmailFrom(),
        ...styledEmail(args.subject, args.text),
      });
    }
    const landing = landingLinkFromText(args.text);
    const code = landing?.page === "signUp" ? new URL(landing.link).searchParams.get("code") : null;
    const to = args.to[0];
    if (code === null || to === undefined) {
      return "dropped";
    }

    await upsertPendingSignUpCode(ctx, { email: normalizeEmail(to), code });
    return "stored";
  },
});

type LandingPage = keyof typeof LANDING_URLS;

/** The link in the email text and its landing page, only if it is one of ours with a `code`. */
function landingLinkFromText(text: string | undefined): { page: LandingPage; link: string } | null {
  const link = text?.match(/https?:\/\/\S+/)?.[0];
  if (!link) return null;
  const url = new URL(link);
  const code = url.searchParams.get("code");
  url.searchParams.delete("code");
  const page = (Object.keys(LANDING_URLS) as LandingPage[]).find(
    (key) => new URL(LANDING_URLS[key]).toString() === url.toString()
  );
  return code && page ? { page, link } : null;
}

// Our template per landing page; null sends the package's plain text (email change isn't offered yet).
const LINK_EMAILS: Record<LandingPage, ((url: string, expiresIn: string) => EmailTemplateDocument) | null> = {
  signUp: (verifyUrl, expiresIn) => buildVerifyEmailEmail({ verifyUrl, expiresIn }),
  recovery: (resetUrl, expiresIn) => buildResetPasswordEmail({ resetUrl, expiresIn }),
  changeEmail: null,
};
// The package's notice after a password change or reset, matched by its subject.
const PASSWORD_CHANGED_SUBJECT = "Your password was changed";

/** Our subject and HTML for the package's emails we have a template for; its text stays the plain-text part. */
function styledEmail(subject: string | undefined, text: string | undefined): { subject: string; html: string } | null {
  const template = authEmailTemplate(subject, text);
  if (!template) return null;
  const { subject: styledSubject, html } = buildResendEmail(template);
  return { subject: styledSubject, html };
}

function authEmailTemplate(subject: string | undefined, text: string | undefined): EmailTemplateDocument | null {
  if (subject === PASSWORD_CHANGED_SUBJECT) return buildPasswordChangedEmail({ resetUrl: FORGOT_PASSWORD_URL });
  const landing = landingLinkFromText(text);
  const expiresIn = text?.match(/stops working after ([^,]+),/)?.[1];
  const build = landing && LINK_EMAILS[landing.page];
  return build && expiresIn ? build(landing.link, expiresIn) : null;
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

// A sign-in envelope, because the auth proxy route refuses any other shape.
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
      error: v.union(
        ...(Object.keys(SIGN_UP_ERROR_CODES) as SignUpErrorCode[]).map((code) => v.literal(code)),
        // Verification is on: the browser starts the sign-up with `signUpWithEmailPassword` instead.
        v.literal("EMAIL_VERIFICATION_REQUIRED")
      ),
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
      return { status: "error", userError: { error: "EMAIL_VERIFICATION_REQUIRED" } };
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

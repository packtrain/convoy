import { ConvexError } from "convex/values";

export const errors = {
  AUTH_NOT_AUTHENTICATED: "Not authenticated",
} as const;

/**
 * Structured error codes clients branch on. Plain `ConvexError(message)` is
 * enough when the client only displays the message, but production redacts
 * non-`ConvexError` messages and `getErrorMessage` only surfaces string
 * `data` — so any failure the UI must *react* to (not just render) carries a
 * stable `code` here instead.
 */
export const USER_ERROR_CODES = {
  AUTH_NOT_AUTHENTICATED: "AUTH_NOT_AUTHENTICATED",
} as const;

export type UserErrorData = {
  code: (typeof USER_ERROR_CODES)[keyof typeof USER_ERROR_CODES];
  message: string;
};

/**
 * Unauthenticated callers of the identity-sync mutations (`store`, `onboard`).
 * Colocated with the code and message so the thrown shape cannot drift from
 * what the client's `data.code` guard matches on.
 */
export function notAuthenticatedError(): ConvexError<UserErrorData> {
  return new ConvexError({
    code: USER_ERROR_CODES.AUTH_NOT_AUTHENTICATED,
    message: errors.AUTH_NOT_AUTHENTICATED,
  });
}

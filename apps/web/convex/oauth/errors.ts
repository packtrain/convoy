/**
 * User-facing error messages thrown by the OAuth domain. Specs and tests
 * assert on these strings — keep them in sync with `docs/specs/`.
 */
export const errors = {
  CLIENT_NAME_TOO_LONG: "Client name must be 100 characters or less",
  REDIRECT_URIS_REQUIRED: "At least one redirect URI is required",
  REDIRECT_URIS_TOO_MANY: "At most 10 redirect URIs are allowed",
  REDIRECT_URI_INVALID: "Redirect URIs must be https, or http on a loopback host",
  CLIENT_NOT_FOUND: "Unknown OAuth client",
  REDIRECT_URI_NOT_REGISTERED: "Redirect URI is not registered for this client",
  CODE_CHALLENGE_INVALID: "code_challenge must be an S256 challenge (43 base64url characters)",
  STATE_TOO_LONG: "state must be 2000 characters or less",
  RESPONSE_TYPE_UNSUPPORTED: "Only response_type=code is supported",
} as const;

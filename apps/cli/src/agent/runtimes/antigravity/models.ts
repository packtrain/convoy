/**
 * Stored values are `default` or an agy model id such as `gemini-3.8-flash`.
 * Keep in sync with `apps/web/convex/cli/lib/runtimes/antigravity/models.ts`.
 */
const MODEL_ID_PATTERN = /^[\w][\w.:/-]{0,199}$/;

export function isAntigravityModel(value: unknown): value is string {
  return typeof value === "string" && MODEL_ID_PATTERN.test(value);
}

/**
 * Sample patch for the Appearance preview (OS-1684). Additions and deletions
 * both matter: a preset's +/− colors come from its `gitDecoration.*` (or
 * `terminal.ansi*`) keys, not just its syntax tokens.
 *
 * Built as lines, not a template literal: a blank context line is a single
 * space, and editors/formatters silently strip that trailing space, which is
 * what made pierre reject the patch. `code-diff-theme-preview.test.ts` runs it
 * through the real parser.
 */
const BLANK_CONTEXT = " ";

export const PREVIEW_PATCH = [
  "--- a/greet.ts",
  "+++ b/greet.ts",
  "@@ -1,5 +1,5 @@",
  ' const GREETING = "Hello";',
  BLANK_CONTEXT,
  "-export function greet(name: string) {",
  '-  return GREETING + ", " + name + "!";',
  "+export function greet(name: string, times = 1) {",
  "+  return Array.from({ length: times }, () => `${GREETING}, ${name}!`).join(\" \");",
  " }",
  "",
].join("\n");

/**
 * A space next to a line ending is unsafe in markdown, so the MDX serializer writes it
 * as a character reference — `Artifact: ` is stored as `Artifact:&#x20;`. Consumers
 * treating the stored markdown as plain text never decode it, so the literal `&#x20;`
 * reaches the thread composer and the CLI.
 *
 * Trailing whitespace carries no meaning in an authored prompt (hard breaks serialize as
 * a backslash), so it is dropped along with the escapes standing in for it. An
 * author-typed `&` serializes as `&amp;`, so a literal `&#x20;` in prose never matches.
 */
const TRAILING_SPACE_RUN = /(?:&#x0*20;|&#0*32;|[ \t])+(?=\r?\n|$)/gi;

export function stripTrailingSpaces(markdown: string): string {
  return markdown.replace(TRAILING_SPACE_RUN, "");
}

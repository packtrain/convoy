// Generate alias from project name (first letters of words, uppercase)
export function generateAliasFromName(name: string): string {
  const words = name
    .trim()
    .replace(/[^A-Za-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "";

  // Take first letter of each word (up to 5)
  let alias = words
    .slice(0, 5)
    .map((word) => word[0])
    .join("")
    .toUpperCase();

  // If single word, take first 2-3 letters
  if (words.length === 1 && words[0].length >= 2) {
    alias = words[0].slice(0, 3).toUpperCase();
  }

  // Ensure it starts with a letter
  if (!/^[A-Z]/.test(alias)) {
    alias = "P" + alias;
  }

  return alias.slice(0, 5);
}

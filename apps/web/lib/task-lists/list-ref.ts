const MAX_LIST_REF_LENGTH = 32;

export function suggestTaskListRefFromName(name: string): string {
  const base = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
  const safeBase = /^[A-Z]/.test(base) ? base : `L-${base}`;
  const ref = safeBase.slice(0, MAX_LIST_REF_LENGTH).replace(/-+$/g, "");
  return ref.length >= 2 ? ref : "LIST";
}

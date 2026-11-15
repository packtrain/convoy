import type { ThreadComposerFilePart } from "@/lib/threads/hooks/use-thread-message-attachment-upload";
import { getErrorMessage } from "@/lib/errors";

interface BuildHandleThreadComposerAttachmentsChangeParams {
  /** Omit for draft-bound uploads; the upload hook saves the draft's attachments (OS-2141). */
  setPendingDraft?: (hasPendingAttachments: boolean) => void;
  syncFileParts: (fileParts: ThreadComposerFilePart[]) => Promise<void>;
  onError: (message: string) => void;
}

export function buildHandleThreadComposerAttachmentsChange({
  setPendingDraft,
  syncFileParts,
  onError,
}: BuildHandleThreadComposerAttachmentsChangeParams) {
  return (fileParts: ThreadComposerFilePart[]) => {
    setPendingDraft?.(fileParts.length > 0);
    void syncFileParts(fileParts).catch((error: unknown) => {
      const message =
        getErrorMessage(error, "Failed to process attachments");
      onError(message);
    });
  };
}

export function dedupeAttachmentFileName(name: string, reservedNames: ReadonlySet<string>): string {
  const used = new Set(Array.from(reservedNames, value => value.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  let suffix = 2;
  while (used.has(`${stem}-${suffix}${extension}`.toLowerCase())) suffix += 1;
  return `${stem}-${suffix}${extension}`;
}

export function serializeAttachmentReference(filename: string): string {
  return `#${/[\s#"\\]/u.test(filename) ? JSON.stringify(filename) : filename}`;
}


type AttachmentReferenceTextPart =
  | { type: "text"; value: string }
  | { type: "attachment"; filename: string };

export function splitAttachmentReferences(text: string, filenames: readonly string[]): AttachmentReferenceTextPart[] {
  const counts = new Map<string, number>();
  for (const name of filenames) counts.set(name.toLowerCase(), (counts.get(name.toLowerCase()) ?? 0) + 1);
  const candidates = filenames.filter((name) => counts.get(name.toLowerCase()) === 1)
    .map((filename) => ({ filename, token: serializeAttachmentReference(filename) }))
    .sort((a, b) => b.token.length - a.token.length);
  const parts: AttachmentReferenceTextPart[] = [];
  let end = 0;
  for (const match of text.matchAll(/(?:^|[\s([{])#/gu)) {
    const start = match.index + match[0].length - 1;
    if (start < end) continue;
    const candidate = candidates.find(({ token }) => text.startsWith(token, start) &&
      /^(?:$|\s|[),;!?:\]}]|\.(?=$|\s))/.test(text.slice(start + token.length)));
    if (!candidate) continue;
    if (start > end) parts.push({ type: "text", value: text.slice(end, start) });
    parts.push({ type: "attachment", filename: candidate.filename });
    end = start + candidate.token.length;
  }
  if (end < text.length) parts.push({ type: "text", value: text.slice(end) });
  return parts;
}

import type { Id } from "../convex/_generated/dataModel.js";

/**
 * Client-side byte cap shared by attachment uploads and worktree downloads, checked
 * before reading. Mirrors the server's `MAX_ATTACHMENT_SIZE`, which deletes larger
 * blobs at registration (OS-1676) and the download op re-checks (OS-2050).
 */
export const MAX_UPLOAD_MB = 50;
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

/** POST `body` to a Convex storage upload URL and return the new storage id. */
export async function uploadToStorage(uploadUrl: string, body: Uint8Array, contentType: string): Promise<Id<"_storage">> {
  const response = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": contentType }, body });
  if (!response.ok) {
    throw new Error(`Upload failed: ${response.status} - ${await response.text()}`);
  }
  const json: unknown = await response.json();
  const storageId = typeof json === "object" && json !== null ? Reflect.get(json, "storageId") : undefined;
  if (typeof storageId !== "string") {
    throw new Error("Upload response did not include a storageId.");
  }
  return storageId as Id<"_storage">;
}

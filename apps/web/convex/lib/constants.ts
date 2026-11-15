/** Per-file attachment cap, checked against the stored blob (OS-1676). Clients import it for their pre-upload check. */
export const MAX_ATTACHMENT_SIZE_MB = 50;
export const MAX_ATTACHMENT_SIZE = MAX_ATTACHMENT_SIZE_MB * 1024 * 1024;
/** Per-message attachment count; the composer and the thread handoff check it client-side. */
export const MAX_MESSAGE_ATTACHMENTS = 10;

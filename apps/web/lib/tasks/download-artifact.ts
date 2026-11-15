export type ArtifactContentType = "markdown" | "html";

const ARTIFACT_MIME_TYPES: Record<ArtifactContentType, string> = {
  markdown: "text/markdown;charset=utf-8",
  html: "text/html;charset=utf-8",
};

/** Download artifact source using the browser's native file-save behavior. */
export function downloadArtifact(
  content: string,
  fileName: string,
  contentType: ArtifactContentType
): boolean {
  let objectUrl: string | null = null;
  let link: HTMLAnchorElement | null = null;

  try {
    const blob = new Blob([content], { type: ARTIFACT_MIME_TYPES[contentType] });
    objectUrl = URL.createObjectURL(blob);
    link = document.createElement("a");
    link.href = objectUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    return true;
  } catch (error) {
    console.error("Artifact download error:", error);
    return false;
  } finally {
    link?.remove();
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
  }
}

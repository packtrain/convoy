import { ensure } from "../../../lib/shared/ensure";
import { errors } from "../../errors";

export const MAX_ARTIFACT_CONTENT_LENGTH = 200_000;

const MAX_ARTIFACT_NAME_LENGTH = 120;
const MAX_RUN_ID_LENGTH = 200;

export function normalizeArtifactName(rawName: string): string {
  const trimmed = rawName.trim();
  ensure(trimmed).notEq("", errors.ARTIFACT_NAME_REQUIRED);
  ensure(trimmed.length).lte(MAX_ARTIFACT_NAME_LENGTH, errors.artifactNameTooLong(MAX_ARTIFACT_NAME_LENGTH));
  return trimmed;
}

export function normalizeArtifactContent(rawContent: string | undefined): string {
  const content = rawContent ?? "";
  ensure(content.length).lte(MAX_ARTIFACT_CONTENT_LENGTH, errors.artifactContentTooLong(MAX_ARTIFACT_CONTENT_LENGTH));
  return content;
}

/** Trims the runId; empty/whitespace-only and null inputs normalize to `undefined`. */
export function normalizeArtifactRunId(rawRunId: string | null | undefined): string | undefined {
  if (rawRunId == null) {
    return undefined;
  }

  const trimmed = rawRunId.trim();
  if (!trimmed) {
    return undefined;
  }

  ensure(trimmed.length).lte(MAX_RUN_ID_LENGTH, errors.runIdTooLong(MAX_RUN_ID_LENGTH));
  return trimmed;
}

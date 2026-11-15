import type { OutputOptions } from "../../../lib/output.js";
import { readTextFile } from "../../../lib/text-input.js";
import { validateNoConflict } from "../parsers.js";

export { resolveRequiredStringInput } from "../../../lib/text-input.js";

export interface ArtifactContentOptions extends OutputOptions {
  content?: string;
  contentFile?: string;
  clearContent?: boolean;
}

export interface ArtifactRunIdOptions {
  runId?: string;
  clearRunId?: boolean;
}

export function resolveArtifactContent(options: ArtifactContentOptions, allowClear: boolean): string | undefined {
  validateNoConflict(options.content !== undefined, options.contentFile !== undefined, "Cannot use --content and --content-file together");

  if (allowClear) {
    validateNoConflict(options.clearContent === true, options.content !== undefined, "Cannot use --content and --clear-content together");
    validateNoConflict(
      options.clearContent === true,
      options.contentFile !== undefined,
      "Cannot use --content-file and --clear-content together"
    );
  }

  if (options.content !== undefined) {
    return options.content;
  }

  if (options.contentFile !== undefined) {
    return readTextFile(options.contentFile, "content");
  }

  if (allowClear && options.clearContent === true) {
    return "";
  }

  return undefined;
}

export function validateRunIdOptions(options: ArtifactRunIdOptions): void {
  validateNoConflict(options.clearRunId === true, options.runId !== undefined, "Cannot use --run-id and --clear-run-id together");
}

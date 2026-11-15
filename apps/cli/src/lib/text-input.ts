import { readFileSync } from "node:fs";

export function readTextFile(path: string, label: string): string {
  try {
    return readFileSync(path, "utf-8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read ${label} file "${path}": ${message}`);
  }
}

interface StringInputArgs {
  inlineValue?: string;
  filePath?: string;
  inlineLabel: string;
  fileLabel: string;
  displayName: string;
}

/**
 * Text from either source, or `""` when neither was given — for callers where an
 * attachment can stand in for the text (`threads create|send`). The caller owns
 * the "text or attachment" error, since only it knows the other half.
 *
 * Not trimmed: `tasks artifacts replace` matches exact strings.
 */
export function resolveOptionalStringInput({
  inlineValue,
  filePath,
  inlineLabel,
  fileLabel,
  displayName,
}: StringInputArgs): string {
  if (inlineValue !== undefined && filePath !== undefined) {
    throw new Error(`Cannot use ${inlineLabel} and ${fileLabel} together`);
  }

  if (inlineValue !== undefined) {
    return inlineValue;
  }

  if (filePath !== undefined) {
    return readTextFile(filePath, displayName);
  }

  return "";
}

export function resolveRequiredStringInput(args: StringInputArgs): string {
  if (args.inlineValue === undefined && args.filePath === undefined) {
    throw new Error(`Pass ${args.inlineLabel} or ${args.fileLabel}.`);
  }

  return resolveOptionalStringInput(args);
}

/**
 * `undefined` when neither source was given — for update commands, where an
 * absent flag means "leave the stored value alone" and `""` would overwrite it.
 */
export function resolveAbsentableStringInput(args: StringInputArgs): string | undefined {
  if (args.inlineValue === undefined && args.filePath === undefined) {
    return undefined;
  }

  return resolveOptionalStringInput(args);
}

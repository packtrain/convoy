import { Option, type Command } from "commander";

export const OUTPUT_MODES = ["text", "json"] as const;

export type OutputMode = (typeof OUTPUT_MODES)[number];

export interface OutputOptions {
  output?: OutputMode;
  json?: boolean;
}

export function addOutputOptions<T extends Command>(cmd: T): T {
  return cmd
    .addOption(
      new Option("--output <mode>", "Output format: text or json")
        .choices([...OUTPUT_MODES])
        .default("text")
    )
    .option("--json", "Alias for --output json") as T;
}

export function resolveOutputMode(options: OutputOptions): OutputMode {
  if (options.json) {
    return "json";
  }

  const output = options.output ?? "text";
  if (output === "text" || output === "json") {
    return output;
  }

  throw new Error(
    `Invalid output mode "${output}". Valid values: ${OUTPUT_MODES.join(", ")}`
  );
}

export function printOutput<T>(
  outputMode: OutputMode,
  value: T,
  renderText: (value: T) => void
): void {
  if (outputMode === "json") {
    console.log(JSON.stringify(value, null, 2));
    return;
  }

  renderText(value);
}

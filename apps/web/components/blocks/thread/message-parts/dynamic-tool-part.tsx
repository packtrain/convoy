import type { DynamicToolUIPart } from "ai";
import { Wrench } from "lucide-react";
import { getFilenameFromPath } from "@/lib/path-display";
import { isRecord } from "@/lib/type-guards";
import { CollapsibleToolPart } from "./components/collapsible-tool-part";
import { ToolPayloadSection } from "./components/tool-payload-section";
import { ToolSurface } from "./components/tool-surface";

interface DynamicToolPartProps {
  part: DynamicToolUIPart;
  onDebug?: () => void;
}

function getInputValueByKey(input: unknown, key: string): string | undefined {
  if (!isRecord(input)) return undefined;
  const value = input[key];
  return typeof value === "string" ? value : undefined;
}

function getGenericInputPreview(input: unknown): string | undefined {
  const candidateKeys = [
    "pattern",
    "query",
    "path",
    "file_path",
    "filePath",
    "command",
    "prompt",
    "text",
  ];
  for (const key of candidateKeys) {
    const value = getInputValueByKey(input, key);
    if (value) return value;
  }
  return undefined;
}

function getReadPathFromOutput(part: DynamicToolUIPart): string | undefined {
  if (!("output" in part)) return undefined;
  const output = part.output;
  if (!isRecord(output)) return undefined;
  const file = output.file;
  if (!isRecord(file)) return undefined;
  const filePath = file.filePath;
  return typeof filePath === "string" ? filePath : undefined;
}

function getToolSummary(part: DynamicToolUIPart): string {
  const toolName = part.toolName;
  const lowerToolName = toolName.toLowerCase();
  const input = "input" in part ? part.input : undefined;

  if (lowerToolName === "grep") {
    const pattern = getInputValueByKey(input, "pattern");
    return pattern ? `${toolName} '${pattern}'` : toolName;
  }

  if (lowerToolName === "read") {
    const filePath =
      getInputValueByKey(input, "file_path") ??
      getInputValueByKey(input, "filePath") ??
      getInputValueByKey(input, "path") ??
      getReadPathFromOutput(part);
    return filePath ? `${toolName} ${getFilenameFromPath(filePath)}` : toolName;
  }

  const preview = getGenericInputPreview(input);
  return preview ? `${toolName} '${preview}'` : toolName;
}

export function DynamicToolPart({ part, onDebug }: DynamicToolPartProps) {
  const summary = getToolSummary(part);

  return (
    <CollapsibleToolPart
      icon={Wrench}
      title={summary}
      state={part.state}
      errorText={"errorText" in part ? part.errorText : undefined}
      onDebug={onDebug}
      renderChildren={() => (
        <ToolSurface className="flex flex-col gap-3">
          <ToolPayloadSection label="Input" value={"input" in part ? part.input : undefined} />
          {/* Errors and the pending state live on the row's icon (OS-1769). */}
          {part.state === "output-available" ? (
            <ToolPayloadSection label="Output" value={part.output} />
          ) : null}
        </ToolSurface>
      )}
    />
  );
}

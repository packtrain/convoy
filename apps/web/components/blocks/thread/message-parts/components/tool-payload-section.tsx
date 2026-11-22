import { ExpandableLines, TOOL_OUTPUT_LINE_LIMIT } from "../lib/expandable-lines";

function stringifyForCodeBlock(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

/** A labeled, line-capped block of a raw tool input or output, inside a `ToolSurface`. */
export function ToolPayloadSection({ label, value }: { label: string; value: unknown }) {
  if (value === undefined) return null;
  return (
    <div className="group/payload flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <ExpandableLines
        text={stringifyForCodeBlock(value)}
        lineLimit={TOOL_OUTPUT_LINE_LIMIT}
        // Bleed through ToolSurface's p-3 so "Show all" spans its edges.
        className="-mx-3"
        buttonClassName="group-last/payload:-mb-3 group-last/payload:rounded-b-md"
      >
        {(displayText) => (
          <pre className="overflow-x-auto px-3 font-mono text-xs text-foreground">
            <code>{displayText}</code>
          </pre>
        )}
      </ExpandableLines>
    </div>
  );
}

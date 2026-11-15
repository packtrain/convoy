import { Plug } from "lucide-react";
import type { McpToolPayload } from "@/lib/ai-tools/mcp-tool";
import { formatMcpToolTitle } from "@/lib/ai-tools/mcp-tool";
import { CollapsibleToolPart } from "./components/collapsible-tool-part";
import { ToolPayloadSection } from "./components/tool-payload-section";
import { ToolSurface } from "./components/tool-surface";

interface McpToolPartProps {
  payload: McpToolPayload;
  onDebug?: () => void;
}

export function McpToolPart({ payload, onDebug }: McpToolPartProps) {
  return (
    <CollapsibleToolPart
      icon={Plug}
      title={formatMcpToolTitle(payload.tool)}
      trailing={
        <span className="shrink-0 rounded border border-border bg-muted px-1.5 text-xs text-muted-foreground">
          {payload.server}
        </span>
      }
      state={payload.state}
      errorText={payload.errorText}
      onDebug={onDebug}
      renderChildren={() => (
        <ToolSurface className="flex flex-col gap-3">
          <ToolPayloadSection label="Input" value={payload.input} />
          {/* Errors and the pending state live on the row's icon (OS-1769). */}
          {payload.state === "output-available" ? (
            <ToolPayloadSection label="Output" value={payload.output} />
          ) : null}
        </ToolSurface>
      )}
    />
  );
}

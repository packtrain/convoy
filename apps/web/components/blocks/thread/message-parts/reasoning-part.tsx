import type { ReasoningUIPart } from "ai";
import { MessageResponse } from "@/components/ai-elements/message";
import { CollapsibleToolPart } from "./components/collapsible-tool-part";

interface ReasoningPartProps {
  part: ReasoningUIPart;
  partIndex: number;
}

export function ReasoningPart({ part, partIndex }: ReasoningPartProps) {
  // Redacted thinking: show the label, but nothing to expand.
  const hasText = part.text.trim().length > 0;

  return (
    <CollapsibleToolPart
      key={`reasoning-${partIndex}`}
      title="Reasoning"
      hasBody={hasText}
      renderChildren={() => (
        <MessageResponse className="text-muted-foreground">{part.text}</MessageResponse>
      )}
    />
  );
}

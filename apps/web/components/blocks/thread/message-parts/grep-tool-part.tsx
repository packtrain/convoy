import { Search } from "lucide-react";
import type { GrepToolPayload } from "@/lib/ai-tools/grep-tool";
import { buildSearchTitle } from "./lib/search-tool-title";
import { SearchToolPart } from "./search-tool-part";

interface GrepToolPartProps {
  payload: GrepToolPayload;
  onDebug?: () => void;
}

export function GrepToolPart({ payload, onDebug }: GrepToolPartProps) {
  return (
    <SearchToolPart
      view={{
        icon: Search,
        title: buildSearchTitle({
          verb: "Search",
          pattern: payload.pattern,
          path: payload.path,
          glob: payload.glob,
          resultCount: payload.resultCount,
          resultLabel: payload.resultLabel,
        }),
        state: payload.state,
        errorFallback: "Search failed",
        emptyLabel: "No search output",
        resultText: payload.resultText,
        errorText: payload.errorText,
      }}
      onDebug={onDebug}
    />
  );
}

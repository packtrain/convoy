import { Files } from "lucide-react";
import type { GlobToolPayload } from "@/lib/ai-tools/glob-tool";
import { buildSearchTitle } from "./lib/search-tool-title";
import { SearchToolPart } from "./search-tool-part";

interface GlobToolPartProps {
  payload: GlobToolPayload;
  onDebug?: () => void;
}

export function GlobToolPart({ payload, onDebug }: GlobToolPartProps) {
  const footerNotice = payload.truncated ? (
    <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
      Results were truncated. Use a more specific path or pattern for the full set.
    </div>
  ) : undefined;

  return (
    <SearchToolPart
      view={{
        icon: Files,
        title: buildSearchTitle({
          verb: "Find",
          pattern: payload.pattern,
          path: payload.path,
          resultCount: payload.resultCount,
          resultLabel: "files",
        }),
        state: payload.state,
        errorFallback: "File search failed",
        emptyLabel: "No files found",
        resultText: payload.resultText,
        errorText: payload.errorText,
        isEmpty: payload.resultCount === 0,
        footerNotice,
      }}
      onDebug={onDebug}
    />
  );
}

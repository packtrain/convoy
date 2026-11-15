import { terminalJson, wrapLines } from "../formatters.js";
import type { LogEvent } from "./validators.js";
export { terminalJson } from "../formatters.js";

export function displayLines(events: LogEvent[], columns: number): string[] {
  const lines: string[] = [];
  for (const event of events) {
    if (lines.length) lines.push("");
    if (event.fidelity.includes("shortened") || event.fidelity.includes("non-JSON")) {
      lines.push(`[Event ${event.order}: ${event.fidelity}]`);
    }
    if (event.nextOffset !== undefined) {
      lines.push(`[Event ${event.order}: ${event.bytes} bytes. Exceeds display limit; export retrieves the stored JSON.]`);
      continue;
    }
    lines.push(...wrapLines(terminalJson(event.eventJson), columns));
  }
  return lines;
}

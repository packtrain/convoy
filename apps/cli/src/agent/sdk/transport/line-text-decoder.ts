import type { DecodedTransportFrame } from "../types.js";

export function decodeLineTextFrame(input: {
  stream: "stdout" | "stderr";
  line: string;
  truncated: boolean;
}): DecodedTransportFrame {
  return {
    stream: input.stream,
    payload: input.line,
    parsed: input.line,
    truncated: input.truncated,
  };
}

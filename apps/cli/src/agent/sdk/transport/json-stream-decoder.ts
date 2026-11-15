import type { DecodedTransportFrame } from "../types.js";

export function decodeJsonStreamFrame(input: {
  stream: "stdout" | "stderr";
  line: string;
  truncated: boolean;
}): DecodedTransportFrame {
  const trimmed = input.line.trim();
  if (!trimmed) {
    return {
      stream: input.stream,
      payload: input.line,
      parsed: { kind: "text", line: "" },
      truncated: input.truncated,
    };
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return {
      stream: input.stream,
      payload: input.line,
      parsed,
      truncated: input.truncated,
    };
  } catch {
    return {
      stream: input.stream,
      payload: input.line,
      parsed: { kind: "text", line: input.line },
      truncated: input.truncated,
    };
  }
}

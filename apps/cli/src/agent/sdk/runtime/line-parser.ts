export interface ParsedLine {
  line: string;
  truncated: boolean;
}

function truncateUtf8(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length <= maxBytes) return value;
  return bytes.subarray(0, maxBytes).toString("utf8");
}

function normalizeLineEndings(value: string): string {
  if (value.endsWith("\r")) return value.slice(0, -1);
  return value;
}

export class LineParser {
  private readonly maxLineBytes: number;
  private buffered = "";

  constructor(maxLineBytes: number) {
    this.maxLineBytes = maxLineBytes;
  }

  feed(chunk: Buffer | string): ParsedLine[] {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    this.buffered += text;

    const out: ParsedLine[] = [];

    let newlineIndex = this.buffered.indexOf("\n");
    while (newlineIndex !== -1) {
      const raw = this.buffered.slice(0, newlineIndex);
      this.buffered = this.buffered.slice(newlineIndex + 1);

      const normalized = normalizeLineEndings(raw);
      const truncated = Buffer.byteLength(normalized, "utf8") > this.maxLineBytes;
      out.push({
        line: truncated ? truncateUtf8(normalized, this.maxLineBytes) : normalized,
        truncated,
      });

      newlineIndex = this.buffered.indexOf("\n");
    }

    // Prevent unbounded buffering when process writes huge lines without newline.
    if (
      this.buffered &&
      Buffer.byteLength(this.buffered, "utf8") > this.maxLineBytes * 2
    ) {
      out.push({
        line: truncateUtf8(this.buffered, this.maxLineBytes),
        truncated: true,
      });
      this.buffered = "";
    }

    return out;
  }

  flush(): ParsedLine[] {
    if (!this.buffered) return [];

    const normalized = normalizeLineEndings(this.buffered);
    this.buffered = "";
    const truncated = Buffer.byteLength(normalized, "utf8") > this.maxLineBytes;

    return [
      {
        line: truncated ? truncateUtf8(normalized, this.maxLineBytes) : normalized,
        truncated,
      },
    ];
  }
}

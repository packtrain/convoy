import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface UnknownPartProps {
  part: { type?: string } & Record<string, unknown>;
}

function stringifyUnknownPart(part: UnknownPartProps["part"]): string {
  try {
    return JSON.stringify(part, null, 2);
  } catch {
    return String(part);
  }
}

export function UnknownPart({ part }: UnknownPartProps) {
  return (
    <Card size="sm" className="border border-border bg-muted/20">
      <CardHeader className="flex flex-row items-center justify-between gap-2 border-b border-border py-2">
        <CardTitle className="text-sm">Unsupported part type</CardTitle>
        <Badge variant="outline">{part.type ?? "unknown"}</Badge>
      </CardHeader>
      <CardContent className="pt-2">
        <pre className="overflow-x-auto rounded-md border border-border bg-muted/50 p-3 font-mono text-xs text-foreground">
          <code>{stringifyUnknownPart(part)}</code>
        </pre>
      </CardContent>
    </Card>
  );
}

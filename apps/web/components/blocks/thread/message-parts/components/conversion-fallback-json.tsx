import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface ConversionFallbackJsonProps {
  reason: string;
  warnings: string[];
  detailsJson: string;
}

export function ConversionFallbackJson({
  reason,
  warnings,
  detailsJson,
}: ConversionFallbackJsonProps) {
  return (
    <Card className="border border-border bg-muted/20">
      <CardHeader className="flex flex-row items-start justify-between gap-3 border-b border-border">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-sm">
            <AlertTriangle className="size-4 text-foreground" />
            Assistant render fallback
          </CardTitle>
          <p className="text-xs text-muted-foreground">{reason}</p>
        </div>
        <Badge variant="destructive">Fallback JSON</Badge>
      </CardHeader>
      <CardContent className="space-y-3 pt-3">
        {warnings.length > 0 && (
          <div className="rounded-md border border-border bg-background px-3 py-2">
            <p className="text-xs font-medium text-foreground">Warnings</p>
            <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        )}
        <pre className="overflow-x-auto rounded-md border border-border bg-muted p-3 font-mono text-xs text-foreground">
          <code>{detailsJson}</code>
        </pre>
      </CardContent>
    </Card>
  );
}

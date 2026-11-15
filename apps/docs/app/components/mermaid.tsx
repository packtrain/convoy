import { useTheme } from "next-themes";
import { useEffect, useId, useRef, useState } from "react";

type MermaidProps = {
  chart: string;
};

export function Mermaid({ chart }: MermaidProps) {
  const reactId = useId();
  const renderNumber = useRef(0);
  const { resolvedTheme } = useTheme();
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!resolvedTheme) return;
    let cancelled = false;
    const id = `mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}-${++renderNumber.current}`;

    async function renderChart() {
      try {
        const mermaid = (await import("mermaid")).default;
        if (cancelled) return;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: resolvedTheme === "dark" ? "dark" : "neutral",
        });

        const result = await mermaid.render(id, chart);

        if (!cancelled) {
          setSvg(result.svg);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setSvg(null);
          setError(
            err instanceof Error ? err.message : "Unable to render diagram",
          );
        }
      }
    }

    void renderChart();

    return () => {
      cancelled = true;
    };
  }, [chart, reactId, resolvedTheme]);

  if (error) {
    return (
      <pre className="overflow-x-auto rounded-lg border bg-fd-muted p-4 text-sm">
        <code>{chart}</code>
      </pre>
    );
  }

  if (!svg) {
    return (
      <div className="my-6 rounded-lg border bg-fd-muted p-4 text-sm text-fd-muted-foreground">
        Rendering diagram...
      </div>
    );
  }

  return (
    <div
      className="my-6 overflow-x-auto rounded-lg border bg-fd-card p-4 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
      // Mermaid returns sanitized SVG when securityLevel is strict.
      // biome-ignore lint/security/noDangerouslySetInnerHtml: Mermaid rendering requires injecting generated SVG markup.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

import { cn } from "@/lib/utils";
import { Glyph } from "./glyph";

/** Glyph + title + description block that opens every onboarding/settings section. */
export function SectionHeader({
  title,
  description,
  align = "left",
  className,
}: {
  title: string;
  description: React.ReactNode;
  align?: "left" | "center";
  className?: string;
}) {
  const centered = align === "center";
  return (
    <div className={cn("flex flex-col", centered && "items-center text-center", className)}>
      <div className={centered ? "mb-4" : "mb-3.5"}>
        <Glyph size={centered ? 30 : 26} />
      </div>
      <h2 className="mb-1.5 text-[19px] font-semibold tracking-tight">{title}</h2>
      <p className={cn("mb-6 text-[13.5px] leading-relaxed text-muted-foreground", centered && "max-w-[36ch]")}>
        {description}
      </p>
    </div>
  );
}

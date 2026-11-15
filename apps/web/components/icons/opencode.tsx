import type React from "react";
import { cn } from "@/lib/utils";

/** Shared SVG structure — only the two fill colors differ between themes. */
function OpenCodeSvg({
  innerFill,
  outerFill,
  className,
  width,
  height,
  ...props
}: React.SVGProps<SVGSVGElement> & { innerFill: string; outerFill: string }) {
  return (
    <svg
      {...props}
      className={className}
      height={height}
      style={{ flex: "none", lineHeight: 1 }}
      viewBox="0 0 240 300"
      width={width}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M180 240H60V120H180V240Z" fill={innerFill} />
      <path
        d="M180 60H60V240H180V60ZM240 300H0V0H240V300Z"
        fill={outerFill}
      />
    </svg>
  );
}

/**
 * OpenCode icon that automatically switches between light and dark variants
 * based on the active theme (via Tailwind `dark:` class).
 */
const OpenCodeIcon = ({
  className,
  width = "1em",
  height = "1em",
  ...props
}: React.SVGProps<SVGSVGElement>) => {
  return (
    <>
      {/* Light theme variant */}
      <OpenCodeSvg
        {...props}
        className={cn("dark:hidden", className)}
        width={width}
        height={height}
        innerFill="#CFCECD"
        outerFill="#211E1E"
      />
      {/* Dark theme variant */}
      <OpenCodeSvg
        {...props}
        className={cn("hidden dark:block", className)}
        width={width}
        height={height}
        innerFill="#4B4646"
        outerFill="#F1ECEC"
      />
    </>
  );
};

export default OpenCodeIcon;

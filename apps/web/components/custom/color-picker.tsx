"use client";

import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import {
  DEFAULT_COLOR_PALETTE,
  EXTENDED_COLOR_PALETTE,
} from "@/lib/colors/palette";

// ============================================================================
// Types
// ============================================================================

export type ColorPalette = "default" | "extended" | readonly string[];

export interface ColorPickerProps {
  /** Current selected color (null = no color) */
  value: string | null;
  /** Callback when color changes */
  onChange: (color: string | null) => void;
  /** Whether to show "no color" option */
  allowEmpty?: boolean;
  /** Palette to use - "default", "extended", or custom array */
  palette?: ColorPalette;
  /** Number of columns in the grid. Defaults to 8 for the extended palette (the agent-editor layout), 4 otherwise. */
  columns?: number;
  /** Additional class name for the trigger button */
  triggerClassName?: string;
  /** Size of color swatches */
  swatchSize?: "sm" | "md" | "lg";
  /** Popover alignment */
  align?: "start" | "center" | "end";
  /** Whether the picker is disabled */
  disabled?: boolean;
  /** Accessible label for the trigger button */
  triggerAriaLabel?: string;
}

// ============================================================================
// Component
// ============================================================================

export function ColorPicker({
  value,
  onChange,
  allowEmpty = true,
  palette = "default",
  columns,
  triggerClassName,
  swatchSize = "md",
  align = "start",
  disabled = false,
  triggerAriaLabel = "Select color",
}: ColorPickerProps) {
  const colors = getColors(palette);
  // Standard grid widths: the extended palette renders as the agent-editor
  // 8-wide grid (3 shade rows) so every extended picker looks the same.
  const resolvedColumns = columns ?? (palette === "extended" ? 8 : 4);

  const swatchSizeClass = {
    sm: "size-4",
    md: "size-5",
    lg: "size-6",
  }[swatchSize];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          type="button"
          disabled={disabled}
          aria-label={triggerAriaLabel}
          className={cn("p-0", triggerClassName)}
        >
          {value ? (
            <div
              className="size-4 rounded-full"
              style={{ backgroundColor: value }}
            />
          ) : (
            <div className="size-4 rounded-full border-2 border-dashed border-muted-foreground/50" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" align={align}>
        <div className="flex items-start gap-2">
          {allowEmpty && (
            <ColorSwatchButton
              color={null}
              isSelected={value === null}
              swatchSizeClass={swatchSizeClass}
              onSelect={onChange}
            />
          )}
          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: `repeat(${resolvedColumns}, minmax(0, 1fr))` }}
          >
            {colors.map((color) => (
              <ColorSwatchButton
                key={color}
                color={color}
                isSelected={value === color}
                swatchSizeClass={swatchSizeClass}
                onSelect={onChange}
              />
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ColorSwatchButton({
  color,
  isSelected,
  swatchSizeClass,
  onSelect,
}: {
  color: string | null;
  isSelected: boolean;
  swatchSizeClass: string;
  onSelect: (color: string | null) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(color)}
      className={cn(
        "cursor-pointer rounded-full transition-all hover:scale-110",
        swatchSizeClass,
        isSelected &&
          "ring-2 ring-offset-2 ring-offset-background ring-primary",
        color === null &&
          "border-2 border-dashed border-muted-foreground/50"
      )}
      style={{ backgroundColor: color ?? undefined }}
      aria-label={color ?? "No color"}
    />
  );
}

// ============================================================================
// Inline variant - for use without popover
// ============================================================================

export interface ColorPickerInlineProps {
  /** Current selected color (null = no color) */
  value: string | null;
  /** Callback when color changes */
  onChange: (color: string | null) => void;
  /** Whether to show "no color" option */
  allowEmpty?: boolean;
  /** Palette to use - "default", "extended", or custom array */
  palette?: ColorPalette;
  /** Number of columns in the grid (0 = single row) */
  columns?: number;
  /** Size of color swatches */
  swatchSize?: "sm" | "md" | "lg";
  /** Maximum number of colors to show (useful for inline display) */
  maxColors?: number;
  /** Additional class name */
  className?: string;
}

export function ColorPickerInline({
  value,
  onChange,
  allowEmpty = false,
  palette = "default",
  columns = 0,
  swatchSize = "md",
  maxColors,
  className,
}: ColorPickerInlineProps) {
  let colors = getColors(palette);
  if (maxColors !== undefined) {
    colors = colors.slice(0, maxColors);
  }
  const allColors = allowEmpty ? [null, ...colors] : colors;

  const swatchSizeClass = {
    sm: "size-6",
    md: "size-8",
    lg: "size-9",
  }[swatchSize];

  const gridStyle =
    columns > 0
      ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }
      : undefined;

  return (
    <div
      className={cn(columns > 0 ? "grid gap-1" : "flex gap-1", className)}
      style={gridStyle}
    >
      {allColors.map((color) => (
        <button
          key={color ?? "none"}
          type="button"
          onClick={() => onChange(color)}
          className={cn(
            "rounded-md transition-all",
            swatchSizeClass,
            value === color &&
              "ring-2 ring-offset-2 ring-offset-background ring-primary",
            color === null && "border-2 border-dashed border-muted-foreground/50"
          )}
          style={{ backgroundColor: color ?? undefined }}
          aria-label={color ?? "No color"}
        />
      ))}
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function getColors(palette: ColorPalette): readonly string[] {
  if (Array.isArray(palette)) {
    return palette;
  }
  switch (palette) {
    case "extended":
      return EXTENDED_COLOR_PALETTE;
    case "default":
    default:
      return DEFAULT_COLOR_PALETTE;
  }
}

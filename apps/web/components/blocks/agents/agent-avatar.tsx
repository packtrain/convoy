import {
  Avatar,
  AvatarFallback,
} from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

interface AgentAvatarProps {
  name: string;
  color: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
}

export function getAgentInitials(name: string): string {
  const [firstCharacter] = Array.from(name.trim());
  return firstCharacter?.toUpperCase() ?? "A";
}

function getAgentAvatarTextColor(color: string): string {
  const normalized = color.trim();
  const hex = normalized.startsWith("#") ? normalized.slice(1) : normalized;
  const fullHex =
    hex.length === 3
      ? hex
          .split("")
          .map((character) => `${character}${character}`)
          .join("")
      : hex;

  if (!/^[0-9a-fA-F]{6}$/.test(fullHex)) {
    return "hsl(var(--primary-foreground))";
  }

  const red = Number.parseInt(fullHex.slice(0, 2), 16);
  const green = Number.parseInt(fullHex.slice(2, 4), 16);
  const blue = Number.parseInt(fullHex.slice(4, 6), 16);
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;

  return luminance > 0.62 ? "#111827" : "#ffffff";
}

const agentAvatarSizeClasses = {
  xs: "size-5",
  sm: "size-8",
  md: "size-9",
  lg: "size-10",
  xl: "size-12",
};

const agentAvatarTextSizeClasses = {
  xs: "text-[10px]",
  sm: "text-xs",
  md: "text-sm",
  lg: "text-sm",
  xl: "text-base",
};

export function AgentAvatar({
  name,
  color,
  size = "lg",
  className,
}: AgentAvatarProps) {
  return (
    <Avatar className={cn(agentAvatarSizeClasses[size], className)}>
      <AvatarFallback
        className={cn("font-medium", agentAvatarTextSizeClasses[size])}
        style={{ backgroundColor: color, color: getAgentAvatarTextColor(color) }}
      >
        {getAgentInitials(name)}
      </AvatarFallback>
    </Avatar>
  );
}

import { cn } from "@/lib/utils";

interface CircularProgressProps {
  completed: number;
  total: number;
  className?: string;
  /** Progress-arc color; defaults to the completion green used by task counts. */
  progressClassName?: string;
}

function CircularProgress({
  completed,
  total,
  className,
  progressClassName,
}: CircularProgressProps) {
  const percentage = total > 0 ? (completed / total) * 100 : 0;
  const radius = 5;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  return (
    <svg className={cn("size-3.5 -rotate-90", className)} viewBox="0 0 14 14">
      {/* Background circle */}
      <circle
        cx="7"
        cy="7"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="text-muted-foreground/30"
      />
      {/* Progress circle */}
      <circle
        cx="7"
        cy="7"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={strokeDashoffset}
        className={cn("text-emerald-500", progressClassName)}
      />
    </svg>
  );
}

export { CircularProgress };

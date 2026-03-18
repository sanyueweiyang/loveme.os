import { cn } from "@/lib/utils";

type WarningLevel = "none" | "warn" | "danger";

interface ProgressBarProps {
  value: number;
  delta?: number;
  size?: "sm" | "md";
  className?: string;
  warning?: WarningLevel;
}

const barColors: Record<WarningLevel, string> = {
  none: "bg-primary",
  warn: "bg-[hsl(var(--status-at-risk))]",
  danger: "bg-[hsl(var(--status-behind))]",
};

export function ProgressBar({ value, delta, size = "sm", className, warning = "none" }: ProgressBarProps) {
  const height = size === "sm" ? "h-1.5" : "h-2";

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className={cn("flex-1 rounded-full bg-muted overflow-hidden", height)}>
        <div
          className={cn("h-full rounded-full transition-all duration-500 ease-out", barColors[warning])}
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </div>
      <span className="text-xs font-medium text-muted-foreground tabular-nums w-8 text-right">
        {value}%
      </span>
      {delta !== undefined && delta !== 0 && (
        <span className={cn(
          "text-xs font-medium tabular-nums",
          delta > 0 ? "text-status-on-track" : "text-status-behind"
        )}>
          {delta > 0 ? "+" : ""}{delta}
        </span>
      )}
    </div>
  );
}

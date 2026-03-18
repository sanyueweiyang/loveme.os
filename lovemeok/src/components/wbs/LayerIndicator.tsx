import { WBS_LAYERS, WBSTier } from "@/types/wbs";
import { cn } from "@/lib/utils";

const tierColors: Record<WBSTier, string> = {
  strategy: "bg-wbs-strategy",
  management: "bg-wbs-management",
  execution: "bg-wbs-execution",
};

const tierTextColors: Record<WBSTier, string> = {
  strategy: "text-wbs-strategy",
  management: "text-wbs-management",
  execution: "text-wbs-execution",
};

interface LayerIndicatorProps {
  activeLevel: number;
  onLevelChange?: (level: number) => void;
  compact?: boolean;
}

export function LayerIndicator({ activeLevel, onLevelChange, compact = false }: LayerIndicatorProps) {
  return (
    <div className="flex flex-col gap-0.5">
      {WBS_LAYERS.map((layer) => {
        const isActive = activeLevel === layer.level;
        return (
          <button
            key={layer.level}
            onClick={() => onLevelChange?.(layer.level)}
            className={cn(
              "flex items-center gap-2 px-2 py-1 rounded-md text-left transition-all group",
              isActive
                ? "bg-accent"
                : "hover:bg-accent/50"
            )}
          >
            <div className={cn(
              "w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold text-white shrink-0",
              tierColors[layer.tier],
              isActive ? "opacity-100" : "opacity-50 group-hover:opacity-80"
            )}>
              {layer.level}
            </div>
            {!compact && (
              <div className="flex-1 min-w-0">
                <div className={cn(
                  "text-xs font-medium truncate",
                  isActive ? "text-foreground" : "text-muted-foreground"
                )}>
                  {layer.label}
                </div>
              </div>
            )}
            {!compact && isActive && (
              <div className={cn("text-[10px] font-medium", tierTextColors[layer.tier])}>
                {layer.reportCycle}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

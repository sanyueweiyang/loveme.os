import { L4Module } from "@/types/wbs";
import { StatusBadge } from "./StatusBadge";
import { ProgressBar } from "./ProgressBar";
import { cn } from "@/lib/utils";
import { Target, Activity, User, Camera, ChevronDown, ChevronRight, ShieldAlert } from "lucide-react";

type WarningLevel = "none" | "warn" | "danger";

interface L4ModuleCardProps {
  module: L4Module;
  className?: string;
  onClick?: () => void;
  isExpanded?: boolean;
  onAudit?: (e: React.MouseEvent) => void;
  warning?: WarningLevel;
  isHighlighted?: boolean;
}

export function L4ModuleCard({ module, className, onClick, isExpanded, onAudit, warning = "none", isHighlighted }: L4ModuleCardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "group relative border bg-card p-4 transition-all hover:shadow-md hover:border-primary/20 cursor-pointer",
        isExpanded ? "rounded-t-lg border-b-0" : "rounded-lg",
        warning === "danger" && "border-[hsl(var(--status-behind)/0.4)]",
        warning === "warn" && "border-[hsl(var(--status-at-risk)/0.4)]",
        isHighlighted && "ring-2 ring-primary ring-offset-2 shadow-lg animate-scale-in",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          {isExpanded ? <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" /> : <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />}
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-card-foreground truncate">{module.title}</h3>
            <div className="flex items-center gap-1.5 mt-1">
              <User className="w-3 h-3 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">{module.owner}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {onAudit && (
            <button
              onClick={(e) => { e.stopPropagation(); onAudit(e); }}
              className={cn(
                "p-1.5 rounded-md transition-colors",
                warning !== "none"
                  ? "text-[hsl(var(--status-behind))] bg-[hsl(var(--status-behind)/0.1)] hover:bg-[hsl(var(--status-behind)/0.2)]"
                  : "text-muted-foreground hover:text-primary hover:bg-primary/10"
              )}
              title="AI 审计"
            >
              <ShieldAlert className="w-3.5 h-3.5" />
            </button>
          )}
          <StatusBadge status={module.status} />
        </div>
      </div>

      {/* Progress */}
      <ProgressBar value={module.progress} delta={module.snapshotDelta} size="md" className="mb-3" warning={warning} />

      {/* L1 Alignment */}
      <div className="flex items-start gap-1.5 mb-3 px-2 py-1.5 rounded-md bg-wbs-strategy/5 border border-wbs-strategy/10">
        <Target className="w-3 h-3 text-wbs-strategy mt-0.5 shrink-0" />
        <span className="text-[11px] text-wbs-strategy leading-tight">{module.alignedL1Goal}</span>
      </div>

      {/* L6 Aggregation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Activity className="w-3 h-3 text-wbs-execution" />
          <span className="text-xs text-muted-foreground">
            L6 活动: <span className="font-medium text-foreground">{module.l6CompletedCount}</span>
            <span className="text-muted-foreground">/{module.l6ActivityCount}</span>
          </span>
        </div>
        {module.snapshotDelta !== undefined && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground" title="月度快照增量">
            <Camera className="w-3 h-3" />
          </div>
        )}
      </div>

      {/* Tags */}
      {module.tags && module.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-3 pt-3 border-t border-border/50">
          {module.tags.map((tag) => (
            <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">{tag}</span>
          ))}
        </div>
      )}
    </div>
  );
}

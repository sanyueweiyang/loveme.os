import { cn } from "@/lib/utils";

interface EffortBarProps {
  inProgressCount: number;
  unfulfilledCount: number;
  incidentalMinutes: number;
  totalPlannedMinutes?: number;
}

export function EffortBar({ inProgressCount, unfulfilledCount, incidentalMinutes, totalPlannedMinutes }: EffortBarProps) {
  const fulfilledCount = Math.max(0, inProgressCount - unfulfilledCount);
  const plannedTotal = inProgressCount || 1;
  const fulfilledPct = Math.round((fulfilledCount / plannedTotal) * 100);
  const unfulfilledPct = 100 - fulfilledPct;

  // Actual: fulfilled portion vs incidental
  const fulfilledMinutes = totalPlannedMinutes ?? fulfilledCount * 60; // fallback estimate
  const actualTotal = fulfilledMinutes + incidentalMinutes || 1;
  const actualFulfilledPct = Math.round((fulfilledMinutes / actualTotal) * 100);
  const actualIncidentalPct = 100 - actualFulfilledPct;

  return (
    <div className="rounded-xl border bg-card p-4 space-y-4">
      <h3 className="text-sm font-semibold">精力分布对比</h3>

      {/* Planned bar */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-muted-foreground font-medium">计划中 (WBS)</span>
          <span className="tabular-nums text-muted-foreground">
            {fulfilledCount} 已投入 / {unfulfilledCount} 未投入
          </span>
        </div>
        <div className="h-5 rounded-full bg-muted overflow-hidden flex">
          <div
            className="h-full bg-[hsl(var(--status-on-track))] transition-all duration-500 flex items-center justify-center"
            style={{ width: `${fulfilledPct}%` }}
          >
            {fulfilledPct > 15 && (
              <span className="text-[9px] font-bold text-white">{fulfilledPct}%</span>
            )}
          </div>
          <div
            className="h-full bg-destructive/60 transition-all duration-500 flex items-center justify-center"
            style={{ width: `${unfulfilledPct}%` }}
          >
            {unfulfilledPct > 15 && (
              <span className="text-[9px] font-bold text-white">{unfulfilledPct}%</span>
            )}
          </div>
        </div>
        <div className="flex gap-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[hsl(var(--status-on-track))]" /> 已投入
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-destructive/60" /> 未投入
          </span>
        </div>
      </div>

      {/* Actual bar */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-muted-foreground font-medium">实际消耗 (durationMinutes)</span>
          <span className="tabular-nums text-muted-foreground">
            杂事 {incidentalMinutes}min
          </span>
        </div>
        <div className="h-5 rounded-full bg-muted overflow-hidden flex">
          <div
            className="h-full bg-primary transition-all duration-500 flex items-center justify-center"
            style={{ width: `${actualFulfilledPct}%` }}
          >
            {actualFulfilledPct > 15 && (
              <span className="text-[9px] font-bold text-primary-foreground">{actualFulfilledPct}%</span>
            )}
          </div>
          <div
            className={cn(
              "h-full transition-all duration-500 flex items-center justify-center",
              incidentalMinutes > 120 ? "bg-destructive" : "bg-[hsl(var(--status-at-risk))]"
            )}
            style={{ width: `${actualIncidentalPct}%` }}
          >
            {actualIncidentalPct > 15 && (
              <span className="text-[9px] font-bold text-white">{actualIncidentalPct}%</span>
            )}
          </div>
        </div>
        <div className="flex gap-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-primary" /> 有效投入
          </span>
          <span className="flex items-center gap-1">
            <span className={cn("w-2 h-2 rounded-full", incidentalMinutes > 120 ? "bg-destructive" : "bg-[hsl(var(--status-at-risk))]")} /> 杂事
          </span>
        </div>
      </div>
    </div>
  );
}

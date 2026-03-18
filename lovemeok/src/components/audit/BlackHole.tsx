import { IncidentalLog } from "@/hooks/use-audit-consistency";
import { Flame, Clock, Brain } from "lucide-react";
import { cn } from "@/lib/utils";

interface BlackHoleProps {
  logs: IncidentalLog[];
}

export function BlackHole({ logs }: BlackHoleProps) {
  const totalMinutes = logs.reduce((s, l) => s + (l.durationMinutes || 0), 0);
  const totalHours = (totalMinutes / 60).toFixed(1);
  const isSevere = totalMinutes > 180;
  const needsAdvice = totalMinutes > 120;

  return (
    <div className={cn(
      "rounded-xl border p-4 space-y-3 transition-colors",
      isSevere
        ? "bg-destructive/8 border-destructive/25"
        : "bg-card"
    )}>
      <div className="flex items-center gap-2">
        <Flame className={cn("w-4 h-4", isSevere ? "text-destructive" : "text-[hsl(var(--status-at-risk))]")} />
        <h3 className="text-sm font-semibold">杂事黑洞 (Black Hole)</h3>
      </div>

      {/* Total stat */}
      <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-background/60 border">
        <Clock className="w-4 h-4 text-muted-foreground" />
        <div>
          <div className={cn(
            "text-lg font-bold tabular-nums",
            isSevere ? "text-destructive" : "text-foreground"
          )}>
            {totalHours} 小时
          </div>
          <div className="text-[10px] text-muted-foreground">
            无关联 ID 日志总时长（{totalMinutes} 分钟）
          </div>
        </div>
      </div>

      {isSevere && (
        <div className="px-3 py-2 rounded-lg bg-destructive/12 border border-destructive/20">
          <p className="text-sm text-destructive font-medium">
            ⚠️ 今日精力流失严重
          </p>
        </div>
      )}

      {/* AI advice when > 120min */}
      {needsAdvice && (
        <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-[hsl(var(--wbs-strategy)/0.08)] border border-[hsl(var(--wbs-strategy)/0.2)]">
          <Brain className="w-4 h-4 text-[hsl(var(--wbs-strategy))] shrink-0 mt-0.5" />
          <p className="text-xs text-[hsl(var(--wbs-strategy))] leading-relaxed font-medium">
            今日深陷 L7 琐事，建议明天开启「勿扰模式」回收精力。
          </p>
        </div>
      )}

      {/* Log items */}
      {logs.length === 0 ? (
        <div className="text-center py-4 text-xs text-muted-foreground">
          今日无杂事记录 ✨
        </div>
      ) : (
        <div className="space-y-1 max-h-[220px] overflow-auto">
          {logs.map((log) => (
            <div
              key={String(log.id)}
              className="flex items-start gap-2 px-3 py-2 rounded-md bg-background/40 border border-border/50 text-xs"
            >
              <span className="text-muted-foreground shrink-0 tabular-nums">
                {log.durationMinutes}min
              </span>
              <span className="text-foreground/80 leading-relaxed">
                {log.content || log.title || "—"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

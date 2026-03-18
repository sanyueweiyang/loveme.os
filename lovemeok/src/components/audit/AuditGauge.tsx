import { cn } from "@/lib/utils";
import { ShieldAlert, ShieldCheck } from "lucide-react";

interface AuditGaugeProps {
  score: number;
  date: string;
}

export function AuditGauge({ score, date }: AuditGaugeProps) {
  const isLow = score < 60;
  // Clamp 0-100, map to 180deg arc
  const clamped = Math.max(0, Math.min(100, score));
  const rotation = (clamped / 100) * 180;

  return (
    <div className="rounded-xl border bg-card p-6 flex flex-col items-center gap-4">
      <div className="text-xs text-muted-foreground font-medium">{date} · 知行合一评分</div>

      {/* Semi-circle gauge */}
      <div className="relative w-[220px] h-[120px]">
        <svg viewBox="0 0 220 120" className="w-full h-full overflow-visible">
          {/* Background arc */}
          <path
            d="M 15 110 A 95 95 0 0 1 205 110"
            fill="none"
            stroke="hsl(var(--border))"
            strokeWidth="14"
            strokeLinecap="round"
          />
          {/* Score arc */}
          <path
            d="M 15 110 A 95 95 0 0 1 205 110"
            fill="none"
            stroke={isLow ? "hsl(var(--destructive))" : "hsl(var(--status-on-track))"}
            strokeWidth="14"
            strokeLinecap="round"
            strokeDasharray={`${(rotation / 180) * 298} 298`}
            className="transition-all duration-700 ease-out"
          />
          {/* Needle center */}
          <circle cx="110" cy="110" r="5" fill="hsl(var(--foreground))" />
          {/* Needle */}
          <line
            x1="110"
            y1="110"
            x2={110 + 75 * Math.cos(((180 - rotation) * Math.PI) / 180)}
            y2={110 - 75 * Math.sin(((180 - rotation) * Math.PI) / 180)}
            stroke="hsl(var(--foreground))"
            strokeWidth="2.5"
            strokeLinecap="round"
            className="transition-all duration-700 ease-out"
          />
          {/* Labels */}
          <text x="10" y="118" fontSize="9" fill="hsl(var(--muted-foreground))" textAnchor="start">0</text>
          <text x="210" y="118" fontSize="9" fill="hsl(var(--muted-foreground))" textAnchor="end">100</text>
        </svg>

        {/* Score number overlay */}
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-2 text-center">
          <div className={cn(
            "text-3xl font-bold tabular-nums",
            isLow ? "text-destructive" : "text-[hsl(var(--status-on-track))]"
          )}>
            {score}
          </div>
        </div>
      </div>

      {/* Verdict */}
      <div className={cn(
        "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium",
        isLow
          ? "bg-destructive/10 text-destructive border border-destructive/20"
          : "bg-[hsl(var(--status-on-track)/0.1)] text-[hsl(var(--status-on-track))] border border-[hsl(var(--status-on-track)/0.2)]"
      )}>
        {isLow ? (
          <>
            <ShieldAlert className="w-4 h-4 shrink-0" />
            今日知行脱节，请警惕！
          </>
        ) : (
          <>
            <ShieldCheck className="w-4 h-4 shrink-0" />
            知行合一良好，继续保持！
          </>
        )}
      </div>
    </div>
  );
}

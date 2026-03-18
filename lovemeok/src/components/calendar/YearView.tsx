import { cn } from "@/lib/utils";
import { formatDateKey } from "./types";

interface YearViewProps {
  year: number;
  getFocus: (date: string) => string;
}

const MONTH_LABELS = [
  "一月", "二月", "三月", "四月", "五月", "六月",
  "七月", "八月", "九月", "十月", "十一月", "十二月",
];

export function YearView({ year, getFocus }: YearViewProps) {
  const today = formatDateKey(new Date());

  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 p-1">
      {MONTH_LABELS.map((label, monthIdx) => {
        // Count days with focus in this month
        const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
        let focusCount = 0;
        const focusSample: string[] = [];

        for (let d = 1; d <= daysInMonth; d++) {
          const dk = formatDateKey(new Date(year, monthIdx, d));
          const f = getFocus(dk);
          if (f) {
            focusCount++;
            if (focusSample.length < 3) focusSample.push(`${d}日: ${f}`);
          }
        }

        const auditPct = daysInMonth > 0 ? Math.round((focusCount / daysInMonth) * 100) : 0;
        const isCurrent = new Date().getMonth() === monthIdx && new Date().getFullYear() === year;

        return (
          <div
            key={monthIdx}
            className={cn(
              "rounded-lg border p-3 flex flex-col gap-2 transition-colors",
              isCurrent ? "border-primary/40 bg-primary/5" : "border-border bg-card"
            )}
          >
            <div className="flex items-center justify-between">
              <span className={cn("text-sm font-semibold", isCurrent ? "text-primary" : "text-foreground")}>
                {label}
              </span>
              <span
                className={cn(
                  "text-[10px] font-bold px-1.5 py-0.5 rounded",
                  auditPct >= 80
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                    : auditPct >= 40
                    ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                    : "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"
                )}
              >
                {auditPct}%
              </span>
            </div>

            {/* Mini calendar dots */}
            <div className="flex flex-wrap gap-[3px]">
              {Array.from({ length: daysInMonth }, (_, i) => {
                const dk = formatDateKey(new Date(year, monthIdx, i + 1));
                const hasFocus = !!getFocus(dk);
                const isToday = dk === today;
                return (
                  <div
                    key={i}
                    className={cn(
                      "w-[6px] h-[6px] rounded-full",
                      isToday
                        ? "bg-primary ring-1 ring-primary/40"
                        : hasFocus
                        ? "bg-emerald-500"
                        : "bg-muted-foreground/15"
                    )}
                    title={hasFocus ? getFocus(dk) : `${i + 1}日`}
                  />
                );
              })}
            </div>

            {/* Sample focus items */}
            {focusSample.length > 0 && (
              <div className="space-y-0.5">
                {focusSample.map((s, i) => (
                  <p key={i} className="text-[10px] text-muted-foreground truncate">{s}</p>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

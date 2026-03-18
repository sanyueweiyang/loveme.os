import { getWeekDates, formatDateKey, weekdayLabel, generateSlots, slotToTime, TimeBlock, CATEGORY_COLORS } from "./types";
import { FocusInput } from "./FocusInput";
import { cn } from "@/lib/utils";

const slots = generateSlots().filter((_, i) => i % 2 === 0); // show hour slots only in week view

interface WeekViewProps {
  anchor: Date;
  getBlocksForDate: (date: string) => TimeBlock[];
  getFocus: (date: string) => string;
  onFocusChange: (date: string, text: string) => void;
}

export function WeekView({ anchor, getBlocksForDate, getFocus, onFocusChange }: WeekViewProps) {
  const days = getWeekDates(anchor);
  const today = formatDateKey(new Date());

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header row */}
      <div className="grid grid-cols-[3rem_repeat(7,1fr)] border-b border-border shrink-0">
        <div />
        {days.map((d, i) => {
          const dk = formatDateKey(d);
          const isToday = dk === today;
          return (
            <div key={dk} className={cn("p-1.5 text-center border-l border-border/50", isToday && "bg-primary/5")}>
              <div className={cn("text-[10px]", isToday ? "text-primary font-bold" : "text-muted-foreground")}>
                {weekdayLabel(i)} {d.getDate()}日
              </div>
              <FocusInput
                compact
                value={getFocus(dk)}
                onChange={(t) => onFocusChange(dk, t)}
              />
            </div>
          );
        })}
      </div>

      {/* Time grid */}
      <div className="flex-1 overflow-y-auto">
        {slots.map(({ slot, label }) => (
          <div key={slot} className="grid grid-cols-[3rem_repeat(7,1fr)] border-b border-border/30 h-10">
            <div className="flex items-start justify-end pr-1.5 pt-0.5">
              <span className="text-[10px] text-muted-foreground">{label}</span>
            </div>
            {days.map((d) => {
              const dk = formatDateKey(d);
              const dayBlocks = getBlocksForDate(dk);
              const blockHere = dayBlocks.find((b) => slot >= b.startSlot && slot < b.endSlot);
              const isToday = dk === today;
              return (
                <div
                  key={dk}
                  className={cn(
                    "border-l border-border/30 relative",
                    isToday && "bg-primary/[0.02]"
                  )}
                >
                  {blockHere && slot === blockHere.startSlot && (
                    <div
                      className={cn(
                        "absolute inset-x-0.5 z-10 rounded text-[9px] text-white px-1 truncate",
                        CATEGORY_COLORS[blockHere.category]
                      )}
                      style={{ height: `${(blockHere.endSlot - blockHere.startSlot) * 20}px` }}
                    >
                      {blockHere.title}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

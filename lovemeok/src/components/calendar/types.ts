export type CalendarView = "day" | "week" | "year";

export type BlockCategory = "WORK" | "LIFE" | "GROWTH";

export interface TimeBlock {
  id: string;
  title: string;
  category: BlockCategory;
  startSlot: number; // 0-47 (half-hour slots from 09:00)
  endSlot: number;
  date: string; // YYYY-MM-DD
}

export interface DailyFocus {
  date: string;
  text: string;
}

export const CATEGORY_COLORS: Record<BlockCategory, string> = {
  WORK: "bg-[hsl(var(--cal-work))]",
  LIFE: "bg-[hsl(var(--cal-life))]",
  GROWTH: "bg-[hsl(var(--cal-growth))]",
};

export const CATEGORY_LABELS: Record<BlockCategory, string> = {
  WORK: "工作",
  LIFE: "生活",
  GROWTH: "成长",
};

/** Generate time label for a slot index (0 = 09:00, 1 = 09:30, ..., 47 = 08:30 next day) */
export function slotToTime(slot: number): string {
  const hour = (9 + Math.floor(slot / 2)) % 24;
  const min = slot % 2 === 0 ? "00" : "30";
  return `${String(hour).padStart(2, "0")}:${min}`;
}

export function generateSlots(): { slot: number; label: string }[] {
  return Array.from({ length: 48 }, (_, i) => ({
    slot: i,
    label: slotToTime(i),
  }));
}

export function formatDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function getWeekDates(anchor: Date): Date[] {
  const day = anchor.getDay();
  const monday = new Date(anchor);
  monday.setDate(anchor.getDate() - ((day + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

const WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
export function weekdayLabel(i: number) {
  return WEEKDAY_LABELS[i] || "";
}

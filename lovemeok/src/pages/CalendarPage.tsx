import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { DayView } from "@/components/calendar/DayView";
import { WeekView } from "@/components/calendar/WeekView";
import { YearView } from "@/components/calendar/YearView";
import { useCalendarState } from "@/components/calendar/useCalendarState";
import { CalendarView } from "@/components/calendar/types";
import { formatDateKey } from "@/components/calendar/types";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const VIEW_LABELS: Record<CalendarView, string> = {
  day: "天",
  week: "周",
  year: "年",
};

const CalendarPage = () => {
  const {
    view, setView,
    currentDate, setCurrentDate, dateKey,
    addBlock, removeBlock,
    updateFocus, getFocus, getBlocksForDate,
  } = useCalendarState();

  const navigate = (delta: number) => {
    const next = new Date(currentDate);
    if (view === "day") next.setDate(next.getDate() + delta);
    else if (view === "week") next.setDate(next.getDate() + delta * 7);
    else next.setFullYear(next.getFullYear() + delta);
    setCurrentDate(next);
  };

  const headerLabel = () => {
    if (view === "year") return `${currentDate.getFullYear()} 年`;
    if (view === "week") {
      const d = currentDate;
      return `${d.getFullYear()}年${d.getMonth() + 1}月 第${Math.ceil(d.getDate() / 7)}周`;
    }
    return `${currentDate.getFullYear()}年${currentDate.getMonth() + 1}月${currentDate.getDate()}日`;
  };

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-muted/30">
        <AppSidebar activeLevel={0} onLevelChange={() => {}} />
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <header className="h-11 flex items-center gap-3 border-b px-3 shrink-0 bg-background">
            <SidebarTrigger className="text-muted-foreground" />
            <div className="w-px h-4 bg-border" />
            <span className="text-xs font-medium text-foreground">每日清单</span>
          </header>

          {/* Toolbar */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-border/50 bg-background shrink-0">
            <div className="flex items-center gap-2">
              <button onClick={() => navigate(-1)} className="p-1 rounded hover:bg-accent"><ChevronLeft className="w-4 h-4" /></button>
              <span className="text-sm font-semibold min-w-[140px] text-center">{headerLabel()}</span>
              <button onClick={() => navigate(1)} className="p-1 rounded hover:bg-accent"><ChevronRight className="w-4 h-4" /></button>
              <button
                onClick={() => setCurrentDate(new Date())}
                className="text-[11px] px-2 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20 ml-1"
              >
                今天
              </button>
            </div>
            <div className="flex items-center bg-muted rounded-lg p-0.5">
              {(["day", "week", "year"] as CalendarView[]).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={cn(
                    "text-[11px] px-3 py-1 rounded-md transition-all",
                    view === v
                      ? "bg-background text-foreground shadow-sm font-medium"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {VIEW_LABELS[v]}
                </button>
              ))}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-hidden p-4">
            {view === "day" && (
              <DayView
                date={currentDate}
                blocks={getBlocksForDate(dateKey)}
                focus={getFocus(dateKey)}
                onFocusChange={(t) => updateFocus(dateKey, t)}
                onAddBlock={addBlock}
                onRemoveBlock={removeBlock}
              />
            )}
            {view === "week" && (
              <WeekView
                anchor={currentDate}
                getBlocksForDate={getBlocksForDate}
                getFocus={getFocus}
                onFocusChange={updateFocus}
              />
            )}
            {view === "year" && (
              <YearView
                year={currentDate.getFullYear()}
                getFocus={getFocus}
              />
            )}
          </div>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default CalendarPage;

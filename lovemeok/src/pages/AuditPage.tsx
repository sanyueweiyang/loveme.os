import { useState } from "react";
import { format } from "date-fns";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { DebugPanel } from "@/components/debug/DebugPanel";
import { AuditGauge } from "@/components/audit/AuditGauge";
import { EffortBar } from "@/components/audit/EffortBar";
import { RedList } from "@/components/audit/RedList";
import { BlackHole } from "@/components/audit/BlackHole";
import { useAuditConsistency } from "@/hooks/use-audit-consistency";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { CalendarIcon, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

const AuditPage = () => {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const dateStr = format(selectedDate, "yyyy-MM-dd");
  const { data, isLoading, isError, error, refetch } = useAuditConsistency(dateStr);

  const score =
    data && data.inProgressCount > 0
      ? Math.round(((data.inProgressCount - data.unfulfilledCount) / data.inProgressCount) * 100)
      : data
      ? 100
      : 0;

  const incidentalMinutes = data
    ? data.incidentalLogs.reduce((s, l) => s + (l.durationMinutes || 0), 0)
    : 0;

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar activeLevel={-1} onLevelChange={() => {}} />

        <div className="flex-1 flex flex-col min-w-0">
          {/* Top bar */}
          <header className="h-11 flex items-center gap-3 border-b px-3 shrink-0 bg-background">
            <SidebarTrigger className="text-muted-foreground" />
            <div className="w-px h-4 bg-border" />
            <span className="text-xs font-medium text-foreground">AI小助手</span>
            <div className="ml-auto">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5 text-xs h-7">
                    <CalendarIcon className="w-3 h-3" />
                    {dateStr}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={(d) => d && setSelectedDate(d)}
                    disabled={(d) => d > new Date()}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </header>

          {/* Content */}
          <div className="flex-1 overflow-auto">
            {isLoading && (
              <div className="flex-1 flex items-center justify-center py-20">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  正在加载审计数据...
                </div>
              </div>
            )}

            {isError && (
              <div className="flex-1 flex items-center justify-center py-20">
                <div className="text-center space-y-3">
                  <AlertCircle className="w-8 h-8 text-destructive mx-auto" />
                  <div className="text-sm text-muted-foreground">无法加载审计数据</div>
                  <div className="text-xs text-muted-foreground/60 max-w-sm">{(error as Error)?.message}</div>
                  <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
                    <RefreshCw className="w-3 h-3" />
                    重试
                  </Button>
                </div>
              </div>
            )}

            {data && (
              <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
                {/* Gauge */}
                <AuditGauge score={score} date={dateStr} />

                {/* Effort comparison bar */}
                <EffortBar
                  inProgressCount={data.inProgressCount}
                  unfulfilledCount={data.unfulfilledCount}
                  incidentalMinutes={incidentalMinutes}
                />

                {/* Two columns */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <RedList plans={data.unfulfilledPlans} />
                  <BlackHole logs={data.incidentalLogs} />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <DebugPanel />
    </SidebarProvider>
  );
};

export default AuditPage;

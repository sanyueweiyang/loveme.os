import { UnfulfilledPlan } from "@/hooks/use-audit-consistency";
import { AlertTriangle, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

interface RedListProps {
  plans: UnfulfilledPlan[];
}

export function RedList({ plans }: RedListProps) {
  // Find critical P0/P1 unfulfilled plans
  const criticalPlans = plans.filter(
    (p) => p.priority === "P0" || p.priority === "P1" || p.priority === "high" || p.priority === "critical"
  );

  const [showAlert, setShowAlert] = useState(false);

  useEffect(() => {
    if (criticalPlans.length > 0) {
      const timer = setTimeout(() => setShowAlert(true), 400);
      return () => clearTimeout(timer);
    } else {
      setShowAlert(false);
    }
  }, [criticalPlans.length]);

  return (
    <div className="rounded-xl border bg-card p-4 space-y-3 relative">
      {/* Critical task alert overlay */}
      {showAlert && criticalPlans.length > 0 && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/70 backdrop-blur-sm rounded-xl animate-fade-in">
          <div className="flex flex-col items-center gap-3 px-4 text-center max-w-[260px]">
            <div className="w-12 h-12 rounded-full bg-destructive/15 flex items-center justify-center animate-pulse">
              <AlertTriangle className="w-6 h-6 text-destructive" />
            </div>
            <p className="text-sm font-semibold text-destructive leading-relaxed">
              樊老师，今日核心任务「{criticalPlans[0].title}」零投入，知行脱节严重！
            </p>
            <Button
              size="sm"
              variant="outline"
              className="text-xs border-destructive/30 text-destructive hover:bg-destructive/10"
              onClick={() => setShowAlert(false)}
            >
              我知道了
            </Button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-destructive" />
        <h3 className="text-sm font-semibold">失信清单 (Red List)</h3>
        <span className="ml-auto text-[10px] text-muted-foreground">{plans.length} 项</span>
      </div>

      <p className="text-[11px] text-muted-foreground leading-relaxed">
        这些是您承诺要做（IN_PROGRESS）但今天零投入的任务
      </p>

      {plans.length === 0 ? (
        <div className="text-center py-6 text-xs text-muted-foreground">
          🎉 今日无失信项，全部兑现！
        </div>
      ) : (
        <div className="space-y-1.5 max-h-[280px] overflow-auto">
          {plans.map((plan) => {
            const isCritical = plan.priority === "P0" || plan.priority === "P1" || plan.priority === "high" || plan.priority === "critical";
            return (
              <div
                key={String(plan.id)}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors",
                  isCritical
                    ? "border-destructive/30 bg-destructive/10 hover:bg-destructive/15"
                    : "border-destructive/15 bg-destructive/5 hover:bg-destructive/8"
                )}
              >
                <div className={cn(
                  "w-1.5 h-1.5 rounded-full shrink-0",
                  isCritical ? "bg-destructive animate-pulse" : "bg-destructive"
                )} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium truncate">{plan.title}</span>
                    {isCritical && (
                      <span className="text-[9px] font-bold text-destructive bg-destructive/15 px-1 rounded shrink-0">
                        {plan.priority}
                      </span>
                    )}
                  </div>
                  {plan.owner && (
                    <div className="text-[10px] text-muted-foreground">👤 {plan.owner}</div>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-muted-foreground hover:text-primary shrink-0"
                  onClick={() => toast.info("语音追问功能即将上线")}
                  title="追问"
                >
                  <Mic className="w-3.5 h-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

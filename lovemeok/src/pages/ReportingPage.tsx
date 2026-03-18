import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { CheckCircle2, PieChart, ArrowRight } from "lucide-react";

const ReportingPage = () => {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-muted/30">
        <AppSidebar activeLevel={0} onLevelChange={() => {}} />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-11 flex items-center gap-3 border-b px-3 shrink-0 bg-background">
            <SidebarTrigger className="text-muted-foreground" />
            <div className="w-px h-4 bg-border" />
            <span className="text-xs font-medium text-foreground">我的总结</span>
          </header>

          <div className="flex-1 overflow-auto p-6">
            <h1 className="text-lg font-semibold mb-6">我的总结</h1>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* 本周已完成 */}
              <div className="rounded-xl border bg-card/70 backdrop-blur-md p-5 space-y-4">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <CheckCircle2 className="w-4 h-4 text-[hsl(var(--status-on-track))]" />
                  本周已完成
                </div>
                <div className="space-y-2">
                  {["核心推理引擎 v2 上线", "数据管道监控告警配置", "用户增长 A/B 测试"].map((item, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground py-1.5 border-b border-border/30 last:border-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--status-on-track))]" />
                      {item}
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground/60">共 3 项已完成</p>
              </div>

              {/* 各模块工时占比 */}
              <div className="rounded-xl border bg-card/70 backdrop-blur-md p-5 space-y-4">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <PieChart className="w-4 h-4 text-primary" />
                  各模块工时占比
                </div>
                <div className="flex items-center justify-center h-32 rounded-lg bg-muted/30 border border-dashed border-border/50">
                  <span className="text-xs text-muted-foreground/50">图表占位</span>
                </div>
                <div className="space-y-1.5">
                  {[
                    { name: "推理引擎", pct: 35, color: "bg-wbs-l1" },
                    { name: "数据管道", pct: 28, color: "bg-wbs-l3" },
                    { name: "用户增长", pct: 22, color: "bg-wbs-l5" },
                    { name: "其他", pct: 15, color: "bg-muted-foreground/30" },
                  ].map(m => (
                    <div key={m.name} className="flex items-center gap-2 text-[11px]">
                      <span className={`w-2 h-2 rounded-sm shrink-0 ${m.color}`} />
                      <span className="flex-1 text-muted-foreground">{m.name}</span>
                      <span className="tabular-nums font-medium text-foreground">{m.pct}%</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 下周计划预告 */}
              <div className="rounded-xl border bg-card/70 backdrop-blur-md p-5 space-y-4">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <ArrowRight className="w-4 h-4 text-[hsl(var(--wbs-l5))]" />
                  下周计划预告
                </div>
                <div className="space-y-2">
                  {["多语言本地化启动", "安全合规模块评审", "数据管道 v2 灰度发布"].map((item, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground py-1.5 border-b border-border/30 last:border-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
                      {item}
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground/60">共 3 项待启动</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default ReportingPage;

/**
 * ReportsPage — /reports
 * 报表视图：各层级进度汇总、维度分布、责任人工作量。
 * 「生成报告」按钮调用 POST /api/reports/aggregate，按 P1 自动抓取，展示三栏结果。
 * 筛选状态从 FilterContext 读取，与其他页面保持一致。
 */

import { useState } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { DebugPanel } from "@/components/debug/DebugPanel";
import { useFilter } from "@/context/FilterContext";
import { useReports, useReportsAggregate, type AggregateReport, type AggregateNode } from "@/hooks/use-reports";
import { PLAN_CATEGORY_OPTIONS } from "@/types/plan-node";
import { cn } from "@/lib/utils";
import { BarChart2, Loader2, TrendingUp, Users, Layers, Sparkles, Target, Zap, RefreshCw } from "lucide-react";
import { toast } from "sonner";

const LEVEL_LABELS: Record<number, string> = {
  1: "L1 愿景", 2: "L2 战略主题", 3: "L3 项目集",
  4: "L4 模块", 5: "L5 工作包", 6: "L6 执行",
};

const LEVEL_COLORS: Record<number, string> = {
  1: "bg-wbs-l1", 2: "bg-wbs-l2", 3: "bg-wbs-l3",
  4: "bg-wbs-l4", 5: "bg-wbs-l5", 6: "bg-wbs-l6",
};

function ProgressBar({ value, color = "bg-primary" }: { value: number; color?: string }) {
  return (
    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
      <div className={cn("h-full rounded-full transition-all duration-500", color)} style={{ width: `${Math.min(value, 100)}%` }} />
    </div>
  );
}

// ── 三栏报告中的单个节点行 ────────────────────────────────────────────────────

function AggregateNodeRow({ node }: { node: AggregateNode }) {
  const isDone = node.planStatus === "DONE";
  return (
    <div className={cn(
      "flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors",
      isDone ? "bg-emerald-500/5 border-emerald-200/40" : "bg-card/60 border-border/40 hover:border-border"
    )}>
      <span className={cn(
        "text-[10px] font-bold text-white px-1.5 py-0.5 rounded shrink-0",
        LEVEL_COLORS[node.level] || "bg-muted"
      )}>
        L{node.level}
      </span>
      <div className="flex-1 min-w-0">
        <p className={cn("text-xs font-medium truncate", isDone && "line-through text-muted-foreground")}>
          {node.title}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          {node.owner && <span className="text-[10px] text-muted-foreground">{node.owner}</span>}
          {node.targetDate && <span className="text-[10px] text-muted-foreground">{node.targetDate}</span>}
        </div>
      </div>
      <div className="shrink-0 text-right min-w-[40px]">
        <span className={cn("text-xs font-semibold", isDone ? "text-emerald-600" : "text-foreground")}>
          {node.progress}%
        </span>
      </div>
      <span className={cn(
        "text-[10px] px-1.5 py-0.5 rounded-md border shrink-0",
        node.priority === "P1" ? "bg-red-500/10 text-red-600 border-red-200" : "bg-amber-500/10 text-amber-600 border-amber-200"
      )}>
        {node.priority}
      </span>
    </div>
  );
}

// ── 三栏报告区块 ──────────────────────────────────────────────────────────────

const COLUMNS = [
  { key: "strategy" as const, label: "战略层", icon: Target, color: "text-wbs-l1", desc: "L1-L2 · 愿景与主题" },
  { key: "management" as const, label: "管理层", icon: Layers, color: "text-wbs-l3", desc: "L3-L4 · 项目集与模块" },
  { key: "execution" as const, label: "执行层", icon: Zap, color: "text-wbs-l5", desc: "L5-L6 · 工作包与活动" },
];

function AggregateReportView({ report }: { report: AggregateReport }) {
  return (
    <div className="space-y-4">
      {/* 总览 */}
      <div className="flex items-center gap-4 px-4 py-3 rounded-xl border bg-card/70">
        <div className="text-center">
          <p className="text-2xl font-bold text-foreground">{report.overallProgress}%</p>
          <p className="text-[10px] text-muted-foreground">整体进度</p>
        </div>
        <div className="w-px h-8 bg-border" />
        <div className="text-center">
          <p className="text-lg font-bold text-emerald-600">{report.doneCount}</p>
          <p className="text-[10px] text-muted-foreground">已完成</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-bold text-foreground">{report.totalCount}</p>
          <p className="text-[10px] text-muted-foreground">总计</p>
        </div>
        <div className="flex-1">
          <ProgressBar value={report.overallProgress} />
        </div>
        <p className="text-[10px] text-muted-foreground shrink-0">
          生成于 {new Date(report.generatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
        </p>
      </div>

      {/* 三栏 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {COLUMNS.map(({ key, label, icon: Icon, color, desc }) => {
          const nodes = report[key];
          return (
            <div key={key} className="rounded-xl border bg-card/70 overflow-hidden">
              <div className="px-4 py-3 border-b bg-muted/20 flex items-center gap-2">
                <Icon className={cn("w-4 h-4", color)} />
                <div>
                  <p className="text-sm font-semibold">{label}</p>
                  <p className="text-[10px] text-muted-foreground">{desc}</p>
                </div>
                <span className="ml-auto text-xs text-muted-foreground">{nodes.length} 项</span>
              </div>
              <div className="p-3 space-y-1.5 max-h-64 overflow-y-auto">
                {nodes.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">暂无 P1 节点</p>
                ) : (
                  nodes.map(n => <AggregateNodeRow key={n.id} node={n} />)
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 主页面 ────────────────────────────────────────────────────────────────────

const ReportsPage = () => {
  const today = new Date();
  const { filterYear, filterCategory, setFilterCategory } = useFilter();
  const year = filterYear ? Number(filterYear) : today.getFullYear();

  const { data, isLoading } = useReports({ year, category: filterCategory });
  const aggregateMutation = useReportsAggregate();
  const [aggregateResult, setAggregateResult] = useState<AggregateReport | null>(null);

  const handleGenerate = async () => {
    try {
      const result = await aggregateMutation.mutateAsync({
        year,
        priorities: ["P1"],
        category: filterCategory || undefined,
      });
      setAggregateResult(result);
      toast.success("报告生成成功");
    } catch (err: any) {
      toast.error("生成失败", {
        description: err?.message?.includes("fetch") ? "后端接口未就绪，请确认 localhost:3000 已启动" : err?.message,
      });
    }
  };

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-muted/30">
        <AppSidebar activeLevel={1} onLevelChange={() => {}} />

        <div className="flex-1 flex flex-col min-w-0">
          {/* Top bar */}
          <header className="h-11 flex items-center gap-3 border-b px-3 shrink-0 bg-background">
            <SidebarTrigger className="text-muted-foreground" />
            <div className="w-px h-4 bg-border" />
            <BarChart2 className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium">报表 · {year} 年</span>
            {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}

            {/* 维度筛选 */}
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={() => setFilterCategory("")}
                className={cn("px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors",
                  !filterCategory ? "bg-foreground text-background" : "bg-muted/60 text-muted-foreground hover:bg-muted"
                )}
              >全部</button>
              {PLAN_CATEGORY_OPTIONS.map(opt => (
                <button key={opt.value}
                  onClick={() => setFilterCategory(filterCategory === opt.value ? "" : opt.value)}
                  className={cn("px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors border",
                    filterCategory === opt.value
                      ? "bg-primary/15 text-primary border-primary/30"
                      : "bg-muted/40 text-muted-foreground border-transparent hover:bg-muted"
                  )}
                >{opt.label}</button>
              ))}
            </div>
          </header>

          <div className="flex-1 overflow-auto p-6 space-y-6">

            {/* ── 生成报告区块 ── */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-amber-500" />
                  三栏聚合报告
                  <span className="text-[10px] text-muted-foreground font-normal">
                    · 自动抓取 P1 优先级节点
                  </span>
                </h2>
                <div className="flex items-center gap-2">
                  {aggregateResult && (
                    <button
                      onClick={() => setAggregateResult(null)}
                      className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      清除
                    </button>
                  )}
                  <button
                    onClick={handleGenerate}
                    disabled={aggregateMutation.isPending}
                    className={cn(
                      "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
                      "bg-primary text-primary-foreground",
                      "shadow-[0_4px_16px_-4px_hsl(var(--primary)/0.4)]",
                      "hover:shadow-[0_8px_24px_-4px_hsl(var(--primary)/0.5)]",
                      "disabled:opacity-50 disabled:cursor-not-allowed"
                    )}
                  >
                    {aggregateMutation.isPending
                      ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />生成中…</>
                      : <><RefreshCw className="w-3.5 h-3.5" />生成报告</>
                    }
                  </button>
                </div>
              </div>

              {aggregateResult ? (
                <AggregateReportView report={aggregateResult} />
              ) : (
                <div className="rounded-xl border border-dashed border-border/50 p-10 text-center">
                  <Sparkles className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">点击「生成报告」，自动抓取 P1 节点生成三栏聚合报告</p>
                  <p className="text-[11px] text-muted-foreground/60 mt-1">
                    调用 POST localhost:3000/api/reports/aggregate
                  </p>
                </div>
              )}
            </section>

            {/* ── 层级进度汇总 ── */}
            <section>
              <h2 className="text-sm font-semibold flex items-center gap-2 mb-3">
                <Layers className="w-4 h-4 text-muted-foreground" />
                各层级进度汇总
              </h2>
              {data?.levelSummaries.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/50 p-8 text-center text-sm text-muted-foreground">
                  暂无数据（后端接口待实现）
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {data?.levelSummaries.map(s => (
                    <div key={s.level} className="rounded-xl border bg-card/70 p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className={cn("text-[10px] font-bold text-white px-1.5 py-0.5 rounded-md", LEVEL_COLORS[s.level])}>
                          {LEVEL_LABELS[s.level]}
                        </span>
                        <span className="text-xs text-muted-foreground">{s.total} 项</span>
                      </div>
                      <ProgressBar value={s.avgProgress} color={LEVEL_COLORS[s.level]} />
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                        <span>完成 {s.done}</span>
                        <span>进行中 {s.inProgress}</span>
                        <span className="font-semibold text-foreground">{s.avgProgress}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* ── 维度分布 ── */}
            <section>
              <h2 className="text-sm font-semibold flex items-center gap-2 mb-3">
                <TrendingUp className="w-4 h-4 text-muted-foreground" />
                维度分布
              </h2>
              {data?.categoryDistribution.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/50 p-8 text-center text-sm text-muted-foreground">
                  暂无数据（后端接口待实现）
                </div>
              ) : (
                <div className="space-y-2">
                  {data?.categoryDistribution.map(c => (
                    <div key={c.category} className="rounded-xl border bg-card/70 p-3 flex items-center gap-4">
                      <span className="text-sm font-medium w-12 shrink-0">{c.category}</span>
                      <div className="flex-1">
                        <ProgressBar value={c.avgProgress} />
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {c.done}/{c.total} · {c.avgProgress}%
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* ── 责任人工作量 ── */}
            <section>
              <h2 className="text-sm font-semibold flex items-center gap-2 mb-3">
                <Users className="w-4 h-4 text-muted-foreground" />
                责任人工作量
              </h2>
              {data?.ownerWorkloads.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/50 p-8 text-center text-sm text-muted-foreground">
                  暂无数据（后端接口待实现）
                </div>
              ) : (
                <div className="rounded-xl border bg-card/70 overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="border-b bg-muted/30">
                      <tr>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">责任人</th>
                        <th className="text-center px-4 py-2 font-medium text-muted-foreground">总计</th>
                        <th className="text-center px-4 py-2 font-medium text-muted-foreground">已完成</th>
                        <th className="text-center px-4 py-2 font-medium text-muted-foreground text-red-500">逾期</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data?.ownerWorkloads.map(o => (
                        <tr key={o.owner} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-2 font-medium">{o.owner}</td>
                          <td className="px-4 py-2 text-center text-muted-foreground">{o.total}</td>
                          <td className="px-4 py-2 text-center text-emerald-600">{o.done}</td>
                          <td className="px-4 py-2 text-center text-red-500">{o.overdue}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

          </div>
        </div>
      </div>
      <DebugPanel />
    </SidebarProvider>
  );
};

export default ReportsPage;

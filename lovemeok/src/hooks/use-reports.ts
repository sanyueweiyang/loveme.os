/**
 * use-reports.ts — 报表数据 API Hook
 *
 * GET  /api/reports?year=YYYY&category=xxx        — 基础报表查询
 * POST /api/reports/aggregate                     — 按 P1 自动抓取生成三栏报告
 *
 * 后端尚未实现时，此 Hook 会优雅降级（返回空结构 + isLoading=false）。
 */

import { useQuery, useMutation } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { PlanCategory, PlanPriority } from "@/types/plan-node";

// ── 报表数据类型 ──────────────────────────────────────────────────────────────

/** 单层级进度汇总 */
export interface LevelSummary {
  level: number;
  total: number;
  done: number;
  inProgress: number;
  planned: number;
  avgProgress: number;     // 0-100
}

/** 维度分布 */
export interface CategoryDistribution {
  category: PlanCategory;
  total: number;
  done: number;
  avgProgress: number;
}

/** 责任人工作量 */
export interface OwnerWorkload {
  owner: string;
  total: number;
  done: number;
  overdue: number;         // targetDate < today && status != DONE
}

/** 完整报表响应 */
export interface ReportsResponse {
  year: number;
  category: PlanCategory | null;
  generatedAt: string;     // ISO datetime
  levelSummaries: LevelSummary[];
  categoryDistribution: CategoryDistribution[];
  ownerWorkloads: OwnerWorkload[];
  /** 月度进度趋势（按月汇总 avgProgress） */
  monthlyTrend: { month: number; avgProgress: number }[];
}

// ── 空报表占位（后端未实现时使用）────────────────────────────────────────────

function emptyReports(year: number): ReportsResponse {
  return {
    year,
    category: null,
    generatedAt: new Date().toISOString(),
    levelSummaries: [],
    categoryDistribution: [],
    ownerWorkloads: [],
    monthlyTrend: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, avgProgress: 0 })),
  };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface UseReportsOptions {
  year: number;
  category?: PlanCategory | "";
  enabled?: boolean;
}

export function useReports({ year, category, enabled = true }: UseReportsOptions) {
  const params = new URLSearchParams({
    year: String(year),
    ...(category ? { category } : {}),
  });

  return useQuery<ReportsResponse>({
    queryKey: ["reports", year, category],
    queryFn: () => apiFetch<ReportsResponse>(`/api/reports?${params}`),
    enabled,
    staleTime: 5 * 60_000,  // 报表数据 5 分钟缓存
    retry: 1,
    placeholderData: emptyReports(year),
  });
}

// ── Aggregate 报告类型（POST /api/reports/aggregate）─────────────────────────

/** 单条聚合节点（P1 自动抓取结果） */
export interface AggregateNode {
  id: number;
  level: number;
  title: string;
  priority: PlanPriority;
  planStatus: string;
  progress: number;
  owner: string | null;
  targetDate: string | null;
  planCategory: string | null;
}

/** 三栏报告结构 */
export interface AggregateReport {
  generatedAt: string;
  year: number;
  /** 栏一：战略层（L1-L2）P1 节点 */
  strategy: AggregateNode[];
  /** 栏二：管理层（L3-L4）P1 节点 */
  management: AggregateNode[];
  /** 栏三：执行层（L5-L6）P1 节点 */
  execution: AggregateNode[];
  /** 整体进度均值 */
  overallProgress: number;
  /** 完成数 / 总数 */
  doneCount: number;
  totalCount: number;
}

/** POST /api/reports/aggregate 请求体 */
export interface AggregateRequest {
  year: number;
  priorities: PlanPriority[];   // 通常传 ["P1"] 或 ["P1","P2"]
  category?: PlanCategory | "";
}

// ── Aggregate Mutation ────────────────────────────────────────────────────────

export function useReportsAggregate() {
  return useMutation<AggregateReport, Error, AggregateRequest>({
    mutationFn: (body: AggregateRequest) =>
      apiFetch<AggregateReport>("/api/reports/aggregate", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    retry: 0,
  });
}

/**
 * use-today-focus.ts — 今日焦点 Hook
 *
 * 调用 GET /api/nodes?targetDate=YYYY-MM-DD&priority=P1
 * 返回今日截止的 P1 节点列表，供日历页「今日最重要」置顶框使用。
 *
 * 字典约定：priority 最高为 P1（无 P0），"今日最重要"= targetDate=today + priority=P1
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { PlanPriority, PlanStatus } from "@/types/plan-node";

// ── 今日焦点节点类型 ──────────────────────────────────────────────────────────

export interface TodayFocusNode {
  id: number;
  level: number;
  title: string;
  owner: string | null;
  priority: PlanPriority;
  planStatus: PlanStatus;
  progress: number;
  targetDate: string;
  planCategory: string | null;
  parentId: number | null;
}

// ── 工具：今日日期字符串 ──────────────────────────────────────────────────────

export function getTodayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useTodayFocus() {
  const today = getTodayStr();

  return useQuery<TodayFocusNode[]>({
    queryKey: ["today-focus", today],
    queryFn: () =>
      apiFetch<TodayFocusNode[]>(
        `/api/nodes?targetDate=${today}&priority=P1`
      ),
    staleTime: 60_000,
    retry: 1,
    // 后端未实现时降级为空数组
    placeholderData: [],
  });
}

// ── 快速更新进度 Mutation ─────────────────────────────────────────────────────

export function useFocusProgressUpdate() {
  const queryClient = useQueryClient();
  const today = getTodayStr();

  return useMutation({
    mutationFn: ({ id, progress, planStatus }: {
      id: number;
      progress: number;
      planStatus?: PlanStatus;
    }) =>
      apiFetch(`/api/nodes/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          progress,
          ...(planStatus ? { planStatus } : {}),
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["today-focus", today] });
      queryClient.invalidateQueries({ queryKey: ["wbs-tree"] });
    },
  });
}

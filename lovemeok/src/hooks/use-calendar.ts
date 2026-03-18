/**
 * use-calendar.ts — 日历视图 API Hook
 *
 * GET /api/calendar?year=YYYY&month=MM
 * 返回当月所有有 targetDate 的 L5 工作包节点，
 * 供日历组件按日期分组渲染。
 *
 * 后端尚未实现时，此 Hook 会优雅降级（返回空数组 + isLoading=false）。
 */

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { PlanStatus, PlanPriority, PlanCategory } from "@/types/plan-node";

// ── 日历事件类型（对应后端返回结构）────────────────────────────────────────────

export interface CalendarEvent {
  id: number;
  title: string;
  level: number;
  targetDate: string;       // YYYY-MM-DD
  owner: string | null;
  priority: PlanPriority | null;
  planCategory: PlanCategory | null;
  planStatus: PlanStatus;
  progress: number;
  parentId: number | null;
}

export interface CalendarDay {
  date: string;             // YYYY-MM-DD
  events: CalendarEvent[];
}

export interface CalendarResponse {
  year: number;
  month: number;
  days: CalendarDay[];
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface UseCalendarOptions {
  year: number;
  month: number;           // 1-12
  category?: PlanCategory | "";
  enabled?: boolean;
}

export function useCalendar({ year, month, category, enabled = true }: UseCalendarOptions) {
  const params = new URLSearchParams({
    year: String(year),
    month: String(month),
    ...(category ? { category } : {}),
  });

  return useQuery<CalendarResponse>({
    queryKey: ["calendar", year, month, category],
    queryFn: () => apiFetch<CalendarResponse>(`/api/calendar?${params}`),
    enabled,
    staleTime: 60_000,
    retry: 1,
    // 后端未实现时返回空结构，不阻塞 UI
    placeholderData: { year, month, days: [] },
  });
}

// ── 工具：将 CalendarResponse 转为按日期索引的 Map ────────────────────────────

export function buildCalendarMap(data: CalendarResponse | undefined): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();
  if (!data) return map;
  for (const day of data.days) {
    map.set(day.date, day.events);
  }
  return map;
}

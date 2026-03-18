/**
 * use-daily-schedules.ts — 每日日程 API Hook
 *
 * 对接 /api/daily-schedules 接口，管理每日的：
 * - topTask：今日最重要的一件事（自由文本，失焦保存）
 * - schedules：24 小时时间块日程（增删改查）
 *
 * 接口约定（与后端对齐）：
 *   GET    /api/daily-schedules?date=YYYY-MM-DD        — 获取某日全部数据
 *   POST   /api/daily-schedules                        — 创建日程条目
 *   PATCH  /api/daily-schedules/:id                    — 更新日程条目
 *   DELETE /api/daily-schedules/:id                    — 删除日程条目
 *   PATCH  /api/daily-schedules/top-task               — 更新当日 topTask
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

// ── 类型定义 ──────────────────────────────────────────────────────────────────

export interface DailyScheduleItem {
  id: number;
  date: string;           // YYYY-MM-DD
  startTime: string;      // "HH:MM"，如 "09:00"
  endTime: string;        // "HH:MM"，如 "10:00"
  title: string;
  description?: string | null;
  category?: string | null;
  isDone: boolean;
  linkedNodeId?: number | null;  // 关联的 PlanNode id（可选）
  createdAt?: string;
  updatedAt?: string;
}

export interface DailyScheduleDay {
  date: string;
  topTask: string | null;   // 今日最重要的一件事
  schedules: DailyScheduleItem[];
}

// ── 创建/更新 payload ─────────────────────────────────────────────────────────

export interface CreateSchedulePayload {
  date: string;
  startTime: string;
  endTime: string;
  title: string;
  description?: string;
  category?: string;
  isDone?: boolean;
  linkedNodeId?: number | null;
}

export type UpdateSchedulePayload = Partial<Omit<CreateSchedulePayload, "date">>;

// ── 允许字段白名单（与 api.ts 拦截器对齐）────────────────────────────────────

export const SCHEDULE_CREATE_FIELDS = new Set([
  "date", "startTime", "endTime", "title",
  "description", "category", "isDone", "linkedNodeId",
]);

export const SCHEDULE_UPDATE_FIELDS = new Set([
  "startTime", "endTime", "title",
  "description", "category", "isDone", "linkedNodeId",
]);

// ── Hooks ─────────────────────────────────────────────────────────────────────

/** 获取某日全部日程数据（含 topTask） */
export function useDailySchedules(date: string) {
  return useQuery<DailyScheduleDay>({
    queryKey: ["daily-schedules", date],
    queryFn: async () => {
      try {
        return await apiFetch<DailyScheduleDay>(`/api/daily-schedules?date=${date}`);
      } catch (e: any) {
        // 后端未实现时（404/500）降级为空结构，不崩溃
        console.warn("[daily-schedules] 接口不可用，使用空数据降级:", e?.message);
        return { date, topTask: null, schedules: [] };
      }
    },
    staleTime: 30_000,
    retry: 0, // 接口不存在时不重试
    placeholderData: { date, topTask: null, schedules: [] },
  });
}

/** 更新当日 topTask（失焦保存） */
export function useUpdateTopTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ date, topTask }: { date: string; topTask: string }) =>
      apiFetch(`/api/daily-schedules/top-task`, {
        method: "PATCH",
        body: JSON.stringify({ date, topTask }),
      }),
    onSuccess: (_, { date }) => {
      queryClient.invalidateQueries({ queryKey: ["daily-schedules", date] });
    },
  });
}

/** 创建日程条目 */
export function useCreateSchedule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CreateSchedulePayload) => {
      // 字段校验
      const invalid = Object.keys(payload).filter(k => !SCHEDULE_CREATE_FIELDS.has(k));
      if (invalid.length) throw new Error(`[字段拦截] 非法字段: ${invalid.join(", ")}`);
      return apiFetch<DailyScheduleItem>("/api/daily-schedules", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: (_, { date }) => {
      queryClient.invalidateQueries({ queryKey: ["daily-schedules", date] });
    },
  });
}

/** 更新日程条目 */
export function useUpdateSchedule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, date, payload }: { id: number; date: string; payload: UpdateSchedulePayload }) => {
      const invalid = Object.keys(payload).filter(k => !SCHEDULE_UPDATE_FIELDS.has(k));
      if (invalid.length) throw new Error(`[字段拦截] 非法字段: ${invalid.join(", ")}`);
      return apiFetch<DailyScheduleItem>(`/api/daily-schedules/${id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: (_, { date }) => {
      queryClient.invalidateQueries({ queryKey: ["daily-schedules", date] });
    },
  });
}

/** 删除日程条目 */
export function useDeleteSchedule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id }: { id: number; date: string }) =>
      apiFetch(`/api/daily-schedules/${id}`, { method: "DELETE" }),
    onSuccess: (_, { date }) => {
      queryClient.invalidateQueries({ queryKey: ["daily-schedules", date] });
    },
  });
}

/** 切换日程完成状态 */
export function useToggleScheduleDone() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, isDone }: { id: number; date: string; isDone: boolean }) =>
      apiFetch<DailyScheduleItem>(`/api/daily-schedules/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ isDone }),
      }),
    onSuccess: (_, { date }) => {
      queryClient.invalidateQueries({ queryKey: ["daily-schedules", date] });
    },
  });
}

// ── 工具：生成 24h 时间槽列表（09:00 起，每小时一格）────────────────────────

export function generateTimeSlots(startHour = 9, endHour = 22): string[] {
  const slots: string[] = [];
  for (let h = startHour; h <= endHour; h++) {
    slots.push(`${String(h).padStart(2, "0")}:00`);
  }
  return slots;
}

// ── L6 节点（用于关联选择）────────────────────────────────────────────────────

export interface L6NodeOption {
  id: number;
  title: string;
  priority: string | null;
  owner: string | null;
  planStatus: string;
}

/** 拉取所有 L6 节点，供日程关联选择 */
export function useL6Nodes() {
  return useQuery<L6NodeOption[]>({
    queryKey: ["nodes-l6-options"],
    queryFn: async () => {
      try {
        // 后端不支持 ?level= 参数，从树数据客户端过滤
        const raw = await apiFetch<any>("/api/nodes/tree");
        const arr: any[] = Array.isArray(raw) ? raw : (raw?.data ?? []);
        const result: L6NodeOption[] = [];
        function walk(node: any) {
          if (node.level === 6) {
            result.push({
              id: node.id,
              title: node.title,
              priority: node.priority ?? null,
              owner: node.owner ?? null,
              planStatus: node.planStatus || node.status || "PLANNED",
            });
          }
          if (node.children?.length) {
            for (const child of node.children) walk(child);
          }
        }
        for (const root of arr) walk(root);
        return result;
      } catch {
        return [];
      }
    },
    staleTime: 60_000,
    retry: 1,
    placeholderData: [],
  });
}

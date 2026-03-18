/**
 * use-l5-planning.ts — L5 月度规划 Hook
 *
 * 业务逻辑：L4（任务拆解）→ L5（月度规划）
 * - L4 只读，作为制定 L5 的参考依据
 * - L5 必须关联 parentId 指向 L4
 * - L5 必须携带 monthCode（YYYY-MM）
 * - 支持"一键导入 L4 目标"作为 L5 草稿
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { PlanPriority, PlanStatus, PlanCategory } from "@/types/plan-node";

// ── 类型定义 ──────────────────────────────────────────────────────────────────

export interface L4Node {
  id: number;
  level: 4;
  title: string;
  parentId: number | null;
  priority: PlanPriority | null;
  planStatus: PlanStatus;
  progress: number;
  owner: string | null;
  planCategory: PlanCategory | null;
  targetDate: string | null;
  description?: string | null;
  children?: L5Node[];
}

export interface L5Node {
  id: number;
  level: 5;
  title: string;
  parentId: number;         // 必须指向 L4
  priority: PlanPriority | null;
  planStatus: PlanStatus;
  progress: number;
  owner: string | null;
  planCategory: PlanCategory | null;
  targetDate: string | null;
  monthCode: string | null; // YYYY-MM，必填
  description?: string | null;
}

// ── 工具函数 ──────────────────────────────────────────────────────────────────

/** 获取当前月份的 monthCode，如 "2026-03" */
export function getCurrentMonthCode(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** 从 targetDate 推导 monthCode */
export function dateToMonthCode(date: string | null): string {
  if (!date) return getCurrentMonthCode();
  return date.slice(0, 7); // "YYYY-MM-DD" → "YYYY-MM"
}

/** 生成最近 N 个月的 monthCode 列表（含当月） */
export function getRecentMonthCodes(n = 6): string[] {
  const codes: string[] = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    const year = d.getFullYear();
    const month = d.getMonth() + 1 - i;
    const adjusted = new Date(year, month - 1, 1);
    codes.push(
      `${adjusted.getFullYear()}-${String(adjusted.getMonth() + 1).padStart(2, "0")}`
    );
  }
  return codes;
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

/** 获取所有 L4 节点（只读参考） */
export function useL4Nodes() {
  return useQuery<L4Node[]>({
    queryKey: ["nodes-l4"],
    queryFn: async () => {
      // 后端不支持 ?level= 参数，从树数据客户端过滤
      const raw = await apiFetch<any>("/api/nodes/tree");
      const arr: any[] = Array.isArray(raw) ? raw : (raw?.data ?? []);
      const result: L4Node[] = [];
      function walk(node: any) {
        if (node.level === 4) {
          result.push({
            id: node.id,
            level: 4,
            title: node.title,
            parentId: node.parentId ?? null,
            priority: node.priority ?? null,
            planStatus: (node.planStatus || node.status || "PLANNED") as any,
            progress: node.progress ?? 0,
            owner: node.owner ?? null,
            planCategory: node.planCategory ?? null,
            targetDate: node.targetDate ?? null,
            description: node.description ?? null,
          });
        }
        if (node.children?.length) {
          for (const child of node.children) walk(child);
        }
      }
      for (const root of arr) walk(root);
      return result;
    },
    staleTime: 60_000,
    retry: 1,
    placeholderData: [],
  });
}

/** 获取所有 L5 节点，可按 monthCode 筛选 */
export function useL5Nodes(monthCode?: string) {
  return useQuery<L5Node[]>({
    queryKey: ["nodes-l5", monthCode],
    queryFn: async () => {
      // 后端不支持 ?level= 参数，从树数据客户端过滤
      const raw = await apiFetch<any>("/api/nodes/tree");
      const arr: any[] = Array.isArray(raw) ? raw : (raw?.data ?? []);
      const result: L5Node[] = [];
      function walk(node: any) {
        if (node.level === 5) {
          const n: L5Node = {
            id: node.id,
            level: 5,
            title: node.title,
            parentId: node.parentId,
            priority: node.priority ?? null,
            planStatus: (node.planStatus || node.status || "PLANNED") as any,
            progress: node.progress ?? 0,
            owner: node.owner ?? null,
            planCategory: node.planCategory ?? null,
            targetDate: node.targetDate ?? null,
            monthCode: node.monthCode ?? (node.targetDate ? node.targetDate.slice(0, 7) : null),
            description: node.description ?? null,
          };
          // 按 monthCode 过滤
          if (!monthCode || n.monthCode === monthCode) {
            result.push(n);
          }
        }
        if (node.children?.length) {
          for (const child of node.children) walk(child);
        }
      }
      for (const root of arr) walk(root);
      return result;
    },
    staleTime: 30_000,
    retry: 1,
    placeholderData: [],
  });
}

// ── L5 创建 payload ───────────────────────────────────────────────────────────

export interface CreateL5Payload {
  level: 5;
  parentId: number;         // 必须是 L4 节点 id
  title: string;
  owner: string;
  priority: PlanPriority;
  targetDate: string;       // YYYY-MM-DD
  monthCode: string;        // YYYY-MM
  planCategory?: PlanCategory;
}

/** 创建 L5 节点 */
export function useCreateL5() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CreateL5Payload) => {
      // 前端校验：parentId 必须存在
      if (!payload.parentId) throw new Error("L5_PARENT_MUST_BE_L4：必须选择 L4 模块作为父节点");
      if (!payload.monthCode) throw new Error("monthCode 为必填项，格式 YYYY-MM");
      return apiFetch<L5Node>("/api/nodes", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: (_, { monthCode }) => {
      queryClient.invalidateQueries({ queryKey: ["nodes-l5", monthCode] });
      queryClient.invalidateQueries({ queryKey: ["nodes-l5"] });
      queryClient.invalidateQueries({ queryKey: ["wbs-tree"] });
    },
    onError: (err: any) => {
      const msg: string = err?.message || "";
      if (msg.includes("L5_PARENT_MUST_BE_L4") || msg.includes("parent")) {
        throw new Error("L5 节点的父节点必须是 L4 模块");
      }
      throw err;
    },
  });
}

/** 更新 L5 节点 */
export function useUpdateL5() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, payload }: {
      id: number;
      payload: Partial<Omit<CreateL5Payload, "level" | "parentId">>;
    }) =>
      apiFetch<L5Node>(`/api/nodes/${id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["nodes-l5"] });
      queryClient.invalidateQueries({ queryKey: ["wbs-tree"] });
    },
  });
}

/** 删除 L5 节点 */
export function useDeleteL5() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/nodes/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["nodes-l5"] });
      queryClient.invalidateQueries({ queryKey: ["wbs-tree"] });
    },
  });
}

/**
 * 从 L4 节点生成 L5 草稿
 * 将 L4 的 title/owner/priority/planCategory 复制过来，允许用户大幅改写
 */
export function importL4AsDraft(
  l4: L4Node,
  monthCode: string
): Omit<CreateL5Payload, "level"> {
  return {
    parentId: l4.id,
    title: l4.title,                          // 可改写
    owner: l4.owner || "",
    priority: l4.priority || "P2",
    targetDate: `${monthCode}-28`,            // 默认月底
    monthCode,
    planCategory: l4.planCategory || undefined,
  };
}

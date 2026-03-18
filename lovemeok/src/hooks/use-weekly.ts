/**
 * use-weekly.ts — 每周重点工作 Hook
 *
 * GET /api/nodes?mode=weekly
 * 返回本周相关的 L5（月度规划）和 L6（本周重点）节点。
 * 前端按 L5 分组，每个 L5 下挂载其 L6 子节点。
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { PlanPriority, PlanStatus, PlanCategory } from "@/types/plan-node";

// ── 类型定义 ──────────────────────────────────────────────────────────────────

export interface WeeklyNode {
  id: number;
  level: 5 | 6;
  title: string;
  parentId: number | null;
  priority: PlanPriority | null;
  planStatus: PlanStatus;
  progress: number;
  owner: string | null;
  targetDate: string | null;
  planCategory: PlanCategory | null;
  dataFeedback: string | null;
}

export interface WeeklyGroup {
  l5: WeeklyNode;
  l6Items: WeeklyNode[];
}

// ── 原始响应（后端可能返回扁平数组或嵌套结构）────────────────────────────────

type WeeklyApiResponse = WeeklyNode[] | { nodes: WeeklyNode[] };

function normalizeResponse(raw: WeeklyApiResponse): WeeklyNode[] {
  if (Array.isArray(raw)) return raw;
  if (raw && "nodes" in raw) return raw.nodes;
  return [];
}

/** 将扁平节点列表按 L5 分组 */
export function groupByL5(nodes: WeeklyNode[]): WeeklyGroup[] {
  const l5List = nodes.filter(n => n.level === 5);
  const l6List = nodes.filter(n => n.level === 6);

  return l5List.map(l5 => ({
    l5,
    l6Items: l6List
      .filter(l6 => l6.parentId === l5.id)
      .sort((a, b) => {
        // P1 > P2 > P3 > null，同优先级按 id 升序
        const pOrder = { P1: 0, P2: 1, P3: 2 };
        const pa = a.priority ? pOrder[a.priority] : 3;
        const pb = b.priority ? pOrder[b.priority] : 3;
        return pa !== pb ? pa - pb : a.id - b.id;
      }),
  }));
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

export function useWeeklyNodes() {
  return useQuery<WeeklyNode[]>({
    queryKey: ["weekly-nodes"],
    queryFn: async () => {
      // 后端不支持 mode=weekly 参数，直接拉全量树然后客户端过滤 L5/L6
      const raw = await apiFetch<any>("/api/nodes/tree");
      const arr: any[] = Array.isArray(raw) ? raw : (raw?.data ?? []);

      // 递归打平，只保留 L5 和 L6
      const result: WeeklyNode[] = [];
      function walk(node: any) {
        if (node.level === 5 || node.level === 6) {
          result.push({
            id: node.id,
            level: node.level,
            title: node.title,
            parentId: node.parentId ?? null,
            priority: node.priority ?? null,
            planStatus: (node.planStatus || node.status || "PLANNED") as any,
            progress: node.progress ?? 0,
            owner: node.owner ?? null,
            targetDate: node.targetDate ?? null,
            planCategory: node.planCategory ?? null,
            dataFeedback: node.dataFeedback ?? null,
          });
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

/** 创建 L6 节点（parentId 必须指向 L5） */
export interface CreateL6Payload {
  level: 6;
  parentId: number;   // 必须是 L5 节点的 id
  title: string;
  priority?: PlanPriority;
  owner?: string;
  targetDate?: string;
  dataFeedback?: string;
}

export function useCreateL6() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CreateL6Payload) =>
      apiFetch<WeeklyNode>("/api/nodes", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["weekly-nodes"] });
      queryClient.invalidateQueries({ queryKey: ["wbs-tree"] });
    },
  });
}

/** 更新 L6 节点进度 / 状态 */
export function useUpdateL6() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, payload }: {
      id: number;
      payload: Partial<Pick<WeeklyNode, "progress" | "planStatus" | "dataFeedback" | "priority" | "owner">>;
    }) =>
      apiFetch<WeeklyNode>(`/api/nodes/${id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["weekly-nodes"] });
      queryClient.invalidateQueries({ queryKey: ["wbs-tree"] });
    },
  });
}

/** 删除节点 */
export function useDeleteNode() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/nodes/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["weekly-nodes"] });
      queryClient.invalidateQueries({ queryKey: ["wbs-tree"] });
    },
    onError: (err: any) => {
      // 处理后端 L6_PARENT_MUST_BE_L5 等业务错误
      const msg: string = err?.message || "";
      if (msg.includes("L6_PARENT_MUST_BE_L5")) {
        throw new Error("L6 节点的父节点必须是 L5 工作包");
      }
      throw err;
    },
  });
}

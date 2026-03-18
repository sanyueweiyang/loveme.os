import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { APITreeNode } from "@/types/wbs";

// ── 树数据规范化 ──────────────────────────────────────────────────────────────

/**
 * 递归规范化节点：
 * - status → planStatus 兼容映射
 * - 兼容后端返回 { data: [...] } 或直接数组
 */
function normalizeNode(n: any): APITreeNode {
  return {
    ...n,
    id: n.id,
    level: n.level,
    title: n.title,
    parentId: n.parentId ?? null,
    progress: n.progress ?? 0,
    // 后端用 status，前端统一用 planStatus
    planStatus: n.planStatus || n.status || "PLANNED",
    owner: n.owner ?? null,
    priority: n.priority ?? null,
    planCategory: n.planCategory ?? null,
    targetDate: n.targetDate ?? null,
    dataFeedback: n.dataFeedback ?? null,
    issueLog: n.issueLog ?? null,
    actualHours: n.actualHours ?? null,
    children: (n.children || []).map(normalizeNode),
  };
}

function normalizeTree(raw: any): APITreeNode[] {
  // 兼容 { data: [...] } 或直接数组
  const arr: any[] = Array.isArray(raw) ? raw : (raw?.data ?? []);
  return arr.map(normalizeNode);
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

/** 强制清除所有 React Query 缓存，用于后端清空数据后同步前端状态 */
export function useClearAllCache() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.clear();
    queryClient.invalidateQueries();
  };
}

export function useWBSTree() {
  return useQuery<APITreeNode[]>({
    queryKey: ["wbs-tree"],
    queryFn: async () => {
      const raw = await apiFetch<any>("/api/nodes/tree");
      return normalizeTree(raw);
    },
    retry: 2,
    refetchOnWindowFocus: false,
    staleTime: 0,
  });
}

export function useUpdateNodeProgress() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, progress }: { id: string; progress: number }) =>
      apiFetch(`/api/nodes/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ progress }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wbs-tree"] });
    },
  });
}

export interface CreateNodePayload {
  parentId?: string | number | null;
  level: number;
  title: string;
  description?: string;
  planCategory?: string;
  priority?: string;
  owner?: string;
  targetDate?: string;
  plannedDate?: string;
  progress?: number;
  planStatus?: string;
  dataFeedback?: string;
  issueLog?: string;
  actualHours?: number;
  monthCode?: string;
  startTime?: string;
  endTime?: string;
}

export function useCreateNode() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CreateNodePayload) =>
      apiFetch("/api/nodes", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      // 用 refetchQueries 而非 invalidateQueries，确保 gcTime:0 时也能立即重新拉取
      queryClient.refetchQueries({ queryKey: ["wbs-tree"] });
    },
  });
}

export function useUpdateNode() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, payload }: { id: string | number; payload: Partial<CreateNodePayload> }) =>
      apiFetch(`/api/nodes/${id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.refetchQueries({ queryKey: ["wbs-tree"] });
    },
  });
}

export function useDeleteNode() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string | number) =>
      apiFetch(`/api/nodes/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.refetchQueries({ queryKey: ["wbs-tree"] });
    },
  });
}

// ── Todo nodes (待办库：所有未完成节点) ──────────────────────────────────────

/** GET /api/nodes/todo — 返回所有 planStatus ≠ DONE 的节点（扁平列表） */
export function useTodoNodes(level?: number) {
  return useQuery<APITreeNode[]>({
    queryKey: ["wbs-todo", level],
    queryFn: async () => {
      const raw = await apiFetch<any>("/api/nodes/todo");
      // 后端可能返回 { data: [...] } 或直接数组
      const arr: any[] = Array.isArray(raw) ? raw : (raw?.data ?? raw?.nodes ?? []);
      const normalized = arr.map(normalizeNode);
      return level != null ? normalized.filter(n => n.level === level) : normalized;
    },
    retry: 2,
    refetchOnWindowFocus: false,
    staleTime: 0,
  });
}

// ── Assignment (领用记录) ─────────────────────────────────────────────────────

export interface CreateAssignmentPayload {
  node_id: number | string;
  month_code: string;       // "YYYY-MM"
  planned_increment: number; // 0-100
  note?: string;
}

export interface AssignmentRecord {
  id: number | string;
  node_id: number | string;
  month_code: string;
  planned_increment: number;
  total_progress?: number;
  [key: string]: any;
}

/** POST /api/assignments — 领用任务，生成该月的执行记录（分身） */
export function useCreateAssignment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateAssignmentPayload) =>
      apiFetch<AssignmentRecord>("/api/assignments", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.refetchQueries({ queryKey: ["wbs-tree"] });
      queryClient.refetchQueries({ queryKey: ["wbs-todo"] });
    },
  });
}

/** GET /api/assignments?month_code=YYYY-MM — 查询某月已有的领用记录 */
export function useAssignments(monthCode: string) {
  return useQuery<AssignmentRecord[]>({
    queryKey: ["assignments", monthCode],
    queryFn: async () => {
      const raw = await apiFetch<any>(`/api/assignments?month_code=${monthCode}`);
      const arr: any[] = Array.isArray(raw) ? raw : (raw?.data ?? raw?.assignments ?? []);
      return arr;
    },
    retry: 1,
    staleTime: 0,
    enabled: !!monthCode,
  });
}

export interface AuditPreview {
  preview: {
    brief: string;
    [key: string]: any;
  };
  [key: string]: any;
}

export function useAuditPreview(nodeId: string | null) {
  return useQuery<AuditPreview>({
    queryKey: ["audit-preview", nodeId],
    queryFn: () => apiFetch<AuditPreview>(`/api/nodes/${nodeId}/audit-preview`),
    enabled: !!nodeId,
    retry: 1,
    staleTime: 30_000,
  });
}

export interface NodeLog {
  id?: string | number;
  content?: string;
  createdAt?: string;
  [key: string]: any;
}

export function useNodeLogs(nodeId: string | null) {
  return useQuery<NodeLog[]>({
    queryKey: ["node-logs", nodeId],
    queryFn: () => apiFetch<NodeLog[]>(`/api/nodes/${nodeId}/logs`),
    enabled: !!nodeId,
    retry: 1,
    staleTime: 30_000,
  });
}

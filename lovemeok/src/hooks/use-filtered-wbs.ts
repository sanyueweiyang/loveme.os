/**
 * useFilteredWBS — 筛选引擎 Hook
 *
 * Input:  allNodes (后端原始树) + 筛选条件 (year, category, l1Id)
 * Output: filteredTree (保持树形结构) + flatList (打平列表，含祖先信息)
 *
 * 设计原则：
 * - 纯计算，无副作用，不发起任何 API 请求
 * - 所有筛选在 useMemo 内完成，避免不必要的重渲染
 * - HierarchicalBoard 只负责渲染，不再内联任何过滤逻辑
 */

import { useMemo } from "react";
import type { APITreeNode } from "@/types/wbs";
import type { PlanCategory } from "@/types/plan-node";

// ── 前端扁平节点（含祖先信息，供看板渲染使用）────────────────────────────────

export interface FlatNode {
  id: string;
  level: number;
  title: string;
  progress: number;
  children: FlatNode[];

  // 祖先追踪
  _parentId?: string;
  _l1AncestorId?: string;

  // 业务字段（严格对齐字典 v1.0）
  owner?: string;
  priority?: string;       // P1 | P2 | P3
  planStatus?: string;     // PLANNED | IN_PROGRESS | IN_PROGRESS_CROSS_WEEK | DONE
  planCategory?: string;   // 工作 | 生活 | 成长
  targetDate?: string;     // YYYY-MM-DD（字典唯一日期字段）
  dataFeedback?: string;   // L6 专用
  issueLog?: string;       // L6 问题反馈/心得
  actualHours?: number;    // L6 实际工时
  description?: string;
}

// ── 筛选条件 ──────────────────────────────────────────────────────────────────

export interface WBSFilterOptions {
  /** 按年份过滤 targetDate / plannedEndDate，"" 表示全部 */
  year?: string;
  /** 按 planCategory 过滤，"" 表示全部 */
  category?: PlanCategory | "";
  /** L2-L5 钻取：只显示属于该 L1 的节点，"" 表示全部 */
  l1Id?: string;
  /** 当前激活层级，用于决定返回哪一层的 displayNodes */
  activeLevel?: number;
}

// ── 工具函数 ──────────────────────────────────────────────────────────────────

/** 将 APITreeNode 树递归转换为 FlatNode，同时记录 _parentId 和 _l1AncestorId */
function flattenTree(
  nodes: APITreeNode[],
  parentId: string | null,
  l1AncestorId: string | null,
  result: FlatNode[] = []
): FlatNode[] {
  for (const n of nodes) {
    const id = String(n.id);
    const thisL1 = n.level === 1 ? id : l1AncestorId;

    const flat: FlatNode = {
      id,
      level: n.level,
      title: n.title,
      progress: Math.round(n.progress ?? 0),
      children: [],
      _parentId: parentId ?? undefined,
      _l1AncestorId: thisL1 ?? undefined,
      owner: n.owner ?? undefined,
      priority: n.priority ?? undefined,
      planStatus: n.planStatus ?? undefined,
      planCategory: n.planCategory ?? undefined,
      targetDate: n.targetDate ?? undefined,
      dataFeedback: n.dataFeedback ?? undefined,
      issueLog: (n as any).issueLog ?? undefined,
      actualHours: (n as any).actualHours ?? undefined,
      description: n.description ?? undefined,
    };

    result.push(flat);

    if (n.children?.length) {
      flattenTree(n.children, id, thisL1, result);
    }
  }
  return result;
}

/** 从打平列表重建子节点引用（只重建直接子节点，不递归） */
function rebuildChildren(flat: FlatNode[]): FlatNode[] {
  const byId = new Map<string, FlatNode>();
  for (const n of flat) byId.set(n.id, { ...n, children: [] });

  const roots: FlatNode[] = [];
  for (const n of byId.values()) {
    if (n._parentId && byId.has(n._parentId)) {
      byId.get(n._parentId)!.children.push(n);
    } else {
      roots.push(n);
    }
  }
  return roots;
}

/** 判断节点的日期是否匹配目标年份（字典规定：只用 targetDate） */
function matchYear(node: FlatNode, year: string): boolean {
  if (!year) return true;
  return (node.targetDate || "").startsWith(year);
}

/** 判断节点的 planCategory 是否匹配 */
function matchCategory(node: FlatNode, category: string): boolean {
  if (!category) return true;
  return node.planCategory === category;
}

// ── 主 Hook ───────────────────────────────────────────────────────────────────

export interface UseFilteredWBSResult {
  /** 打平后的全量节点列表（含祖先信息） */
  allNodes: FlatNode[];
  /** 当前 activeLevel 下，经过所有筛选条件过滤后的节点列表 */
  displayNodes: FlatNode[];
  /** L6 专用：当前 activeParentId 下的 L6 节点 */
  l6Nodes: FlatNode[];
  /** L1 节点列表（用于钻取选择框） */
  l1Nodes: FlatNode[];
  /** 从数据中动态提取的可用年份列表（降序） */
  availableYears: string[];
}

export function useFilteredWBS(
  tree: APITreeNode[] | undefined,
  filters: WBSFilterOptions,
  activeParentId?: string | null
): UseFilteredWBSResult {
  const { year = "", category = "", l1Id = "", activeLevel = 1 } = filters;

  // 1. 将后端树打平，记录祖先信息
  const allNodes = useMemo<FlatNode[]>(() => {
    if (!tree?.length) return [];
    return flattenTree(tree, null, null);
  }, [tree]);

  // 2. 重建子节点引用（供卡片展开使用）
  const allNodesWithChildren = useMemo<FlatNode[]>(() => {
    if (!allNodes.length) return [];
    // 将 children 引用注入到每个 FlatNode
    const byId = new Map<string, FlatNode>();
    for (const n of allNodes) byId.set(n.id, { ...n, children: [] });
    for (const n of byId.values()) {
      if (n._parentId && byId.has(n._parentId)) {
        byId.get(n._parentId)!.children.push(n);
      }
    }
    return Array.from(byId.values());
  }, [allNodes]);

  // 3. L1 节点列表
  const l1Nodes = useMemo(
    () => allNodesWithChildren.filter((n) => n.level === 1),
    [allNodesWithChildren]
  );

  // 4. 可用年份（字典规定：只从 targetDate 提取）
  const availableYears = useMemo(() => {
    const years = new Set<string>();
    for (const n of allNodes) {
      const y = (n.targetDate || "").slice(0, 4);
      if (/^\d{4}$/.test(y)) years.add(y);
    }
    return Array.from(years).sort().reverse();
  }, [allNodes]);

  // 5. displayNodes：当前层级 + 全部筛选条件
  const displayNodes = useMemo<FlatNode[]>(() => {
    let nodes = allNodesWithChildren.filter(
      (n) => Number(n.level) === Number(activeLevel)
    );

    // L2-L5 钻取：按所属 L1 过滤
    if (activeLevel >= 2 && activeLevel <= 5 && l1Id) {
      nodes = nodes.filter((n) => n._l1AncestorId === l1Id);
    }

    // 维度筛选
    if (category) {
      nodes = nodes.filter((n) => matchCategory(n, category));
    }

    // 年份筛选
    if (year) {
      nodes = nodes.filter((n) => matchYear(n, year));
    }

    return nodes;
  }, [allNodesWithChildren, activeLevel, l1Id, category, year]);

  // 6. L6 节点（进度日志模式）
  const l6Nodes = useMemo<FlatNode[]>(() => {
    if (activeLevel !== 6) return [];
    let nodes = allNodesWithChildren.filter((n) => n.level === 6);
    if (activeParentId) {
      nodes = nodes.filter((n) => n._parentId === activeParentId);
    }
    if (category) nodes = nodes.filter((n) => matchCategory(n, category));
    if (year) nodes = nodes.filter((n) => matchYear(n, year));
    return nodes;
  }, [allNodesWithChildren, activeLevel, activeParentId, category, year]);

  return {
    allNodes: allNodesWithChildren,
    displayNodes,
    l6Nodes,
    l1Nodes,
    availableYears,
  };
}

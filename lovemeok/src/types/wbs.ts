// LoveMe OS — 7-Layer WBS Data Model (API-driven)

export type WBSLayerLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type WBSTier = "strategy" | "management" | "execution";

export interface WBSLayerMeta {
  level: WBSLayerLevel;
  label: string;
  shortLabel: string;
  tier: WBSTier;
  tierLabel: string;
  description: string;
  reportCycle: string;
}

export const WBS_LAYERS: WBSLayerMeta[] = [
  { level: 1, label: "年度目标", shortLabel: "L1", tier: "strategy", tierLabel: "长期愿景", description: "年度核心目标", reportCycle: "年度" },
  { level: 2, label: "关键成果", shortLabel: "L2", tier: "strategy", tierLabel: "长期愿景", description: "关键成果指标", reportCycle: "年度" },
  { level: 3, label: "关键计划", shortLabel: "L3", tier: "management", tierLabel: "长期愿景", description: "关键计划拆解", reportCycle: "季度" },
  { level: 4, label: "月度计划", shortLabel: "L4", tier: "management", tierLabel: "长期愿景", description: "月度计划行动", reportCycle: "月度" },
  { level: 5, label: "月度清单", shortLabel: "L5", tier: "management", tierLabel: "当下行动", description: "月度待办清单", reportCycle: "月度" },
  { level: 6, label: "本周清单", shortLabel: "L6", tier: "execution", tierLabel: "当下行动", description: "本周重点事项", reportCycle: "每周" },
  { level: 7, label: "日志", shortLabel: "L7", tier: "execution", tierLabel: "当下行动", description: "操作日志与工时", reportCycle: "每周" },
];

export type ModuleStatus = "on_track" | "at_risk" | "behind" | "completed" | "not_started";

// Generic tree node from backend API
export interface APITreeNode {
  id: string | number;
  level: number;
  title: string;
  parentId?: string | number | null;
  status?: string;
  planStatus?: string;
  progress: number;
  owner?: string | null;
  priority?: string;
  plannedEndDate?: string | null;
  tags?: string[];
  updatedAt?: string;
  children?: APITreeNode[];
  [key: string]: any; // allow extra fields from backend
}

export interface WBSNode {
  id: string;
  level: WBSLayerLevel;
  title: string;
  parentId: string | null;
  status: ModuleStatus;
  progress: number;
  owner?: string;
  tags?: string[];
  updatedAt: string;
  children?: WBSNode[];
}

export interface L4Module extends WBSNode {
  level: 4;
  alignedL1Goal: string;
  l6ActivityCount: number;
  l6CompletedCount: number;
  snapshotDelta?: number;
  children?: WBSNode[];
}

export interface L4Snapshot {
  moduleId: string;
  month: string;
  progress: number;
  delta: number;
}

// Helpers to extract nodes from the API tree
function flattenTree(node: APITreeNode, list: APITreeNode[] = []): APITreeNode[] {
  list.push(node);
  if (node.children) {
    for (const child of node.children) {
      flattenTree(child, list);
    }
  }
  return list;
}

function findAncestorAtLevel(nodeId: string | number, level: number, allNodes: APITreeNode[]): APITreeNode | undefined {
  const nodeMap = new Map<string, APITreeNode>();
  const parentMap = new Map<string, string>(); // childId -> parentId

  // Build parent map from tree structure
  function buildParentMap(node: APITreeNode) {
    if (node.children) {
      for (const child of node.children) {
        parentMap.set(String(child.id), String(node.id));
        buildParentMap(child);
      }
    }
  }

  for (const n of allNodes) {
    nodeMap.set(String(n.id), n);
    if (!n.parentId) buildParentMap(n); // only from roots to avoid duplicates
  }

  let currentId = String(nodeId);
  while (currentId) {
    const current = nodeMap.get(currentId);
    if (current && current.level === level) return current;
    const pid = parentMap.get(currentId);
    if (!pid) break;
    currentId = pid;
  }
  return undefined;
}

function countDescendantsAtLevel(node: APITreeNode, level: number): { total: number; completed: number } {
  let total = 0;
  let completed = 0;
  
  function walk(n: APITreeNode) {
    if (n.level === level) {
      total++;
      if (n.progress >= 100 || resolveStatus(n) === "completed") completed++;
    }
    if (n.children) {
      for (const child of n.children) walk(child);
    }
  }
  
  if (node.children) {
    for (const child of node.children) walk(child);
  }
  return { total, completed };
}

function resolveStatus(node: APITreeNode): string {
  if (node.status) return node.status;
  const p = node.progress ?? 0;
  if (p >= 100) return "completed";
  if (p > 0) return "on_track";
  return "not_started";
}

export function normalizeStatus(status?: string): ModuleStatus {
  if (!status) return "not_started";
  const map: Record<string, ModuleStatus> = {
    on_track: "on_track",
    at_risk: "at_risk",
    behind: "behind",
    completed: "completed",
    not_started: "not_started",
  };
  return map[status] || "not_started";
}

export function extractL4Modules(tree: APITreeNode | APITreeNode[]): L4Module[] {
  const roots = Array.isArray(tree) ? tree : [tree];
  const allNodes: APITreeNode[] = [];
  for (const root of roots) flattenTree(root, allNodes);

  const l4Nodes = allNodes.filter((n) => n.level === 4);

  return l4Nodes.map((n): L4Module => {
    const l1Ancestor = findAncestorAtLevel(n.id, 1, allNodes);
    const l6Stats = countDescendantsAtLevel(n, 6);
    const status = resolveStatus(n);

    return {
      id: String(n.id),
      level: 4,
      title: n.title,
      parentId: n.parentId ? String(n.parentId) : null,
      status: normalizeStatus(status),
      progress: Math.round(n.progress ?? 0),
      owner: n.owner || "未分配",
      tags: n.tags || [],
      updatedAt: n.updatedAt || new Date().toISOString(),
      alignedL1Goal: l1Ancestor?.title || "未关联战略目标",
      l6ActivityCount: l6Stats.total,
      l6CompletedCount: l6Stats.completed,
      snapshotDelta: n.snapshotDelta ?? undefined,
      children: (n.children || []).map((c) => ({
        id: String(c.id),
        level: c.level as WBSLayerLevel,
        title: c.title,
        parentId: String(c.parentId ?? n.id),
        status: normalizeStatus(resolveStatus(c)),
        progress: Math.round(c.progress ?? 0),
        owner: c.owner || undefined,
        tags: c.tags,
        updatedAt: c.updatedAt || new Date().toISOString(),
      })),
    };
  });
}

export function extractNodesAtLevel(tree: APITreeNode | APITreeNode[], level: number): APITreeNode[] {
  const roots = Array.isArray(tree) ? tree : [tree];
  const allNodes: APITreeNode[] = [];
  for (const root of roots) flattenTree(root, allNodes);
  return allNodes.filter((n) => n.level === level);
}

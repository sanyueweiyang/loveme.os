/**
 * LoveMe OS — PlanNode 前端类型定义 (v1.0)
 *
 * 严格对齐《WBS 核心业务数据字典 v1.0》。
 * 所有 API payload 必须只包含此处定义的字段，
 * 由 src/lib/api.ts 中的拦截器在运行时强制校验。
 *
 * ⚠️  字段名是契约，禁止随意修改。
 */

// ── 枚举类型（严格对齐字典）────────────────────────────────────────────────────

/** 节点状态 — 对应字典 planStatus 列 */
export type PlanStatus = "PLANNED" | "IN_PROGRESS" | "IN_PROGRESS_CROSS_WEEK" | "DONE";

/** 优先级 — 对应字典 priority 列 */
export type PlanPriority = "P1" | "P2" | "P3";

/**
 * 业务维度 — 对应字典 planCategory 列
 * 字典规定：'工作' | '生活' | '成长'，L1 必选，下级继承
 */
export type PlanCategory = "工作" | "生活" | "成长";

/** 层级 — 1(愿景) 到 6(执行) */
export type PlanLevel = 1 | 2 | 3 | 4 | 5 | 6;

// ── 核心模型 ──────────────────────────────────────────────────────────────────

/**
 * PlanNode — 完整字段集合，对应后端 plan_nodes 表。
 * 只读字段（id, createdAt, updatedAt）在创建时不需要传入。
 */
export interface PlanNode {
  /** 唯一标识，后端自增 */
  id: number;

  /** 层级深度：1(愿景) ~ 6(执行) */
  level: PlanLevel;

  /** 父节点 ID；L1 为 null，L2-L6 必填 */
  parentId: number | null;

  /** 标题，全层级必填 */
  title: string;

  /** 业务维度；L1 必选，下级继承 */
  planCategory: PlanCategory | null;

  /** 负责人；L2-L5 必填 */
  owner: string | null;

  /** 优先级；L1-L5 */
  priority: PlanPriority | null;

  /** 目标日期 YYYY-MM-DD；L5 必填，其他选填 */
  targetDate: string | null;

  /** 月度编码 YYYY-MM；L5 必填，用于周报/月报筛选 */
  monthCode: string | null;

  /** 进度 0-100；全层级，L6 录入 */
  progress: number;

  /** 状态 */
  planStatus: PlanStatus;

  /** 执行反馈；L6 必填 */
  dataFeedback: string | null;

  /** 问题反馈/心得；L6 选填 */
  issueLog: string | null;

  /** 实际工时；L6 选填 */
  actualHours: number | null;

  // ── 系统字段（只读）──
  createdAt: string;
  updatedAt: string;

  // ── 前端组装（后端不直接返回）──
  children?: PlanNode[];
}

// ── 层级专属 Payload 类型（编译期约束）────────────────────────────────────────

/** L1 愿景：title + planCategory + priority */
export interface L1CreatePayload {
  level: 1;
  parentId: null;
  title: string;
  planCategory: PlanCategory;
  priority?: PlanPriority;
}

/** L2-L4 拆解：title + owner + priority */
export interface L2L4CreatePayload {
  level: 2 | 3 | 4;
  parentId: number;
  title: string;
  owner: string;
  priority: PlanPriority;
  planCategory?: PlanCategory;
}

/** L5 工作包：title + owner + priority + targetDate(必填) + monthCode(必填) */
export interface L5CreatePayload {
  level: 5;
  parentId: number;
  title: string;
  owner: string;
  priority: PlanPriority;
  targetDate: string;       // YYYY-MM-DD，必填
  monthCode: string;        // YYYY-MM，如 "2026-03"，必填
  planCategory?: PlanCategory;
}

/** L6 执行：progress + dataFeedback + issueLog + actualHours */
export interface L6UpdatePayload {
  progress: number;
  dataFeedback: string;
  issueLog?: string;
  actualHours?: number;
}

/** 通用创建 payload（联合类型，供 handleAdd 使用） */
export type CreatePlanNodePayload =
  | L1CreatePayload
  | L2L4CreatePayload
  | L5CreatePayload;

/** PATCH 更新 payload（所有字段可选） */
export type UpdatePlanNodePayload = Partial<
  Omit<PlanNode, "id" | "level" | "parentId" | "createdAt" | "updatedAt" | "children">
>;

// ── 字段白名单（运行时拦截器使用）────────────────────────────────────────────

/**
 * 各层级允许出现在 POST payload 中的字段名。
 * 任何不在此列表中的字段都会被拦截器拒绝。
 */
export const LEVEL_ALLOWED_CREATE_FIELDS: Record<number, Set<string>> = {
  1: new Set(["level", "parentId", "title", "planCategory", "priority"]),
  2: new Set(["level", "parentId", "title", "owner", "priority", "planCategory"]),
  3: new Set(["level", "parentId", "title", "owner", "priority", "planCategory"]),
  4: new Set(["level", "parentId", "title", "owner", "priority", "planCategory"]),
  5: new Set(["level", "parentId", "title", "owner", "priority", "targetDate", "monthCode", "planCategory"]),
  6: new Set(["level", "parentId", "title", "progress", "dataFeedback", "issueLog", "actualHours"]),
};

/**
 * 允许出现在 POST /api/nodes payload 中的全量字段（所有层级的并集）。
 * api.ts 拦截器使用此集合做快速校验。
 */
export const PLAN_NODE_CREATE_FIELDS = new Set<string>([
  "level", "parentId", "title",
  "planCategory", "owner", "priority",
  "targetDate", "monthCode", "progress", "planStatus",
  "dataFeedback", "issueLog", "actualHours",
]);

/**
 * 允许出现在 PATCH /api/nodes/:id payload 中的字段名集合。
 */
export const PLAN_NODE_UPDATE_FIELDS = new Set<string>([
  "title", "planCategory", "owner", "priority",
  "targetDate", "monthCode", "progress", "planStatus",
  "dataFeedback", "issueLog", "actualHours",
]);

/**
 * 校验 payload 字段是否合法。
 * @returns 非法字段列表（空数组表示全部合法）
 */
export function validatePayloadFields(
  payload: Record<string, unknown>,
  allowedFields: Set<string>
): string[] {
  return Object.keys(payload).filter((k) => !allowedFields.has(k));
}

/**
 * 按层级校验 payload 字段（比全量白名单更严格）。
 * @returns 非法字段列表
 */
export function validatePayloadByLevel(
  level: number,
  payload: Record<string, unknown>
): string[] {
  const allowed = LEVEL_ALLOWED_CREATE_FIELDS[level];
  if (!allowed) return [];
  return Object.keys(payload).filter((k) => !allowed.has(k));
}

// ── 枚举值常量（供 UI 选项使用）──────────────────────────────────────────────

export const PLAN_STATUS_OPTIONS: { value: PlanStatus; label: string }[] = [
  { value: "PLANNED", label: "计划中" },
  { value: "IN_PROGRESS", label: "进行中" },
  { value: "IN_PROGRESS_CROSS_WEEK", label: "跨周进行中" },
  { value: "DONE", label: "已完成" },
];

export const PLAN_PRIORITY_OPTIONS: { value: PlanPriority; label: string }[] = [
  { value: "P1", label: "P1 · 高" },
  { value: "P2", label: "P2 · 中" },
  { value: "P3", label: "P3 · 低" },
];

export const PLAN_CATEGORY_OPTIONS: { value: PlanCategory; label: string }[] = [
  { value: "工作", label: "事业" },
  { value: "生活", label: "生活" },
  { value: "成长", label: "成长" },
];

// ── 层级名称常量（OKR 术语对齐）────────────────────────────────────────────
/**
 * LEVEL_NAMES — 每个层级对应的 OKR/WBS 业务术语。
 *
 * 对应关系：
 *   L1 愿景     — 组织级战略目标（Vision）
 *   L2 关键结果  — 年度 OKR 的 Key Result
 *   L3 项目集   — 季度项目群（Program）
 *   L4 模块     — 月度核心模块（Module）
 *   L5 工作包   — 可交付工作包（Work Package）
 *   L6 活动     — 具体执行活动（Activity），进度由此层录入
 *
 * 使用示例：
 *   LEVEL_NAMES[2]        // → "关键结果"
 *   LEVEL_DIALOG_TITLE[2] // → "新建关键结果"
 */
export const LEVEL_NAMES: Record<PlanLevel, string> = {
  1: "年度目标",
  2: "关键成果",
  3: "关键计划",
  4: "我的行动",
  5: "月度清单",
  6: "本周清单",
};

/**
 * LEVEL_DIALOG_TITLE — 新建/更新弹窗标题，直接使用 OKR 术语，不加"节点"后缀。
 *
 * 规则：
 *   L1 → "新建愿景"
 *   L2 → "新建关键结果"
 *   L3 → "新建项目集"
 *   L4 → "新建模块"
 *   L5 → "新建工作包"
 *   L6 → "更新活动进度"（L6 不新建，只更新 progress + dataFeedback）
 */
export const LEVEL_DIALOG_TITLE: Record<PlanLevel, string> = {
  1: "记一笔 · 年度目标",
  2: "记一笔 · 关键成果",
  3: "记一笔 · 关键计划",
  4: "记一笔 · 我的行动",
  5: "记一笔 · 月度清单",
  6: "存入轨迹",
};

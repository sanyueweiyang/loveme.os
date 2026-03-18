import { L4Module, WBSNode } from "@/types/wbs";

export const mockL1Goals: WBSNode[] = [
  { id: "l1-1", level: 1, title: "成为行业领先的 AI 平台", parentId: null, status: "on_track", progress: 42, owner: "CEO", updatedAt: "2026-03-10" },
  { id: "l1-2", level: 1, title: "实现全球化市场拓展", parentId: null, status: "at_risk", progress: 28, owner: "COO", updatedAt: "2026-03-08" },
];

export const mockL4Modules: L4Module[] = [
  {
    id: "l4-1", level: 4, title: "核心推理引擎", parentId: "l3-1",
    status: "on_track", progress: 68, owner: "张工",
    alignedL1Goal: "成为行业领先的 AI 平台",
    l6ActivityCount: 24, l6CompletedCount: 18, snapshotDelta: 12,
    tags: ["AI", "后端"], updatedAt: "2026-03-12",
  },
  {
    id: "l4-2", level: 4, title: "数据管道 v2", parentId: "l3-1",
    status: "at_risk", progress: 41, owner: "李工",
    alignedL1Goal: "成为行业领先的 AI 平台",
    l6ActivityCount: 32, l6CompletedCount: 14, snapshotDelta: -3,
    tags: ["数据", "基础设施"], updatedAt: "2026-03-11",
  },
  {
    id: "l4-3", level: 4, title: "用户增长系统", parentId: "l3-2",
    status: "on_track", progress: 55, owner: "王工",
    alignedL1Goal: "实现全球化市场拓展",
    l6ActivityCount: 18, l6CompletedCount: 10, snapshotDelta: 8,
    tags: ["增长", "前端"], updatedAt: "2026-03-10",
  },
  {
    id: "l4-4", level: 4, title: "多语言本地化", parentId: "l3-2",
    status: "behind", progress: 22, owner: "赵工",
    alignedL1Goal: "实现全球化市场拓展",
    l6ActivityCount: 15, l6CompletedCount: 3, snapshotDelta: 5,
    tags: ["i18n", "内容"], updatedAt: "2026-03-09",
  },
  {
    id: "l4-5", level: 4, title: "安全合规模块", parentId: "l3-3",
    status: "not_started", progress: 0, owner: "孙工",
    alignedL1Goal: "成为行业领先的 AI 平台",
    l6ActivityCount: 8, l6CompletedCount: 0, snapshotDelta: 0,
    tags: ["安全", "合规"], updatedAt: "2026-03-07",
  },
  {
    id: "l4-6", level: 4, title: "监控告警平台", parentId: "l3-1",
    status: "completed", progress: 100, owner: "周工",
    alignedL1Goal: "成为行业领先的 AI 平台",
    l6ActivityCount: 20, l6CompletedCount: 20, snapshotDelta: 4,
    tags: ["运维", "SRE"], updatedAt: "2026-03-06",
  },
];

/**
 * ExecutionPage — /execution · 每周重点工作
 *
 * 逻辑：GET /api/nodes?mode=weekly → 按 L5 分组 → 每组展示 L6 行
 * 创建 L6 时必须先选择 L5 父节点，处理 L6_PARENT_MUST_BE_L5 错误
 */

import { useState } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { DebugPanel } from "@/components/debug/DebugPanel";
import {
  useWeeklyNodes, useCreateL6, useUpdateL6, useDeleteNode,
  groupByL5, type WeeklyNode, type WeeklyGroup,
} from "@/hooks/use-weekly";
import { PLAN_PRIORITY_OPTIONS } from "@/types/plan-node";
import { cn } from "@/lib/utils";
import {
  Plus, Loader2, RefreshCw, Trash2, Zap,
  ChevronDown, ChevronRight, CheckCircle2, Circle,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";

// ── 常量 ──────────────────────────────────────────────────────────────────────

const PRIORITY_STYLES: Record<string, string> = {
  P1: "bg-red-500/15 text-red-600 border-red-200",
  P2: "bg-amber-500/15 text-amber-600 border-amber-200",
  P3: "bg-blue-500/15 text-blue-600 border-blue-200",
};

const STATUS_STYLES: Record<string, string> = {
  PLANNED:     "bg-muted/60 text-muted-foreground",
  IN_PROGRESS: "bg-amber-500/15 text-amber-600",
  DONE:        "bg-emerald-500/15 text-emerald-600",
};

const STATUS_LABELS: Record<string, string> = {
  PLANNED: "计划中", IN_PROGRESS: "进行中", DONE: "已完成",
};

// ── 进度条 ────────────────────────────────────────────────────────────────────

function ProgressBar({ value, isDone }: { value: number; isDone: boolean }) {
  return (
    <div className="flex items-center gap-2 min-w-[80px]">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-500",
            isDone ? "bg-emerald-500" : "bg-primary"
          )}
          style={{ width: `${Math.min(value, 100)}%` }}
        />
      </div>
      <span className={cn("text-[11px] font-semibold w-7 text-right shrink-0",
        isDone ? "text-emerald-600" : "text-foreground"
      )}>
        {value}%
      </span>
    </div>
  );
}

// ── L6 行 ─────────────────────────────────────────────────────────────────────

function L6Row({
  node,
  onToggleDone,
  onDelete,
}: {
  node: WeeklyNode;
  onToggleDone: (node: WeeklyNode) => void;
  onDelete: (node: WeeklyNode) => void;
}) {
  const isDone = node.planStatus === "DONE";

  return (
    <div className={cn(
      "group flex items-center gap-3 px-4 py-2.5 border-b border-border/20 last:border-0",
      "hover:bg-muted/30 transition-colors",
      isDone && "opacity-60"
    )}>
      {/* 完成切换 */}
      <button
        onClick={() => onToggleDone(node)}
        className="shrink-0 text-muted-foreground hover:text-primary transition-colors"
      >
        {isDone
          ? <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          : <Circle className="w-4 h-4" />
        }
      </button>

      {/* 标题 */}
      <p className={cn(
        "flex-1 text-sm font-medium truncate",
        isDone && "line-through text-muted-foreground"
      )}>
        {node.title}
      </p>

      {/* 优先级标签 */}
      {node.priority ? (
        <span className={cn(
          "text-[10px] font-bold px-1.5 py-0.5 rounded-md border shrink-0",
          PRIORITY_STYLES[node.priority]
        )}>
          {node.priority}
        </span>
      ) : (
        <span className="text-[10px] text-muted-foreground/40 shrink-0 w-8">—</span>
      )}

      {/* 进度条 */}
      <ProgressBar value={node.progress} isDone={isDone} />

      {/* 负责人 */}
      <span className="text-[11px] text-muted-foreground shrink-0 w-14 truncate text-right">
        {node.owner || "—"}
      </span>

      {/* 删除按钮（hover 显示） */}
      <button
        onClick={() => onDelete(node)}
        className="shrink-0 opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-all"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ── L5 分组卡片 ───────────────────────────────────────────────────────────────

function L5GroupCard({
  group,
  onAddL6,
  onToggleDone,
  onDelete,
}: {
  group: WeeklyGroup;
  onAddL6: (l5: WeeklyNode) => void;
  onToggleDone: (node: WeeklyNode) => void;
  onDelete: (node: WeeklyNode) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const { l5, l6Items } = group;
  const doneCount = l6Items.filter(n => n.planStatus === "DONE").length;
  const totalCount = l6Items.length;
  const groupProgress = totalCount > 0
    ? Math.round(l6Items.reduce((s, n) => s + n.progress, 0) / totalCount)
    : l5.progress;

  return (
    <div className="rounded-xl border bg-card/70 overflow-hidden shadow-[0_2px_12px_-4px_hsl(var(--foreground)/0.06)]">
      {/* L5 卡片头 */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/20 transition-colors select-none"
        onClick={() => setExpanded(v => !v)}
      >
        {/* 展开/折叠 */}
        <button className="shrink-0 text-muted-foreground">
          {expanded
            ? <ChevronDown className="w-4 h-4" />
            : <ChevronRight className="w-4 h-4" />
          }
        </button>

        {/* L5 徽章 */}
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold text-white bg-wbs-l5 shrink-0">
          <Zap className="w-3 h-3" />L5
        </span>

        {/* 标题 */}
        <h3 className="flex-1 text-sm font-semibold text-card-foreground truncate">
          {l5.title}
        </h3>

        {/* 元信息 */}
        <div className="flex items-center gap-3 shrink-0">
          {l5.priority && (
            <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-md border", PRIORITY_STYLES[l5.priority])}>
              {l5.priority}
            </span>
          )}
          <span className={cn("text-[10px] px-1.5 py-0.5 rounded-md font-medium", STATUS_STYLES[l5.planStatus])}>
            {STATUS_LABELS[l5.planStatus]}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {doneCount}/{totalCount} 完成
          </span>
          <ProgressBar value={groupProgress} isDone={l5.planStatus === "DONE"} />
          {l5.owner && (
            <span className="text-[11px] text-muted-foreground w-14 truncate text-right">{l5.owner}</span>
          )}
        </div>

        {/* 添加 L6 按钮 */}
        <button
          onClick={e => { e.stopPropagation(); onAddL6(l5); }}
          className="shrink-0 p-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
          title="添加本周重点"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* L6 列表 */}
      {expanded && (
        <div className="border-t border-border/30">
          {/* 列头 */}
          <div className="flex items-center gap-3 px-4 py-1.5 bg-muted/20 border-b border-border/20">
            <div className="w-4 shrink-0" />
            <span className="flex-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wide">本周重点</span>
            <span className="text-[10px] text-muted-foreground shrink-0 w-8 text-center">优先级</span>
            <span className="text-[10px] text-muted-foreground shrink-0 min-w-[80px]">进度</span>
            <span className="text-[10px] text-muted-foreground shrink-0 w-14 text-right">负责人</span>
            <div className="w-6 shrink-0" />
          </div>

          {l6Items.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <p className="text-xs text-muted-foreground">暂无本周重点</p>
              <button
                onClick={() => onAddL6(l5)}
                className="mt-2 text-xs text-primary hover:underline"
              >
                + 添加第一条
              </button>
            </div>
          ) : (
            l6Items.map(node => (
              <L6Row
                key={node.id}
                node={node}
                onToggleDone={onToggleDone}
                onDelete={onDelete}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── 创建 L6 弹窗 ──────────────────────────────────────────────────────────────

interface CreateL6DialogProps {
  open: boolean;
  l5List: WeeklyNode[];
  defaultL5Id?: number;
  onClose: () => void;
}

function CreateL6Dialog({ open, l5List, defaultL5Id, onClose }: CreateL6DialogProps) {
  const createMutation = useCreateL6();
  const [form, setForm] = useState({
    parentId: defaultL5Id ? String(defaultL5Id) : "",
    title: "",
    priority: "" as string,
    owner: "",
    targetDate: "",
    dataFeedback: "",
  });

  // 当 defaultL5Id 变化时同步
  const handleOpen = () => {
    setForm(f => ({ ...f, parentId: defaultL5Id ? String(defaultL5Id) : f.parentId }));
  };

  const handleSubmit = async () => {
    if (!form.parentId) {
      toast.error("请先选择所属 L5 工作包");
      return;
    }
    if (!form.title.trim()) {
      toast.error("请填写本周重点标题");
      return;
    }

    const selectedL5 = l5List.find(n => n.id === Number(form.parentId));
    if (!selectedL5 || selectedL5.level !== 5) {
      toast.error("L6_PARENT_MUST_BE_L5：父节点必须是 L5 工作包");
      return;
    }

    try {
      await createMutation.mutateAsync({
        level: 6,
        parentId: Number(form.parentId),
        title: form.title.trim(),
        ...(form.priority ? { priority: form.priority as any } : {}),
        ...(form.owner ? { owner: form.owner.trim() } : {}),
        ...(form.targetDate ? { targetDate: form.targetDate } : {}),
        ...(form.dataFeedback ? { dataFeedback: form.dataFeedback.trim() } : {}),
      });
      toast.success("本周重点已添加");
      setForm({ parentId: "", title: "", priority: "", owner: "", targetDate: "", dataFeedback: "" });
      onClose();
    } catch (err: any) {
      const msg: string = err?.message || "";
      if (msg.includes("L6_PARENT_MUST_BE_L5")) {
        toast.error("父节点必须是 L5 工作包，请重新选择");
      } else {
        toast.error("创建失败", { description: msg });
      }
    }
  };

  const inputCls = "w-full px-3 py-2 rounded-lg text-sm bg-muted/50 border border-border/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all";

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); else handleOpen(); }}>
      <DialogContent className="sm:max-w-md bg-card/95 backdrop-blur-xl border-border/50 shadow-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold text-white bg-wbs-l6">
              <Zap className="w-3 h-3" />L6
            </span>
            添加本周重点
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 pt-1">
          {/* 必选：所属 L5 工作包 */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              所属 L5 工作包 <span className="text-red-500">*</span>
            </label>
            <select
              value={form.parentId}
              onChange={e => setForm(f => ({ ...f, parentId: e.target.value }))}
              className={inputCls}
            >
              <option value="">请选择 L5 工作包…</option>
              {l5List.map(n => (
                <option key={n.id} value={n.id}>{n.title}</option>
              ))}
            </select>
            {!form.parentId && (
              <p className="text-[10px] text-amber-600 mt-1">⚠ 必须先选择 L5 工作包，L6 节点不能独立存在</p>
            )}
          </div>

          {/* 标题 */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              本周重点标题 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              onKeyDown={e => e.key === "Enter" && handleSubmit()}
              placeholder="例：完成看板 UI 重构"
              className={inputCls}
              autoFocus
            />
          </div>

          {/* 优先级 */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">优先级</label>
            <select
              value={form.priority}
              onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
              className={inputCls}
            >
              <option value="">请选择…</option>
              {PLAN_PRIORITY_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* 负责人 */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">负责人</label>
            <input
              type="text"
              value={form.owner}
              onChange={e => setForm(f => ({ ...f, owner: e.target.value }))}
              placeholder="例：张三"
              className={inputCls}
            />
          </div>

          {/* 目标日期 */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">目标日期</label>
            <input
              type="date"
              value={form.targetDate}
              onChange={e => setForm(f => ({ ...f, targetDate: e.target.value }))}
              className={inputCls}
            />
          </div>
        </div>

        <DialogFooter className="flex gap-2 pt-2">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-lg text-sm font-medium border border-border/50 hover:bg-muted transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={createMutation.isPending}
            className={cn(
              "flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all",
              "bg-primary text-primary-foreground",
              "shadow-[0_4px_16px_-4px_hsl(var(--primary)/0.4)]",
              "hover:shadow-[0_8px_24px_-4px_hsl(var(--primary)/0.5)]",
              "disabled:opacity-40 disabled:cursor-not-allowed"
            )}
          >
            {createMutation.isPending ? "保存中…" : "保存"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── 主页面 ────────────────────────────────────────────────────────────────────

const ExecutionPage = () => {
  const { data: nodes = [], isLoading, refetch } = useWeeklyNodes();
  const updateMutation = useUpdateL6();
  const deleteMutation = useDeleteNode();

  const [createDialog, setCreateDialog] = useState<{ open: boolean; defaultL5Id?: number }>({ open: false });

  const groups = groupByL5(nodes);
  const l5List = nodes.filter(n => n.level === 5);

  // 完成切换
  const handleToggleDone = async (node: WeeklyNode) => {
    const isDone = node.planStatus === "DONE";
    try {
      await updateMutation.mutateAsync({
        id: node.id,
        payload: {
          planStatus: isDone ? "IN_PROGRESS" : "DONE",
          progress: isDone ? node.progress : 100,
        },
      });
    } catch {
      toast.error("更新失败");
    }
  };

  // 删除节点
  const handleDelete = async (node: WeeklyNode) => {
    try {
      await deleteMutation.mutateAsync(node.id);
      toast.success("已删除");
    } catch (err: any) {
      const msg: string = err?.message || "";
      if (msg.includes("L6_PARENT_MUST_BE_L5") || msg.includes("子节点")) {
        toast.error("无法删除：请先清理下级节点");
      } else {
        toast.error("删除失败", { description: msg });
      }
    }
  };

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-muted/30">
        <AppSidebar activeLevel={6} onLevelChange={() => {}} />

        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <header className="h-11 flex items-center gap-3 border-b px-4 shrink-0 bg-background">
            <SidebarTrigger className="text-muted-foreground" />
            <div className="w-px h-4 bg-border" />
            <Zap className="w-4 h-4 text-wbs-l6" />
            <span className="text-sm font-semibold">每周重点工作</span>
            <span className="text-[11px] text-muted-foreground">L5 工作包 → L6 本周重点</span>

            <div className="ml-auto flex items-center gap-2">
              {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
              <button
                onClick={() => refetch()}
                className="p-1.5 rounded-md hover:bg-muted text-muted-foreground transition-colors"
                title="刷新"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setCreateDialog({ open: true })}
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold",
                  "bg-primary text-primary-foreground",
                  "shadow-[0_4px_16px_-4px_hsl(var(--primary)/0.4)]",
                  "hover:shadow-[0_8px_24px_-4px_hsl(var(--primary)/0.5)] transition-all"
                )}
              >
                <Plus className="w-3.5 h-3.5" />
                添加本周重点
              </button>
            </div>
          </header>

          {/* 内容区 */}
          <div className="flex-1 overflow-auto p-6">
            {isLoading ? (
              <div className="flex items-center justify-center py-24">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : groups.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <Zap className="w-10 h-10 text-muted-foreground/20 mb-4" />
                <p className="text-sm font-medium text-muted-foreground">暂无本周工作数据</p>
                <p className="text-xs text-muted-foreground/60 mt-1 mb-4">
                  后端接口：GET /api/nodes?mode=weekly
                </p>
                <button
                  onClick={() => setCreateDialog({ open: true })}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  添加第一条本周重点
                </button>
              </div>
            ) : (
              <div className="space-y-4 max-w-4xl mx-auto">
                {groups.map(group => (
                  <L5GroupCard
                    key={group.l5.id}
                    group={group}
                    onAddL6={l5 => setCreateDialog({ open: true, defaultL5Id: l5.id })}
                    onToggleDone={handleToggleDone}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 创建 L6 弹窗 */}
      <CreateL6Dialog
        open={createDialog.open}
        l5List={l5List}
        defaultL5Id={createDialog.defaultL5Id}
        onClose={() => setCreateDialog({ open: false })}
      />

      <DebugPanel />
    </SidebarProvider>
  );
};

export default ExecutionPage;

/**
 * L5PlanningPage — /planning/l5
 * 双窗格布局：左侧 L4（只读参考）+ 右侧 L5（月度规划编辑）
 */

import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { toast } from "sonner";
import { ArrowLeft, Plus, Download, Pencil, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useL4Nodes,
  useL5Nodes,
  useCreateL5,
  useUpdateL5,
  useDeleteL5,
  importL4AsDraft,
  getCurrentMonthCode,
  getRecentMonthCodes,
  type L4Node,
  type L5Node,
  type CreateL5Payload,
} from "@/hooks/use-l5-planning";
import { PLAN_PRIORITY_OPTIONS, PLAN_CATEGORY_OPTIONS } from "@/types/plan-node";
import type { PlanPriority, PlanCategory } from "@/types/plan-node";

// ── 优先级颜色 ────────────────────────────────────────────────────────────────
const PRIORITY_COLOR: Record<string, string> = {
  P1: "bg-red-100 text-red-700",
  P2: "bg-yellow-100 text-yellow-700",
  P3: "bg-green-100 text-green-700",
};

const STATUS_COLOR: Record<string, string> = {
  PLANNED: "bg-slate-100 text-slate-600",
  IN_PROGRESS: "bg-blue-100 text-blue-700",
  DONE: "bg-emerald-100 text-emerald-700",
};

const STATUS_LABEL: Record<string, string> = {
  PLANNED: "计划中",
  IN_PROGRESS: "进行中",
  DONE: "已完成",
};

// ── 空表单初始值 ──────────────────────────────────────────────────────────────
const emptyForm = (): Omit<CreateL5Payload, "level"> => ({
  parentId: 0,
  title: "",
  owner: "",
  priority: "P2",
  targetDate: "",
  monthCode: getCurrentMonthCode(),
  planCategory: undefined,
});

// ── L4 只读卡片 ───────────────────────────────────────────────────────────────
function L4Card({
  node,
  selected,
  onSelect,
  onImport,
}: {
  node: L4Node;
  selected: boolean;
  onSelect: () => void;
  onImport: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      className={cn(
        "rounded-xl border p-3 cursor-pointer transition-all duration-150 group",
        selected
          ? "border-blue-400 bg-blue-50 shadow-sm"
          : "border-border bg-card hover:border-blue-200 hover:bg-blue-50/40"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium leading-snug truncate">{node.title}</p>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            {node.priority && (
              <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium", PRIORITY_COLOR[node.priority])}>
                {node.priority}
              </span>
            )}
            <span className={cn("text-[10px] px-1.5 py-0.5 rounded", STATUS_COLOR[node.planStatus])}>
              {STATUS_LABEL[node.planStatus]}
            </span>
            {node.owner && (
              <span className="text-[10px] text-muted-foreground">@{node.owner}</span>
            )}
          </div>
        </div>
        <button
          onClick={e => { e.stopPropagation(); onImport(); }}
          title="导入为 L5 草稿"
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-blue-100 text-blue-600 shrink-0"
        >
          <Download className="w-3.5 h-3.5" />
        </button>
      </div>
      {/* 进度条 */}
      <div className="mt-2 h-1 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full bg-blue-400 rounded-full transition-all"
          style={{ width: `${node.progress}%` }}
        />
      </div>
    </div>
  );
}

// ── L5 卡片 ───────────────────────────────────────────────────────────────────
function L5Card({
  node,
  onEdit,
  onDelete,
}: {
  node: L5Node;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-3 group hover:shadow-sm transition-all">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium leading-snug">{node.title}</p>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            {node.priority && (
              <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium", PRIORITY_COLOR[node.priority])}>
                {node.priority}
              </span>
            )}
            {node.planCategory && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">
                {node.planCategory}
              </span>
            )}
            {node.monthCode && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                📅 {node.monthCode}
              </span>
            )}
            {node.owner && (
              <span className="text-[10px] text-muted-foreground">@{node.owner}</span>
            )}
            {node.targetDate && (
              <span className="text-[10px] text-muted-foreground">截止 {node.targetDate}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button onClick={onEdit} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button onClick={onDelete} className="p-1 rounded hover:bg-red-50 text-muted-foreground hover:text-red-600">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <div className="mt-2 h-1 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full bg-emerald-400 rounded-full transition-all"
          style={{ width: `${node.progress}%` }}
        />
      </div>
    </div>
  );
}

// ── L5 表单弹窗 ───────────────────────────────────────────────────────────────
function L5FormDialog({
  open,
  title,
  form,
  l4Nodes,
  monthCodes,
  onChange,
  onSave,
  onCancel,
}: {
  open: boolean;
  title: string;
  form: Omit<CreateL5Payload, "level">;
  l4Nodes: L4Node[];
  monthCodes: string[];
  onChange: (f: Omit<CreateL5Payload, "level">) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-background rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
        <h3 className="text-base font-semibold mb-4">{title}</h3>
        <div className="space-y-3">
          {/* 关联 L4 */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">关联 L4 模块 <span className="text-red-500">*</span></label>
            <select
              value={form.parentId || ""}
              onChange={e => onChange({ ...form, parentId: Number(e.target.value) })}
              className="w-full border rounded-lg px-3 py-2 text-sm bg-background"
            >
              <option value="">请选择 L4 模块</option>
              {l4Nodes.map(n => (
                <option key={n.id} value={n.id}>{n.title}</option>
              ))}
            </select>
          </div>
          {/* 月度编码 */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">月度 (monthCode) <span className="text-red-500">*</span></label>
            <select
              value={form.monthCode}
              onChange={e => onChange({ ...form, monthCode: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm bg-background"
            >
              {monthCodes.map(mc => (
                <option key={mc} value={mc}>{mc}</option>
              ))}
            </select>
          </div>
          {/* 标题 */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">工作包标题 <span className="text-red-500">*</span></label>
            <input
              value={form.title}
              onChange={e => onChange({ ...form, title: e.target.value })}
              placeholder="本月要完成的核心工作"
              className="w-full border rounded-lg px-3 py-2 text-sm bg-background"
            />
          </div>
          {/* 负责人 */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">负责人 <span className="text-red-500">*</span></label>
            <input
              value={form.owner}
              onChange={e => onChange({ ...form, owner: e.target.value })}
              placeholder="@姓名"
              className="w-full border rounded-lg px-3 py-2 text-sm bg-background"
            />
          </div>
          {/* 优先级 */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">优先级 <span className="text-red-500">*</span></label>
            <select
              value={form.priority}
              onChange={e => onChange({ ...form, priority: e.target.value as PlanPriority })}
              className="w-full border rounded-lg px-3 py-2 text-sm bg-background"
            >
              {PLAN_PRIORITY_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          {/* 目标日期 */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">目标日期 <span className="text-red-500">*</span></label>
            <input
              type="date"
              value={form.targetDate}
              onChange={e => onChange({ ...form, targetDate: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm bg-background"
            />
          </div>
          {/* 业务维度（可选） */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">业务维度</label>
            <select
              value={form.planCategory || ""}
              onChange={e => onChange({ ...form, planCategory: (e.target.value || undefined) as PlanCategory | undefined })}
              className="w-full border rounded-lg px-3 py-2 text-sm bg-background"
            >
              <option value="">继承父节点</option>
              {PLAN_CATEGORY_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onCancel} className="px-4 py-2 text-sm rounded-lg border hover:bg-muted transition-colors">
            取消
          </button>
          <button onClick={onSave} className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 主页面 ────────────────────────────────────────────────────────────────────
const L5PlanningPage = () => {
  const navigate = useNavigate();
  const monthCodes = useMemo(() => getRecentMonthCodes(12), []);
  const [selectedMonthCode, setSelectedMonthCode] = useState(getCurrentMonthCode());
  const [selectedL4Id, setSelectedL4Id] = useState<number | null>(null);
  const [expandedL4Ids, setExpandedL4Ids] = useState<Set<number>>(new Set());

  // 弹窗状态
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<L5Node | null>(null);
  const [form, setForm] = useState<Omit<CreateL5Payload, "level">>(emptyForm());

  // 数据
  const { data: l4Nodes = [], isLoading: l4Loading } = useL4Nodes();
  const { data: l5Nodes = [], isLoading: l5Loading } = useL5Nodes(selectedMonthCode);
  const createL5 = useCreateL5();
  const updateL5 = useUpdateL5();
  const deleteL5 = useDeleteL5();

  // 按 L4 分组 L5
  const l5ByL4 = useMemo(() => {
    const map = new Map<number, L5Node[]>();
    for (const n of l5Nodes) {
      const arr = map.get(n.parentId) || [];
      arr.push(n);
      map.set(n.parentId, arr);
    }
    return map;
  }, [l5Nodes]);

  // 当前选中 L4 的 L5 列表（右侧主区）
  const displayL5 = selectedL4Id ? (l5ByL4.get(selectedL4Id) || []) : l5Nodes;

  // 打开新建弹窗
  const openAdd = (prefill?: Partial<Omit<CreateL5Payload, "level">>) => {
    setForm({
      ...emptyForm(),
      parentId: selectedL4Id || 0,
      monthCode: selectedMonthCode,
      ...prefill,
    });
    setAddOpen(true);
  };

  // 一键导入 L4 草稿
  const handleImportL4 = (l4: L4Node) => {
    const draft = importL4AsDraft(l4, selectedMonthCode);
    openAdd(draft);
    toast.info(`已导入「${l4.title}」作为草稿，请按月度节奏调整`);
  };

  // 保存新建
  const handleCreate = async () => {
    if (!form.parentId) return toast.error("请选择关联的 L4 模块");
    if (!form.title.trim()) return toast.error("工作包标题不能为空");
    if (!form.owner.trim()) return toast.error("负责人不能为空");
    if (!form.targetDate) return toast.error("目标日期不能为空");
    try {
      await createL5.mutateAsync({ ...form, level: 5 });
      toast.success("L5 工作包创建成功");
      setAddOpen(false);
    } catch (e: any) {
      toast.error(e?.message || "创建失败");
    }
  };

  // 打开编辑弹窗
  const openEdit = (node: L5Node) => {
    setEditTarget(node);
    setForm({
      parentId: node.parentId,
      title: node.title,
      owner: node.owner || "",
      priority: node.priority || "P2",
      targetDate: node.targetDate || "",
      monthCode: node.monthCode || selectedMonthCode,
      planCategory: node.planCategory || undefined,
    });
  };

  // 保存编辑
  const handleUpdate = async () => {
    if (!editTarget) return;
    if (!form.title.trim()) return toast.error("工作包标题不能为空");
    if (!form.owner.trim()) return toast.error("负责人不能为空");
    if (!form.targetDate) return toast.error("目标日期不能为空");
    try {
      await updateL5.mutateAsync({
        id: editTarget.id,
        payload: {
          title: form.title,
          owner: form.owner,
          priority: form.priority,
          targetDate: form.targetDate,
          monthCode: form.monthCode,
          planCategory: form.planCategory,
        },
      });
      toast.success("L5 工作包已更新");
      setEditTarget(null);
    } catch (e: any) {
      toast.error(e?.message || "更新失败");
    }
  };

  // 删除
  const handleDelete = async (node: L5Node) => {
    if (!confirm(`确认删除「${node.title}」？此操作不可撤销。`)) return;
    try {
      await deleteL5.mutateAsync(node.id);
      toast.success("已删除");
    } catch (e: any) {
      const msg: string = e?.message || "";
      if (msg.includes("children") || msg.includes("has child")) {
        toast.error("该工作包下还有执行记录，请先清理 L6 子项");
      } else {
        toast.error(msg || "删除失败");
      }
    }
  };

  const toggleL4Expand = (id: number) => {
    setExpandedL4Ids(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-muted/30">
        <AppSidebar activeLevel={5} onLevelChange={() => {}} />

        <div className="flex-1 flex flex-col min-w-0">
          {/* Top bar */}
          <header className="h-11 flex items-center gap-3 border-b px-3 shrink-0 bg-background">
            <SidebarTrigger className="text-muted-foreground" />
            <div className="w-px h-4 bg-border" />
            <button
              onClick={() => navigate("/planning")}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              规划
            </button>
            <span className="text-xs text-muted-foreground">/</span>
            <span className="text-xs font-medium">L5 月度规划</span>

            {/* 月份切换 */}
            <div className="ml-auto flex items-center gap-2">
              <label className="text-xs text-muted-foreground">月份</label>
              <select
                value={selectedMonthCode}
                onChange={e => setSelectedMonthCode(e.target.value)}
                className="text-xs border rounded-lg px-2 py-1 bg-background"
              >
                {monthCodes.map(mc => (
                  <option key={mc} value={mc}>{mc}</option>
                ))}
              </select>
              <button
                onClick={() => openAdd()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                新建工作包
              </button>
            </div>
          </header>

          {/* 当前上下文提示 */}
          {selectedL4Id && (() => {
            const l4 = l4Nodes.find(n => n.id === selectedL4Id);
            return l4 ? (
              <div className="px-4 py-2 bg-blue-50 border-b text-xs text-blue-700 flex items-center gap-2">
                <span className="font-medium">当前正在拆解：</span>
                <span>{l4.title}</span>
                <button
                  onClick={() => setSelectedL4Id(null)}
                  className="ml-auto text-blue-500 hover:text-blue-700"
                >
                  查看全部
                </button>
              </div>
            ) : null;
          })()}

          {/* 双窗格主体 */}
          <div className="flex-1 flex overflow-hidden">
            {/* ── 左侧：L4 参考区 ── */}
            <div className="w-72 shrink-0 border-r bg-background flex flex-col overflow-hidden">
              <div className="px-3 py-2.5 border-b flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  L4 模块（参考）
                </span>
                <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">只读</span>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {l4Loading && (
                  <p className="text-xs text-muted-foreground text-center py-8">加载中…</p>
                )}
                {!l4Loading && l4Nodes.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-8">暂无 L4 模块</p>
                )}
                {l4Nodes.map(l4 => (
                  <div key={l4.id}>
                    <L4Card
                      node={l4}
                      selected={selectedL4Id === l4.id}
                      onSelect={() => setSelectedL4Id(prev => prev === l4.id ? null : l4.id)}
                      onImport={() => handleImportL4(l4)}
                    />
                    {/* 展示该 L4 下已有的 L5 数量 */}
                    {(l5ByL4.get(l4.id)?.length ?? 0) > 0 && (
                      <button
                        onClick={() => toggleL4Expand(l4.id)}
                        className="flex items-center gap-1 text-[10px] text-muted-foreground ml-2 mt-1 hover:text-foreground"
                      >
                        {expandedL4Ids.has(l4.id) ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        {l5ByL4.get(l4.id)!.length} 个工作包
                      </button>
                    )}
                    {expandedL4Ids.has(l4.id) && (
                      <div className="ml-3 mt-1 space-y-1 border-l-2 border-blue-100 pl-2">
                        {(l5ByL4.get(l4.id) || []).map(l5 => (
                          <div key={l5.id} className="text-[11px] text-muted-foreground py-0.5 truncate">
                            · {l5.title}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* ── 右侧：L5 制定区 ── */}
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="px-4 py-2.5 border-b flex items-center justify-between bg-background">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    L5 工作包
                  </span>
                  <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">
                    {selectedMonthCode}
                  </span>
                  {displayL5.length > 0 && (
                    <span className="text-[10px] text-muted-foreground">{displayL5.length} 项</span>
                  )}
                </div>
                <button
                  onClick={() => openAdd()}
                  className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  新建
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4">
                {l5Loading && (
                  <p className="text-xs text-muted-foreground text-center py-12">加载中…</p>
                )}
                {!l5Loading && displayL5.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <p className="text-sm text-muted-foreground">本月暂无工作包</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      点击左侧 L4 卡片右上角的
                      <Download className="w-3 h-3 inline mx-1" />
                      可一键导入为草稿
                    </p>
                    <button
                      onClick={() => openAdd()}
                      className="mt-4 flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                      新建工作包
                    </button>
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {displayL5.map(node => (
                    <L5Card
                      key={node.id}
                      node={node}
                      onEdit={() => openEdit(node)}
                      onDelete={() => handleDelete(node)}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 新建弹窗 */}
      <L5FormDialog
        open={addOpen}
        title="新建 L5 工作包"
        form={form}
        l4Nodes={l4Nodes}
        monthCodes={monthCodes}
        onChange={setForm}
        onSave={handleCreate}
        onCancel={() => setAddOpen(false)}
      />

      {/* 编辑弹窗 */}
      <L5FormDialog
        open={!!editTarget}
        title="编辑工作包"
        form={form}
        l4Nodes={l4Nodes}
        monthCodes={monthCodes}
        onChange={setForm}
        onSave={handleUpdate}
        onCancel={() => setEditTarget(null)}
      />
    </SidebarProvider>
  );
};

export default L5PlanningPage;

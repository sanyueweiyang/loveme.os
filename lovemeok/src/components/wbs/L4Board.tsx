import { useState, useMemo } from "react";
import { APITreeNode } from "@/types/wbs";
import { useWBSTree, useCreateNode, useUpdateNode, useDeleteNode, CreateNodePayload, useClearAllCache, useTodoNodes, useCreateAssignment, useAssignments } from "@/hooks/use-wbs";
import { cn } from "@/lib/utils";
import {
  Loader2, RefreshCw, ChevronDown, ChevronRight,
  ChevronLeft, Search, X, Sparkles, Plus,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { NodeCard } from "./NodeCard";
import { EmptyState } from "./EmptyState";

const PRIORITY_ORDER: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
const PRIORITY_OPTIONS = ["P0", "P1", "P2", "P3"];

const CATEGORY_TABS = [
  { key: "", label: "全部" },
  { key: "工作", label: "事业", color: "bg-cat-work" },
  { key: "生活", label: "生活", color: "bg-cat-life" },
  { key: "成长", label: "成长", color: "bg-cat-growth" },
];

const PRIORITY_COLORS: Record<string, string> = {
  P0: "bg-destructive text-destructive-foreground",
  P1: "bg-[hsl(var(--status-behind))] text-white",
  P2: "bg-[hsl(var(--status-at-risk))] text-white",
  P3: "bg-muted text-muted-foreground",
};

const STATUS_OPTIONS_WORK = [
  { value: "PLANNED", label: "待开始" },
  { value: "RESEARCHING", label: "调研中" },
  { value: "PLANNING", label: "需求策划中" },
  { value: "DEVELOPING", label: "开发中" },
  { value: "TESTING", label: "测试中" },
  { value: "GRAY_RELEASE", label: "已灰度" },
  { value: "DONE", label: "已上线" },
];

const STATUS_OPTIONS_DEFAULT = [
  { value: "PLANNED", label: "待开始" },
  { value: "IN_PROGRESS", label: "进行中" },
  { value: "DONE", label: "已完成" },
];

function flatAll(nodes: APITreeNode[]): APITreeNode[] {
  const r: APITreeNode[] = [];
  function w(n: APITreeNode) { r.push(n); n.children?.forEach(w); }
  nodes.forEach(w);
  return r;
}

interface L4Form {
  title: string;
  description: string;
  progress: number;
  priority: string;
  owner: string;
  plannedDate: string;
  planStatus: string;
}

const emptyForm = (): L4Form => ({
  title: "",
  description: "",
  progress: 0,
  priority: "P2",
  owner: "",
  plannedDate: "",
  planStatus: "PLANNED",
});

// ── L3 源卡片：仅作为拆解入口，显示「新增月度计划」按钮，禁止编辑删除 ──
const CATEGORY_STRIP: Record<string, string> = {
  "工作": "bg-cat-work",
  "生活": "bg-cat-life",
  "成长": "bg-cat-growth",
};
const LAYER_COLOR: Record<number, string> = { 3: "wbs-l3", 4: "wbs-l4" };

function L3SourceCard({ node, childCount, onAdd }: { node: APITreeNode; childCount: number; onAdd: () => void }) {
  const stripColor = node.planCategory ? (CATEGORY_STRIP[node.planCategory] || "bg-[hsl(var(--wbs-l3))]") : "bg-[hsl(var(--wbs-l3))]";
  return (
    <div className="group/card relative rounded-xl border bg-card border-border/60 hover:border-border shadow-sm transition-all duration-200">
      <div className={cn("absolute left-0 top-2 bottom-2 w-1 rounded-full", stripColor)} />
      <div className="p-2.5 pl-4 pr-3">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-card-foreground leading-snug">
              {node.title}
            </p>
            {(node.owner || node.plannedDate || node.targetDate) && (
              <p className="text-[10px] text-muted-foreground/60 mt-0.5 truncate">
                {node.owner && <span>{node.owner}</span>}
                {(node.plannedDate || node.targetDate) && (
                  <span>{node.owner ? " · " : ""}{node.plannedDate || node.targetDate}</span>
                )}
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <button
              onClick={(e) => { e.stopPropagation(); onAdd(); }}
              className="flex items-center gap-0.5 px-2 py-0.5 rounded-md bg-primary/10 text-primary text-[9px] font-semibold hover:bg-primary/20 transition-colors whitespace-nowrap"
            >
              <Plus className="w-2.5 h-2.5" />
              新增月度计划
            </button>
            {childCount > 0 && (
              <span className="text-[9px] text-muted-foreground/50">已关联 {childCount} 项</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface L4BoardProps {
  onNlpOpen?: () => void;
}

export function L4Board({ onNlpOpen }: L4BoardProps) {
  const { data: tree, isLoading, refetch } = useWBSTree();
  const clearAllCache = useClearAllCache();
  const createMutation = useCreateNode();
  const updateMutation = useUpdateNode();
  const deleteMutation = useDeleteNode();
  // Todo: 左侧待选库 — 从 /api/nodes/todo 获取所有未完成 L3（不受月份限制）
  const { data: todoL3 = [] } = useTodoNodes(3);
  const { toast } = useToast();

  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const MONTHS_12 = Array.from({ length: 12 }, (_, i) => i + 1);

  const isCurrentMonth = selectedYear === now.getFullYear() && selectedMonth === now.getMonth() + 1;
  const goToPrevMonth = () => {
    if (selectedMonth === 1) { setSelectedMonth(12); setSelectedYear(y => y - 1); }
    else setSelectedMonth(m => m - 1);
  };
  const goToNextMonth = () => {
    if (selectedMonth === 12) { setSelectedMonth(1); setSelectedYear(y => y + 1); }
    else setSelectedMonth(m => m + 1);
  };
  const goToCurrentMonth = () => { setSelectedYear(now.getFullYear()); setSelectedMonth(now.getMonth() + 1); };

  const monthCode = `${selectedYear}-${String(selectedMonth).padStart(2, "0")}`;

  const [searchQuery, setSearchQuery] = useState("");
  const [showIncompleteOnly, setShowIncompleteOnly] = useState(false);
  const [activeCategory, setActiveCategory] = useState("");
  const [collapsedPriorities, setCollapsedPriorities] = useState<Set<string>>(new Set());

  // Edit dialog
  const [editingNode, setEditingNode] = useState<APITreeNode | null>(null);
  const [addParentId, setAddParentId] = useState<string | null>(null);
  const [form, setForm] = useState<L4Form>(emptyForm());

  // Delete confirm
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleteTargetTitle, setDeleteTargetTitle] = useState("");

  const allNodes: APITreeNode[] = tree ? (Array.isArray(tree) ? tree : [tree]) : [];
  const flat = flatAll(allNodes);
  // l3Nodes 仅用于拆解时查找父级信息（继承 category/owner/priority）
  const l3Nodes = flat.filter(n => n.level === 3);
  const l4Nodes = flat.filter(n => n.level === 4);

  // Left panel: L3 todo grouped by priority（待办库，不受月份限制）
  const l3ByPriority = useMemo(() => {
    // 优先使用 todo 接口数据，若为空则 fallback 到树数据
    let nodes = todoL3.length > 0 ? todoL3 : l3Nodes;
    if (activeCategory) nodes = nodes.filter(n => n.planCategory === activeCategory);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      nodes = nodes.filter(n => n.title.toLowerCase().includes(q) || n.owner?.toLowerCase().includes(q));
    }
    const map = new Map<string, APITreeNode[]>();
    nodes.forEach(n => {
      const p = n.priority || "P3";
      if (!map.has(p)) map.set(p, []);
      map.get(p)!.push(n);
    });
    return [...map.entries()].sort(([a], [b]) => (PRIORITY_ORDER[a] ?? 9) - (PRIORITY_ORDER[b] ?? 9));
  }, [todoL3, l3Nodes, activeCategory, searchQuery]);

  // Right panel: L4 nodes filtered by selected month
  const filteredL4 = useMemo(() => {
    let result = l4Nodes.filter(n => {
      // 根据 targetDate 或 plannedDate 判断是否属于本月
      const dateStr = n.targetDate || n.plannedDate || "";
      if (!dateStr) return true; // 无日期的始终显示
      return dateStr.slice(0, 7) === monthCode;
    });
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(n => n.title.toLowerCase().includes(q) || n.owner?.toLowerCase().includes(q));
    }
    if (showIncompleteOnly) result = result.filter(n => n.planStatus !== "COMPLETED" && n.planStatus !== "DONE");
    if (activeCategory) result = result.filter(n => n.planCategory === activeCategory);
    return result;
  }, [l4Nodes, monthCode, searchQuery, showIncompleteOnly, activeCategory]);

  const togglePriority = (p: string) => {
    setCollapsedPriorities(prev => { const s = new Set(prev); s.has(p) ? s.delete(p) : s.add(p); return s; });
  };

  // ── Open edit dialog ──
  const openEdit = (node: APITreeNode) => {
    setAddParentId(null);
    setEditingNode(node);
    setForm({
      title: node.title,
      description: node.description || "",
      progress: node.progress ?? 0,
      priority: node.priority || "P2",
      owner: node.owner || "",
      plannedDate: node.plannedDate || node.targetDate || "",
      planStatus: node.planStatus || "PLANNED",
    });
  };

  // ── Open add dialog — 静默继承父级 L3 的 category / owner / priority ──
  const openAdd = (l3Id: string) => {
    setEditingNode(null);
    setAddParentId(l3Id);
    const parent = l3Nodes.find(n => String(n.id) === l3Id);
    setForm({
      ...emptyForm(),
      title: "",           // 清空，让用户填写本月具体计划标题
      description: parent?.description || "",
      owner: parent?.owner || "",
      priority: parent?.priority || "P2",
      plannedDate: parent?.plannedDate || parent?.targetDate || "",
      planStatus: "PLANNED",
    });
    // planCategory 在 handleSave 时通过 addParentId 追溯 L3 自动继承
  };

  const openDelete = (node: APITreeNode) => {
    const hasChildren = flat.some(c => c.level === 5 && String(c.parentId) === String(node.id));
    if (hasChildren) {
      toast({ title: "无法删除", description: "该计划已关联月度行动，请先删除子任务", variant: "destructive" });
      return;
    }
    setDeleteTargetId(String(node.id));
    setDeleteTargetTitle(node.title);
  };

  const handleSave = () => {
    if (!form.title.trim()) { toast({ title: "请填写标题", variant: "destructive" }); return; }
    const payload: Record<string, any> = {
      title: form.title.trim(),
      description: form.description.trim() || undefined,
      progress: form.progress,
      priority: form.priority || undefined,
      owner: form.owner.trim() || undefined,
      planStatus: form.planStatus,
      plannedDate: form.plannedDate.trim() || undefined,
    };

    if (editingNode) {
      updateMutation.mutate({ id: editingNode.id, payload }, {
        onSuccess: () => { toast({ title: "✅ 已保存" }); setEditingNode(null); setForm(emptyForm()); refetch(); },
        onError: (err: any) => toast({ title: "更新失败", description: err.message, variant: "destructive" }),
      });
    } else {
      // 静默继承父级 L3 的 planCategory
      const parentL3 = l3Nodes.find(n => String(n.id) === addParentId);
      const createPayload: CreateNodePayload = {
        ...payload,
        level: 4,
        parentId: addParentId,
        planCategory: parentL3?.planCategory || undefined,
      } as any;
      createMutation.mutate(createPayload, {
        onSuccess: () => { toast({ title: "✅ 月度计划已创建" }); setAddParentId(null); setForm(emptyForm()); refetch(); },
        onError: (err: any) => toast({ title: "创建失败", description: err.message, variant: "destructive" }),
      });
    }
  };

  const handleDelete = () => {
    if (!deleteTargetId) return;
    deleteMutation.mutate(deleteTargetId, {
      onSuccess: () => { toast({ title: "↩ 已删除" }); setDeleteTargetId(null); refetch(); },
      onError: (err: any) => toast({ title: "删除失败", description: err.message, variant: "destructive" }),
    });
  };

  const isDialogOpen = !!addParentId || !!editingNode;
  const isEditMode = !!editingNode;

  // Determine status options based on active category or editing node's category
  const editCategory = editingNode?.planCategory || activeCategory;
  const statusOptions = editCategory === "工作" ? STATUS_OPTIONS_WORK : STATUS_OPTIONS_DEFAULT;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* ═══ SINGLE-ROW HEADER ═══ */}
      <div className="sticky top-0 z-10 bg-background/90 backdrop-blur-md border-b">
        <div className="flex items-center gap-1.5 h-9 px-2">
          <SidebarTrigger className="text-muted-foreground/60 shrink-0" />
          <div className="w-px h-3.5 bg-border/30 shrink-0" />

          {/* Clickable title → month popover */}
          <Popover open={monthPickerOpen} onOpenChange={setMonthPickerOpen}>
            <PopoverTrigger asChild>
              <button className="text-[13px] font-semibold shrink-0 tabular-nums hover:text-primary transition-colors flex items-center gap-0.5">
                {selectedMonth}月计划
                <ChevronDown className="w-3 h-3 text-muted-foreground/50" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-[200px] p-2" align="start">
              <div className="flex items-center justify-between mb-2">
                <button onClick={() => setSelectedYear(y => y - 1)} className="p-0.5 rounded hover:bg-muted/60 text-muted-foreground/60"><ChevronLeft className="w-3.5 h-3.5" /></button>
                <span className="text-xs font-semibold tabular-nums">{selectedYear}</span>
                <button onClick={() => setSelectedYear(y => y + 1)} className="p-0.5 rounded hover:bg-muted/60 text-muted-foreground/60"><ChevronRight className="w-3.5 h-3.5" /></button>
              </div>
              <div className="grid grid-cols-4 gap-1">
                {MONTHS_12.map(m => {
                  const isActive = m === selectedMonth && selectedYear === selectedYear;
                  const isCurrent = selectedYear === now.getFullYear() && m === now.getMonth() + 1;
                  return (
                    <button
                      key={m}
                      onClick={() => { setSelectedMonth(m); setMonthPickerOpen(false); }}
                      className={cn(
                        "h-7 rounded text-xs font-medium transition-all",
                        isActive ? "bg-primary text-primary-foreground" : isCurrent ? "text-primary font-semibold bg-primary/10" : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
                      )}
                    >
                      {m}月
                    </button>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>

          {/* Prev/Next month arrows */}
          <div className="flex items-center gap-0.5 shrink-0">
            <button onClick={goToPrevMonth} className="p-0.5 rounded hover:bg-muted/60 text-muted-foreground/50"><ChevronLeft className="w-3 h-3" /></button>
            <button
              onClick={goToCurrentMonth}
              className={cn(
                "px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors",
                isCurrentMonth ? "text-primary" : "text-muted-foreground/60 hover:text-foreground hover:bg-muted/40"
              )}
            >
              本月
            </button>
            <button onClick={goToNextMonth} className="p-0.5 rounded hover:bg-muted/60 text-muted-foreground/50"><ChevronRight className="w-3 h-3" /></button>
          </div>

          <div className="w-px h-3.5 bg-border/30 shrink-0" />

          {/* Category tabs */}
          {CATEGORY_TABS.map(tab => (
            <button
              key={tab.key} onClick={() => setActiveCategory(tab.key)}
              className={cn(
                "px-2 py-[2px] rounded-full text-[9px] font-medium transition-all flex items-center gap-1 shrink-0",
                activeCategory === tab.key ? "bg-foreground/8 text-foreground" : "text-muted-foreground/50 hover:text-foreground hover:bg-muted/30",
              )}
            >
              {tab.color && <span className={cn("w-1.5 h-1.5 rounded-full", tab.color, activeCategory !== tab.key && "opacity-30")} />}
              {tab.label}
            </button>
          ))}

          <div className="flex-1" />

          {/* Search */}
          <div className="relative w-[130px] shrink-0">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/40 pointer-events-none" />
            <input
              value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="搜索…"
              className="w-full h-[22px] pl-6 pr-5 rounded text-[10px] bg-transparent border border-transparent placeholder:text-muted-foreground/40 hover:bg-muted/30 focus:bg-muted/40 focus:border-border/50 focus:outline-none transition-all"
            />
            {searchQuery && <button onClick={() => setSearchQuery("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground/50"><X className="w-2.5 h-2.5" /></button>}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <Switch checked={showIncompleteOnly} onCheckedChange={setShowIncompleteOnly} className="scale-[0.5] origin-center" />
            <span className="text-[9px] text-muted-foreground/50 select-none">未完成</span>
          </div>

          {onNlpOpen && (
            <button onClick={onNlpOpen} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/10 text-primary text-[10px] font-medium hover:bg-primary/20 transition-colors shrink-0">
              <Sparkles className="w-3 h-3" /> 语音
            </button>
          )}

          {isLoading && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground/40 shrink-0" />}
          <button onClick={() => { clearAllCache(); refetch(); }} className="p-0.5 rounded hover:bg-muted/60 text-muted-foreground/40 hover:text-foreground shrink-0"><RefreshCw className="w-3 h-3" /></button>
        </div>
      </div>

      {/* ═══ DUAL PANE ═══ */}
      <div className="flex-1 flex overflow-hidden">

        {/* Left: L3 成果库 — 拆解入口，仅展示「新增月度计划」按钮，禁止编辑删除 */}
        <div className="w-[280px] shrink-0 border-r bg-muted/10 overflow-y-auto">
          <div className="px-2.5 py-1.5 border-b bg-background/60 sticky top-0 z-10 flex items-center gap-1.5">
            <span className="text-[9px] font-semibold text-muted-foreground/50 uppercase tracking-wider">关键计划库</span>
            <span className="ml-auto text-[9px] text-muted-foreground/40">{l3Nodes.length} 项 L3 成果</span>
          </div>
          <div className="p-1.5 space-y-0.5">
            {l3ByPriority.length === 0 && (
              <EmptyState variant={searchQuery ? "search" : "default"} title="暂无关键计划" className="py-8" />
            )}
            {l3ByPriority.map(([priority, nodes]) => {
              const collapsed = collapsedPriorities.has(priority);
              return (
                <div key={priority}>
                  <button onClick={() => togglePriority(priority)} className="w-full flex items-center gap-1.5 px-1.5 py-1 rounded hover:bg-muted/40 transition-colors">
                    {collapsed ? <ChevronRight className="w-2.5 h-2.5 text-muted-foreground/50" /> : <ChevronDown className="w-2.5 h-2.5 text-muted-foreground/50" />}
                    <span className={cn("px-1 py-0.5 rounded text-[8px] font-bold", PRIORITY_COLORS[priority])}>{priority}</span>
                    <span className="text-[10px] text-muted-foreground/60">{nodes.length}</span>
                  </button>
                  {!collapsed && (
                    <div className="ml-1 space-y-1 mt-0.5">
                      {nodes.map(n => {
                        const childCount = l4Nodes.filter(c => String(c.parentId) === String(n.id)).length;
                        return (
                          <L3SourceCard
                            key={n.id}
                            node={n}
                            childCount={childCount}
                            onAdd={() => openAdd(String(n.id))}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: L4 月度计划看板 — 编辑删除图标强制常驻 */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-2.5 py-1.5 border-b bg-background/60 sticky top-0 z-10 flex items-center gap-1.5">
            <span className="text-[9px] font-semibold text-muted-foreground/50 uppercase tracking-wider">{selectedMonth}月计划</span>
            <span className="ml-auto text-[9px] text-muted-foreground/40">{filteredL4.length} 项</span>
          </div>
          <div className="p-3">
            {filteredL4.length === 0 ? (
              <EmptyState
                variant={searchQuery ? "search" : "no-plan"}
                title={searchQuery ? undefined : "暂无月度计划"}
                description={searchQuery ? undefined : "从左侧关键计划库点击「新增月度计划」"}
                className="py-10"
              />
            ) : (
              <div className="space-y-1.5">
                {filteredL4.map(n => {
                  return (
                    <NodeCard
                      key={n.id}
                      level={4}
                      title={n.title}
                      progress={Math.round(n.progress ?? 0)}
                      priority={n.priority}
                      status={n.planStatus || "PLANNED"}
                      owner={n.owner}
                      deadline={n.plannedDate || n.targetDate}
                      description={n.description}
                      category={n.planCategory}
                      variant="child"
                      textMode
                      alwaysShowActions
                      onClick={() => openEdit(n)}
                      onEdit={() => openEdit(n)}
                      onDelete={() => openDelete(n)}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══ Create / Edit Dialog ═══ */}
      <Dialog open={isDialogOpen} onOpenChange={open => { if (!open) { setAddParentId(null); setEditingNode(null); } }}>
        <DialogContent className="sm:max-w-lg bg-card/95 backdrop-blur-xl border-border/50 shadow-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base">
              {isEditMode ? "编辑月度计划" : (() => {
                const parent = l3Nodes.find(n => String(n.id) === addParentId);
                return parent ? `新增月度计划 · ${parent.title}` : "新增月度计划";
              })()}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 pt-1">
            <div>
              <Label className="text-xs">标题 <span className="text-destructive">*</span></Label>
              <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="月度计划标题…" autoFocus className="mt-1" />
            </div>

            <div>
              <Label className="text-xs">具体内容</Label>
              <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="详细描述…" rows={2} className="mt-1" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">进度: {form.progress}%</Label>
                <Slider value={[form.progress]} onValueChange={([v]) => setForm(f => ({ ...f, progress: v }))} min={0} max={100} step={1} className="mt-2" />
              </div>
              <div>
                <Label className="text-xs">状态</Label>
                <select
                  value={form.planStatus}
                  onChange={e => setForm(f => ({ ...f, planStatus: e.target.value }))}
                  className="w-full mt-1 px-3 py-2 rounded-md text-sm bg-muted/50 border border-input focus:outline-none focus:ring-1 focus:ring-primary/30"
                >
                  {statusOptions.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">优先级</Label>
                <select
                  value={form.priority}
                  onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
                  className="w-full mt-1 px-3 py-2 rounded-md text-sm bg-muted/50 border border-input focus:outline-none focus:ring-1 focus:ring-primary/30"
                >
                  {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-xs">负责人</Label>
                <Input value={form.owner} onChange={e => setForm(f => ({ ...f, owner: e.target.value }))} placeholder="如：张三" className="mt-1" />
              </div>
            </div>

            <div>
              <Label className="text-xs">计划完成时间</Label>
              <Input value={form.plannedDate} onChange={e => setForm(f => ({ ...f, plannedDate: e.target.value }))} placeholder="如：Q2完成、6月底上线" className="mt-1" />
            </div>
          </div>

          <DialogFooter className="pt-3">
            <button
              onClick={handleSave}
              disabled={isEditMode ? updateMutation.isPending : createMutation.isPending}
              className="w-full py-2.5 rounded-lg text-sm font-semibold bg-primary text-primary-foreground disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {(isEditMode ? updateMutation.isPending : createMutation.isPending) && <Loader2 className="w-4 h-4 animate-spin" />}
              保存
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ Delete Confirm ═══ */}
      <AlertDialog open={!!deleteTargetId} onOpenChange={open => !open && setDeleteTargetId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除月度计划？</AlertDialogTitle>
            <AlertDialogDescription>将删除「{deleteTargetTitle}」，此操作不可撤销。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleteMutation.isPending} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "确认删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

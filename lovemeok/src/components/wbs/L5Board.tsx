import { useState, useMemo } from "react";
import { APITreeNode } from "@/types/wbs";
import { useWBSTree, useCreateNode, useDeleteNode, useUpdateNode, CreateNodePayload, useClearAllCache, useTodoNodes, useCreateAssignment, useAssignments } from "@/hooks/use-wbs";
import { cn } from "@/lib/utils";
import {
  Loader2, RefreshCw, ChevronDown, ChevronRight,
  ChevronLeft, Search, X, Sparkles,
} from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { NodeCard } from "./NodeCard";
import { EmptyState } from "./EmptyState";

// Status options (mirrors L4/L6)
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
const PRIORITY_OPTIONS = ["P0", "P1", "P2", "P3"];

const PRIORITY_ORDER: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
const MONTHS_12 = Array.from({ length: 12 }, (_, i) => i + 1);

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

function flatAll(nodes: APITreeNode[]): APITreeNode[] {
  const r: APITreeNode[] = [];
  function w(n: APITreeNode) { r.push(n); n.children?.forEach(w); }
  nodes.forEach(w);
  return r;
}

interface L5BoardProps {
  onNlpOpen?: () => void;
}

export function L5Board({ onNlpOpen }: L5BoardProps) {
  const { data: tree, isLoading, refetch } = useWBSTree();
  const clearAllCache = useClearAllCache();
  // Todo: 左侧待选库 — 始终从 /api/nodes/todo 获取所有未完成 L4（不受月份过滤）
  const { data: todoL4 = [], isLoading: todoLoading } = useTodoNodes(4);
  const updateMutation = useUpdateNode();
  const deleteMutation = useDeleteNode();
  const assignMutation = useCreateAssignment();
  const { toast } = useToast();

  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [showIncompleteOnly, setShowIncompleteOnly] = useState(false);
  const [activeCategory, setActiveCategory] = useState("");
  const [collapsedPriorities, setCollapsedPriorities] = useState<Set<string>>(new Set());

  // Edit dialog state
  const [editingNode, setEditingNode] = useState<APITreeNode | null>(null);
  const [editForm, setEditForm] = useState({ title: "", description: "", progress: 0, priority: "P2", owner: "", plannedDate: "", planStatus: "PLANNED" });

  // Regret (delete) confirmation for right pane
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleteTargetTitle, setDeleteTargetTitle] = useState("");

  const monthCode = `${selectedYear}-${String(selectedMonth).padStart(2, "0")}`;
  const allNodes: APITreeNode[] = tree ? (Array.isArray(tree) ? tree : [tree]) : [];
  const flat = flatAll(allNodes);
  const l5Nodes = flat.filter(n => n.level === 5);

  // 查询本月已有的 assignment 记录，用于"已领取"标签
  const { data: assignments = [] } = useAssignments(monthCode);
  const claimedL4Ids = useMemo(() => {
    const ids = new Set<string>();
    // 从 assignments 记录中获取本月已领取的 node_id
    assignments.forEach((a: any) => ids.add(String(a.node_id)));
    // 兼容旧逻辑：从 l5Nodes 的 parentId 中也提取
    l5Nodes.forEach(n => {
      const mc = n.targetDate ? String(n.targetDate).slice(0, 7) : "";
      if (mc === monthCode && n.parentId) ids.add(String(n.parentId));
    });
    return ids;
  }, [assignments, l5Nodes, monthCode]);

  // ── Claim dialog state (Assignment Dialog) ─────────────────────────────────
  const [claimTarget, setClaimTarget] = useState<APITreeNode | null>(null);
  const [claimForm, setClaimForm] = useState({ plannedIncrement: 0, note: "" });

  // Left panel: L4 todo grouped by priority (不受月份限制，只要未完成就显示)
  const l4ByPriority = useMemo(() => {
    let nodes = todoL4;
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
  }, [todoL4, activeCategory, searchQuery]);

  // Right panel: claimed L5 tasks for this month (read-only)
  const filteredL5 = useMemo(() => {
    let result = l5Nodes.filter(n => {
      const mc = n.targetDate ? String(n.targetDate).slice(0, 7) : "";
      return mc === monthCode;
    });
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(n => n.title.toLowerCase().includes(q) || n.owner?.toLowerCase().includes(q));
    }
    if (showIncompleteOnly) result = result.filter(n => n.planStatus !== "COMPLETED" && n.planStatus !== "DONE");
    if (activeCategory) result = result.filter(n => n.planCategory === activeCategory);
    return result;
  }, [l5Nodes, monthCode, searchQuery, showIncompleteOnly, activeCategory]);

  // Build L6 aggregated progress per L5 parent (for dual-progress display)
  const l6Nodes = flat.filter(n => n.level === 6);
  const l5SubProgressMap = useMemo(() => {
    const map = new Map<string, number>();
    filteredL5.forEach(l5 => {
      const children = l6Nodes.filter(c => String(c.parentId) === String(l5.id));
      if (children.length > 0) {
        const avg = Math.round(children.reduce((sum, c) => sum + (c.progress ?? 0), 0) / children.length);
        map.set(String(l5.id), avg);
      }
    });
    return map;
  }, [filteredL5, l6Nodes]);

  const togglePriority = (p: string) => {
    setCollapsedPriorities(prev => { const s = new Set(prev); s.has(p) ? s.delete(p) : s.add(p); return s; });
  };

  // ── Open claim dialog (Assignment Dialog) ─────────────────────────────────
  const openClaimDialog = (l4: APITreeNode) => {
    setClaimTarget(l4);
    setClaimForm({ plannedIncrement: 0, note: "" });
  };

  // ── Confirm Claim — POST /api/assignments，携带 planned_increment + month_code ──
  const handleClaim = () => {
    if (!claimTarget) return;
    assignMutation.mutate(
      {
        node_id: claimTarget.id,
        month_code: monthCode,
        planned_increment: claimForm.plannedIncrement,
        note: claimForm.note.trim() || undefined,
      } as any,
      {
        onSuccess: () => {
          toast({ title: `✅ 已领取到 ${selectedMonth}月清单` });
          setClaimTarget(null);
          refetch();
        },
        onError: (err: any) => {
          toast({ title: "领取失败", description: err.message, variant: "destructive" });
        },
      }
    );
  };

  // ── Regret delete (right pane) ──────────────────────────────────────────────
  const openDeleteConfirm = (n: APITreeNode) => {
    const hasChildren = flat.some(c => c.level === 6 && String(c.parentId) === String(n.id));
    if (hasChildren) {
      toast({ title: "无法撤回", description: "该清单已关联本周行动，请先删除子任务", variant: "destructive" });
      return;
    }
    setDeleteTargetId(String(n.id));
    setDeleteTargetTitle(n.title);
  };

  const handleDelete = () => {
    if (!deleteTargetId) return;
    deleteMutation.mutate(deleteTargetId, {
      onSuccess: () => { toast({ title: "↩ 已撤回领取" }); setDeleteTargetId(null); refetch(); },
      onError: (err: any) => { toast({ title: "删除失败", description: err.message, variant: "destructive" }); },
    });
  };

  // ── Edit L5 node ────────────────────────────────────────────────────────────
  const openEdit = (n: APITreeNode) => {
    setEditingNode(n);
    setEditForm({
      title: n.title,
      description: n.description || "",
      progress: n.progress ?? 0,
      priority: n.priority || "P2",
      owner: n.owner || "",
      plannedDate: n.plannedDate || n.targetDate || "",
      planStatus: n.planStatus || "PLANNED",
    });
  };

  const handleEdit = () => {
    if (!editingNode) return;
    if (!editForm.title.trim()) { toast({ title: "请填写标题", variant: "destructive" }); return; }
    const payload: Partial<CreateNodePayload> = {
      title: editForm.title.trim(),
      description: editForm.description.trim() || undefined,
      progress: editForm.progress,
      priority: editForm.priority || undefined,
      owner: editForm.owner.trim() || undefined,
      plannedDate: editForm.plannedDate.trim() || undefined,
      planStatus: editForm.planStatus,
    };
    updateMutation.mutate({ id: editingNode.id, payload }, {
      onSuccess: () => { toast({ title: "✅ 已保存" }); setEditingNode(null); refetch(); },
      onError: (err: any) => { toast({ title: "更新失败", description: err.message, variant: "destructive" }); },
    });
  };

  const editCategory = editingNode?.planCategory || activeCategory;
  const statusOptions = editCategory === "工作" ? STATUS_OPTIONS_WORK : STATUS_OPTIONS_DEFAULT;

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
                {selectedMonth}月清单
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
                  const isActive = m === selectedMonth;
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

          {/* Category tabs inline */}
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

        {/* Left: L4 月度计划库 */}
        <div className="w-[268px] shrink-0 border-r bg-muted/10 overflow-y-auto">
          <div className="px-2.5 py-1.5 border-b bg-background/60 sticky top-0 z-10 flex items-center gap-1.5">
            <span className="text-[9px] font-semibold text-muted-foreground/50 uppercase tracking-wider">月度计划库</span>
            <span className="ml-auto text-[9px] text-muted-foreground/40">点击「领取」加入{selectedMonth}月</span>
          </div>
          <div className="p-1.5 space-y-0.5">
            {l4ByPriority.length === 0 && (
              <EmptyState variant={searchQuery ? "search" : "default"} title="暂无月度计划" className="py-8" />
            )}
            {l4ByPriority.map(([priority, nodes]) => {
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
                        const alreadyClaimed = claimedL4Ids.has(String(n.id));
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
                            claimLabel={alreadyClaimed ? "已领取 ＋" : "领取"}
                            onAdd={() => openClaimDialog(n)}
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

        {/* Right: claimed L5 this month — edit + regret-delete */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-2.5 py-1.5 border-b bg-background/60 sticky top-0 z-10 flex items-center gap-1.5">
            <span className="text-[9px] font-semibold text-muted-foreground/50 uppercase tracking-wider">{selectedMonth}月聚焦</span>
            <span className="ml-auto text-[9px] text-muted-foreground/40">{filteredL5.length} 项</span>
          </div>
          <div className="p-3">
            {filteredL5.length === 0 ? (
              <EmptyState
                variant={searchQuery ? "search" : "no-plan"}
                title={searchQuery ? undefined : "本月暂无计划"}
                description={searchQuery ? undefined : "从左侧月度计划库领取任务"}
                className="py-10"
              />
            ) : (
              <div className="space-y-1.5">
                {filteredL5.map(n => {
                  const hasChildren = flat.some(c => c.level === 6 && String(c.parentId) === String(n.id));
                  const subProgress = l5SubProgressMap.get(String(n.id)) ?? null;
                  return (
                    <NodeCard
                      key={n.id}
                      level={5}
                      title={n.title}
                      progress={Math.round(n.progress ?? 0)}
                      subProgress={subProgress}
                      priority={n.priority}
                      status={n.planStatus || "PLANNED"}
                      owner={n.owner}
                      deadline={n.plannedDate || n.targetDate}
                      description={n.description}
                      category={n.planCategory}
                      variant="child"
                      textMode
                      onClick={() => openEdit(n)}
                      onEdit={() => openEdit(n)}
                      onDelete={hasChildren ? undefined : () => openDeleteConfirm(n)}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══ Edit L5 Dialog ═══ */}
      <Dialog open={!!editingNode} onOpenChange={open => { if (!open) setEditingNode(null); }}>
        <DialogContent className="sm:max-w-lg bg-card/95 backdrop-blur-xl border-border/50 shadow-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base">编辑 · 本月行动</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            <div>
              <Label className="text-xs">标题 <span className="text-destructive">*</span></Label>
              <Input value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} placeholder="月度行动标题…" autoFocus className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">具体内容</Label>
              <Textarea value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} placeholder="详细描述…" rows={2} className="mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">进度: {editForm.progress}%</Label>
                <Slider value={[editForm.progress]} onValueChange={([v]) => setEditForm(f => ({ ...f, progress: v }))} min={0} max={100} step={1} className="mt-2" />
              </div>
              <div>
                <Label className="text-xs">状态</Label>
                <select value={editForm.planStatus} onChange={e => setEditForm(f => ({ ...f, planStatus: e.target.value }))} className="w-full mt-1 px-3 py-2 rounded-md text-sm bg-muted/50 border border-input focus:outline-none focus:ring-1 focus:ring-primary/30">
                  {statusOptions.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">优先级</Label>
                <select value={editForm.priority} onChange={e => setEditForm(f => ({ ...f, priority: e.target.value }))} className="w-full mt-1 px-3 py-2 rounded-md text-sm bg-muted/50 border border-input focus:outline-none focus:ring-1 focus:ring-primary/30">
                  {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-xs">负责人</Label>
                <Input value={editForm.owner} onChange={e => setEditForm(f => ({ ...f, owner: e.target.value }))} placeholder="如：张三" className="mt-1" />
              </div>
            </div>
            <div>
              <Label className="text-xs">计划完成时间</Label>
              <Input value={editForm.plannedDate} onChange={e => setEditForm(f => ({ ...f, plannedDate: e.target.value }))} placeholder="如：月底前、3月26日" className="mt-1" />
            </div>
          </div>
          <DialogFooter className="pt-3">
            <button onClick={handleEdit} disabled={updateMutation.isPending} className="w-full py-2.5 rounded-lg text-sm font-semibold bg-primary text-primary-foreground disabled:opacity-40 flex items-center justify-center gap-2">
              {updateMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              保存
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ Regret delete confirm ═══ */}
      <AlertDialog open={!!deleteTargetId} onOpenChange={open => !open && setDeleteTargetId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>撤回领取？</AlertDialogTitle>
            <AlertDialogDescription>
              将从{selectedMonth}月清单中移除「{deleteTargetTitle}」，可随时重新领取。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleteMutation.isPending} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "确认撤回"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ═══ Assignment Dialog — 领取弹窗（任务分身）═══ */}
      <Dialog open={!!claimTarget} onOpenChange={open => { if (!open) setClaimTarget(null); }}>
        <DialogContent className="sm:max-w-md bg-card/95 backdrop-blur-xl border-border/50 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-base">领取到 {selectedMonth} 月清单</DialogTitle>
          </DialogHeader>
          {claimTarget && (
            <div className="space-y-4 pt-1">
              {/* 任务本体信息 */}
              <div className="rounded-lg bg-muted/40 border border-border/40 p-3 space-y-1">
                <p className="text-xs font-semibold text-foreground/80 truncate">{claimTarget.title}</p>
                {claimTarget.owner && (
                  <p className="text-[11px] text-muted-foreground">负责人：{claimTarget.owner}</p>
                )}
                {/* total_progress — 全局总进度（本体进度） */}
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] text-muted-foreground/60 shrink-0">全局总进度</span>
                  <div className="flex-1 h-1.5 rounded-full bg-muted/60 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[hsl(var(--wbs-l4))] transition-all"
                      style={{ width: `${Math.round(claimTarget.progress ?? 0)}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-semibold tabular-nums text-muted-foreground w-7 text-right">
                    {Math.round(claimTarget.progress ?? 0)}%
                  </span>
                </div>
              </div>

              {/* planned_increment — 本月计划增量 */}
              <div>
                <Label className="text-xs">
                  本月计划增量
                  <span className="ml-1.5 text-[10px] font-normal text-muted-foreground/60">
                    (planned_increment：本月预计完成多少%)
                  </span>
                </Label>
                <div className="flex items-center gap-3 mt-2">
                  <Slider
                    value={[claimForm.plannedIncrement]}
                    onValueChange={([v]) => setClaimForm(f => ({ ...f, plannedIncrement: v }))}
                    min={0} max={100} step={5}
                    className="flex-1"
                  />
                  <span className="text-sm font-semibold tabular-nums text-primary w-10 text-right">
                    {claimForm.plannedIncrement}%
                  </span>
                </div>
              </div>

              {/* 备注 */}
              <div>
                <Label className="text-xs">本月重点（可选）</Label>
                <Textarea
                  value={claimForm.note}
                  onChange={e => setClaimForm(f => ({ ...f, note: e.target.value }))}
                  placeholder="本月该任务的具体目标或关键里程碑…"
                  rows={2}
                  className="mt-1"
                />
              </div>
            </div>
          )}
          <DialogFooter className="pt-3">
            <button
              onClick={handleClaim}
              disabled={assignMutation.isPending}
              className="w-full py-2.5 rounded-lg text-sm font-semibold bg-primary text-primary-foreground disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {assignMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              确认领取
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

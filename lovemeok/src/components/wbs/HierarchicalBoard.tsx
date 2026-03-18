/**
 * HierarchicalBoard — L1 / L2 / L3
 *
 * L1  → 单栏看板，顶部「新增年度目标」按钮，卡片右上角编辑/删除
 * L2  → 双栏：左侧 L1 卡片（含「新增关键成果」按钮）+ 右侧 L2 看板（编辑/删除）
 * L3  → 双栏：左侧 L2 卡片（含「新增关键计划」按钮）+ 右侧 L3 看板（编辑/删除）
 */

import { useState, useCallback, useMemo } from "react";
import { WBS_LAYERS, APITreeNode } from "@/types/wbs";
import { useWBSTree, useCreateNode, useUpdateNode, useDeleteNode, CreateNodePayload, useClearAllCache } from "@/hooks/use-wbs";
import { cn } from "@/lib/utils";
import {
  Plus, ChevronLeft, ChevronRight, Loader2, RefreshCw, Sparkles, Search, X,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "./EmptyState";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { NodeCard } from "./NodeCard";

// ── Constants ──────────────────────────────────────────────────────────────────

const PLAN_CATEGORIES = ["工作", "生活", "成长"] as const;
const PRIORITIES = ["P0", "P1", "P2", "P3"] as const;

const CATEGORY_TABS = [
  { key: "", label: "全部" },
  { key: "工作", label: "事业", color: "bg-cat-work" },
  { key: "生活", label: "生活", color: "bg-cat-life" },
  { key: "成长", label: "成长", color: "bg-cat-growth" },
];

const ADD_LABEL: Record<number, string> = {
  1: "新增年度目标",
  2: "新增关键成果",
  3: "新增关键计划",
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function getNodesAtLevel(tree: APITreeNode[], level: number): APITreeNode[] {
  const result: APITreeNode[] = [];
  function walk(n: APITreeNode) {
    if (n.level === level) { result.push(n); return; }
    if (n.children) n.children.forEach(walk);
  }
  tree.forEach(walk);
  return result;
}

function deriveStatus(n: APITreeNode) {
  return n.planStatus || (n.progress >= 100 ? "COMPLETED" : n.progress > 0 ? "IN_PROGRESS" : "PLANNED");
}

// ── Form fields ────────────────────────────────────────────────────────────────

const EMPTY_FORM: CreateNodePayload = {
  level: 1, title: "", planCategory: "", priority: "", owner: "",
  targetDate: "", progress: 0, planStatus: "PLANNED", dataFeedback: "",
};

function getPlaceholder(level: number): string {
  const map: Record<number, string> = {
    1: "例：2026 健康生活计划",
    2: "例：Q1 体能提升",
    3: "例：运动习惯养成",
  };
  return map[level] || "输入标题…";
}

interface FormProps {
  level: number;
  form: CreateNodePayload;
  setForm: React.Dispatch<React.SetStateAction<CreateNodePayload>>;
}

function LevelFormFields({ level, form, setForm }: FormProps) {
  return (
    <div className="space-y-4">
      {/* Title */}
      <div>
        <Label className="text-xs">标题 <span className="text-destructive">*</span></Label>
        <Input
          value={form.title}
          onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))}
          placeholder={getPlaceholder(level)}
          className="mt-1"
          autoFocus
        />
      </div>

      {/* Category — only for L1 or when not inherited */}
      {level === 1 && (
        <div>
          <Label className="text-xs">维度 <span className="text-destructive">*</span></Label>
          <Select value={form.planCategory || ""} onValueChange={(v) => setForm(f => ({ ...f, planCategory: v }))}>
            <SelectTrigger className="mt-1"><SelectValue placeholder="选择维度" /></SelectTrigger>
            <SelectContent>{PLAN_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      )}

      {/* Description */}
      <div>
        <Label className="text-xs">内容</Label>
        <Input
          value={form.description || ""}
          onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
          placeholder="可选，简要描述…"
          className="mt-1"
        />
      </div>

      {/* plannedDate — free text */}
      <div>
        <Label className="text-xs">计划时间</Label>
        <Input
          value={form.plannedDate || form.targetDate || ""}
          onChange={(e) => setForm(f => ({ ...f, plannedDate: e.target.value, targetDate: e.target.value }))}
          placeholder="例：2026年内 / Q2 / 3月前"
          className="mt-1"
        />
      </div>

      {/* Priority */}
      <div>
        <Label className="text-xs">优先级</Label>
        <Select value={form.priority || ""} onValueChange={(v) => setForm(f => ({ ...f, priority: v }))}>
          <SelectTrigger className="mt-1"><SelectValue placeholder="选择优先级" /></SelectTrigger>
          <SelectContent>{PRIORITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {/* Owner */}
      {level >= 2 && (
        <div>
          <Label className="text-xs">负责人</Label>
          <Input
            value={form.owner || ""}
            onChange={(e) => setForm(f => ({ ...f, owner: e.target.value }))}
            placeholder="输入负责人"
            className="mt-1"
          />
        </div>
      )}

      {/* Progress — only on edit */}
      {(form.progress ?? 0) > 0 && (
        <div>
          <Label className="text-xs">进度: {form.progress ?? 0}%</Label>
          <Slider
            value={[form.progress ?? 0]}
            onValueChange={([v]) => setForm(f => ({ ...f, progress: v }))}
            min={0} max={100} step={1} className="mt-2"
          />
        </div>
      )}
    </div>
  );
}

// ── Left-panel source card (read-only + add button) ────────────────────────────

interface SourceCardProps {
  node: APITreeNode;
  addLabel: string;
  onAdd: (parentNode: APITreeNode) => void;
  isSelected?: boolean;
  onSelect?: (node: APITreeNode) => void;
}

function SourceCard({ node, addLabel, onAdd, isSelected, onSelect }: SourceCardProps) {
  return (
    <div
      onClick={() => onSelect?.(node)}
      className={cn(
        "group/src relative rounded-xl border transition-all duration-200 cursor-pointer",
        "bg-white dark:bg-[hsl(var(--card))] shadow-[0_1px_6px_rgba(0,0,0,0.08)]",
        isSelected
          ? "border-primary/60 ring-1 ring-primary/30 shadow-[0_4px_16px_rgba(0,0,0,0.12)]"
          : "border-slate-200 dark:border-border hover:border-slate-300 hover:shadow-[0_4px_16px_rgba(0,0,0,0.10)]",
      )}
    >
      {/* category strip */}
      <div className={cn(
        "absolute left-0 top-2 bottom-2 w-1 rounded-full",
        node.planCategory === "工作" ? "bg-cat-work" :
        node.planCategory === "生活" ? "bg-cat-life" :
        node.planCategory === "成长" ? "bg-cat-growth" : "bg-muted-foreground/30",
      )} />

      <div className="p-3 pl-5 pr-3">
        {/* Title row */}
        <div className="flex items-start gap-2">
          <span className={cn(
            "w-2 h-2 rounded-full shrink-0 mt-0.5",
            node.progress >= 100 ? "bg-[hsl(var(--status-on-track))]" :
            node.progress > 0 ? "bg-[hsl(var(--wbs-l5))]" : "bg-muted-foreground/50",
          )} />
          <p className="flex-1 text-sm font-semibold text-card-foreground leading-snug line-clamp-2">
            {node.title}
          </p>
        </div>

        {/* Meta */}
        {(node.owner || node.plannedDate || node.targetDate) && (
          <p className="mt-1.5 pl-4 text-[11px] text-muted-foreground/70 line-clamp-1">
            {node.owner && <span>{node.owner}</span>}
            {(node.plannedDate || node.targetDate) && (
              <span className="ml-2">{node.plannedDate || node.targetDate}</span>
            )}
          </p>
        )}

        {/* Progress bar */}
        {(node.progress ?? 0) > 0 && (
          <div className="mt-2 pl-4">
            <div className="h-1 rounded-full bg-muted/60 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[hsl(var(--wbs-l2))] to-[hsl(var(--wbs-l3))] transition-all duration-700"
                style={{ width: `${Math.min(100, node.progress ?? 0)}%` }}
              />
            </div>
          </div>
        )}

        {/* Add button */}
        <button
          onClick={(e) => { e.stopPropagation(); onAdd(node); }}
          className={cn(
            "mt-2.5 w-full flex items-center justify-center gap-1.5",
            "py-1.5 rounded-lg border border-dashed text-[11px] font-semibold",
            "border-primary/40 text-primary bg-primary/5",
            "hover:bg-primary/15 hover:border-primary/60 transition-all duration-200",
          )}
        >
          <Plus className="w-3 h-3" />
          {addLabel}
        </button>
      </div>
    </div>
  );
}

// ── Right-panel node card (edit + delete always visible) ───────────────────────

interface RightCardProps {
  node: APITreeNode;
  onEdit: (n: APITreeNode) => void;
  onDelete: (n: APITreeNode) => void;
}

function RightNodeCard({ node, onEdit, onDelete }: RightCardProps) {
  const status = deriveStatus(node);
  const deadline = node.plannedDate || node.targetDate || null;

  return (
    <NodeCard
      level={node.level}
      title={node.title}
      progress={Math.round(node.progress ?? 0)}
      priority={node.priority}
      status={status}
      owner={node.owner}
      deadline={deadline}
      description={node.description}
      category={node.planCategory}
      textMode
      alwaysShowActions
      onEdit={() => onEdit(node)}
      onDelete={() => onDelete(node)}
    />
  );
}

// ── Main Board ─────────────────────────────────────────────────────────────────

interface HierarchicalBoardProps {
  activeLevel?: number;
  onNlpOpen?: () => void;
}

export function HierarchicalBoard({ activeLevel = 1, onNlpOpen }: HierarchicalBoardProps) {
  const { data: tree, isLoading, refetch } = useWBSTree();
  const clearAllCache = useClearAllCache();
  const createMutation = useCreateNode();
  const updateMutation = useUpdateNode();
  const deleteMutation = useDeleteNode();
  const { toast } = useToast();

  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [filterCategory, setFilterCategory] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showIncompleteOnly, setShowIncompleteOnly] = useState(false);

  // Selected source node (left panel) for L2/L3 — filters right panel
  const [selectedSourceId, setSelectedSourceId] = useState<string | number | null>(null);

  const [addDialog, setAddDialog] = useState<{ parentNode: APITreeNode | null; level: number } | null>(null);
  const [editDialog, setEditDialog] = useState<APITreeNode | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<APITreeNode | null>(null);
  const [form, setForm] = useState<CreateNodePayload>({ ...EMPTY_FORM });

  const allNodes: APITreeNode[] = useMemo(
    () => tree ? (Array.isArray(tree) ? tree : [tree]) : [],
    [tree],
  );

  // ── Derive visible nodes ──

  // For L1: all L1 nodes (year-filtered + category + search)
  // For L2: left = L1 nodes; right = L2 nodes (filtered by selected L1 if any)
  // For L3: left = L2 nodes; right = L3 nodes (filtered by selected L2 if any)

  const sourceLevel = activeLevel - 1; // L2 shows L1 on left, etc.

  const sourceNodes = useMemo(() => {
    if (activeLevel === 1) return [];
    return getNodesAtLevel(allNodes, sourceLevel).filter(n => {
      if (filterCategory && n.planCategory !== filterCategory) return false;
      if (n.targetDate && !String(n.targetDate).startsWith(String(selectedYear))) return false;
      return true;
    });
  }, [allNodes, activeLevel, sourceLevel, filterCategory, selectedYear]);

  const rightNodes = useMemo(() => {
    const base = getNodesAtLevel(allNodes, activeLevel);
    return base.filter(n => {
      // category filter
      if (filterCategory && n.planCategory !== filterCategory) return false;
      // year filter
      const dateStr = n.targetDate || n.plannedDate || "";
      if (dateStr && !String(dateStr).includes(String(selectedYear))) {
        // soft filter — only exclude if there's a clear year mismatch
      }
      // search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        if (!n.title.toLowerCase().includes(q) && !(n.owner && n.owner.toLowerCase().includes(q))) return false;
      }
      // incomplete only
      if (showIncompleteOnly && (n.planStatus === "COMPLETED" || n.planStatus === "DONE")) return false;
      // parent filter (L2/L3 right panel)
      if (activeLevel > 1 && selectedSourceId != null) {
        if (String(n.parentId) !== String(selectedSourceId)) return false;
      }
      return true;
    });
  }, [allNodes, activeLevel, filterCategory, searchQuery, showIncompleteOnly, selectedSourceId, selectedYear]);

  // L1 nodes (single-column)
  const l1Nodes = useMemo(() => {
    if (activeLevel !== 1) return [];
    return getNodesAtLevel(allNodes, 1).filter(n => {
      if (filterCategory && n.planCategory !== filterCategory) return false;
      if (n.targetDate && !String(n.targetDate).startsWith(String(selectedYear))) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        if (!n.title.toLowerCase().includes(q)) return false;
      }
      if (showIncompleteOnly && (n.planStatus === "COMPLETED" || n.planStatus === "DONE")) return false;
      return true;
    });
  }, [allNodes, activeLevel, filterCategory, selectedYear, searchQuery, showIncompleteOnly]);

  // ── Dialog openers ──

  const openAdd = useCallback((parentNode: APITreeNode | null, level: number) => {
    const inherited: Partial<CreateNodePayload> = parentNode ? {
      planCategory: parentNode.planCategory || "",
      owner: parentNode.owner || "",
      priority: parentNode.priority || "",
    } : {};
    setForm({ ...EMPTY_FORM, level, parentId: parentNode?.id ?? null, ...inherited });
    setAddDialog({ parentNode, level });
  }, []);

  const openEdit = useCallback((node: APITreeNode) => {
    setForm({
      level: node.level,
      title: node.title,
      planCategory: node.planCategory || "",
      priority: node.priority || "",
      owner: node.owner || "",
      targetDate: node.targetDate || "",
      plannedDate: node.plannedDate || node.targetDate || "",
      progress: node.progress ?? 0,
      planStatus: node.planStatus || "PLANNED",
      dataFeedback: node.dataFeedback || "",
      description: node.description || "",
      parentId: node.parentId as string,
    });
    setEditDialog(node);
  }, []);

  // ── CRUD handlers ──

  const handleCreate = useCallback(() => {
    if (!form.title.trim()) { toast({ title: "请填写标题", variant: "destructive" }); return; }
    const lv = addDialog?.level ?? activeLevel;
    if (lv === 1 && !form.planCategory) { toast({ title: "请选择维度", variant: "destructive" }); return; }

    const payload: CreateNodePayload = {
      level: lv,
      parentId: addDialog?.parentNode?.id ?? null,
      title: form.title.trim(),
      description: form.description || undefined,
      progress: 0,
      planStatus: "PLANNED",
      planCategory: form.planCategory || undefined,
      owner: form.owner || undefined,
      priority: form.priority || undefined,
      plannedDate: form.plannedDate || form.targetDate || undefined,
      targetDate: form.targetDate || form.plannedDate || undefined,
    };

    createMutation.mutate(payload, {
      onSuccess: () => {
        toast({ title: "✅ 已创建" });
        setAddDialog(null);
        setForm({ ...EMPTY_FORM });
        refetch();
      },
      onError: (err: any) => toast({ title: "创建失败", description: err.message, variant: "destructive" }),
    });
  }, [form, addDialog, activeLevel, createMutation, toast]);

  const handleEdit = useCallback(() => {
    if (!editDialog) return;
    updateMutation.mutate({
      id: editDialog.id,
      payload: {
        title: form.title.trim(),
        description: form.description,
        owner: form.owner,
        priority: form.priority,
        plannedDate: form.plannedDate || form.targetDate,
        targetDate: form.targetDate || form.plannedDate,
        progress: form.progress,
        planStatus: form.planStatus,
        planCategory: form.planCategory,
      },
    }, {
      onSuccess: () => { toast({ title: "✅ 已保存" }); setEditDialog(null); refetch(); },
      onError: (err: any) => toast({ title: "更新失败", description: err.message, variant: "destructive" }),
    });
  }, [form, editDialog, updateMutation, toast, refetch]);

  const handleDelete = useCallback(() => {
    if (!deleteTarget) return;
    deleteMutation.mutate(deleteTarget.id, {
      onSuccess: () => { toast({ title: "↩ 已删除" }); setDeleteTarget(null); refetch(); },
      onError: (err: any) => toast({ title: "删除失败", description: err.message, variant: "destructive" }),
    });
  }, [deleteTarget, deleteMutation, toast]);

  const currentLayerMeta = WBS_LAYERS.find(l => l.level === activeLevel);
  const addLabel = ADD_LABEL[activeLevel] ?? "新增";

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-muted/20">

      {/* ═══ UNIFIED HEADER ═══ */}
      <div className="sticky top-0 z-10 bg-background/90 backdrop-blur-md border-b shrink-0">
        <div className="flex items-center gap-1.5 h-9 px-2">
          <SidebarTrigger className="text-muted-foreground/60 shrink-0" />
          <div className="w-px h-3.5 bg-border/30 shrink-0" />
          <h1 className="text-[13px] font-semibold shrink-0 tabular-nums">{selectedYear}年度</h1>
          <div className="flex items-center gap-0.5 shrink-0">
            <button onClick={() => setSelectedYear(y => y - 1)} className="p-0.5 rounded hover:bg-muted/60 text-muted-foreground/50 hover:text-foreground transition-colors">
              <ChevronLeft className="w-3 h-3" />
            </button>
            <button
              onClick={() => setSelectedYear(now.getFullYear())}
              className={cn("px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors",
                selectedYear === now.getFullYear() ? "text-primary" : "text-muted-foreground/60 hover:text-foreground hover:bg-muted/40"
              )}
            >今年</button>
            <button onClick={() => setSelectedYear(y => y + 1)} className="p-0.5 rounded hover:bg-muted/60 text-muted-foreground/50 hover:text-foreground transition-colors">
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>
          <div className="w-px h-3.5 bg-border/30 shrink-0" />
          {CATEGORY_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setFilterCategory(tab.key)}
              className={cn(
                "px-2 py-[2px] rounded-full text-[9px] font-medium transition-all flex items-center gap-1 shrink-0",
                filterCategory === tab.key ? "bg-foreground/8 text-foreground" : "text-muted-foreground/50 hover:text-foreground hover:bg-muted/30",
              )}
            >
              {tab.color && <span className={cn("w-1.5 h-1.5 rounded-full", tab.color, filterCategory !== tab.key && "opacity-30")} />}
              {tab.label}
            </button>
          ))}
          <div className="flex-1" />
          {/* Search */}
          <div className="relative w-[130px] shrink-0">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/40 pointer-events-none" />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="搜索…"
              className="w-full h-[22px] pl-6 pr-5 rounded text-[10px] bg-transparent border border-transparent placeholder:text-muted-foreground/40 hover:bg-muted/30 focus:bg-muted/40 focus:border-border/50 focus:outline-none transition-all"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground/50">
                <X className="w-2.5 h-2.5" />
              </button>
            )}
          </div>
          {/* Incomplete toggle */}
          <div className="flex items-center gap-1 shrink-0">
            <Switch checked={showIncompleteOnly} onCheckedChange={setShowIncompleteOnly} className="scale-[0.5] origin-center" />
            <span className="text-[9px] text-muted-foreground/50 select-none">未完成</span>
          </div>
          {/* AI button */}
          {onNlpOpen && (
            <button
              onClick={onNlpOpen}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/10 text-primary text-[10px] font-medium hover:bg-primary/20 transition-colors shrink-0"
            >
              <Sparkles className="w-3 h-3" /> 拆解
            </button>
          )}
          {isLoading && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground/40 shrink-0" />}
          <button onClick={() => { clearAllCache(); refetch(); }} className="p-0.5 rounded hover:bg-muted/60 text-muted-foreground/40 hover:text-foreground shrink-0" title="刷新">
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* ═══ CONTENT ═══ */}
      {activeLevel === 1 ? (
        /* ── L1: Single column ── */
        <div className="flex-1 overflow-auto p-4">
          {/* Top add button */}
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-medium text-muted-foreground">年度目标</span>
            <button
              onClick={() => openAdd(null, 1)}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold",
                "bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm",
              )}
            >
              <Plus className="w-3.5 h-3.5" />
              {addLabel}
            </button>
          </div>

          {l1Nodes.length === 0 ? (
            <EmptyState
              variant={searchQuery ? "search" : "default"}
              title={searchQuery ? undefined : "还没有年度目标"}
              actionLabel={searchQuery ? undefined : `+ ${addLabel}`}
              onAction={searchQuery ? undefined : () => openAdd(null, 1)}
            />
          ) : (
            <div className="space-y-2">
              {l1Nodes.map(node => (
                <NodeCard
                  key={node.id}
                  level={1}
                  title={node.title}
                  progress={Math.round(node.progress ?? 0)}
                  priority={node.priority}
                  status={deriveStatus(node)}
                  owner={node.owner}
                  deadline={node.plannedDate || node.targetDate}
                  description={node.description}
                  category={node.planCategory}
                  variant="parent"
                  alwaysShowActions
                  onEdit={() => openEdit(node)}
                  onDelete={() => setDeleteTarget(node)}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        /* ── L2 / L3: Dual column ── */
        <div className="flex-1 overflow-hidden flex">
          {/* LEFT — source panel */}
          <div className="w-72 shrink-0 border-r border-border/40 flex flex-col bg-muted/10 overflow-hidden">
            <div className="p-3 border-b border-border/30">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                {WBS_LAYERS.find(l => l.level === sourceLevel)?.label ?? "上级"} · 来源
              </p>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {sourceNodes.length === 0 ? (
                <p className="text-xs text-muted-foreground/50 text-center py-8">暂无上级节点</p>
              ) : (
                sourceNodes.map(sn => (
                  <SourceCard
                    key={sn.id}
                    node={sn}
                    addLabel={addLabel}
                    isSelected={selectedSourceId != null && String(sn.id) === String(selectedSourceId)}
                    onSelect={(n) => setSelectedSourceId(prev =>
                      prev != null && String(prev) === String(n.id) ? null : n.id
                    )}
                    onAdd={(parentNode) => openAdd(parentNode, activeLevel)}
                  />
                ))
              )}
            </div>
          </div>

          {/* RIGHT — current level board */}
          <div className="flex-1 overflow-y-auto flex flex-col min-w-0">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/30 bg-background/50 shrink-0">
              <div className="flex items-center gap-2">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  {currentLayerMeta?.label ?? "本级"} · 计划
                </p>
                {selectedSourceId != null && (
                  <span className="text-[10px] text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">
                    已筛选
                  </span>
                )}
              </div>
              {selectedSourceId != null && (
                <button
                  onClick={() => setSelectedSourceId(null)}
                  className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-0.5"
                >
                  <X className="w-3 h-3" /> 清除筛选
                </button>
              )}
            </div>

            <div className="flex-1 p-4">
              {rightNodes.length === 0 ? (
                <EmptyState
                  variant={searchQuery ? "search" : "default"}
                  title={searchQuery ? undefined : `还没有${currentLayerMeta?.label}`}
                  actionLabel={undefined}
                  onAction={undefined}
                />
              ) : (
                <div className="space-y-2">
                  {rightNodes.map(node => (
                    <RightNodeCard
                      key={node.id}
                      node={node}
                      onEdit={openEdit}
                      onDelete={setDeleteTarget}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══ Create Dialog ═══ */}
      <Dialog open={!!addDialog} onOpenChange={(open) => !open && setAddDialog(null)}>
        <DialogContent className="sm:max-w-md bg-card/95 backdrop-blur-xl border-border/50 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-base">
              {addLabel}
              {addDialog?.parentNode && (
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  · {addDialog.parentNode.title}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <LevelFormFields level={addDialog?.level ?? activeLevel} form={form} setForm={setForm} />
            <button
              onClick={handleCreate}
              disabled={createMutation.isPending}
              className={cn(
                "w-full py-2.5 rounded-lg text-sm font-semibold transition-all duration-300",
                "bg-primary text-primary-foreground",
                "shadow-[0_4px_16px_-4px_hsl(var(--primary)/0.4)]",
                "disabled:opacity-40 disabled:shadow-none disabled:cursor-not-allowed",
                "flex items-center justify-center gap-2",
              )}
            >
              {createMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              保存
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ═══ Edit Dialog ═══ */}
      <Dialog open={!!editDialog} onOpenChange={(open) => !open && setEditDialog(null)}>
        <DialogContent className="sm:max-w-md bg-card/95 backdrop-blur-xl border-border/50 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-base">
              编辑 · {editDialog ? WBS_LAYERS.find(l => l.level === editDialog.level)?.label : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <LevelFormFields level={editDialog?.level ?? activeLevel} form={form} setForm={setForm} />
            <button
              onClick={handleEdit}
              disabled={updateMutation.isPending}
              className={cn(
                "w-full py-2.5 rounded-lg text-sm font-semibold transition-all duration-300",
                "bg-primary text-primary-foreground",
                "shadow-[0_4px_16px_-4px_hsl(var(--primary)/0.4)]",
                "disabled:opacity-40 disabled:shadow-none disabled:cursor-not-allowed",
                "flex items-center justify-center gap-2",
              )}
            >
              {updateMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              保存
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ═══ Delete Confirm ═══ */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除节点？</AlertDialogTitle>
            <AlertDialogDescription>
              将删除「{deleteTarget?.title}」，此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "确认删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

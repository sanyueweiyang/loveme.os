import { useState, useMemo } from "react";
import { APITreeNode } from "@/types/wbs";
import { useWBSTree, useCreateNode, useUpdateNode, useDeleteNode, CreateNodePayload, useClearAllCache } from "@/hooks/use-wbs";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";
import {
  Loader2, RefreshCw, ChevronLeft, ChevronRight, ChevronDown,
  Search, X, Sparkles, Archive,
} from "lucide-react";
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
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { NodeCard } from "./NodeCard";
import { EmptyState } from "./EmptyState";

// ── Week helpers ──────────────────────────────────────────────────────────────
interface WeekInfo {
  id: string;
  weekNum: number;
  start: Date;
  end: Date;
  label: string;
  crossMonth: boolean;
}

function getMonday(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - ((day + 6) % 7);
  const mon = new Date(d);
  mon.setDate(diff);
  mon.setHours(0, 0, 0, 0);
  return mon;
}

function getISOWeekNumber(d: Date): number {
  const tmp = new Date(d.getTime());
  tmp.setHours(0, 0, 0, 0);
  tmp.setDate(tmp.getDate() + 3 - ((tmp.getDay() + 6) % 7));
  const week1 = new Date(tmp.getFullYear(), 0, 4);
  return 1 + Math.round(((tmp.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
}

function generateWeeks(centerDate: Date, range: number): WeekInfo[] {
  const centerMon = getMonday(centerDate);
  const weeks: WeekInfo[] = [];
  for (let i = -range; i <= range; i++) {
    const start = new Date(centerMon);
    start.setDate(centerMon.getDate() + i * 7);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    const wn = getISOWeekNumber(start);
    const crossMonth = start.getMonth() !== end.getMonth();
    weeks.push({
      id: `${start.getFullYear()}-W${String(wn).padStart(2, "0")}`,
      weekNum: wn,
      start, end,
      label: `${start.getMonth() + 1}.${start.getDate()}–${end.getMonth() + 1}.${end.getDate()}`,
      crossMonth,
    });
  }
  return weeks;
}

const CATEGORY_TABS = [
  { key: "", label: "全部" },
  { key: "工作", label: "事业", color: "bg-cat-work" },
  { key: "生活", label: "生活", color: "bg-cat-life" },
  { key: "成长", label: "成长", color: "bg-cat-growth" },
];

const PRIORITY_OPTIONS = ["P0", "P1", "P2", "P3"];

// Status options per category
const STATUS_OPTIONS_WORK = [
  { value: "PLANNED",      label: "待开始" },
  { value: "RESEARCHING",  label: "调研中" },
  { value: "PLANNING",     label: "需求策划中" },
  { value: "DEVELOPING",   label: "开发中" },
  { value: "TESTING",      label: "测试中" },
  { value: "GRAY_RELEASE", label: "已灰度" },
  { value: "DONE",         label: "已上线" },
];

const STATUS_OPTIONS_DEFAULT = [
  { value: "PLANNED",      label: "待开始" },
  { value: "IN_PROGRESS",  label: "进行中" },
  { value: "DONE",         label: "已完成" },
];

// Terminal statuses — not auto-upgraded to CROSS_WEEK
const TERMINAL_STATUSES = new Set(["DONE", "GRAY_RELEASE"]);

function flatAll(nodes: APITreeNode[]): APITreeNode[] {
  const r: APITreeNode[] = [];
  function w(n: APITreeNode) { r.push(n); n.children?.forEach(w); }
  nodes.forEach(w);
  return r;
}

// Form shape — plannedDate is a free-text string (e.g. "3月26日提测，月内上线")
interface L6Form {
  title: string;
  description: string;
  progress: number;
  priority: string;
  owner: string;
  plannedDate: string;    // free-text, not a Date
  planStatus: string;
  dataFeedback: string;
  issueLog: string;
}

const emptyForm = (): L6Form => ({
  title: "",
  description: "",
  progress: 0,
  priority: "P2",
  owner: "",
  plannedDate: "",
  planStatus: "IN_PROGRESS",
  dataFeedback: "",
  issueLog: "",
});

interface L6BoardProps {
  onNlpOpen?: () => void;
}

export function L6Board({ onNlpOpen }: L6BoardProps) {
  const { data: tree, isLoading, refetch } = useWBSTree();
  const clearAllCache = useClearAllCache();
  const createMutation = useCreateNode();
  const updateMutation = useUpdateNode();
  const deleteMutation = useDeleteNode();
  const { toast } = useToast();

  const now = new Date();
  const weeks = useMemo(() => generateWeeks(now, 26), []);
  const currentWeekId = useMemo(() => {
    const mon = getMonday(now);
    const wn = getISOWeekNumber(mon);
    return `${mon.getFullYear()}-W${String(wn).padStart(2, "0")}`;
  }, []);
  const [selectedWeekId, setSelectedWeekId] = useState(currentWeekId);
  const selectedWeek = weeks.find(w => w.id === selectedWeekId) || weeks.find(w => w.id === currentWeekId)!;
  const [weekPickerOpen, setWeekPickerOpen] = useState(false);

  // Edit dialog state
  const [editingNode, setEditingNode] = useState<APITreeNode | null>(null);
  const [addParentId, setAddParentId] = useState<string | null>(null);
  const [form, setForm] = useState<L6Form>(emptyForm());

  // Delete confirm
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleteTargetTitle, setDeleteTargetTitle] = useState("");

  const [weekReportLoading, setWeekReportLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showIncompleteOnly, setShowIncompleteOnly] = useState(false);
  const [activeCategory, setActiveCategory] = useState("");

  const allNodes: APITreeNode[] = tree ? (Array.isArray(tree) ? tree : [tree]) : [];
  const flat = flatAll(allNodes);
  const l5Nodes = flat.filter(n => n.level === 5);
  const l6Nodes = flat.filter(n => n.level === 6);

  const relevantL5 = useMemo(() => {
    if (!selectedWeek) return l5Nodes;
    // 本周所跨的月份集合（正常周1个月，跨月周2个月）
    const months = new Set<string>();
    months.add(`${selectedWeek.start.getFullYear()}-${String(selectedWeek.start.getMonth() + 1).padStart(2, "0")}`);
    months.add(`${selectedWeek.end.getFullYear()}-${String(selectedWeek.end.getMonth() + 1).padStart(2, "0")}`);
    return l5Nodes.filter(n => {
      if (!n.targetDate) return false; // 没有月份标记的 L5 不展示（避免污染左侧池）
      const mc = String(n.targetDate).slice(0, 7);
      return months.has(mc);
    });
  }, [l5Nodes, selectedWeek]);

  // Track claimed L5 IDs for badge display only — does NOT block re-claiming (分身逻辑)
  const claimedL5Ids = useMemo(() => {
    const ids = new Set<string>();
    l6Nodes.forEach(n => { if (n.parentId) ids.add(String(n.parentId)); });
    return ids;
  }, [l6Nodes]);

  const filteredLeftL5 = useMemo(() => {
    let result = relevantL5;
    if (activeCategory) result = result.filter(n => n.planCategory === activeCategory);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(n => n.title.toLowerCase().includes(q) || n.owner?.toLowerCase().includes(q));
    }
    return result;
  }, [relevantL5, activeCategory, searchQuery]);

  const l6ByParent = useMemo(() => {
    const map = new Map<string, APITreeNode[]>();
    l6Nodes.forEach(n => {
      const pid = String(n.parentId || "orphan");
      if (!map.has(pid)) map.set(pid, []);
      map.get(pid)!.push(n);
    });
    return map;
  }, [l6Nodes]);

  const rightL5WithChildren = useMemo(() => {
    return relevantL5.filter(l5 => {
      const children = l6ByParent.get(String(l5.id)) || [];
      if (children.length === 0) return false;
      if (activeCategory && l5.planCategory !== activeCategory) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const m5 = l5.title.toLowerCase().includes(q);
        const mC = children.some(c => c.title.toLowerCase().includes(q));
        if (!m5 && !mC) return false;
      }
      if (showIncompleteOnly) {
        const allDone = children.every(c => c.planStatus === "COMPLETED" || c.planStatus === "DONE");
        if (allDone) return false;
      }
      return true;
    });
  }, [relevantL5, l6ByParent, activeCategory, searchQuery, showIncompleteOnly]);

  // ── Silent Claim: inherit all fields from L5, record startTime ──────────────
  const handleClaim = (l5: APITreeNode) => {
    const payload: CreateNodePayload & { startTime?: string } = {
      level: 6,
      parentId: String(l5.id),
      title: l5.title,
      // Inherit description, owner, priority, plannedDate from L5
      ...(l5.description && { description: l5.description }),
      owner: l5.owner || undefined,
      priority: l5.priority || "P2",
      plannedDate: l5.targetDate || undefined,
      progress: 0,
      planStatus: "IN_PROGRESS",
      planCategory: l5.planCategory || undefined,
      startTime: new Date().toISOString(),
    };
    createMutation.mutate(payload as CreateNodePayload, {
      onSuccess: () => { toast({ title: `✅ 已领取至本周行动` }); refetch(); },
      onError: (err: any) => toast({ title: "领取失败", description: err.message, variant: "destructive" }),
    });
  };

  // ── Open edit dialog ─────────────────────────────────────────────────────────
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
      planStatus: node.planStatus || "IN_PROGRESS",
      dataFeedback: node.dataFeedback || "",
      issueLog: node.issueLog || "",
    });
  };

  const openAdd = (l5Id: string) => {
    setEditingNode(null);
    setAddParentId(l5Id);
    setForm(emptyForm());
  };

  const openDelete = (node: APITreeNode) => {
    if (node.dataFeedback?.trim()) {
      toast({ title: "无法撤回", description: "已有执行结果记录，请联系归档管理员", variant: "destructive" });
      return;
    }
    setDeleteTargetId(String(node.id));
    setDeleteTargetTitle(node.title);
  };

  // ── Build audit payload ────────────────────────────────────────────────────
  const buildSavePayload = (isCreate: boolean) => {
    const plannedDateStr = form.plannedDate.trim() || undefined;
    // Auto-status: 100% → DONE; <100 and not terminal → IN_PROGRESS_CROSS_WEEK
    const autoStatus =
      form.progress >= 100
        ? "DONE"
        : !TERMINAL_STATUSES.has(form.planStatus) && form.progress > 0
        ? "IN_PROGRESS_CROSS_WEEK"
        : form.planStatus;

    const base: Record<string, any> = {
      title: form.title.trim(),
      description: form.description.trim() || undefined,
      progress: form.progress,
      priority: form.priority || undefined,
      owner: form.owner.trim() || undefined,
      planStatus: autoStatus,
      plannedDate: plannedDateStr,
      dataFeedback: form.dataFeedback.trim() || undefined,
      issueLog: form.issueLog.trim() || undefined,
    };

    // Audit: endTime = plannedDate when progress reaches 100
    if (form.progress >= 100 && plannedDateStr) {
      base.endTime = plannedDateStr;
    }

    if (isCreate) {
      base.level = 6;
      base.parentId = addParentId;
    }

    return base;
  };

  const handleCreate = () => {
    if (!form.title.trim()) { toast({ title: "请填写标题", variant: "destructive" }); return; }
    const payload = buildSavePayload(true) as CreateNodePayload;
    createMutation.mutate(payload, {
      onSuccess: () => {
        toast({ title: "✅ 已记入本周清单" });
        setAddParentId(null);
        setForm(emptyForm());
        refetch();
      },
      onError: (err: any) => toast({ title: "创建失败", description: err.message, variant: "destructive" }),
    });
  };

  const handleEdit = () => {
    if (!editingNode) return;
    if (!form.title.trim()) { toast({ title: "请填写标题", variant: "destructive" }); return; }
    const payload = buildSavePayload(false) as Partial<CreateNodePayload>;
    updateMutation.mutate({ id: editingNode.id, payload }, {
      onSuccess: () => {
        toast({ title: "✅ 存入轨迹" });
        setEditingNode(null);
        setForm(emptyForm());
        refetch();
      },
      onError: (err: any) => toast({ title: "更新失败", description: err.message, variant: "destructive" }),
    });
  };

  const handleDelete = () => {
    if (!deleteTargetId) return;
    deleteMutation.mutate(deleteTargetId, {
      onSuccess: () => {
        toast({ title: "↩ 已撤回" });
        setDeleteTargetId(null);
        refetch();
      },
      onError: (err: any) => toast({ title: "删除失败", description: err.message, variant: "destructive" }),
    });
  };

  const handleWeekReport = async () => {
    setWeekReportLoading(true);
    try {
      await apiFetch("/api/nodes/week-report/lock", {
        method: "POST",
        body: JSON.stringify({ weekId: selectedWeekId }),
      });
      toast({ title: "📋 周报已生成并归档" });
    } catch (err: any) {
      toast({ title: "生成失败", description: err.message, variant: "destructive" });
    } finally {
      setWeekReportLoading(false);
    }
  };

  const weekTitle = selectedWeek ? `第${selectedWeek.weekNum}周清单` : "本周清单";
  const isCurrentWeek = selectedWeekId === currentWeekId;
  const currentIdx = weeks.findIndex(w => w.id === selectedWeekId);
  const goToPrevWeek = () => { if (currentIdx > 0) setSelectedWeekId(weeks[currentIdx - 1].id); };
  const goToNextWeek = () => { if (currentIdx < weeks.length - 1) setSelectedWeekId(weeks[currentIdx + 1].id); };
  const goToCurrentWeek = () => setSelectedWeekId(currentWeekId);

  const nearbyWeeks = useMemo(() => {
    const start = Math.max(0, currentIdx - 8);
    const end = Math.min(weeks.length, currentIdx + 9);
    return weeks.slice(start, end);
  }, [weeks, currentIdx]);

  const isDialogOpen = !!addParentId || !!editingNode;
  const isEditMode = !!editingNode;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* ═══ SINGLE-ROW HEADER ═══ */}
      <div className="sticky top-0 z-10 bg-background/90 backdrop-blur-md border-b">
        <div className="flex items-center gap-1.5 h-9 px-2">
          <SidebarTrigger className="text-muted-foreground/60 shrink-0" />
          <div className="w-px h-3.5 bg-border/30 shrink-0" />

          {/* Clickable title → week popover */}
          <Popover open={weekPickerOpen} onOpenChange={setWeekPickerOpen}>
            <PopoverTrigger asChild>
              <button className="text-[13px] font-semibold shrink-0 tabular-nums hover:text-primary transition-colors flex items-center gap-0.5">
                {weekTitle}
                <ChevronDown className="w-3 h-3 text-muted-foreground/50" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-[220px] p-2 max-h-[280px] overflow-y-auto" align="start">
              <div className="space-y-0.5">
                {nearbyWeeks.map(w => {
                  const isActive = w.id === selectedWeekId;
                  const isCurrent = w.id === currentWeekId;
                  return (
                    <button
                      key={w.id}
                      onClick={() => { setSelectedWeekId(w.id); setWeekPickerOpen(false); }}
                      className={cn(
                        "w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-all",
                        isActive ? "bg-primary text-primary-foreground" : isCurrent ? "bg-primary/10 text-primary font-semibold" : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
                      )}
                    >
                      <span className="font-medium tabular-nums">W{w.weekNum}</span>
                      <span className={cn("text-[10px]", isActive ? "text-primary-foreground/70" : "text-muted-foreground/60")}>{w.label}</span>
                      {isCurrent && !isActive && <span className="ml-auto text-[9px] text-primary">本周</span>}
                    </button>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>

          {/* Prev/Next week arrows */}
          <div className="flex items-center gap-0.5 shrink-0">
            <button onClick={goToPrevWeek} className="p-0.5 rounded hover:bg-muted/60 text-muted-foreground/50"><ChevronLeft className="w-3 h-3" /></button>
            <button
              onClick={goToCurrentWeek}
              className={cn(
                "px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors",
                isCurrentWeek ? "text-primary" : "text-muted-foreground/60 hover:text-foreground hover:bg-muted/40"
              )}
            >
              本周
            </button>
            <button onClick={goToNextWeek} className="p-0.5 rounded hover:bg-muted/60 text-muted-foreground/50"><ChevronRight className="w-3 h-3" /></button>
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
          <div className="relative w-[110px] shrink-0">
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

          {/* 生成周报并归档 */}
          <button
            onClick={handleWeekReport}
            disabled={weekReportLoading}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted/60 text-muted-foreground text-[10px] font-medium hover:bg-muted hover:text-foreground transition-colors shrink-0 disabled:opacity-40"
          >
            {weekReportLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Archive className="w-3 h-3" />}
            <span className="hidden sm:inline">生成周报</span>
          </button>

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

        {/* Left: L5 reference pool (claim to this week) */}
        <div className="w-[260px] shrink-0 border-r bg-muted/10 overflow-y-auto">
          <div className="px-2.5 py-1.5 border-b bg-background/60 sticky top-0 z-10 flex items-center gap-1.5">
            <span className="text-[9px] font-semibold text-muted-foreground/50 uppercase tracking-wider">
              月度清单库
              {selectedWeek?.crossMonth && <span className="ml-1 text-accent font-normal">· 跨月</span>}
            </span>
            <span className="ml-auto text-[9px] text-muted-foreground/40">点击「领取」加入本周</span>
          </div>
          <div className="p-1.5 space-y-1">
            {filteredLeftL5.length === 0 && (
              <EmptyState variant={searchQuery ? "search" : "default"} title="暂无月度任务" className="py-8" />
            )}
            {filteredLeftL5.map(n => {
              const alreadyClaimed = claimedL5Ids.has(String(n.id));
              return (
                <NodeCard
                  key={n.id}
                  level={5}
                  title={n.title}
                  progress={Math.round(n.progress ?? 0)}
                  priority={n.priority}
                  status={n.planStatus || "PLANNED"}
                  owner={n.owner}
                  deadline={n.targetDate}
                  category={n.planCategory}
                  variant="child"
                  claimLabel={alreadyClaimed ? "已领取 ＋" : "领取"}
                  onAdd={() => handleClaim(n)}
                />
              );
            })}
          </div>
        </div>

        {/* Right: Weekly execution (edit/delete always visible on L6 cards) */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-2.5 py-1.5 border-b bg-background/60 sticky top-0 z-10 flex items-center gap-1.5">
            <span className="text-[9px] font-semibold text-muted-foreground/50 uppercase tracking-wider">本周行动</span>
          </div>
          <div className="p-3">
            {rightL5WithChildren.length === 0 ? (
              <EmptyState
                variant={searchQuery ? "search" : "no-plan"}
                title={searchQuery ? undefined : "本周暂无事项"}
                description={searchQuery ? undefined : "从左侧月度清单领取任务"}
                className="py-10"
              />
            ) : (
              <div className="space-y-4">
                {rightL5WithChildren.map(l5 => {
                  const children = l6ByParent.get(String(l5.id)) || [];
                  return (
                    <div key={l5.id} className="space-y-1.5">
                      {/* L5 group header */}
                      <div className="flex items-center gap-2 pb-0.5 border-b border-border/30">
                        <span className="text-[11px] font-semibold truncate">{l5.title}</span>
                        {l5.owner && <span className="text-[9px] text-muted-foreground/60">· {l5.owner}</span>}
                        <button
                          onClick={() => openAdd(String(l5.id))}
                          className="ml-auto text-[9px] text-muted-foreground/50 hover:text-primary transition-colors px-1.5 py-0.5 rounded hover:bg-primary/10"
                        >
                          + 记一笔
                        </button>
                      </div>
                      {/* L6 children — click card to edit, edit/delete icons always visible */}
                      <div className="ml-3 space-y-1.5">
                        {children.map(l6 => (
                          <NodeCard
                            key={l6.id}
                            level={6}
                            title={l6.title}
                            description={l6.description}
                            progress={Math.round(l6.progress ?? 0)}
                            priority={l6.priority}
                            status={l6.planStatus || "IN_PROGRESS"}
                            owner={l6.owner}
                            deadline={l6.plannedDate || l6.targetDate}
                            feedback={l6.dataFeedback}
                            issueLog={l6.issueLog}
                            category={l6.planCategory}
                            variant="child"
                            alwaysShowActions
                            textMode
                            onClick={() => openEdit(l6)}
                            onEdit={() => openEdit(l6)}
                            onDelete={() => openDelete(l6)}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══ Create / Edit L6 Dialog ═══ */}
      <Dialog open={isDialogOpen} onOpenChange={open => { if (!open) { setAddParentId(null); setEditingNode(null); } }}>
        <DialogContent className="sm:max-w-lg bg-card/95 backdrop-blur-xl border-border/50 shadow-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base">记一笔 · 本周清单</DialogTitle>
          </DialogHeader>

          <div className="space-y-3 pt-1">
            {/* 标题 */}
            <div>
              <Label className="text-xs">标题 <span className="text-destructive">*</span></Label>
              <Input
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="本周核心事项…"
                autoFocus
                className="mt-1"
              />
            </div>

            {/* 具体内容 */}
            <div>
              <Label className="text-xs">具体内容</Label>
              <Textarea
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="详细描述本周要做的事…"
                rows={2}
                className="mt-1"
              />
            </div>

            {/* 进度 + 状态 两列 */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">进度: {form.progress}%</Label>
                <Slider
                  value={[form.progress]}
                  onValueChange={([v]) => setForm(f => ({ ...f, progress: v }))}
                  min={0} max={100} step={1}
                  className="mt-2"
                />
              </div>
              <div>
                <Label className="text-xs">状态</Label>
                <select
                  value={form.planStatus}
                  onChange={e => setForm(f => ({ ...f, planStatus: e.target.value }))}
                  className="w-full mt-1 px-3 py-2 rounded-md text-sm bg-muted/50 border border-input focus:outline-none focus:ring-1 focus:ring-primary/30"
                >
                  {(activeCategory === "工作" ? STATUS_OPTIONS_WORK : STATUS_OPTIONS_DEFAULT).map(s => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* 优先级 + 负责人 两列 */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">优先级</Label>
                <select
                  value={form.priority}
                  onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
                  className="w-full mt-1 px-3 py-2 rounded-md text-sm bg-muted/50 border border-input focus:outline-none focus:ring-1 focus:ring-primary/30"
                >
                  {PRIORITY_OPTIONS.map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-xs">负责人</Label>
                <Input
                  value={form.owner}
                  onChange={e => setForm(f => ({ ...f, owner: e.target.value }))}
                  placeholder="如：张三"
                  className="mt-1"
                />
              </div>
            </div>

            {/* 计划完成时间 — free-text; used as endTime when progress=100 */}
            <div>
              <Label className="text-xs">
                计划完成时间
                {form.progress >= 100 && (
                  <span className="ml-1.5 text-[10px] text-primary font-normal">· 进度 100% 时作为审计 endTime</span>
                )}
              </Label>
              <Input
                value={form.plannedDate}
                onChange={e => setForm(f => ({ ...f, plannedDate: e.target.value }))}
                placeholder="如：3月26日提测，月内上线"
                className="mt-1"
              />
            </div>

            {/* 数据（执行结果） */}
            <div>
              <Label className="text-xs">数据 <span className="text-muted-foreground/50">(dataFeedback)</span></Label>
              <Textarea
                value={form.dataFeedback}
                onChange={e => setForm(f => ({ ...f, dataFeedback: e.target.value }))}
                placeholder="记录关键产出与量化数据…"
                rows={2}
                className="mt-1"
              />
            </div>

            {/* 问题（复盘） */}
            <div>
              <Label className="text-xs">问题 <span className="text-muted-foreground/50">(issueLog)</span></Label>
              <Textarea
                value={form.issueLog}
                onChange={e => setForm(f => ({ ...f, issueLog: e.target.value }))}
                placeholder="遇到的阻碍或经验总结…"
                rows={2}
                className="mt-1"
              />
            </div>
          </div>

          <DialogFooter className="pt-3">
            <button
              onClick={isEditMode ? handleEdit : handleCreate}
              disabled={isEditMode ? updateMutation.isPending : createMutation.isPending}
              className="w-full py-2.5 rounded-lg text-sm font-semibold bg-primary text-primary-foreground disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {(isEditMode ? updateMutation.isPending : createMutation.isPending) && (
                <Loader2 className="w-4 h-4 animate-spin" />
              )}
              保存
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ Delete / Regret Confirm ═══ */}
      <AlertDialog open={!!deleteTargetId} onOpenChange={open => !open && setDeleteTargetId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>撤回本周行动？</AlertDialogTitle>
            <AlertDialogDescription>
              将从本周清单中移除「{deleteTargetTitle}」，可随时重新领取。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "确认撤回"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

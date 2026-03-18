/**
 * VerticalTimeline — 单轴 24h 日程时间轴
 *
 * 特性：
 * - 时间轴从 09:00 开始，到次日 08:59 结束（共 24h）
 * - 热力图背景：工作(09-18)淡蓝、生活(18-23)淡橙、睡眠(23-09)淡紫
 * - 鼠标拖拽选择时间跨度，松手弹出选择框
 * - 选择框：A) 从 L6 列表关联  B) 手动输入
 * - 已有日程以绝对定位块渲染，支持完成切换/删除
 */

import { useRef, useState, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import { CheckCircle2, Circle, Trash2, X, Link2, Pencil } from "lucide-react";
import { toast } from "sonner";
import {
  useDailySchedules,
  useCreateSchedule,
  useDeleteSchedule,
  useToggleScheduleDone,
  useL6Nodes,
  type DailyScheduleItem,
} from "@/hooks/use-daily-schedules";

// ── 时间常量 ──────────────────────────────────────────────────────────────────

/** 时间轴起始小时（09:00） */
const START_HOUR = 9;
/** 每格高度 px（代表 1 小时） */
const HOUR_PX = 64;
/** 总格数 24 */
const TOTAL_HOURS = 24;
/** 时间轴总高度 */
const TIMELINE_HEIGHT = HOUR_PX * TOTAL_HOURS;

/** 将"绝对小时"（0-23，以 START_HOUR 为 0）转为 HH:MM 字符串 */
function absHourToTime(absH: number): string {
  const real = ((absH + START_HOUR) % 24);
  return `${String(real).padStart(2, "0")}:00`;
}

/** 将 HH:MM 转为相对于 START_HOUR 的偏移小时（0-23） */
function timeToAbsHour(time: string): number {
  const [h] = time.split(":").map(Number);
  return ((h - START_HOUR + 24) % 24);
}

/** 将 y 坐标（px）转为绝对小时（0-23），精度 0.5h */
function yToAbsHour(y: number): number {
  const raw = y / HOUR_PX;
  return Math.max(0, Math.min(TOTAL_HOURS - 0.5, Math.round(raw * 2) / 2));
}

/** 将绝对小时转为 y 坐标 */
function absHourToY(absH: number): number {
  return absH * HOUR_PX;
}

// ── 热力图区段 ────────────────────────────────────────────────────────────────

interface HeatZone {
  label: string;
  startAbs: number; // 相对 START_HOUR 的偏移
  endAbs: number;
  color: string;    // tailwind bg class
}

const HEAT_ZONES: HeatZone[] = [
  { label: "工作", startAbs: 0,  endAbs: 9,  color: "bg-blue-400/8"   }, // 09-18
  { label: "生活", startAbs: 9,  endAbs: 14, color: "bg-orange-400/8" }, // 18-23
  { label: "睡眠", startAbs: 14, endAbs: 24, color: "bg-violet-400/8" }, // 23-09
];

// ── 优先级颜色 ────────────────────────────────────────────────────────────────

const PRIORITY_BAR: Record<string, string> = {
  P1: "bg-red-400",
  P2: "bg-amber-400",
  P3: "bg-blue-400",
};

// ── 选区弹窗 ──────────────────────────────────────────────────────────────────

interface SelectionPopoverProps {
  startTime: string;
  endTime: string;
  date: string;
  anchorY: number;
  onClose: () => void;
  onCreated: () => void;
}

function SelectionPopover({
  startTime, endTime, date, anchorY, onClose, onCreated,
}: SelectionPopoverProps) {
  const [mode, setMode] = useState<"choose" | "l6" | "manual">("choose");
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [linkedNodeId, setLinkedNodeId] = useState<number | null>(null);
  const createMutation = useCreateSchedule();
  const { data: l6Nodes = [] } = useL6Nodes();

  const handleSave = async () => {
    const finalTitle = mode === "l6"
      ? (l6Nodes.find(n => n.id === linkedNodeId)?.title || "")
      : title.trim();

    if (!finalTitle) { toast.error("请填写标题或选择 L6 任务"); return; }

    try {
      await createMutation.mutateAsync({
        date,
        startTime,
        endTime,
        title: finalTitle,
        description: desc || undefined,
        linkedNodeId: mode === "l6" ? linkedNodeId : undefined,
      });
      toast.success("日程已添加");
      onCreated();
      onClose();
    } catch (e: any) {
      toast.error(e?.message || "添加失败");
    }
  };

  // 弹窗定位：避免超出底部
  const top = Math.min(anchorY, TIMELINE_HEIGHT - 280);

  return (
    <div
      className="absolute left-16 z-30 w-72 bg-background border border-border rounded-xl shadow-xl p-4"
      style={{ top }}
      onClick={e => e.stopPropagation()}
    >
      {/* 时间范围标题 */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-foreground">
          {startTime} – {endTime}
        </span>
        <button onClick={onClose} className="p-0.5 rounded hover:bg-muted text-muted-foreground">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 模式选择 */}
      {mode === "choose" && (
        <div className="space-y-2">
          <button
            onClick={() => setMode("l6")}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border hover:border-primary/40 hover:bg-primary/5 transition-all text-left"
          >
            <Link2 className="w-4 h-4 text-primary shrink-0" />
            <div>
              <p className="text-xs font-medium">关联 L6 任务</p>
              <p className="text-[10px] text-muted-foreground">从本周重点工作中选择</p>
            </div>
          </button>
          <button
            onClick={() => setMode("manual")}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border hover:border-primary/40 hover:bg-primary/5 transition-all text-left"
          >
            <Pencil className="w-4 h-4 text-muted-foreground shrink-0" />
            <div>
              <p className="text-xs font-medium">手动输入</p>
              <p className="text-[10px] text-muted-foreground">计划外任务或临时安排</p>
            </div>
          </button>
        </div>
      )}

      {/* L6 关联模式 */}
      {mode === "l6" && (
        <div className="space-y-2">
          <button onClick={() => setMode("choose")} className="text-[10px] text-muted-foreground hover:text-foreground">← 返回</button>
          <div className="max-h-48 overflow-y-auto space-y-1 border rounded-lg p-1">
            {l6Nodes.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">暂无 L6 任务</p>
            )}
            {l6Nodes.map(n => (
              <button
                key={n.id}
                onClick={() => setLinkedNodeId(n.id === linkedNodeId ? null : n.id)}
                className={cn(
                  "w-full text-left px-2.5 py-2 rounded-lg text-xs transition-all",
                  linkedNodeId === n.id
                    ? "bg-primary/10 border border-primary/30 text-primary"
                    : "hover:bg-muted border border-transparent"
                )}
              >
                <div className="flex items-center gap-2">
                  {n.priority && (
                    <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", PRIORITY_BAR[n.priority] || "bg-slate-400")} />
                  )}
                  <span className="truncate font-medium">{n.title}</span>
                </div>
                {n.owner && <span className="text-[10px] text-muted-foreground ml-3.5">@{n.owner}</span>}
              </button>
            ))}
          </div>
          <div className="flex gap-2 mt-2">
            <button onClick={onClose} className="flex-1 py-1.5 rounded-lg text-xs border hover:bg-muted transition-colors">取消</button>
            <button
              onClick={handleSave}
              disabled={!linkedNodeId || createMutation.isPending}
              className="flex-1 py-1.5 rounded-lg text-xs bg-primary text-primary-foreground disabled:opacity-40 transition-colors"
            >
              {createMutation.isPending ? "…" : "确认"}
            </button>
          </div>
        </div>
      )}

      {/* 手动输入模式 */}
      {mode === "manual" && (
        <div className="space-y-2">
          <button onClick={() => setMode("choose")} className="text-[10px] text-muted-foreground hover:text-foreground">← 返回</button>
          <input
            autoFocus
            value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSave()}
            placeholder="日程标题 *"
            className="w-full px-2.5 py-1.5 rounded-lg text-xs bg-muted/50 border border-border/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
          <input
            value={desc}
            onChange={e => setDesc(e.target.value)}
            placeholder="备注（选填）"
            className="w-full px-2.5 py-1.5 rounded-lg text-xs bg-muted/50 border border-border/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 py-1.5 rounded-lg text-xs border hover:bg-muted transition-colors">取消</button>
            <button
              onClick={handleSave}
              disabled={createMutation.isPending}
              className="flex-1 py-1.5 rounded-lg text-xs bg-primary text-primary-foreground disabled:opacity-40 transition-colors"
            >
              {createMutation.isPending ? "…" : "保存"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 日程块 ────────────────────────────────────────────────────────────────────

function ScheduleBlock({
  item,
  date,
  onToggle,
  onDelete,
}: {
  item: DailyScheduleItem;
  date: string;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const startAbs = timeToAbsHour(item.startTime);
  const endAbs   = timeToAbsHour(item.endTime);
  const duration = Math.max(endAbs - startAbs, 0.5);
  const top    = absHourToY(startAbs);
  const height = Math.max(duration * HOUR_PX - 2, 24);

  return (
    <div
      className={cn(
        "absolute left-14 right-2 rounded-lg border px-2 py-1 group transition-all overflow-hidden",
        item.isDone
          ? "bg-emerald-500/10 border-emerald-300/40 opacity-70"
          : "bg-primary/10 border-primary/30 hover:border-primary/60 hover:shadow-sm"
      )}
      style={{ top, height }}
    >
      <div className="flex items-start gap-1.5 h-full">
        <button
          onClick={e => { e.stopPropagation(); onToggle(); }}
          className="shrink-0 mt-0.5"
        >
          {item.isDone
            ? <CheckCircle2 className="w-3 h-3 text-emerald-500" />
            : <Circle className="w-3 h-3 text-primary/60 hover:text-primary" />
          }
        </button>
        <div className="flex-1 min-w-0">
          <p className={cn(
            "text-[11px] font-medium leading-tight truncate",
            item.isDone && "line-through text-muted-foreground"
          )}>
            {item.title}
          </p>
          {height >= 36 && (
            <p className="text-[9px] text-muted-foreground mt-0.5">
              {item.startTime} – {item.endTime}
            </p>
          )}
        </div>
        <button
          onClick={e => { e.stopPropagation(); onDelete(); }}
          className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-500"
        >
          <Trash2 className="w-2.5 h-2.5" />
        </button>
      </div>
    </div>
  );
}

// ── 主组件 ────────────────────────────────────────────────────────────────────

interface VerticalTimelineProps {
  date: string;
  onClose: () => void;
}

export function VerticalTimeline({ date, onClose }: VerticalTimelineProps) {
  const { data, isLoading } = useDailySchedules(date);
  const deleteMutation  = useDeleteSchedule();
  const toggleMutation  = useToggleScheduleDone();

  // 拖拽状态
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragStart, setDragStart] = useState<number | null>(null);   // absHour
  const [dragEnd,   setDragEnd]   = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // 弹窗状态
  const [popover, setPopover] = useState<{
    startTime: string; endTime: string; anchorY: number;
  } | null>(null);

  // 将容器内 clientY 转为 absHour
  const clientYToAbsHour = useCallback((clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const y = clientY - rect.top + (containerRef.current?.scrollTop || 0);
    return yToAbsHour(y);
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // 只响应左键，且不在日程块上
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("[data-schedule-block]")) return;
    const abs = clientYToAbsHour(e.clientY);
    setDragStart(abs);
    setDragEnd(abs);
    setIsDragging(true);
    setPopover(null);
  }, [clientYToAbsHour]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    setDragEnd(clientYToAbsHour(e.clientY));
  }, [isDragging, clientYToAbsHour]);

  const handleMouseUp = useCallback(() => {
    if (!isDragging || dragStart === null || dragEnd === null) return;
    setIsDragging(false);

    const lo = Math.min(dragStart, dragEnd);
    const hi = Math.max(dragStart, dragEnd);
    // 最小 30 分钟
    const finalEnd = hi - lo < 0.5 ? lo + 1 : hi;

    const startTime = absHourToTime(lo);
    const endTime   = absHourToTime(finalEnd);
    const anchorY   = absHourToY(lo);

    setPopover({ startTime, endTime, anchorY });
    setDragStart(null);
    setDragEnd(null);
  }, [isDragging, dragStart, dragEnd]);

  // 全局 mouseup（防止拖出容器后不触发）
  useEffect(() => {
    const up = () => { if (isDragging) handleMouseUp(); };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, [isDragging, handleMouseUp]);

  const handleDelete = async (item: DailyScheduleItem) => {
    try {
      await deleteMutation.mutateAsync({ id: item.id, date });
      toast.success("已删除");
    } catch {
      toast.error("删除失败");
    }
  };

  const handleToggle = async (item: DailyScheduleItem) => {
    try {
      await toggleMutation.mutateAsync({ id: item.id, date, isDone: !item.isDone });
    } catch {
      toast.error("更新失败");
    }
  };

  // 拖拽选区的视觉矩形
  const selectionRect = isDragging && dragStart !== null && dragEnd !== null
    ? {
        top:    absHourToY(Math.min(dragStart, dragEnd)),
        height: Math.max(Math.abs(dragEnd - dragStart), 0.5) * HOUR_PX,
      }
    : null;

  // 当前时间指示线
  const now = new Date();
  const nowAbs = ((now.getHours() - START_HOUR + 24) % 24) + now.getMinutes() / 60;
  const nowY = absHourToY(nowAbs);

  return (
    <div className="w-80 shrink-0 border-l bg-background flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{date}</span>
          {isLoading && <span className="text-[10px] text-muted-foreground animate-pulse">加载中…</span>}
        </div>
        <div className="flex items-center gap-2">
          {/* 图例 */}
          <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground">
            <span className="w-2 h-2 rounded-sm bg-blue-400/30 inline-block" />工作
            <span className="w-2 h-2 rounded-sm bg-orange-400/30 inline-block" />生活
            <span className="w-2 h-2 rounded-sm bg-violet-400/30 inline-block" />睡眠
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground text-center py-1 border-b bg-muted/20 shrink-0">
        拖拽选择时间段以添加日程
      </p>

      {/* 时间轴滚动区 */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto relative select-none"
        style={{ cursor: isDragging ? "ns-resize" : "crosshair" }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      >
        <div className="relative" style={{ height: TIMELINE_HEIGHT }}>

          {/* ── 热力图背景 ── */}
          {HEAT_ZONES.map(zone => (
            <div
              key={zone.label}
              className={cn("absolute left-0 right-0 pointer-events-none", zone.color)}
              style={{
                top:    absHourToY(zone.startAbs),
                height: (zone.endAbs - zone.startAbs) * HOUR_PX,
              }}
            />
          ))}

          {/* ── 小时刻度线 + 标签 ── */}
          {Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => {
            const y = i * HOUR_PX;
            const label = absHourToTime(i);
            const isMajor = i % 3 === 0;
            return (
              <div key={i} className="absolute left-0 right-0 pointer-events-none" style={{ top: y }}>
                <div className={cn(
                  "absolute left-0 right-0 border-t",
                  isMajor ? "border-border/40" : "border-border/15"
                )} />
                <span className={cn(
                  "absolute left-1 text-[9px] font-mono -translate-y-1/2",
                  isMajor ? "text-muted-foreground" : "text-muted-foreground/40"
                )}>
                  {label}
                </span>
              </div>
            );
          })}

          {/* ── 当前时间指示线 ── */}
          <div
            className="absolute left-0 right-0 pointer-events-none z-10"
            style={{ top: nowY }}
          >
            <div className="absolute left-10 right-0 border-t-2 border-red-400/70 border-dashed" />
            <div className="absolute left-8 w-2 h-2 rounded-full bg-red-400 -translate-y-1/2" />
          </div>

          {/* ── 拖拽选区高亮 ── */}
          {selectionRect && (
            <div
              className="absolute left-12 right-1 rounded-md bg-primary/15 border border-primary/40 border-dashed pointer-events-none z-20"
              style={{ top: selectionRect.top, height: selectionRect.height }}
            />
          )}

          {/* ── 已有日程块 ── */}
          {(data?.schedules || []).map(item => (
            <div key={item.id} data-schedule-block="true">
              <ScheduleBlock
                item={item}
                date={date}
                onToggle={() => handleToggle(item)}
                onDelete={() => handleDelete(item)}
              />
            </div>
          ))}

          {/* ── 选区弹窗 ── */}
          {popover && (
            <SelectionPopover
              startTime={popover.startTime}
              endTime={popover.endTime}
              date={date}
              anchorY={popover.anchorY}
              onClose={() => setPopover(null)}
              onCreated={() => setPopover(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

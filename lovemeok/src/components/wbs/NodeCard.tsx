import { cn } from "@/lib/utils";
import { Clock, User, Plus, Pencil, Trash2, Timer } from "lucide-react";

// ── Category → left strip color ──
const CATEGORY_STRIP: Record<string, string> = {
  "工作": "bg-cat-work",
  "生活": "bg-cat-life",
  "成长": "bg-cat-growth",
};

// ── Priority config ──
const PRIORITY_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  P0: { label: "P0", bg: "bg-destructive", text: "text-destructive-foreground" },
  P1: { label: "P1", bg: "bg-[hsl(var(--status-behind))]", text: "text-white" },
  P2: { label: "P2", bg: "bg-[hsl(var(--status-at-risk))]", text: "text-white" },
  P3: { label: "P3", bg: "bg-muted", text: "text-muted-foreground" },
};

// ── Status config ──
const STATUS_CONFIG: Record<string, { dot: string; label: string }> = {
  PLANNED:                  { dot: "bg-muted-foreground/50",             label: "待开始" },
  IN_PROGRESS:              { dot: "bg-[hsl(var(--wbs-l5))]",            label: "进行中" },
  IN_PROGRESS_CROSS_WEEK:   { dot: "bg-[hsl(var(--wbs-l4))]",            label: "跨周进行中" },
  COMPLETED:                { dot: "bg-[hsl(var(--status-on-track))]",   label: "已完成" },
  DONE:                     { dot: "bg-[hsl(var(--status-on-track))]",   label: "已完成" },
  BLOCKED:                  { dot: "bg-destructive",                      label: "阻塞" },
  RESEARCHING:              { dot: "bg-[hsl(var(--wbs-l3))]",            label: "调研中" },
  PLANNING:                 { dot: "bg-[hsl(var(--wbs-l3))]",            label: "需求策划中" },
  DEVELOPING:               { dot: "bg-[hsl(var(--wbs-l4))]",            label: "开发中" },
  TESTING:                  { dot: "bg-[hsl(var(--wbs-l5))]",            label: "测试中" },
  GRAY_RELEASE:             { dot: "bg-[hsl(var(--status-on-track))]",   label: "已灰度" },
  on_track:                 { dot: "bg-[hsl(var(--status-on-track))]",   label: "正常" },
  at_risk:                  { dot: "bg-[hsl(var(--status-at-risk))]",    label: "风险" },
  behind:                   { dot: "bg-[hsl(var(--status-behind))]",     label: "落后" },
  completed:                { dot: "bg-[hsl(var(--status-on-track))]",   label: "已完成" },
  not_started:              { dot: "bg-muted-foreground/50",             label: "未开始" },
};

const LAYER_COLORS: Record<number, string> = {
  1: "wbs-l1", 2: "wbs-l2", 3: "wbs-l3", 4: "wbs-l4", 5: "wbs-l5", 6: "wbs-l6",
};

interface NodeCardProps {
  level: number;
  title: string;
  progress?: number;
  /** 双进度：子节点聚合进度（L5 专用，显示 L6 子任务平均进度） */
  subProgress?: number | null;
  priority?: string | null;
  status?: string | null;
  owner?: string | null;
  deadline?: string | null;      // plannedDate (free-text) for L4-L6; targetDate for others
  category?: string | null;
  feedback?: string | null;      // dataFeedback
  issueLog?: string | null;
  description?: string | null;
  estHours?: number | null;
  actHours?: number | null;
  variant?: "parent" | "child";
  className?: string;
  children?: React.ReactNode;
  /** When true, edit/delete icons are always visible (not just on hover) */
  alwaysShowActions?: boolean;
  /** Label for the claim/add button — shown in left-panel funnel views */
  claimLabel?: string;
  /**
   * "text" mode renders the structured inline-text format per level:
   *  L4: [title]：[deadline]。【优先级：P?】-owner
   *  L5: [title]：[deadline]。内容：[desc]。【进度：X%，status】【优先级：P?】-owner
   *  L6: same as L5 + 【数据】 + 【问题】 lines
   */
  textMode?: boolean;
  onClick?: () => void;
  onAdd?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

export function NodeCard({
  level, title, progress = 0, subProgress, priority, status, owner, deadline, category,
  feedback, issueLog, description,
  estHours, actHours,
  variant = "child", className, children, alwaysShowActions = false,
  claimLabel,
  textMode = false,
  onClick, onAdd, onEdit, onDelete,
}: NodeCardProps) {
  const colorKey = LAYER_COLORS[level] || "wbs-l4";
  const priorityCfg = priority ? PRIORITY_CONFIG[priority] : null;
  const statusCfg = status ? (STATUS_CONFIG[status] ?? STATUS_CONFIG["PLANNED"]) : STATUS_CONFIG["PLANNED"];
  const isParent = variant === "parent";

  const stripColor = category ? (CATEGORY_STRIP[category] || `bg-${colorKey}`) : `bg-${colorKey}`;
  const displayProgress = Math.min(100, Math.max(0, progress ?? 0));
  const displaySubProgress = subProgress != null ? Math.min(100, Math.max(0, subProgress)) : null;
  const statusLabel = statusCfg?.label ?? status ?? "";
  const priorityLabel = priority ?? "";
  const showOwner = owner != null && owner.trim() !== "";

  const actionVisibility = alwaysShowActions
    ? "opacity-100"
    : "opacity-0 group-hover/card:opacity-100";

  const hasActions = !!(claimLabel ? onAdd : (onAdd || onEdit || onDelete));

  const showHours = estHours != null || actHours != null;
  const showDeadline = deadline != null && deadline.trim() !== "";
  const showMeta = (showOwner || showHours || showDeadline) && !textMode;

  return (
    <div
      onClick={onClick}
      className={cn(
        "group/card relative rounded-xl border transition-all duration-200",
        isParent
          ? "bg-white dark:bg-[hsl(var(--card))] shadow-[0_2px_12px_-4px_rgba(0,0,0,0.10)] hover:shadow-[0_8px_24px_-6px_rgba(0,0,0,0.14)] border-slate-200 dark:border-border hover:border-slate-300 dark:hover:border-border"
          : "bg-white dark:bg-[hsl(var(--card))] border-slate-200 dark:border-border hover:border-slate-300 dark:hover:border-border shadow-[0_1px_4px_rgba(0,0,0,0.08)]",
        onClick && "cursor-pointer",
        className,
      )}
    >
      {/* Left category color strip */}
      <div className={cn("absolute left-0 top-2 bottom-2 w-1 rounded-full", stripColor)} />

      {/* Claim button (funnel mode) */}
      {claimLabel && onAdd && (
        <button
          onClick={(e) => { e.stopPropagation(); onAdd(); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-0.5 rounded-md bg-primary/10 text-primary text-[9px] font-semibold hover:bg-primary/20 transition-colors z-10 shrink-0"
        >
          {claimLabel}
        </button>
      )}

      {/* Standard action icons */}
      {!claimLabel && hasActions && (
        <div className={cn(
          "absolute right-2 flex items-center gap-0.5 transition-opacity duration-200 z-10",
          textMode ? "top-1/2 -translate-y-1/2" : "top-2",
          actionVisibility,
        )}>
          {onAdd && (
            <button
              onClick={(e) => { e.stopPropagation(); onAdd(); }}
              className="p-1 rounded-md hover:bg-primary/10 text-muted-foreground/60 hover:text-primary transition-colors"
              title="新增子项"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}
          {onEdit && (
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(); }}
              className="p-1 rounded-md hover:bg-primary/10 text-muted-foreground/60 hover:text-primary transition-colors"
              title="编辑"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          )}
          {onDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="p-1 rounded-md hover:bg-destructive/10 text-muted-foreground/60 hover:text-destructive transition-colors"
              title="删除"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* ── TEXT MODE (L4 / L5 / L6 structured inline text) ─────────────────── */}
      {textMode ? (
        <div className={cn("p-2.5 pl-4 space-y-0.5", (!claimLabel && hasActions) ? "pr-16" : "pr-3")}>

          {/* ── L4: same as L5 format — title + plannedDate + description + progress + status + priority + owner ── */}
          {level === 4 && (
            <p className="text-xs leading-relaxed text-card-foreground">
              <span className="font-semibold">{title}</span>
              {deadline && deadline.trim()
                ? <>：<span className="text-muted-foreground">{deadline}</span></>
                : null}
              {description && description.trim()
                ? <>。内容：<span className="text-muted-foreground/80">{description}</span></>
                : null}
              {(displayProgress > 0 || statusLabel)
                ? <>。<span className="text-muted-foreground/70">【进度：{displayProgress}%，{statusLabel}】</span></>
                : null}
              {priorityLabel
                ? <span className="text-muted-foreground/70">【优先级：{priorityLabel}】</span>
                : null}
              {showOwner
                ? <span className="text-muted-foreground/70">-{owner}</span>
                : null}
            </p>
          )}

          {/* ── L5: [title]：[deadline]。内容：[desc]。【进度/status】【优先级】-owner ── */}
          {level === 5 && (
            <>
              <p className="text-xs leading-relaxed text-card-foreground">
                <span className="font-semibold">{title}</span>
                {deadline && deadline.trim()
                  ? <>：<span className="text-muted-foreground">{deadline}</span></>
                  : null}
                {description && description.trim()
                  ? <>。内容：<span className="text-muted-foreground/80">{description}</span></>
                  : null}
                。<span className="text-muted-foreground/70">【计划进度：{displayProgress}%，{statusLabel}】</span>
                {displaySubProgress != null
                  ? <span className="text-[hsl(var(--wbs-l6))]">【实际进度：{displaySubProgress}%】</span>
                  : null}
                {priorityLabel
                  ? <span className="text-muted-foreground/70">【优先级：{priorityLabel}】</span>
                  : null}
                {showOwner
                  ? <span className="text-muted-foreground/70">-{owner}</span>
                  : null}
              </p>
              {/* 双进度条：计划 vs 实际 */}
              {displaySubProgress != null && (
                <div className="mt-1.5 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] text-muted-foreground/50 w-8 shrink-0">计划</span>
                    <div className="flex-1 h-1 rounded-full bg-muted/60 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[hsl(var(--wbs-l5))] transition-all duration-700"
                        style={{ width: `${displayProgress}%` }}
                      />
                    </div>
                    <span className="text-[9px] tabular-nums text-muted-foreground/60 w-6 text-right">{displayProgress}%</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] text-muted-foreground/50 w-8 shrink-0">实际</span>
                    <div className="flex-1 h-1 rounded-full bg-muted/60 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[hsl(var(--wbs-l6))] transition-all duration-700"
                        style={{ width: `${displaySubProgress}%` }}
                      />
                    </div>
                    <span className="text-[9px] tabular-nums text-[hsl(var(--wbs-l6))] w-6 text-right font-semibold">{displaySubProgress}%</span>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── L6: same as L5 + 【数据】 + 【问题】 ── */}
          {level === 6 && (
            <>
              <p className="text-xs leading-relaxed text-card-foreground">
                <span className="font-semibold">{title}</span>
                {deadline && deadline.trim()
                  ? <>：<span className="text-muted-foreground">{deadline}</span></>
                  : null}
                {description && description.trim()
                  ? <>。内容：<span className="text-muted-foreground/80">{description}</span></>
                  : null}
                。<span className="text-muted-foreground/70">【进度：{displayProgress}%，{statusLabel}】</span>
                {priorityLabel
                  ? <span className="text-muted-foreground/70">【优先级：{priorityLabel}】</span>
                  : null}
                {showOwner
                  ? <span className="text-muted-foreground/70">-{owner}</span>
                  : null}
              </p>
              {feedback && feedback.trim() && (
                <p className="text-xs leading-relaxed text-muted-foreground/80">
                  <span className="font-medium text-foreground/60">【数据】</span>{feedback}
                </p>
              )}
              {issueLog && issueLog.trim() && (
                <p className="text-xs leading-relaxed text-muted-foreground/80">
                  <span className="font-medium text-foreground/60">【问题】</span>{issueLog}
                </p>
              )}
            </>
          )}
        </div>
      ) : (
        /* ── STANDARD LAYOUT ──────────────────────────────────────────────────── */
        <div className={cn(
          isParent ? "p-3 pl-5" : "p-2.5 pl-4",
          claimLabel ? "pr-14" : "",
        )}>
          {/* Row 1: status dot + title + priority badge */}
          <div className={cn("flex items-center gap-2", (!claimLabel && hasActions) ? "pr-16" : "pr-2")}>
            <span className={cn("w-2 h-2 rounded-full shrink-0", statusCfg.dot)} title={statusLabel} />
            <h3 className={cn(
              "truncate flex-1 min-w-0",
              isParent ? "text-sm font-semibold text-card-foreground" : "text-xs font-medium text-card-foreground",
            )}>
              {title}
            </h3>
            {priority && priorityCfg && (
              <span className={cn(
                "px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0",
                priorityCfg.bg, priorityCfg.text,
              )}>
                {priorityCfg.label}
              </span>
            )}
          </div>

          {/* dataFeedback block */}
          {feedback && (
            <div className="mt-1.5 pl-0.5">
              <p className="text-[11px] text-muted-foreground/70 leading-relaxed line-clamp-2">
                <span className="font-medium text-muted-foreground">【数据】</span>{feedback}
              </p>
            </div>
          )}

          {/* Progress bar — L5: 双进度条（计划 vs 实际），其他层级：单条 */}
          {level === 5 && displaySubProgress != null ? (
            <div className="mt-2 space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-muted-foreground/50 w-8 shrink-0">计划</span>
                <div className={cn("flex-1 rounded-full bg-muted/60 overflow-hidden", isParent ? "h-2" : "h-1.5")}>
                  <div
                    className="h-full rounded-full bg-[hsl(var(--wbs-l5))] transition-all duration-700"
                    style={{ width: `${displayProgress}%` }}
                  />
                </div>
                <span className="text-[10px] font-semibold tabular-nums text-muted-foreground w-9 text-right">
                  {displayProgress}%
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-muted-foreground/50 w-8 shrink-0">实际</span>
                <div className={cn("flex-1 rounded-full bg-muted/60 overflow-hidden", isParent ? "h-2" : "h-1.5")}>
                  <div
                    className="h-full rounded-full bg-[hsl(var(--wbs-l6))] transition-all duration-700"
                    style={{ width: `${displaySubProgress}%` }}
                  />
                </div>
                <span className="text-[10px] font-semibold tabular-nums text-[hsl(var(--wbs-l6))] w-9 text-right">
                  {displaySubProgress}%
                </span>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 mt-2">
              <div className={cn("flex-1 rounded-full bg-muted/60 overflow-hidden", isParent ? "h-2" : "h-1.5")}>
                <div
                  className={cn("h-full rounded-full bg-gradient-to-r transition-all duration-700",
                    `from-[hsl(var(--${colorKey}))] to-[hsl(var(--${LAYER_COLORS[Math.min(level + 1, 6)] || colorKey}))]`,
                  )}
                  style={{ width: `${displayProgress}%` }}
                />
              </div>
              <span className="text-[11px] font-semibold tabular-nums text-muted-foreground w-9 text-right">
                {displayProgress}%
              </span>
            </div>
          )}

          {/* Meta row */}
          {showMeta && (
            <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground">
              {showOwner && (
                <div className="flex items-center gap-1">
                  <User className="w-3 h-3" />
                  <span className="truncate max-w-[80px]">{owner}</span>
                </div>
              )}
              {showHours && (
                <div className="flex items-center gap-1">
                  <Timer className="w-3 h-3" />
                  <span className="tabular-nums">
                    {estHours != null ? `${estHours}h` : "—"}
                    {" / "}
                    {actHours != null ? `${actHours}h` : "—"}
                  </span>
                </div>
              )}
              {showDeadline && (
                <div className="flex items-center gap-1 ml-auto">
                  <Clock className="w-3 h-3" />
                  <span className="truncate max-w-[120px]">{deadline}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {children}
    </div>
  );
}

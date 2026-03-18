import { Inbox, Search, CalendarPlus } from "lucide-react";
import { cn } from "@/lib/utils";

type EmptyVariant = "search" | "no-plan" | "default";

interface EmptyStateProps {
  variant?: EmptyVariant;
  title?: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

const VARIANT_CONFIG: Record<EmptyVariant, { icon: React.ReactNode; defaultTitle: string; defaultDesc: string }> = {
  search: {
    icon: <Search className="w-8 h-8 text-muted-foreground/40" />,
    defaultTitle: "没有匹配的结果",
    defaultDesc: "试试调整搜索关键词或关闭「只看未完成」筛选",
  },
  "no-plan": {
    icon: <CalendarPlus className="w-8 h-8 text-muted-foreground/40" />,
    defaultTitle: "本月暂无计划",
    defaultDesc: "从左侧战略任务库中领取任务，开始规划你的本月工作",
  },
  default: {
    icon: <Inbox className="w-8 h-8 text-muted-foreground/40" />,
    defaultTitle: "暂无数据",
    defaultDesc: "点击下方按钮开始创建",
  },
};

export function EmptyState({
  variant = "default",
  title,
  description,
  actionLabel,
  onAction,
  className,
}: EmptyStateProps) {
  const cfg = VARIANT_CONFIG[variant];

  return (
    <div className={cn("flex flex-col items-center justify-center py-8 text-center", className)}>
      <div className="w-10 h-10 rounded-xl bg-muted/50 flex items-center justify-center mb-2">
        {cfg.icon}
      </div>
      <p className="text-sm font-medium text-muted-foreground">{title || cfg.defaultTitle}</p>
      <p className="text-xs text-muted-foreground/70 mt-1 max-w-[280px]">{description || cfg.defaultDesc}</p>
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className={cn(
            "mt-5 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium",
            "bg-primary text-primary-foreground",
            "shadow-[0_4px_16px_-4px_hsl(var(--primary)/0.35)]",
            "hover:shadow-[0_6px_24px_-4px_hsl(var(--primary)/0.45)]",
            "transition-all duration-300 hover:translate-y-[-1px]",
          )}
        >
          <CalendarPlus className="w-3.5 h-3.5" />
          {actionLabel}
        </button>
      )}
    </div>
  );
}
